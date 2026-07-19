import 'server-only';
import { getEtsyClient } from '../etsy/client';
import type { DataSource, EtsyClient } from '../etsy/types';
import {
  AI_MOCK_MODE,
  getNarrativeProvider,
  type NarrativeProvider,
  type ProviderName,
} from '../ai/provider';
import { buildAllowedFigures, verifyGrounding, type GroundingViolation } from '../ai/grounding';
import { computeSpread, type PriceSpread } from './spread';
import { breakevenPrice, buildTiers, type PriceTier, type SellerCosts } from './tiers';

/**
 * Pricing assistant (CLAUDE.md §4.5 / Phase 4, module 10):
 *   competitor price spread (REAL) + tiers derived from that spread and the
 *   real fee math + an LLM rationale that is only allowed to talk about those
 *   numbers.
 *
 * Order of operations matters. All metrics are computed FIRST, deterministically.
 * The model is then handed those finished numbers and asked only to explain the
 * tradeoffs. Its output is checked by the grounding guard; if it cites a figure
 * we did not supply, the narrative is dropped rather than shown.
 */

export type PricingAdvice = {
  keyword: string;
  source: DataSource;
  isMock: boolean;
  competitionCount: number;
  spread: PriceSpread;
  tiers: PriceTier[];
  breakeven: number | null;
  recommendedTier: PriceTier | null;
  narrative: {
    text: string;
    /** 'model' when a provider wrote it, 'template' when deterministic. */
    origin: 'model' | 'template';
    /** Which provider produced it — the guard applies to all of them equally. */
    provider?: ProviderName;
    model?: string;
    /** Figures the model invented, if any (narrative is suppressed when non-empty). */
    groundingViolations: GroundingViolation[];
  };
  notes: string[];
};

export interface AdviceOptions {
  client?: EtsyClient;
  /** Force the deterministic narrative (used by tests). */
  disableAi?: boolean;
  /** Inject a provider instead of resolving from env (used by tests). */
  provider?: NarrativeProvider;
}

const SYSTEM_PROMPT = `You are a pricing analyst for Etsy sellers.

You will be given REAL marketplace figures and REAL fee-adjusted profit numbers that have already been computed. Your only job is to explain the tradeoffs between the given price tiers in plain language.

Hard rules:
- Use ONLY the figures provided. Never state a dollar amount or percentage that is not in the data you were given.
- Do not invent, estimate, extrapolate, or predict any number — no projected sales volume, no conversion rates, no revenue forecasts. That data does not exist here.
- Do not recommend a price outside the given tiers.
- If a tier is unprofitable, say so plainly.
- Be concise and concrete. No preamble, no hedging, no marketing language.`;

function fmtUsd(n: number | null): string {
  return n === null ? 'n/a' : `$${n.toFixed(2)}`;
}

/** Deterministic fallback narrative — no model involved. */
function templateNarrative(
  tiers: PriceTier[],
  spread: PriceSpread,
  recommended: PriceTier | null,
): string {
  if (tiers.length === 0) {
    return 'No competitor prices were available for this keyword, so no tiers could be built.';
  }
  const parts: string[] = [];
  parts.push(
    `Across ${spread.sampleSize} competing listings, prices run from ${fmtUsd(spread.min)} to ${fmtUsd(spread.max)}, with a median of ${fmtUsd(spread.median)}.`,
  );
  for (const t of tiers) {
    parts.push(
      `${t.label} at ${fmtUsd(t.price)} (${t.basis}) nets ${fmtUsd(t.netProfit)} after ${fmtUsd(t.totalFees)} in Etsy fees, a ${t.marginPct.toFixed(1)}% margin.`,
    );
  }
  const unprofitable = tiers.filter((t) => !t.profitable);
  if (unprofitable.length > 0) {
    parts.push(
      `${unprofitable.map((t) => t.label).join(' and ')} ${unprofitable.length === 1 ? 'does' : 'do'} not clear a profit at your costs.`,
    );
  }
  if (recommended) {
    parts.push(`${recommended.label} gives the highest net profit of the three.`);
  }
  return parts.join(' ');
}

/**
 * Ask the configured provider to explain the already-computed numbers.
 * Provider-agnostic: whatever comes back is validated by the grounding guard.
 */
