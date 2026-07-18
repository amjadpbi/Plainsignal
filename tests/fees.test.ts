import { describe, expect, it } from 'vitest';
import { calculateFees } from '@/lib/fees/calculate';
import {
  LISTING_FEE_USD,
  PAYMENT_PROCESSING_US,
  TRANSACTION_FEE_RATE,
  CURRENCY_CONVERSION_RATE,
} from '@/lib/fees/schedule';

function feeOf(result: ReturnType<typeof calculateFees>, key: string): number {
  const line = result.fees.find((f) => f.key === key);
  if (!line) throw new Error(`no fee line "${key}"`);
  return line.amount;
}

describe('fee schedule constants match Etsy’s published rates', () => {
  it('encodes the documented values', () => {
    expect(LISTING_FEE_USD).toBe(0.2);
    expect(TRANSACTION_FEE_RATE).toBe(0.065);
    expect(PAYMENT_PROCESSING_US.rate).toBe(0.03);
    expect(PAYMENT_PROCESSING_US.fixed).toBe(0.25);
    expect(CURRENCY_CONVERSION_RATE).toBe(0.025);
  });
});

describe("Etsy's own published example: $30 item + $5 shipping", () => {
  // Etsy documents ~$3.78 in mandatory fees for this order.
  const result = calculateFees({
    itemCost: 0,
    shippingCost: 0,
    salePrice: 30,
    shippingCharged: 5,
  });

  it('charges the $0.20 listing fee', () => {
    expect(feeOf(result, 'listing')).toBe(0.2);
  });

  it('charges 6.5% on item PLUS shipping ($35 base), rounded half-up', () => {
    // 6.5% of $35.00 = $2.275 -> $2.28
    expect(result.feeBase).toBe(35);
    expect(feeOf(result, 'transaction')).toBe(2.28);
  });

  it('charges 3% + $0.25 payment processing on the $35 order', () => {
    // 3% of $35.00 = $1.05, + $0.25 = $1.30
    expect(feeOf(result, 'processing')).toBe(1.3);
  });

  it('totals $3.78 — matching Etsy’s published figure exactly', () => {
    expect(result.totalFees).toBe(3.78);
  });

  it('omits optional fees that do not apply', () => {
    expect(result.fees.map((f) => f.key)).toEqual(['listing', 'transaction', 'processing']);
  });
});

describe('reconciliation guarantees', () => {
  const cases = [
    { itemCost: 8, shippingCost: 4.5, salePrice: 30, shippingCharged: 5 },
    { itemCost: 0.99, shippingCost: 0, salePrice: 4.99, shippingCharged: 0 },
    { itemCost: 120, shippingCost: 18.75, salePrice: 349.99, shippingCharged: 24.99 },
    { itemCost: 3.33, shippingCost: 1.11, salePrice: 9.99, shippingCharged: 3.33 },
  ];

  it('itemized fees always sum exactly to totalFees', () => {
    for (const c of cases) {
      const r = calculateFees({ ...c, currencyConversion: true, offsiteAds: 'standard' });
      const sum = r.fees.reduce((acc, f) => acc + f.amount, 0);
      // Compare in cents to assert exactness, not float tolerance.
      expect(Math.round(sum * 100)).toBe(Math.round(r.totalFees * 100));
    }
  });

  it('netProfit always equals revenue − fees − costs', () => {
    for (const c of cases) {
      const r = calculateFees(c);
      const expected = r.revenue - r.totalFees - r.totalCosts;
      expect(Math.round(r.netProfit * 100)).toBe(Math.round(expected * 100));
    }
  });

  it('revenue equals sale price + shipping charged', () => {
    const r = calculateFees({ itemCost: 0, shippingCost: 0, salePrice: 19.99, shippingCharged: 6.5 });
    expect(r.revenue).toBe(26.49);
  });

  it('every fee line is a whole number of cents', () => {
    const r = calculateFees({
      itemCost: 1,
      shippingCost: 1,
      salePrice: 33.33,
      shippingCharged: 7.77,
      currencyConversion: true,
      offsiteAds: 'reduced',
      regulatoryFeeRate: 0.011,
    });
    for (const f of r.fees) {
      expect(Number.isInteger(Math.round(f.amount * 100))).toBe(true);
      expect(Math.abs(f.amount * 100 - Math.round(f.amount * 100))).toBeLessThan(1e-9);
    }
  });
});

