import 'server-only';
import {
  AI_MOCK_MODE,
  getNarrativeProvider,
  type NarrativeProvider,
  type ProviderName,
} from '../ai/provider';
import { buildAllowedFigures, verifyGrounding, type GroundingViolation } from '../ai/grounding';
import type { TenantDb } from '../db/tenant';
import { buildSellerContext, contextFigures, type SellerContext } from './context';

/**
 * AI SELLER COACH (CLAUDE.md §4.7 / Phase 4, module 11).
 *
 * A chat assistant that answers from the seller's OWN data — their saved
 * searches, keyword snapshots and scores, listing audits, and pricing history
 * — never from generic advice or invented figures.
 *
 * Same architecture as the pricing assistant:
 *   1. Load real data from our Postgres (tenant-scoped).
 *   2. Hand it to whichever provider is configured (OpenRouter by default).
 *   3. Run the SAME grounding guard over the answer. Any number that does not
 *      trace back to the supplied context gets the answer discarded in favour
 *      of the real figures.
 */

export type CoachTurn = { role: 'user' | 'assistant'; content: string };

export type CoachAnswer = {
  question: string;
  answer: string;
  /** 'model' when a provider wrote it, 'context' when we fell back to real data. */
  origin: 'model' | 'context';
  provider?: ProviderName;
  model?: string;
  groundingViolations: GroundingViolation[];
  /** What the coach was allowed to see, echoed back for transparency. */
  context: SellerContext;
  notes: string[];
};

const SYSTEM_PROMPT = `You are an Etsy seller coach. You advise ONE seller, using ONLY their own data, which is supplied to you as JSON.

Hard rules:
- Every number you state — prices, percentages, scores, competition counts, favourites — must come from the supplied data. Never state a figure that is not in it.
- Do not estimate, project, forecast, or extrapolate. No predicted sales, revenue, conversion rates, or traffic. That data does not exist.
- Do not cite industry benchmarks, averages, or numbers from your general knowledge.
- If the data does not answer the question, say so plainly and say what the seller would need to run to find out.
- Refer to the seller's actual keywords, listings, and scores by name.
- Do not mention dates or years unless quoting a capture date from the data.
- Be concise and specific. No preamble, no generic Etsy tips.`;

/** Deterministic answer built only from real figures — used when AI is off or rejected. */
export function contextSummary(ctx: SellerContext): string {
  if (ctx.isEmpty) {
    return 'There is no saved data on this account yet. Run a keyword search, audit a listing, or save a fee calculation, and this coach will answer from those real numbers.';
  }

  const parts: string[] = [];

  if (ctx.keywords.length > 0) {
    const best = [...ctx.keywords].sort(
      (a, b) => (b.opportunity ?? 0) - (a.opportunity ?? 0),
    )[0];
    parts.push(
      `You are tracking ${ctx.keywords.length} keyword${ctx.keywords.length === 1 ? '' : 's'}.`,
    );
    parts.push(
      `"${best.keyword}" has the highest opportunity score at ${best.opportunity ?? 0}, with ${best.competitionCount.toLocaleString()} competing listings, ${best.avgFavorites} average favourites, and a verdict of ${best.verdict ?? 'n/a'}.`,
    );
  }

  if (ctx.audits.length > 0) {
    const latest = ctx.audits[0];
    parts.push(
      `Your most recent listing audit (${latest.listingId}) scored ${latest.score} out of 100 with ${latest.findingCount} finding${latest.findingCount === 1 ? '' : 's'}.`,
    );
  }

  if (ctx.feeCalculations.length > 0) {
    const f = ctx.feeCalculations[0];
    parts.push(
      `Your latest saved fee calculation prices at $${f.salePrice.toFixed(2)} for a net profit of $${f.netProfit.toFixed(2)} (${f.marginPct.toFixed(1)}% margin).`,
    );
  }

  return parts.join(' ');
}

function buildUserMessage(ctx: SellerContext, question: string, history: CoachTurn[]): string {
  const priorTurns =
    history.length > 0
      ? `\n\nEarlier in this conversation:\n${history
          .slice(-6)
          .map((t) => `${t.role === 'user' ? 'Seller' : 'You'}: ${t.content}`)
          .join('\n')}`
      : '';

  return `Here is the seller's real data from our database:\n\n${JSON.stringify(ctx, null, 2)}${priorTurns}\n\nSeller's question: ${question}\n\nAnswer using only the figures above.`;
}

export interface CoachOptions {
  /** Inject a provider instead of resolving from env (used by tests). */
  provider?: NarrativeProvider;
  /** Force the deterministic answer. */
  disableAi?: boolean;
  history?: CoachTurn[];
}

export async function askCoach(
  db: TenantDb,
  question: string,
  opts: CoachOptions = {},
): Promise<CoachAnswer> {
  const trimmed = question.trim();
  if (!trimmed) throw new Error('Question must not be empty.');

  // ---- 1. REAL data, tenant-scoped. ----
  const context = await buildSellerContext(db);
  const notes: string[] = [
    'The coach can only see your own saved data: searches, keyword snapshots and scores, listing audits, and fee calculations.',
  ];

  const fallback = contextSummary(context);
  let answer: CoachAnswer = {
    question: trimmed,
    answer: fallback,
    origin: 'context',
    groundingViolations: [],
    context,
    notes,
  };

  const provider = opts.disableAi ? null : (opts.provider ?? getNarrativeProvider());
  const providerReady = provider !== null && (!AI_MOCK_MODE || Boolean(opts.provider));

  if (!providerReady) {
    notes.push(
      'AI is off: set OPENROUTER_API_KEY (free models available) to have a model answer from this data.',
    );
    return answer;
  }

  if (context.isEmpty) {
    notes.push('No saved data yet, so there is nothing for the coach to reason over.');
    return answer;
  }

  // ---- 2. Model answers over that data. ----
  const text = await provider!.generate({
    system: SYSTEM_PROMPT,
    user: buildUserMessage(context, trimmed, opts.history ?? []),
  });

  // ---- 3. SAME guard as the pricing assistant, plus bare counts. ----
  const figures = contextFigures(context);
  const allowed = buildAllowedFigures(figures);
  const report = verifyGrounding(text, allowed, { checkCounts: true });

  if (report.ok) {
    answer = {
      ...answer,
      answer: text,
      origin: 'model',
      provider: provider!.name,
      model: provider!.model,
      groundingViolations: [],
    };
  } else {
    notes.push(
      `The AI answer from ${provider!.name} (${provider!.model}) was discarded: it cited ${report.violations.length} figure(s) not present in your data (${report.violations
        .map((v) => v.cited)
        .join(', ')}). Showing your real figures instead.`,
    );
    answer = {
      ...answer,
      answer: fallback,
      origin: 'context',
      groundingViolations: report.violations,
    };
  }

  return answer;
}
