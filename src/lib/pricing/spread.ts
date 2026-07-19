import type { EtsyListing } from '../etsy/types';

/**
 * Competitor price distribution — pure math over REAL listing prices
 * (CLAUDE.md §4.5: "competitor price spread (real)").
 *
 * Nothing here is estimated or modeled. Every figure is an order statistic of
 * prices actually observed on active Etsy listings.
 */

export type PriceSpread = {
  sampleSize: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
  mean: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Linear-interpolated percentile (the R-7 / Excel PERCENTILE.INC method).
 * `sorted` must be ascending and non-empty; `p` is in [0, 1].
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile() needs a non-empty array.');
  if (sorted.length === 1) return sorted[0];

  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Compute the spread from a sample of real listings. Prices of 0 are ignored. */
export function computeSpread(listings: Pick<EtsyListing, 'price'>[]): PriceSpread {
  const prices = listings
    .map((l) => l.price)
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) {
    return {
      sampleSize: 0,
      min: null,
      p25: null,
      median: null,
      p75: null,
      max: null,
      mean: null,
    };
  }

  const sum = prices.reduce((a, b) => a + b, 0);

  return {
    sampleSize: prices.length,
    min: round2(prices[0]),
    p25: round2(percentile(prices, 0.25)),
    median: round2(percentile(prices, 0.5)),
    p75: round2(percentile(prices, 0.75)),
    max: round2(prices[prices.length - 1]),
    mean: round2(sum / prices.length),
  };
}
