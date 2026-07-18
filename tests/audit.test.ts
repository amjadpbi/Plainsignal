import { describe, expect, it } from 'vitest';
import {
  auditDescription,
  auditPhotos,
  auditPrice,
  auditTags,
  auditTitle,
  CATEGORY_WEIGHTS,
  ETSY_TAG_SLOTS,
  ETSY_TITLE_MAX,
  type MarketContext,
} from '@/lib/audit/rules';
import { auditListing, deriveFocusKeyword, scoreFindings } from '@/lib/audit/audit';
import { extractListingId } from '@/lib/audit/listing-id';
import { MockEtsyClient } from '@/lib/etsy/client';
import type { EtsyClient, EtsyListingDetail, ListingSearchResult } from '@/lib/etsy/types';

function listing(over: Partial<EtsyListingDetail> = {}): EtsyListingDetail {
  return {
    listingId: '123',
    title: 'Personalized linen apron for her, handmade kitchen gift, rustic cooking apron',
    description: 'x'.repeat(300),
    tags: Array.from({ length: 13 }, (_, i) => `linen apron tag ${i}`.slice(0, 20)),
    materials: ['linen'],
    price: 30,
    currencyCode: 'USD',
    quantity: 5,
    numFavorers: 100,
    views: 1000,
    imageCount: 7,
    source: 'mock',
    ...over,
  };
}

const ids = (fs: { id: string }[]) => fs.map((f) => f.id);

describe('title rules', () => {
  it('accepts a well-formed, keyword-led title', () => {
    expect(auditTitle(listing(), 'linen apron')).toHaveLength(0);
  });

  it('flags a title over Etsy’s 140-character limit as critical', () => {
    const f = auditTitle(listing({ title: 'a linen apron '.repeat(20) }), 'linen apron');
    const tooLong = f.find((x) => x.id === 'title.tooLong');
    expect(tooLong?.severity).toBe('critical');
    expect(ETSY_TITLE_MAX).toBe(140);
  });

  it('flags a title that wastes available space', () => {
    const f = auditTitle(listing({ title: 'linen apron' }), 'linen apron');
    expect(ids(f)).toContain('title.tooShort');
  });

  it('flags a focus keyword missing from the first 40 characters', () => {
    const f = auditTitle(
      listing({ title: 'Handmade artisan kitchen textile made carefully — linen apron here' }),
      'linen apron',
    );
    expect(ids(f)).toContain('title.keywordNotLeading');
  });

  it('flags keyword stuffing', () => {
    const f = auditTitle(
      listing({ title: 'apron apron apron linen apron handmade apron gift for her kitchen' }),
      'apron',
    );
    expect(ids(f)).toContain('title.repetition');
  });

  it('treats a missing title as fully disqualifying', () => {
    const f = auditTitle(listing({ title: '' }), 'x');
    expect(f).toHaveLength(1);
    expect(f[0].deduction).toBe(CATEGORY_WEIGHTS.title);
  });
});

describe('tag rules', () => {
  it('accepts 13 well-formed tags', () => {
    expect(auditTags(listing())).toHaveLength(0);
  });

  it('flags unused tag slots and scales the penalty', () => {
    const few = auditTags(listing({ tags: ['a b', 'c d'] }));
    const found = few.find((f) => f.id === 'tags.unusedSlots');
    expect(found).toBeDefined();
    expect(found!.severity).toBe('critical'); // 11 empty slots
    expect(ETSY_TAG_SLOTS).toBe(13);

    const nearlyFull = auditTags(
      listing({ tags: Array.from({ length: 11 }, (_, i) => `tag phrase ${i}`) }),
    );
    const mild = nearlyFull.find((f) => f.id === 'tags.unusedSlots');
    expect(mild!.severity).toBe('warning');
    expect(mild!.deduction).toBeLessThan(found!.deduction);
  });

  it('flags tags over the 20-character limit as critical', () => {
    const f = auditTags(listing({ tags: ['this tag is definitely far too long'] }));
    expect(f.find((x) => x.id === 'tags.tooLong')?.severity).toBe('critical');
  });

  it('flags duplicate tags', () => {
    const f = auditTags(listing({ tags: ['linen apron', 'LINEN APRON'] }));
    expect(ids(f)).toContain('tags.duplicates');
  });

  it('flags a tag set dominated by single words', () => {
    const f = auditTags(listing({ tags: ['apron', 'linen', 'gift', 'cotton'] }));
    expect(ids(f)).toContain('tags.singleWordHeavy');
  });
});