describe('a realistic profitable sale', () => {
  // $30 item, $5 shipping charged; costs $8 item + $4.50 shipping.
  const r = calculateFees({ itemCost: 8, shippingCost: 4.5, salePrice: 30, shippingCharged: 5 });

  it('nets revenue $35.00 minus $3.78 fees minus $12.50 costs = $18.72', () => {
    expect(r.revenue).toBe(35);
    expect(r.totalFees).toBe(3.78);
    expect(r.totalCosts).toBe(12.5);
    expect(r.netProfit).toBe(18.72);
  });

  it('reports margin as profit over revenue', () => {
    // 18.72 / 35.00 = 53.49%
    expect(r.marginPct).toBeCloseTo(53.49, 2);
  });

  it('reports Etsy’s cut of revenue', () => {
    // 3.78 / 35.00 = 10.8%
    expect(r.feePctOfRevenue).toBeCloseTo(10.8, 2);
  });
});

describe('optional fees', () => {
  const base = { itemCost: 0, shippingCost: 0, salePrice: 30, shippingCharged: 5 };

  it('adds 2.5% currency conversion on the order total', () => {
    const r = calculateFees({ ...base, currencyConversion: true });
    // 2.5% of $35.00 = $0.875 -> $0.88
    expect(feeOf(r, 'currency')).toBe(0.88);
    expect(r.totalFees).toBe(4.66); // 3.78 + 0.88
  });

  it('adds 15% offsite ads when attributed', () => {
    const r = calculateFees({ ...base, offsiteAds: 'standard' });
    expect(feeOf(r, 'offsiteAds')).toBe(5.25); // 15% of $35
    expect(r.totalFees).toBe(9.03);
  });

  it('uses the reduced 12% offsite ads rate for high-volume shops', () => {
    const r = calculateFees({ ...base, offsiteAds: 'reduced' });
    expect(feeOf(r, 'offsiteAds')).toBe(4.2); // 12% of $35
  });

  it('adds a seller-supplied regulatory operating fee on item + shipping', () => {
    const r = calculateFees({ ...base, regulatoryFeeRate: 0.011 });
    // 1.1% of $35.00 = $0.385 -> $0.39
    expect(feeOf(r, 'regulatory')).toBe(0.39);
  });

  it('supports overriding processing rates for non-US sellers', () => {
    const r = calculateFees({
      ...base,
      paymentProcessingRate: 0.04,
      paymentProcessingFixed: 0.3,
    });
    // 4% of $35 = $1.40 + $0.30 = $1.70
    expect(feeOf(r, 'processing')).toBe(1.7);
  });
});

describe('edge cases', () => {
  it('handles free shipping (nothing charged to buyer)', () => {
    const r = calculateFees({ itemCost: 5, shippingCost: 4, salePrice: 20, shippingCharged: 0 });
    expect(r.revenue).toBe(20);
    expect(r.feeBase).toBe(20);
    // 6.5% of 20 = 1.30; processing 3% of 20 = 0.60 + 0.25 = 0.85; listing 0.20
    expect(r.totalFees).toBe(2.35);
    // NB: the literal 8.65 — NOT `20 - 2.35 - 9`, which floats to
    // 8.649999999999999. The engine works in cents and returns exactly 8.65,
    // which is the whole point of not doing this math in floats.
    expect(r.netProfit).toBe(8.65);
  });

  it('reports a loss when the price is too low', () => {
    const r = calculateFees({ itemCost: 15, shippingCost: 6, salePrice: 12, shippingCharged: 0 });
    expect(r.netProfit).toBeLessThan(0);
    expect(r.marginPct).toBeLessThan(0);
  });

  it('does not divide by zero at zero revenue', () => {
    const r = calculateFees({ itemCost: 0, shippingCost: 0, salePrice: 0, shippingCharged: 0 });
    expect(r.revenue).toBe(0);
    expect(r.marginPct).toBe(0);
    expect(r.feePctOfRevenue).toBe(0);
    expect(Number.isFinite(r.netProfit)).toBe(true);
  });

  it('avoids float drift on values like 0.1 + 0.2', () => {
    const r = calculateFees({ itemCost: 0.1, shippingCost: 0.2, salePrice: 0.3, shippingCharged: 0 });
    expect(r.totalCosts).toBe(0.3);
  });
});

describe('breakeven price', () => {
  it('produces a price where profit is >= 0 but a cent less is not', () => {
    const inputs = { itemCost: 8, shippingCost: 4.5, shippingCharged: 5 };
    const r = calculateFees({ ...inputs, salePrice: 30 });
    const be = r.breakevenSalePrice!;

    const atBreakeven = calculateFees({ ...inputs, salePrice: be });
    expect(atBreakeven.netProfit).toBeGreaterThanOrEqual(0);

    const belowBreakeven = calculateFees({ ...inputs, salePrice: be - 0.02 });
    expect(belowBreakeven.netProfit).toBeLessThan(0);
  });

  it('returns null when variable fees would consume the whole sale', () => {
    const r = calculateFees({
      itemCost: 1,
      shippingCost: 0,
      salePrice: 10,
      transactionFeeRate: 0.6,
      paymentProcessingRate: 0.5,
    });
    expect(r.breakevenSalePrice).toBeNull();
  });
});
