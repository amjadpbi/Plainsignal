import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';

/**
 * PROVIDER-AGNOSTIC NARRATIVE CLIENT (Phase 4).
 *
 * The AI layer is a REASONING layer over real numbers — it never produces a
 * metric (CLAUDE.md §1). Which vendor generates the prose is an implementation
 * detail; what matters is that the output passes the grounding guard
 * (src/lib/ai/grounding.ts) before a user ever sees it. That guard sits
 * downstream of EVERY provider here and is deliberately provider-unaware.
 *
 * Supported:
 *   - OpenRouter (default) — OpenAI-compatible, has genuinely free models,
 *     so it needs no paid billing to run.
 *   - Anthropic — first-party SDK, requires paid billing.
 *
 * Selection order: AI_PROVIDER (explicit) → OpenRouter key → Anthropic key →
 * mock mode (deterministic narrative, no model call).
 */

export type ProviderName = 'openrouter' | 'anthropic';

export interface GenerateInput {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface NarrativeProvider {
  readonly name: ProviderName;
  readonly model: string;
  /** Return the model's plain-text response. Throws AiError on failure. */
  generate(input: GenerateInput): Promise<string>;
}

/** Thrown when a provider call fails, so routes can distinguish it. */
export class AiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly provider?: ProviderName,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

const DEFAULT_MAX_TOKENS = 16000;

// ------------------------------------------------------------- OpenRouter --

type FetchFn = typeof fetch;

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchFn?: FetchFn;
}

/** Shape of an OpenAI-compatible chat completion response. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string; code?: number };
}

/**
 * OpenRouter — OpenAI-compatible chat completions.
 * Verified 2026-07-19: POST https://openrouter.ai/api/v1/chat/completions,
 * `Authorization: Bearer <key>`. Free models use `:free` IDs, and the free
 * lineup rotates, so the default model is the `openrouter/free` auto-router
 * rather than a specific free model that may be withdrawn.
 */
export class OpenRouterProvider implements NarrativeProvider {
  readonly name = 'openrouter' as const;
  readonly model: string;
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;

  constructor(private readonly opts: OpenRouterOptions) {
    this.model = opts.model;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.baseUrl = (opts.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  }

  async generate({ system, user, maxTokens }: GenerateInput): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          'Content-Type': 'application/json',
          // Optional attribution headers OpenRouter uses for app ranking.
          'X-Title': 'Plainsignal',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
          // Low temperature for a factual narrative. Valid here (OpenAI-
          // compatible); it would be a 400 on Anthropic's current models.
          temperature: 0.2,
        }),
      });
    } catch (err) {
      throw new AiError(
        `Could not reach OpenRouter: ${err instanceof Error ? err.message : 'network error'}`,
        undefined,
        this.name,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body) as ChatCompletionResponse;
        if (parsed?.error?.message) detail = parsed.error.message;
      } catch {
        /* keep raw text */
      }
      throw new AiError(
        `OpenRouter API error (HTTP ${res.status}): ${detail}`,
        res.status,
        this.name,
      );
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) {
      throw new AiError('OpenRouter returned an empty response.', undefined, this.name);
    }
    return text.trim();
  }
}

// -------------------------------------------------------------- Anthropic --

export const ANTHROPIC_MODEL = 'claude-opus-4-8';

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
}

/**
 * Anthropic first-party SDK. Note the current models reject `temperature`,
 * `top_p`, `top_k`, and `budget_tokens` with a 400 — depth is controlled by
 * adaptive thinking plus `output_config.effort`.
 */
export class AnthropicProvider implements NarrativeProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private client: Anthropic;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model ?? ANTHROPIC_MODEL;
    this.client = new Anthropic({ apiKey: opts.apiKey });
  }

  async generate({ system, user, maxTokens }: GenerateInput): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system,
        messages: [{ role: 'user', content: user }],
      });

      return response.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
    } catch (err) {
      throw toAnthropicError(err);
    }
  }
}

function toAnthropicError(err: unknown): AiError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError('Anthropic rejected the API key (401).', 401, 'anthropic');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError('Anthropic rate limit reached — try again shortly.', 429, 'anthropic');
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(
      `Anthropic API error (${err.status}): ${err.message}`,
      err.status,
      'anthropic',
    );
  }
  return new AiError(
    err instanceof Error ? err.message : 'Unknown Anthropic error.',
    undefined,
    'anthropic',
  );
}

// ---------------------------------------------------------------- factory --

function openRouterConfigured(): boolean {
  return env.OPENROUTER_API_KEY.trim().length > 0;
}

function anthropicConfigured(): boolean {
  return env.ANTHROPIC_API_KEY.trim().length > 0;
}

/** True when NO provider is configured — the narrative is templated instead. */
export const AI_MOCK_MODE = !openRouterConfigured() && !anthropicConfigured();

let cached: NarrativeProvider | null | undefined;

/**
 * Resolve the configured provider, or null when none is set (mock mode).
 * `AI_PROVIDER` forces a choice; otherwise OpenRouter wins when both keys are
 * present, since it does not require paid billing.
 */
export function getNarrativeProvider(): NarrativeProvider | null {
  if (cached !== undefined) return cached;

  const forced = env.AI_PROVIDER.trim().toLowerCase();

  if (forced === 'anthropic' || (!forced && !openRouterConfigured() && anthropicConfigured())) {
    cached = anthropicConfigured()
      ? new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY.trim() })
      : null;
    return cached;
  }

  if (forced === 'openrouter' || (!forced && openRouterConfigured())) {
    cached = openRouterConfigured()
      ? new OpenRouterProvider({
          apiKey: env.OPENROUTER_API_KEY.trim(),
          model: env.OPENROUTER_MODEL.trim() || 'openrouter/free',
          baseUrl: env.OPENROUTER_BASE_URL.trim() || undefined,
        })
      : null;
    return cached;
  }

  cached = null;
  return cached;
}

/** Test hook — clears the memoized provider. */
export function resetNarrativeProvider(): void {
  cached = undefined;
}
