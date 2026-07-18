import {
  CURRENCY_CONVERSION_RATE,
  LISTING_FEE_USD,
  OFFSITE_ADS_REDUCED_RATE,
  OFFSITE_ADS_STANDARD_RATE,
  PAYMENT_PROCESSING_US,
  TRANSACTION_FEE_RATE,
} from './schedule';

/**
 * Etsy fee & profit math. PURE — no AI, no network, no I/O (CLAUDE.md §4.3:
 * "pure math on Etsy's real fee structure. Honest, easy.").
 *
 * All arithmetic runs in INTEGER CENTS. Floating-point dollars would make the
 * itemized fees fail to sum to the total (e.g. 0.1+0.2 !== 0.3); with cents,
 * the breakdown reconciles exactly, every time.
 */

export type OffsiteAdsMode = 'none' | 'standard' | 'reduced';

export interface FeeInput {
  /** What the item costs YOU to make/buy. */
  itemCost: number;
  /** What shipping costs YOU to fulfill. */
  shippingCost: number;
  /** Item price the buyer pays. */
  salePrice: number;
  /** Shipping charged to the buyer (0 = free shipping). */
  shippingCharged?: number;
  /** Gift wrap charged to the buyer. */
  giftWrapCharged?: number;

  /** Listing currency differs from payout currency → 2.5% conversion fee. */
  currencyConversion?: boolean;
  /** Whether this order is attributed to Offsite Ads. */
  offsiteAds?: OffsiteAdsMode;
  /** Regulatory operating fee rate (UK/FR/IT/ES/TR sellers), e.g. 0.011. */
  regulatoryFeeRate?: number;

  /** Overrides for non-US payment processing or a changed schedule. */
  listingFee?: number;
  paymentProcessingRate?: number;
  paymentProcessingFixed?: number;
  transactionFeeRate?: number;
}

export interface FeeLine {
  key: string;
  label: string;
  /** Human-readable basis, e.g. "6.5% of $35.00". */
  basis: string;
  amount: number;
}

export interface FeeResult {
  /** What the buyer pays (item + shipping + gift wrap), excluding sales tax. */
  revenue: number;
  /** The base Etsy applies percentage fees to. */
  feeBase: number;
  fees: FeeLine[];
  totalFees: number;
  /** itemCost + shippingCost. */
  totalCosts: number;
  netProfit: number;
  /** Net profit as a % of revenue. 0 when revenue is 0. */
  marginPct: number;
  /** Etsy's cut as a % of revenue. */
  feePctOfRevenue: number;
  /**
   * Sale price at which profit is exactly zero, holding shipping charged and
   * all costs constant. Null when fees scale past 100% (no breakeven exists).
   */
  breakevenSalePrice: number | null;
}

/** Dollars → integer cents. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents → dollars. */
function toDollars(cents: number): number {
  return cents / 100;
}

/** Percent of a cent amount, rounded half-up to the nearest cent. */
function pctOfCents(cents: number, rate: number): number {
  return Math.round(cents * rate);
}

