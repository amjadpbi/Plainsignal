import { describe, expect, it } from 'vitest';
import { computeSpread, percentile } from '@/lib/pricing/spread';
import { breakevenPrice, buildTiers } from '@/lib/pricing/tiers';
import {
  buildAllowedFigures,
  verifyGrounding,
} from '@/lib/ai/grounding';

const priced = (...prices: number[]) => prices.map((price) => ({ price }));

describe('percentile', () => {
  it('returns the only value for a single-element array', () => {
    expect(percentile([42], 0.5)).toBe(42);
  });

  it('computes exact order statistics when they land on an index', () => {
    const s = [10, 20, 30, 40, 50];
    expect(percentile(s, 0)).toBe(10);
    expect(percentile(s, 0.5)).toBe(30);
    expect(percentile(s, 1)).toBe(50);
  });

  it('interpolates linearly between ranks', () => {
    // [10,20,30,40]: p50 index = 1.5 -> midway between 20 and 30
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
    // p25 index = 0.75 -> 10 + 0.75*(20-10)
    expect(percentile([10, 20, 30, 40], 0.25)).toBe(17.5);
  });

  it('clamps out-of-range p', () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 5)).toBe(3);
  });

  it('throws on an empty array rather than inventing a value', () => {
    expect(() => percentile([], 0.5)).toThrow(/non-empty/i);
  });
});

describe('computeSpread', () => {
  it('summarizes a real price sample', () => {
    const s = computeSpread(priced(10, 20, 30, 40, 50));
    expect(s).toEqual({
      sampleSize: 5,
      min: 10,
      p25: 20,
      median: 30,
      p75: 40,
      max: 50,
      mean: 30,
    });
  });

  it('ignores zero and negative prices', () => {
    const s = computeSpread(priced(0, -5, 10, 20, 30));
    expect(s.sampleSize).toBe(3);
    expect(s.min).toBe(10);
    expect(s.max).toBe(30);
  });

  it('returns nulls for an empty sample instead of guessing', () => {
    const s = computeSpread([]);
    expect(s.sampleSize).toBe(0);
    expect(s.median).toBeNull();
    expect(s.mean).toBeNull();
  });

  it('is order-independent', () => {
    expect(computeSpread(priced(50, 10, 30, 20, 40))).toEqual(
      computeSpread(priced(10, 20, 30, 40, 50)),
    );
  });
});

describe('buildTiers', () => {
  const spread = computeSpread(priced(10, 20, 30, 40, 50));
  const costs = { itemCost: 5, shippingCost: 2, shippingCharged: 0 };

  it('anchors each tier to a real percentile, not an invented price', () => {
    const tiers = buildTiers(spread, costs);
    expect(tiers.map((t) => t.price)).toEqual([spread.p25, spread.median, spread.p75]);
    expect(tiers.map((t) => t.key)).toEqual(['budget', 'competitive', 'premium']);
    expect(tiers[0].basis).toMatch(/25th percentile/);
  });

  it('computes profit through the real fee engine', () => {
    const tiers = buildTiers(spread, costs);
    const competitive = tiers.find((t) => t.key === 'competitive')!;
    // $30 sale: fees = 0.20 + 6.5% of 30 (1.95) + 3% of 30 (0.90) + 0.25 = 3.30
    // profit = 30 - 3.30 - 7 = 19.70
    expect(competitive.totalFees).toBe(3.3);
    expect(competitive.netProfit).toBe(19.7);
    expect(competitive.profitable).toBe(true);
  });

  it('reports position relative to the real median', () => {
    const tiers = buildTiers(spread, costs);
    expect(tiers.find((t) => t.key === 'competitive')!.vsMedianPct).toBe(0);
    expect(tiers.find((t) => t.key === 'budget')!.vsMedianPct).toBeLessThan(0);
    expect(tiers.find((t) => t.key === 'premium')!.vsMedianPct).toBeGreaterThan(0);
  });

  it('marks tiers that do not clear a profit', () => {
    const tiers = buildTiers(spread, { itemCost: 40, shippingCost: 10 });
    expect(tiers.find((t) => t.key === 'budget')!.profitable).toBe(false);
  });

  it('returns no tiers when there is no competitor data', () => {
    expect(buildTiers(computeSpread([]), costs)).toEqual([]);
  });
});

