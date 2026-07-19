import { calculateFees, type FeeInput } from '../fees/calculate';
import type { PriceSpread } from './spread';

/**
 * Price tiers (CLAUDE.md §4.5).
 *
 * CRITICAL: the tier PRICES are not suggestions from a language model. Each one
 * is an actual percentile of real competitor prices, and its profit is computed
 * by the same fee engine used by the calculator. The LLM never chooses a
 * number — it only explains numbers produced here.
 */

export type TierKey = 'budget' | 'competitive' | 'premium';

export type PriceTier = {
  key: TierKey;
  label: string;
  /** Where this price comes from, stated plainly for the UI. */
  basis: string;
  price: number;
  netProfit: number;
  marginPct: number;
  totalFees: number;
  /** % difference from the competitor median. */
  vsMedianPct: number | null;
  profitable: boolean;
};

export type SellerCosts = {
  itemCost: number;
  shippingCost: number;
  shippingCharged?: number;
};

const TIER_DEFS: Array<{ key: TierKey; label: string; p: keyof PriceSpread; basis: string }> = [
  { key: 'budget', label: 'Budget', p: 'p25', basis: '25th percentile of competitor prices' },
  { key: 'competitive', label: 'Competitive', p: 'median', basis: 'median competitor price' },
  { key: 'premium', label: 'Premium', p: 'p75', basis: '75th percentile of competitor prices' },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the three tiers from a real price spread plus the seller's own costs.
 * Returns [] when there is no competitor data — we do not guess a price.
 */
export function buildTiers(
  spread: PriceSpread,
  costs: SellerCosts,
  feeOverrides: Partial<FeeInput> = {},
): PriceTier[] {
  if (spread.sampleSize === 0) return [];

  const median = spread.median;

  return TIER_DEFS.flatMap(({ key, label, p, basis }) => {
    const price = spread[p] as number | null;
    if (price === null || price <= 0) return [];

    const result = calculateFees({
      ...feeOverrides,
      itemCost: costs.itemCost,
      shippingCost: costs.shippingCost,
      salePrice: price,
      shippingCharged: costs.shippingCharged ?? 0,
    });

    return [
      {
        key,
        label,
        basis,
        price,
        netProfit: result.netProfit,
        marginPct: result.marginPct,
        totalFees: result.totalFees,
        vsMedianPct:
          median && median > 0 ? round2(((price - median) / median) * 100) : null,
        profitable: result.netProfit > 0,
      },
    ];
  });
}

/**
 * Lowest price that still clears a profit, from the fee engine's breakeven.
 * Null when fees would consume the whole sale.
 */
export function breakevenPrice(costs: SellerCosts, feeOverrides: Partial<FeeInput> = {}): number | null {
  const result = calculateFees({
    ...feeOverrides,
    itemCost: costs.itemCost,
    shippingCost: costs.shippingCost,
    salePrice: 1,
    shippingCharged: costs.shippingCharged ?? 0,
  });
  return result.breakevenSalePrice;
}
