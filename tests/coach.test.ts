import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@/lib/db/tenant';

const aiMock = vi.hoisted(() => ({
  generateFn: vi.fn(),
  mockMode: { value: false },
  provider: { name: 'openrouter', model: 'openrouter/free' },
}));

vi.mock('@/lib/ai/provider', () => ({
  get AI_MOCK_MODE() {
    return aiMock.mockMode.value;
  },
  getNarrativeProvider: () =>
    aiMock.mockMode.value
      ? null
      : { name: aiMock.provider.name, model: aiMock.provider.model, generate: aiMock.generateFn },
  AiError: class AiError extends Error {},
}));

// buildSellerContext reads Prisma directly for nothing — it uses the tenant db
// we inject — but the module imports prisma, so stub it.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { askCoach, contextSummary } from '@/lib/coach/coach';
import { contextFigures, type SellerContext } from '@/lib/coach/context';

/**
 * A fake tenant DB holding REAL-shaped data for one seller.
 * competition 4213 / favourites 120.5 / opportunity 22.7 / audit score 76.
 */
function fakeDb(): TenantDb {
  const snapshot = {
    keyword: 'linen apron',
    competitionCount: 4213,
    avgFavorites: 120.5,
    priceMin: 12.5,
    priceMed: 28.0,
    priceMax: 64.0,
    capturedAt: new Date('2026-07-18T19:50:17Z'),
    score: { difficulty: 60.1, demand: 70.2, opportunity: 22.7, verdict: 'CROWDED' },
  };

  return {
    userId: 'user-A',
    searches: {
      list: async () => [
        { id: 's1', userId: 'user-A', seedKeyword: 'linen apron', createdAt: new Date() },
      ],
    },
    trends: {
      keywords: async () => [
        { keyword: 'linen apron', captureCount: 2, lastCapturedAt: snapshot.capturedAt },
      ],
      forKeyword: async () => [snapshot],
    },
    audits: {
      list: async () => [
        {
          id: 'a1',
          shopId: 'shop1',
          listingId: '1234567890',
          score: 76,
          createdAt: new Date('2026-07-19T02:00:00Z'),
          findingsJson: {
            findings: [
              { message: 'Only 8 of 13 tag slots used — 5 left empty.' },
              { message: 'Focus keyword not in the first 40 characters.' },
            ],
          },
        },
      ],
    },
    feeCalculations: {
      list: async () => [
        {
          id: 'f1',
          userId: 'user-A',
          label: 'apron v1',
          salePrice: 30,
          netProfit: 18.72,
          marginPct: 53.49,
          createdAt: new Date('2026-07-19T03:00:00Z'),
        },
      ],
    },
  } as unknown as TenantDb;
}

/** A tenant DB with nothing saved. */
function emptyDb(): TenantDb {
  return {
    userId: 'user-B',
    searches: { list: async () => [] },
    trends: { keywords: async () => [], forKeyword: async () => [] },
    audits: { list: async () => [] },
    feeCalculations: { list: async () => [] },
  } as unknown as TenantDb;
}

const modelSays = (t: string) => aiMock.generateFn.mockResolvedValue(t);

beforeEach(() => {
  vi.clearAllMocks();
  aiMock.mockMode.value = false;
  aiMock.provider = { name: 'openrouter', model: 'openrouter/free' };
});