describe('breakevenPrice', () => {
  it('is a price at which profit is non-negative', () => {
    const costs = { itemCost: 8, shippingCost: 4.5, shippingCharged: 0 };
    const be = breakevenPrice(costs)!;
    expect(be).toBeGreaterThan(costs.itemCost + costs.shippingCost);
  });
});

describe('grounding guard', () => {
  const allowed = buildAllowedFigures({
    currency: [19.7, 30, 3.3],
    percent: [65.67, 0],
  });

  it('accepts a narrative that only cites supplied figures', () => {
    const report = verifyGrounding(
      'At $30.00 you net $19.70 after $3.30 in fees, a 65.7% margin.',
      allowed,
    );
    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
    expect(report.checked).toBe(4);
  });

  it('CATCHES an invented dollar figure', () => {
    const report = verifyGrounding(
      'At $30.00 you net $19.70, and you could expect $500.00 in monthly revenue.',
      allowed,
    );
    expect(report.ok).toBe(false);
    expect(report.violations.map((v) => v.cited)).toContain('$500.00');
  });

  it('CATCHES an invented percentage', () => {
    const report = verifyGrounding('This should convert at about 12% of views.', allowed);
    expect(report.ok).toBe(false);
    expect(report.violations[0]).toMatchObject({ kind: 'percent', value: 12 });
  });

  it('tolerates legitimate rounding of a supplied figure', () => {
    // 65.67 supplied; model writes 65.7% and 66%
    expect(verifyGrounding('a 65.7% margin', allowed).ok).toBe(true);
    expect(verifyGrounding('a 66% margin', allowed).ok).toBe(true);
  });

  it('treats $19.7 and $19.70 as the same figure', () => {
    expect(verifyGrounding('you net $19.7', allowed).ok).toBe(true);
  });

  it('does NOT let a decimal percentage ride on an unrelated integer', () => {
    // Regression: the whole-number tolerance (so 53.49 may be written "53%")
    // used to match on either precision, which meant "2.3%" passed whenever
    // the integer 2 appeared anywhere in the data. A decimal citation must
    // match a supplied decimal.
    const a = buildAllowedFigures({ currency: [], percent: [2, 53.49] });
    expect(verifyGrounding('converts at 2.3%', a).ok).toBe(false);
    expect(verifyGrounding('a 2% share', a).ok).toBe(true); // supplied exactly
    expect(verifyGrounding('a 53% margin', a).ok).toBe(true); // rounding of 53.49
    expect(verifyGrounding('a 53.5% margin', a).ok).toBe(true); // 1dp rounding
    expect(verifyGrounding('a 53.4% margin', a).ok).toBe(false); // not a rounding
  });

  it('handles thousands separators and spacing', () => {
    const a = buildAllowedFigures({ currency: [1234.56], percent: [] });
    expect(verifyGrounding('costs $1,234.56 total', a).ok).toBe(true);
    expect(verifyGrounding('costs $ 1,234.56 total', a).ok).toBe(true);
    expect(verifyGrounding('costs $1,234.57 total', a).ok).toBe(false);
  });

  it('passes text with no figures at all', () => {
    const report = verifyGrounding('Price competitively and watch your margins.', allowed);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(0);
  });

  it('reports every violation, not just the first', () => {
    const report = verifyGrounding('Expect $900.00 revenue and 45% conversion.', allowed);
    expect(report.violations).toHaveLength(2);
  });

  it('ignores null/undefined when building the allowed set', () => {
    const a = buildAllowedFigures({ currency: [null, undefined, 10], percent: [null] });
    expect(verifyGrounding('$10.00', a).ok).toBe(true);
    expect(verifyGrounding('$11.00', a).ok).toBe(false);
  });
});