describe('price rules (grounded in real competitor data)', () => {
  const market: MarketContext = { competitionCount: 5000, medianPrice: 30, sampleSize: 24 };

  it('does not judge price without market data — no invented verdict', () => {
    expect(auditPrice(listing({ price: 999 }), null)).toHaveLength(0);
    expect(
      auditPrice(listing({ price: 999 }), { competitionCount: 1, medianPrice: null, sampleSize: 0 }),
    ).toHaveLength(0);
  });

  it('accepts a price near the market median', () => {
    expect(auditPrice(listing({ price: 32 }), market)).toHaveLength(0);
  });

  it('flags a price far above the median and cites the real figure', () => {
    const f = auditPrice(listing({ price: 90 }), market);
    expect(ids(f)).toContain('price.aboveMarket');
    expect(f[0].message).toContain('$30.00');
    expect(f[0].message).toContain('24 competing listings');
  });

  it('flags a price far below the median', () => {
    const f = auditPrice(listing({ price: 10 }), market);
    expect(ids(f)).toContain('price.belowMarket');
  });
});

describe('photo and description rules', () => {
  it('accepts enough photos', () => {
    expect(auditPhotos(listing({ imageCount: 7 }))).toHaveLength(0);
  });

  it('scales the penalty by how few photos there are', () => {
    const one = auditPhotos(listing({ imageCount: 1 }))[0];
    const four = auditPhotos(listing({ imageCount: 4 }))[0];
    expect(one.deduction).toBeGreaterThan(four.deduction);
  });

  it('treats zero photos as critical', () => {
    expect(auditPhotos(listing({ imageCount: 0 }))[0].severity).toBe('critical');
  });

  it('flags a thin description', () => {
    expect(ids(auditDescription(listing({ description: 'A mug.' })))).toContain(
      'description.thin',
    );
  });

  it('treats a missing description as critical', () => {
    expect(auditDescription(listing({ description: '' }))[0].severity).toBe('critical');
  });
});