describe('seller context', () => {
  it('feeds the model the seller’s real saved data', async () => {
    modelSays('Your linen apron niche has 4213 competing listings.');
    await askCoach(fakeDb(), 'how is my linen apron niche doing?');

    const { system, user } = aiMock.generateFn.mock.calls[0][0];
    expect(system).toMatch(/only their own data/i);
    expect(system).toMatch(/never state a figure that is not in it/i);

    // Real numbers from the DB are actually in the prompt.
    expect(user).toContain('"competitionCount": 4213');
    expect(user).toContain('"opportunity": 22.7');
    expect(user).toContain('"score": 76');
    expect(user).toContain('linen apron');
    expect(user).toContain('how is my linen apron niche doing?');
  });

  it('collects every figure from the context for the allowed set', async () => {
    const ctx: SellerContext = {
      searchCount: 1,
      recentSeeds: ['linen apron'],
      keywords: [
        {
          keyword: 'linen apron',
          competitionCount: 4213,
          avgFavorites: 120.5,
          priceMin: 12.5,
          priceMed: 28,
          priceMax: 64,
          difficulty: 60.1,
          demand: 70.2,
          opportunity: 22.7,
          verdict: 'CROWDED',
          capturedAt: '2026-07-18',
          captureCount: 2,
        },
      ],
      audits: [
        { listingId: '1', score: 76, createdAt: '2026-07-19', findingCount: 2, topFindings: [] },
      ],
      feeCalculations: [
        { label: null, salePrice: 30, netProfit: 18.72, marginPct: 53.49, createdAt: '2026-07-19' },
      ],
      isEmpty: false,
    };

    const figures = contextFigures(ctx);
    expect(figures.counts).toContain(4213);
    expect(figures.currency).toContain(28);
    expect(figures.currency).toContain(18.72);
    expect(figures.percent).toContain(53.49);
    expect(figures.percent).toContain(22.7);
    // Identifiers are supplied data too — citing a listing id is not a
    // fabrication. (An end-to-end run rejected an answer over "1234567890".)
    expect(figures.counts).toContain(1);
  });

  it('admits identifiers and prose figures from the supplied context', async () => {
    // Both of these were false positives found by running end to end.
    modelSays(
      'Listing 1234567890 scored 76, and the audit noted it is priced 247% above the $15.00 median.',
    );

    const db = fakeDb();
    (db.audits as unknown as { list: () => Promise<unknown[]> }).list = async () => [
      {
        id: 'a1',
        shopId: 'shop1',
        listingId: '1234567890',
        score: 76,
        createdAt: new Date('2026-07-19T02:00:00Z'),
        findingsJson: {
          findings: [{ message: 'Priced 247% above the market median of $15.00.' }],
        },
      },
    ];

    const answer = await askCoach(db, 'what did my audit say?');
    expect(answer.groundingViolations).toHaveLength(0);
    expect(answer.origin).toBe('model');
  });

  it('allows figures embedded in audit finding TEXT we supplied', async () => {
    // Regression: an end-to-end run discarded a good answer over "247%",
    // which came from a real stored finding ("Priced 247% above the market
    // median of $15.00"). Numbers inside prose we supply are real data too.
    modelSays(
      'Your audit flagged that the listing is priced 247% above the market median of $15.00.',
    );

    const db = fakeDb();
    (db.audits as unknown as { list: () => Promise<unknown[]> }).list = async () => [
      {
        id: 'a1',
        shopId: 'shop1',
        listingId: '77',
        score: 59,
        createdAt: new Date('2026-07-19T02:00:00Z'),
        findingsJson: {
          findings: [
            { message: 'Priced 247% above the market median of $15.00 (from 24 competing listings).' },
          ],
        },
      },
    ];

    const answer = await askCoach(db, 'what did my audit say?');

    expect(answer.groundingViolations).toHaveLength(0);
    expect(answer.origin).toBe('model');
    expect(answer.answer).toContain('247%');
  });

  it('says so plainly when the account has no data', async () => {
    const answer = await askCoach(emptyDb(), 'how am I doing?');
    expect(answer.context.isEmpty).toBe(true);
    expect(answer.origin).toBe('context');
    expect(answer.answer).toMatch(/no saved data/i);
    expect(aiMock.generateFn).not.toHaveBeenCalled();
  });
});

