import { describe, expect, it } from 'vitest';
import { MockEtsyClient } from '@/lib/etsy/client';
import type {
  AutosuggestResult,
  EtsyClient,
  ListingSearchResult,
} from '@/lib/etsy/types';
import { computeSignals, runKeywordResearch } from '@/lib/keywords/service';

describe('computeSignals', () => {
  it('computes avg favorites and price min/med/max from listings', () => {
    const search: ListingSearchResult = {
      query: 'x',
      count: 5000,
      source: 'mock',
      listings: [
        { listingId: '1', title: 'a', price: 10, currencyCode: 'USD', numFavorers: 100, views: 0, tags: [] },
        { listingId: '2', title: 'b', price: 30, currencyCode: 'USD', numFavorers: 200, views: 0, tags: [] },
        { listingId: '3', title: 'c', price: 20, currencyCode: 'USD', numFavorers: 300, views: 0, tags: [] },
      ],
    };
    const s = computeSignals('x', search);
    expect(s.competitionCount).toBe(5000);
    expect(s.avgFavorites).toBe(200);
    expect(s.priceMin).toBe(10);
    expect(s.priceMed).toBe(20);
    expect(s.priceMax).toBe(30);
    expect(s.sampleSize).toBe(3);
  });

  it('handles an empty listing sample without crashing', () => {
    const search: ListingSearchResult = { query: 'x', count: 0, source: 'mock', listings: [] };
    const s = computeSignals('x', search);
    expect(s.avgFavorites).toBe(0);
    expect(s.priceMin).toBeNull();
    expect(s.priceMed).toBeNull();
    expect(s.priceMax).toBeNull();
  });
});

describe('runKeywordResearch (mock client)', () => {
  it('runs the seed → suggest → score pipeline end to end', async () => {
    const result = await runKeywordResearch('linen apron', {
      client: new MockEtsyClient(),
      maxKeywords: 8,
    });

    expect(result.seed).toBe('linen apron');
    expect(result.isMock).toBe(true);
    expect(result.source).toBe('mock');
    expect(result.keywords.length).toBeGreaterThan(1);
    expect(result.keywords.length).toBeLessThanOrEqual(8);

    // Every keyword carries real-signal fields + derived scores.
    for (const k of result.keywords) {
      expect(k.difficulty).toBeGreaterThanOrEqual(0);
      expect(k.difficulty).toBeLessThanOrEqual(100);
      expect(k.opportunity).toBeGreaterThanOrEqual(0);
      expect(['STRONG', 'PROMISING', 'CROWDED', 'AVOID']).toContain(k.verdict);
    }

    // Ranked by opportunity, descending.
    for (let i = 1; i < result.keywords.length; i++) {
      expect(result.keywords[i - 1].opportunity).toBeGreaterThanOrEqual(
        result.keywords[i].opportunity,
      );
    }

    // Honesty notes present, including the mock warning and no-volume note.
    expect(result.notes.some((n) => n.includes('MOCK MODE'))).toBe(true);
    expect(result.notes.some((n) => n.toLowerCase().includes('no search-volume'))).toBe(true);
  });

  it('ranks keywords by opportunity using a controlled client', async () => {
    // low competition + high favorites should outrank high competition + low favorites.
    const fake: EtsyClient = {
      source: 'mock',
      async getAutosuggestions(seed): Promise<AutosuggestResult> {
        return { seed, suggestions: ['high opp', 'low opp'], source: 'mock' };
      },
      async searchActiveListings(query): Promise<ListingSearchResult> {
        const profile =
          query === 'high opp'
            ? { count: 200, fav: 900 }
            : { count: 90_000, fav: 20 }; // 'low opp' and the seed
        return {
          query,
          count: profile.count,
          source: 'mock',
          listings: [
            {
              listingId: '1',
              title: query,
              price: 20,
              currencyCode: 'USD',
              numFavorers: profile.fav,
              views: 0,
              tags: [],
            },
          ],
        };
      },
    };

    const result = await runKeywordResearch('seed kw', { client: fake });
    expect(result.keywords[0].keyword).toBe('high opp');
    expect(result.keywords[0].verdict).toBe('STRONG');
  });
});
