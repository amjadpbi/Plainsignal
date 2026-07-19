import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtsyClient, ListingSearchResult } from '@/lib/etsy/types';

/**
 * Exercises the full pricing pipeline, including the case that matters most:
 * a model that invents a number must NOT reach the user.
 */

const aiMock = vi.hoisted(() => ({
  generateFn: vi.fn(),
  mockMode: { value: false },
  provider: { name: 'openrouter', model: 'openrouter/free' },
}));

// Provider-agnostic: the assistant only knows the NarrativeProvider interface.
vi.mock('@/lib/ai/provider', () => ({
  ANTHROPIC_MODEL: 'claude-opus-4-8',
  get AI_MOCK_MODE() {
    return aiMock.mockMode.value;
  },
  getNarrativeProvider: () =>
    aiMock.mockMode.value
      ? null
      : {
          name: aiMock.provider.name,
          model: aiMock.provider.model,
          generate: aiMock.generateFn,
        },
  AiError: class AiError extends Error {},
}));

import { getPricingAdvice } from '@/lib/pricing/assistant';

/** Competitor listings at 10/20/30/40/50 → p25=20, median=30, p75=40. */
function fakeEtsy(prices = [10, 20, 30, 40, 50]): EtsyClient {
  return {
    source: 'mock',
    async searchActiveListings(query): Promise<ListingSearchResult> {
      return {
        query,
        count: 4321,
        source: 'mock',
        listings: prices.map((price, i) => ({
          listingId: String(i),
          title: `listing ${i}`,
          price,
          currencyCode: 'USD',
          numFavorers: 10,
          views: 100,
          tags: [],
        })),
      };
    },
    async getAutosuggestions(seed) {
      return { seed, suggestions: [], source: 'mock' as const };
    },
    async getListing() {
      throw new Error('not used');
    },
  };
}

const costs = { itemCost: 5, shippingCost: 2, shippingCharged: 0 };

function modelSays(text: string) {
  aiMock.generateFn.mockResolvedValue(text);
}

beforeEach(() => {
  vi.clearAllMocks();
  aiMock.mockMode.value = false;
  aiMock.provider = { name: 'openrouter', model: 'openrouter/free' };
});

describe('getPricingAdvice — real data layer', () => {
  it('derives tiers from real competitor percentiles', async () => {
    const advice = await getPricingAdvice('linen apron', costs, {
      client: fakeEtsy(),
      disableAi: true,
    });

    expect(advice.competitionCount).toBe(4321);
    expect(advice.spread.median).toBe(30);
    expect(advice.tiers.map((t) => t.price)).toEqual([20, 30, 40]);
    expect(advice.recommendedTier?.price).toBe(40); // highest net profit
  });

  it('states that no volume forecast is provided', async () => {
    const advice = await getPricingAdvice('x', costs, { client: fakeEtsy(), disableAi: true });
    expect(advice.notes.some((n) => /no sales-volume/i.test(n))).toBe(true);
  });

  it('builds no tiers when there is no competitor data', async () => {
    const advice = await getPricingAdvice('x', costs, {
      client: fakeEtsy([]),
      disableAi: true,
    });
    expect(advice.tiers).toEqual([]);
    expect(advice.recommendedTier).toBeNull();
    expect(advice.narrative.text).toMatch(/no competitor prices/i);
  });

  it('uses the deterministic narrative when AI is disabled', async () => {
    const advice = await getPricingAdvice('x', costs, { client: fakeEtsy(), disableAi: true });
    expect(advice.narrative.origin).toBe('template');
    expect(aiMock.generateFn).not.toHaveBeenCalled();
  });
});

describe('getPricingAdvice — grounded AI layer', () => {
  it('keeps a narrative that only cites supplied figures', async () => {
    modelSays(
      'At $30.00 the median price you net $19.70 after $3.30 in fees. Premium at $40.00 nets more.',
    );

    const advice = await getPricingAdvice('linen apron', costs, { client: fakeEtsy() });

    expect(advice.narrative.origin).toBe('model');
    expect(advice.narrative.provider).toBe('openrouter');
    expect(advice.narrative.model).toBe('openrouter/free');
    expect(advice.narrative.groundingViolations).toHaveLength(0);
    expect(advice.narrative.text).toContain('$19.70');
  });

  it('applies the SAME guard no matter which provider generated the text', async () => {
    // Identical fabrication, swapped provider — must be suppressed either way.
    for (const provider of [
      { name: 'openrouter' as const, model: 'openrouter/free' },
      { name: 'anthropic' as const, model: 'claude-opus-4-8' },
    ]) {
      vi.clearAllMocks();
      aiMock.provider = provider;
      modelSays('Price at $30.00 and expect $2,400.00 in monthly revenue.');

      const advice = await getPricingAdvice('linen apron', costs, { client: fakeEtsy() });

      expect(advice.narrative.origin).toBe('template');
      expect(advice.narrative.text).not.toContain('$2,400.00');
      expect(advice.notes.some((n) => n.includes(provider.name))).toBe(true);
    }
  });

  it('SUPPRESSES a narrative that invents a revenue figure', async () => {
    modelSays('Price at $30.00 and you should clear $2,400.00 in monthly revenue.');

    const advice = await getPricingAdvice('linen apron', costs, { client: fakeEtsy() });

    // The fabricated text must not reach the user.
    expect(advice.narrative.text).not.toContain('$2,400.00');
    expect(advice.narrative.origin).toBe('template');
    expect(advice.narrative.groundingViolations.map((v) => v.cited)).toContain('$2,400.00');
    expect(advice.notes.some((n) => /discarded/i.test(n))).toBe(true);
  });

  it('SUPPRESSES a narrative that invents a conversion rate', async () => {
    modelSays('At $30.00, expect roughly 3.5% of viewers to convert.');

    const advice = await getPricingAdvice('linen apron', costs, { client: fakeEtsy() });

    expect(advice.narrative.origin).toBe('template');
    expect(advice.narrative.text).not.toContain('3.5%');
    expect(advice.narrative.groundingViolations[0].kind).toBe('percent');
  });

  it('sends real figures to the model and forbids invention in the system prompt', async () => {
    modelSays('Median is $30.00.');
    await getPricingAdvice('linen apron', costs, { client: fakeEtsy() });

    const args = aiMock.generateFn.mock.calls[0][0];
    expect(args.system).toMatch(/never state a dollar amount or percentage that is not in the data/i);
    expect(args.system).toMatch(/do not invent, estimate, extrapolate, or predict/i);

    // The real numbers are actually in the prompt.
    expect(args.user).toContain('"median": 30');
    expect(args.user).toContain('"price": 40');
  });

  it('does not call any provider when no key is configured', async () => {
    aiMock.mockMode.value = true;

    const advice = await getPricingAdvice('linen apron', costs, { client: fakeEtsy() });

    expect(aiMock.generateFn).not.toHaveBeenCalled();
    expect(advice.narrative.origin).toBe('template');
    expect(advice.notes.some((n) => /OPENROUTER_API_KEY/.test(n))).toBe(true);
  });
});
