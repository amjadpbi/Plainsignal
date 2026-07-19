import { z } from 'zod';

/**
 * Centralized, validated environment access. Import `env` instead of reading
 * process.env directly so a misconfigured deploy fails loudly and early.
 *
 * Server-only. Never import this into a client component.
 */
const schema = z.object({
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().optional(),

  ETSY_API_KEY: z.string().optional().default(''),
  ETSY_API_BASE: z
    .string()
    .url()
    .optional()
    .default('https://openapi.etsy.com/v3/application'),
  ETSY_RATE_PER_SECOND: z.coerce.number().int().positive().default(5),
  ETSY_RATE_PER_DAY: z.coerce.number().int().positive().default(5000),
  ETSY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),

  // --- AI layer (Phase 4) — provider-agnostic narrative ---
  // The AI only writes rationale over numbers we computed; the grounding guard
  // validates its output regardless of provider. When NO key is set, the layer
  // runs in mock mode: metrics are still real, the narrative is templated.
  //
  // OpenRouter is the default (free models available, no paid billing).
  // Set AI_PROVIDER to force one when both keys are present.
  AI_PROVIDER: z.enum(['openrouter', 'anthropic', '']).optional().default(''),
  OPENROUTER_API_KEY: z.string().optional().default(''),
  // Free-model IDs end in `:free` and the lineup rotates, so default to the
  // auto-router rather than pinning a model that may be withdrawn.
  OPENROUTER_MODEL: z.string().optional().default('openrouter/free'),
  OPENROUTER_BASE_URL: z.string().optional().default('https://openrouter.ai/api/v1'),
  // Optional alternative provider — requires paid billing.
  ANTHROPIC_API_KEY: z.string().optional().default(''),

  // --- Trademark source (Phase 3) ---
  // No official keyless USPTO text-search API exists (TESS retired; TSDR is
  // serial-number lookup behind a key; ODP is bulk data behind an account).
  // Point these at whichever register you have rights to query; when unset,
  // the trademark module runs in mock mode.
  TRADEMARK_API_URL: z.string().optional().default(''),
  TRADEMARK_API_KEY: z.string().optional().default(''),

  // --- Supabase Auth (Phase 2) — identity issuer only ---
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional().default(''),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message rather than undefined-at-runtime surprises.
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration. See .env.example.');
}

export const env = parsed.data;

/**
 * When true, the Etsy client returns deterministic synthetic data instead of
 * hitting the network. This is the default until an ETSY_API_KEY is set, so the
 * whole keyword pipeline is usable with zero external credentials.
 */
export const ETSY_MOCK_MODE = env.ETSY_API_KEY.trim().length === 0;

/**
 * Normalize a Supabase project URL to its origin. The dashboard sometimes hands
 * out the PostgREST endpoint (…/rest/v1/); the auth client needs the bare
 * project origin (https://<ref>.supabase.co), so strip any path/suffix.
 */
export function supabaseOrigin(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/**
 * Supabase config, validated at call time so the rest of the app can boot
 * without auth configured. Throws a clear error if auth is used unconfigured.
 */
export function getSupabaseConfig() {
  const url = supabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY.trim();
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  return { url, anonKey, serviceRoleKey };
}

export const SUPABASE_CONFIGURED =
  supabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL).length > 0 &&
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim().length > 0;