function fmtUsd(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

function fmtPct(rate: number): string {
  // Trim trailing zeros: 0.065 -> "6.5%", 0.03 -> "3%".
  return `${parseFloat((rate * 100).toFixed(4))}%`;
}

function offsiteRate(mode: OffsiteAdsMode): number {
  if (mode === 'standard') return OFFSITE_ADS_STANDARD_RATE;
  if (mode === 'reduced') return OFFSITE_ADS_REDUCED_RATE;
  return 0;
}

/**
 * Compute the full fee breakdown and resulting profit.
 * Guarantees: every fee line is a whole number of cents, and
 * `sum(fees) === totalFees`, and `netProfit === revenue - totalFees - costs`.
 */
export function calculateFees(input: FeeInput): FeeResult {
  const {
    itemCost,
    shippingCost,
    salePrice,
    shippingCharged = 0,
    giftWrapCharged = 0,
    currencyConversion = false,
    offsiteAds = 'none',
    regulatoryFeeRate = 0,
    listingFee = LISTING_FEE_USD,
    paymentProcessingRate = PAYMENT_PROCESSING_US.rate,
    paymentProcessingFixed = PAYMENT_PROCESSING_US.fixed,
    transactionFeeRate = TRANSACTION_FEE_RATE,
  } = input;

  // Fee base: item price + shipping + gift wrap, per Etsy's policy wording.
  const baseCents = toCents(salePrice) + toCents(shippingCharged) + toCents(giftWrapCharged);
  const revenueCents = baseCents;

  const lines: FeeLine[] = [];

  // 1. Listing fee — flat, per listing.
  const listingCents = toCents(listingFee);
  lines.push({
    key: 'listing',
    label: 'Listing fee',
    basis: `${fmtUsd(listingFee)} flat`,
    amount: toDollars(listingCents),
  });

  // 2. Transaction fee — on item + shipping + gift wrap.
  const transactionCents = pctOfCents(baseCents, transactionFeeRate);
  lines.push({
    key: 'transaction',
    label: 'Transaction fee',
    basis: `${fmtPct(transactionFeeRate)} of ${fmtUsd(toDollars(baseCents))}`,
    amount: toDollars(transactionCents),
  });

  // 3. Payment processing — percentage + flat, on the order total.
  const processingCents = pctOfCents(revenueCents, paymentProcessingRate) + toCents(paymentProcessingFixed);
  lines.push({
    key: 'processing',
    label: 'Payment processing',
    basis: `${fmtPct(paymentProcessingRate)} of ${fmtUsd(toDollars(revenueCents))} + ${fmtUsd(paymentProcessingFixed)}`,
    amount: toDollars(processingCents),
  });

  let totalCents = listingCents + transactionCents + processingCents;

  // 4. Currency conversion — only when payout currency differs.
  if (currencyConversion) {
    const conversionCents = pctOfCents(revenueCents, CURRENCY_CONVERSION_RATE);
    lines.push({
      key: 'currency',
      label: 'Currency conversion',
      basis: `${fmtPct(CURRENCY_CONVERSION_RATE)} of ${fmtUsd(toDollars(revenueCents))}`,
      amount: toDollars(conversionCents),
    });
    totalCents += conversionCents;
  }

  // 5. Offsite Ads — only on attributed orders.
  const adsRate = offsiteRate(offsiteAds);
  if (adsRate > 0) {
    const adsCents = pctOfCents(revenueCents, adsRate);
    lines.push({
      key: 'offsiteAds',
      label: `Offsite Ads (${offsiteAds === 'reduced' ? '12%' : '15%'})`,
      basis: `${fmtPct(adsRate)} of ${fmtUsd(toDollars(revenueCents))}`,
      amount: toDollars(adsCents),
    });
    totalCents += adsCents;
  }

  // 6. Regulatory operating fee — country-specific, seller-supplied rate.
  if (regulatoryFeeRate > 0) {
    const regulatoryCents = pctOfCents(baseCents, regulatoryFeeRate);
    lines.push({
      key: 'regulatory',
      label: 'Regulatory operating fee',
      basis: `${fmtPct(regulatoryFeeRate)} of ${fmtUsd(toDollars(baseCents))}`,
      amount: toDollars(regulatoryCents),
    });
    totalCents += regulatoryCents;
  }

  const costsCents = toCents(itemCost) + toCents(shippingCost);
  const netCents = revenueCents - totalCents - costsCents;

  // Breakeven: revenue*(1 - variableRate) - fixedFees - costs = 0
  const variableRate =
    transactionFeeRate +
    paymentProcessingRate +
    (currencyConversion ? CURRENCY_CONVERSION_RATE : 0) +
    adsRate +
    (regulatoryFeeRate > 0 ? regulatoryFeeRate : 0);
  const fixedCents = listingCents + toCents(paymentProcessingFixed);

  let breakevenSalePrice: number | null = null;
  if (variableRate < 1) {
    const breakevenBaseCents = (fixedCents + costsCents) / (1 - variableRate);
    const priceCents = Math.ceil(breakevenBaseCents - toCents(shippingCharged) - toCents(giftWrapCharged));
    breakevenSalePrice = toDollars(priceCents);
  }

  return {
    revenue: toDollars(revenueCents),
    feeBase: toDollars(baseCents),
    fees: lines,
    totalFees: toDollars(totalCents),
    totalCosts: toDollars(costsCents),
    netProfit: toDollars(netCents),
    marginPct: revenueCents === 0 ? 0 : Math.round((netCents / revenueCents) * 10000) / 100,
    feePctOfRevenue: revenueCents === 0 ? 0 : Math.round((totalCents / revenueCents) * 10000) / 100,
    breakevenSalePrice,
  };
}