describe('coach grounding guard', () => {
  it('keeps an answer that cites only the seller’s real figures', async () => {
    modelSays(
      'Your "linen apron" niche is crowded: 4213 competing listings against an opportunity score of 22.7. The median competitor price is $28.00, and your saved calculation nets $18.72 at a 53.5% margin.',
    );

    const answer = await askCoach(fakeDb(), 'how is my linen apron niche doing?');

    expect(answer.origin).toBe('model');
    expect(answer.provider).toBe('openrouter');
    expect(answer.groundingViolations).toHaveLength(0);
    expect(answer.answer).toContain('4213');
  });

  it('SUPPRESSES an invented competition count', async () => {
    modelSays('Your linen apron niche has about 87500 competing listings, which is very crowded.');

    const answer = await askCoach(fakeDb(), 'how is my linen apron niche doing?');

    expect(answer.origin).toBe('context');
    expect(answer.answer).not.toContain('87500');
    expect(answer.groundingViolations.map((v) => v.cited)).toContain('87500');
    expect(answer.groundingViolations[0].kind).toBe('count');
  });

  it('SUPPRESSES an invented price', async () => {
    modelSays('Competitors sit around $45.99, so raise your price.');

    const answer = await askCoach(fakeDb(), 'what should I charge?');

    expect(answer.origin).toBe('context');
    expect(answer.answer).not.toContain('$45.99');
    expect(answer.groundingViolations[0].kind).toBe('currency');
  });

  it('SUPPRESSES an invented conversion/benchmark percentage', async () => {
    modelSays('Listings like yours typically convert at 2.3% on Etsy.');

    const answer = await askCoach(fakeDb(), 'how am I doing?');

    expect(answer.origin).toBe('context');
    expect(answer.answer).not.toContain('2.3%');
    expect(answer.groundingViolations[0].kind).toBe('percent');
  });

  it('falls back to an answer built from the seller’s REAL figures', async () => {
    modelSays('You have 99999 listings competing.');

    const answer = await askCoach(fakeDb(), 'how is my niche?');

    // The fallback cites the genuine numbers, not the fabricated one.
    expect(answer.answer).toContain('4,213');
    expect(answer.answer).toContain('22.7');
    expect(answer.answer).toContain('76');
    expect(answer.notes.some((n) => /discarded/i.test(n))).toBe(true);
  });

  it('applies the SAME guard regardless of provider', async () => {
    for (const provider of [
      { name: 'openrouter' as const, model: 'openrouter/free' },
      { name: 'anthropic' as const, model: 'claude-opus-4-8' },
    ]) {
      vi.clearAllMocks();
      aiMock.provider = provider;
      modelSays('Your niche has 87500 competitors and converts at 2.3%.');

      const answer = await askCoach(fakeDb(), 'how is my niche?');

      expect(answer.origin).toBe('context');
      expect(answer.answer).not.toContain('87500');
      expect(answer.notes.some((n) => n.includes(provider.name))).toBe(true);
    }
  });

  it('does not flag small prose numbers or capture years', async () => {
    modelSays(
      'You are tracking 1 keyword with 2 captures. As of 2026 the opportunity score is 22.7.',
    );

    const answer = await askCoach(fakeDb(), 'summary?');
    expect(answer.origin).toBe('model');
    expect(answer.groundingViolations).toHaveLength(0);
  });

  it('passes prior turns to the model for continuity', async () => {
    modelSays('Yes, 4213 listings.');
    await askCoach(fakeDb(), 'and the competition?', {
      history: [
        { role: 'user', content: 'how is linen apron?' },
        { role: 'assistant', content: 'It is crowded.' },
      ],
    });

    const { user } = aiMock.generateFn.mock.calls[0][0];
    expect(user).toContain('how is linen apron?');
    expect(user).toContain('It is crowded.');
  });

  it('does not call a provider when AI is off', async () => {
    aiMock.mockMode.value = true;
    const answer = await askCoach(fakeDb(), 'how am I doing?');
    expect(aiMock.generateFn).not.toHaveBeenCalled();
    expect(answer.origin).toBe('context');
    expect(answer.notes.some((n) => /OPENROUTER_API_KEY/.test(n))).toBe(true);
  });
});

describe('contextSummary', () => {
  it('builds an answer purely from real figures', () => {
    const text = contextSummary({
      searchCount: 1,
      recentSeeds: [],
      keywords: [
        {
          keyword: 'linen apron',
          competitionCount: 4213,
          avgFavorites: 120.5,
          priceMin: null,
          priceMed: null,
          priceMax: null,
          difficulty: 60.1,
          demand: 70.2,
          opportunity: 22.7,
          verdict: 'CROWDED',
          capturedAt: '2026-07-18',
          captureCount: 2,
        },
      ],
      audits: [],
      feeCalculations: [],
      isEmpty: false,
    });
    expect(text).toContain('linen apron');
    expect(text).toContain('22.7');
    expect(text).toContain('4,213');
    expect(text).toContain('CROWDED');
  });
});
