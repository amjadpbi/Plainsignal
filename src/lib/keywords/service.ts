import { getEtsyClient } from '../etsy/client';
import type { EtsyClient, ListingSearchResult } from '../etsy/types';
import { scoreKeyword, verdictFor } from './scoring';
import type { AnalyzedKeyword, KeywordSignals, ResearchResult } from './types';

const DEFAULT_MAX_KEYWORDS = 12;

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Reduce a keyword's raw search result into the real signals we score on. */
export function computeSignals(keyword: string, search: ListingSearchResult): KeywordSignals {
  const listings = search.listings;
  const sampleSize = listings.length;

  const avgFavorites =
    sampleSize === 0
      ? 0
      : listings.reduce((sum, l) => sum + l.numFavorers, 0) / sampleSize;

  const prices = listings
    .map((l) => l.price)
    .filter((p) => p > 0)
    .sort((a, b) => a - b);

  return {
    keyword,
    competitionCount: search.count,
    avgFavorites: round2(avgFavorites),
    priceMin: prices.length ? round2(prices[0]) : null,
    priceMed: prices.length ? round2(median(prices)!) : null,
    priceMax: prices.length ? round2(prices[prices.length - 1]) : null,
    sampleSize,
  };
}

function uniqueLower(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface RunOptions {
  client?: EtsyClient;
  maxKeywords?: number;
}

/**
 * The core module (CLAUDE.md §4.1):
 *   seed → autosuggest expansion → real competition + favorites per keyword →
 *   difficulty/demand/opportunity scores → ranked list + niche verdict.
 *
 * Runs against the mock client by default until an Etsy key is set. Pass a
 * client explicitly in tests.
 */
export async function runKeywordResearch(
  seed: string,
  opts: RunOptions = {},
): Promise<ResearchResult> {
  const client = opts.client ?? getEtsyClient();
  const maxKeywords = opts.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
  const trimmedSeed = seed.trim();

  if (!trimmedSeed) {
    throw new Error('Seed keyword must not be empty.');
  }

  const suggest = await client.getAutosuggestions(trimmedSeed);
  const candidates = uniqueLower([trimmedSeed, ...suggest.suggestions]).slice(0, maxKeywords);

  // The rate limiter (live mode) self-throttles these concurrent calls to
  // 5 req/s; in mock mode they resolve instantly.
  const analyzed: AnalyzedKeyword[] = await Promise.all(
    candidates.map(async (keyword) => {
      const search = await client.searchActiveListings(keyword);
      const signals = computeSignals(keyword, search);
      const scores = scoreKeyword(signals);
      return { ...signals, ...scores, source: search.source };
    }),
  );

  analyzed.sort((a, b) => b.opportunity - a.opportunity);

  const avgDifficulty = round2(mean(analyzed.map((k) => k.difficulty)));
  const avgOpportunity = round2(mean(analyzed.map((k) => k.opportunity)));
  const gemCount = analyzed.filter(
    (k) => k.verdict === 'STRONG' || k.verdict === 'PROMISING',
  ).length;

  const isMock = client.source === 'mock';
  const notes: string[] = [
    'No search-volume metric is shown: Etsy exposes no volume endpoint. Scores are built from real competition counts and listing favorites only.',
  ];
  if (isMock) {
    notes.unshift(
      'MOCK MODE: numbers are deterministic synthetic data. Set ETSY_API_KEY to pull real Etsy signals.',
    );
  }

  return {
    seed: trimmedSeed,
    source: client.source,
    isMock,
    keywords: analyzed,
    rollup: {
      keywordCount: analyzed.length,
      avgDifficulty,
      avgOpportunity,
      gemCount,
      verdict: verdictFor(avgOpportunity),
    },
    notes,
  };
}