describe('scoreFindings', () => {
  it('returns a perfect 100 when nothing is wrong', () => {
    const { score, categoryScores } = scoreFindings([]);
    expect(score).toBe(100);
    expect(categoryScores.every((c) => c.score === c.max)).toBe(true);
  });

  it('never lets a category go negative', () => {
    const { categoryScores, score } = scoreFindings([
      { id: 'a', category: 'photos', severity: 'critical', message: '', recommendation: '', deduction: 999 },
    ]);
    expect(categoryScores.find((c) => c.category === 'photos')!.score).toBe(0);
    expect(score).toBe(100 - CATEGORY_WEIGHTS.photos);
  });

  it('sums category budgets to 100', () => {
    const total = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});

describe('deriveFocusKeyword', () => {
  it('prefers the first tag', () => {
    expect(deriveFocusKeyword(listing({ tags: ['linen apron', 'other'] }))).toBe('linen apron');
  });

  it('falls back to the leading title words when there are no tags', () => {
    expect(deriveFocusKeyword(listing({ tags: [], title: 'Handmade Linen Apron for cooks' }))).toBe(
      'Handmade Linen Apron',
    );
  });
});

describe('auditListing end to end (mock client)', () => {
  it('audits a mock listing and returns a coherent result', async () => {
    const result = await auditListing('1234567890', { client: new MockEtsyClient() });

    expect(result.listingId).toBe('1234567890');
    expect(result.isMock).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.categoryScores).toHaveLength(5);
    expect(result.notes.some((n) => n.includes('MOCK MODE'))).toBe(true);
  });

  it('is deterministic for the same listing id', async () => {
    const a = await auditListing('555', { client: new MockEtsyClient() });
    const b = await auditListing('555', { client: new MockEtsyClient() });
    expect(a.score).toBe(b.score);
    expect(ids(a.findings)).toEqual(ids(b.findings));
  });

  it('orders findings by severity, critical first', async () => {
    const result = await auditListing('9', { client: new MockEtsyClient() });
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < result.findings.length; i++) {
      expect(rank[result.findings[i - 1].severity]).toBeLessThanOrEqual(
        rank[result.findings[i].severity],
      );
    }
  });

  it('still audits everything else when competitor data cannot be loaded', async () => {
    const failing: EtsyClient = {
      source: 'mock',
      async getListing() {
        return listing({ tags: ['apron'], imageCount: 1 });
      },
      async searchActiveListings(): Promise<ListingSearchResult> {
        throw new Error('upstream down');
      },
      async getAutosuggestions() {
        return { seed: 'x', suggestions: [], source: 'mock' as const };
      },
    };

    const result = await auditListing('1', { client: failing });
    expect(result.market).toBeNull();
    // Price is unscored (full marks) rather than guessed at.
    expect(result.categoryScores.find((c) => c.category === 'price')!.score).toBe(
      CATEGORY_WEIGHTS.price,
    );
    // Other categories still produced findings.
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.notes.some((n) => n.includes('competitor data'))).toBe(true);
  });

  it('scores a deliberately bad listing far below a good one', async () => {
    const make = (l: EtsyListingDetail): EtsyClient => ({
      source: 'mock',
      async getListing() {
        return l;
      },
      async searchActiveListings(query): Promise<ListingSearchResult> {
        return {
          query,
          count: 5000,
          source: 'mock',
          listings: [
            { listingId: '1', title: 't', price: 30, currencyCode: 'USD', numFavorers: 10, views: 0, tags: [] },
          ],
        };
      },
      async getAutosuggestions() {
        return { seed: 'x', suggestions: [], source: 'mock' as const };
      },
    });

    const good = await auditListing('1', { client: make(listing()) });
    const bad = await auditListing('1', {
      client: make(
        listing({
          title: 'apron',
          tags: ['apron'],
          description: 'x',
          imageCount: 0,
          price: 500,
        }),
      ),
    });

    expect(good.score).toBeGreaterThan(85);

    // Pin the exact arithmetic rather than a vague threshold:
    //   title       30 - 10 (too short)                        = 20
    //   tags        30 - 18 (12 empty slots) - 4 (single-word)  =  8
    //   price       20 - 10 (>50% above the $30 median)         = 10
    //   photos      10 - 10 (no photos, critical)               =  0
    //   description 10 -  5 (thin)                              =  5
    //                                                     total = 43
    expect(bad.score).toBe(43);
    const byCat = Object.fromEntries(bad.categoryScores.map((c) => [c.category, c.score]));
    expect(byCat).toEqual({ title: 20, tags: 8, price: 10, photos: 0, description: 5 });
  });
});

describe('extractListingId', () => {
  it('accepts a bare numeric id', () => {
    expect(extractListingId('1234567890')).toBe('1234567890');
    expect(extractListingId('  42  ')).toBe('42');
  });

  it('pulls the id out of a pasted Etsy listing URL', () => {
    expect(
      extractListingId('https://www.etsy.com/listing/1234567890/handmade-linen-apron'),
    ).toBe('1234567890');
    expect(extractListingId('etsy.com/listing/999/x?ref=shop_home')).toBe('999');
  });

  it('returns null for input with no listing id', () => {
    expect(extractListingId('')).toBeNull();
    expect(extractListingId('linen apron')).toBeNull();
    expect(extractListingId('https://www.etsy.com/shop/SomeShop')).toBeNull();
  });
});