async function modelNarrative(
  provider: NonNullable<ReturnType<typeof getNarrativeProvider>>,
  keyword: string,
  spread: PriceSpread,
  tiers: PriceTier[],
  costs: SellerCosts,
  competitionCount: number,
): Promise<string> {
  const facts = {
    keyword,
    competitionCount,
    yourCosts: {
      itemCost: costs.itemCost,
      shippingCost: costs.shippingCost,
      shippingCharged: costs.shippingCharged ?? 0,
    },
    competitorPriceSpread: spread,
    tiers: tiers.map((t) => ({
      label: t.label,
      basis: t.basis,
      price: t.price,
      netProfit: t.netProfit,
      marginPct: t.marginPct,
      etsyFees: t.totalFees,
      percentVsMedian: t.vsMedianPct,
      profitable: t.profitable,
    })),
  };

  return provider.generate({
    system: SYSTEM_PROMPT,
    user: `Here are the real figures for "${keyword}":\n\n${JSON.stringify(facts, null, 2)}\n\nIn 3-5 sentences, explain the tradeoff between these tiers and which one you'd start at, given the margins shown. Reference only the numbers above.`,
  });
}

export async function getPricingAdvice(
  keyword: string,
  costs: SellerCosts,
  opts: AdviceOptions = {},
): Promise<PricingAdvice> {
  const etsy = opts.client ?? getEtsyClient();
  const trimmed = keyword.trim();
  if (!trimmed) throw new Error('Keyword must not be empty.');

  // ---- 1. REAL data. No model involved. ----
  const search = await etsy.searchActiveListings(trimmed, { limit: 50 });
  const spread = computeSpread(search.listings);
  const tiers = buildTiers(spread, costs);
  const breakeven = breakevenPrice(costs);

  const recommendedTier =
    tiers.filter((t) => t.profitable).sort((a, b) => b.netProfit - a.netProfit)[0] ?? null;

  const notes: string[] = [];
  if (search.source === 'mock') {
    notes.push(
      'MOCK MODE: competitor prices are deterministic synthetic data. Set an approved ETSY_API_KEY for real market prices.',
    );
  }
  notes.push(
    'Tier prices are real competitor percentiles, not model suggestions. Profit is computed by the fee calculator, not estimated.',
  );
  notes.push(
    'No sales-volume or conversion forecast is shown — Etsy exposes no such data, and it is not inferred.',
  );

  // ---- 2. Narrative layer over those finished numbers. ----
  const provider = opts.disableAi ? null : (opts.provider ?? getNarrativeProvider());
  // An injected provider is used even when no env key is configured.
  const providerReady = provider !== null && (!AI_MOCK_MODE || Boolean(opts.provider));
  const useAi = providerReady && tiers.length > 0;
  let narrative: PricingAdvice['narrative'] = {
    text: templateNarrative(tiers, spread, recommendedTier),
    origin: 'template',
    groundingViolations: [],
  };

  if (useAi) {
    const allowed = buildAllowedFigures({
      currency: [
        spread.min,
        spread.p25,
        spread.median,
        spread.p75,
        spread.max,
        spread.mean,
        breakeven,
        costs.itemCost,
        costs.shippingCost,
        costs.shippingCharged ?? 0,
        ...tiers.flatMap((t) => [t.price, t.netProfit, t.totalFees]),
      ],
      percent: [...tiers.flatMap((t) => [t.marginPct, t.vsMedianPct])],
    });

    const text = await modelNarrative(provider!, trimmed, spread, tiers, costs, search.count);

    // The guard runs on EVERY provider's output, unchanged.
    const report = verifyGrounding(text, allowed);

    if (report.ok) {
      narrative = {
        text,
        origin: 'model',
        provider: provider!.name,
        model: provider!.model,
        groundingViolations: [],
      };
    } else {
      // The model cited a figure we never gave it. Do not show it.
      narrative = {
        text: templateNarrative(tiers, spread, recommendedTier),
        origin: 'template',
        groundingViolations: report.violations,
      };
      notes.push(
        `The AI rationale from ${provider!.name} (${provider!.model}) was discarded: it cited ${report.violations.length} figure(s) not present in the real data (${report.violations
          .map((v) => v.cited)
          .join(', ')}). Showing the computed summary instead.`,
      );
    }
  } else if (AI_MOCK_MODE) {
    notes.push(
      'AI rationale is templated: set OPENROUTER_API_KEY (free models available) or ANTHROPIC_API_KEY to have a model explain these numbers.',
    );
  }

  return {
    keyword: trimmed,
    source: search.source,
    isMock: search.source === 'mock',
    competitionCount: search.count,
    spread,
    tiers,
    breakeven,
    recommendedTier,
    narrative,
    notes,
  };
}
