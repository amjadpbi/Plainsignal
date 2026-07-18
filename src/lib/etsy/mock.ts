import type { AutosuggestResult, EtsyListing, ListingSearchResult } from './types';

/**
 * Deterministic synthetic Etsy data for MOCK MODE (CLAUDE.md §5, step 4:
 * "Mock mode until key set"). Everything is a pure function of the query
 * string, so the same keyword always yields the same numbers — which keeps the
 * UI stable and makes the pipeline unit-testable.
 *
 * IMPORTANT: this is clearly-labeled synthetic data (results carry
 * `source: 'mock'`). It exists to exercise the pipeline, never to be presented
 * as real marketplace signal.
 */

/** cyrb53 string hash → 53-bit unsigned int. Cheap, well-distributed. */
function hashString(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** mulberry32 PRNG — deterministic float in [0,1) from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngFor(query: string): () => number {
  return mulberry32(hashString(query.trim().toLowerCase()));
}

const MODIFIERS_PREFIX = [
  'personalized',
  'custom',
  'handmade',
  'vintage',
  'minimalist',
  'boho',
  'rustic',
  'modern',
];
const MODIFIERS_SUFFIX = [
  'gift',
  'for her',
  'for him',
  'set',
  'kit',
  'digital download',
  'svg',
  'decor',
  'wall art',
  'bundle',
];

export function mockAutosuggest(seed: string): AutosuggestResult {
  const rng = rngFor(`suggest:${seed}`);
  const base = seed.trim();
  const suggestions = new Set<string>();

  // A stable, seed-dependent selection of long-tail expansions.
  const prefixCount = 3 + Math.floor(rng() * 3);
  const suffixCount = 4 + Math.floor(rng() * 4);

  for (let i = 0; i < prefixCount; i++) {
    const m = MODIFIERS_PREFIX[Math.floor(rng() * MODIFIERS_PREFIX.length)];
    suggestions.add(`${m} ${base}`);
  }
  for (let i = 0; i < suffixCount; i++) {
    const m = MODIFIERS_SUFFIX[Math.floor(rng() * MODIFIERS_SUFFIX.length)];
    suggestions.add(`${base} ${m}`);
  }

  return {
    seed: base,
    suggestions: Array.from(suggestions),
    source: 'mock',
  };
}

function mockCount(rng: () => number): number {
  // Log-uniform spread across ~50 .. ~120k active listings so keywords land
  // across the full difficulty range.
  const min = 50;
  const max = 120_000;
  const t = rng();
  return Math.round(Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min))));
}

function mockListings(query: string, rng: () => number, limit: number): EtsyListing[] {
  // Center favorites around a query-dependent popularity level.
  const popularity = Math.exp(1 + rng() * 6); // ~2.7 .. ~1100
  const basePrice = 6 + rng() * 60; // $6 .. $66

  const listings: EtsyListing[] = [];
  for (let i = 0; i < limit; i++) {
    const favJitter = 0.3 + rng() * 1.7;
    const priceJitter = 0.6 + rng() * 1.2;
    listings.push({
      listingId: String(1_000_000 + Math.floor(rng() * 8_999_999)),
      title: `${query} — handmade listing ${i + 1}`,
      price: Math.round(basePrice * priceJitter * 100) / 100,
      currencyCode: 'USD',
      numFavorers: Math.max(0, Math.round(popularity * favJitter)),
      views: Math.max(0, Math.round(popularity * favJitter * (8 + rng() * 20))),
      tags: mockAutosuggest(query).suggestions.slice(0, 5),
    });
  }
  return listings;
}

export function mockSearchActiveListings(query: string, limit = 24): ListingSearchResult {
  const rng = rngFor(`search:${query}`);
  const count = mockCount(rng);
  return {
    query: query.trim(),
    count,
    listings: mockListings(query.trim(), rng, limit),
    source: 'mock',
  };
}
