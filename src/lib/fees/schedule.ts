/**
 * ETSY FEE SCHEDULE — real, published rates (CLAUDE.md §1: no invented numbers).
 *
 * Source: Etsy "Fees & Payments Policy" (https://www.etsy.com/legal/fees/)
 *         and Etsy Fee Basics help article.
 * Verified: 2026-07-19.
 *
 * Etsy's own worked example reconciles exactly against these constants:
 *   $30.00 item + $5.00 shipping
 *     listing            $0.20
 *     transaction  6.5% × $35.00 = $2.275 → $2.28
 *     processing   3.0% × $35.00 + $0.25  = $1.30
 *     total                                 $3.78   ✓ (matches Etsy's $3.78)
 *
 * NOTE ON DRIFT: these are published rates, not a live API. Etsy can change
 * them. `FEE_SCHEDULE_VERIFIED_ON` is surfaced in the UI, and every rate is
 * user-overridable on the calculator so a seller is never stuck with a stale
 * constant. Re-verify against the source URL before trusting a stale date.
 */

export const FEE_SCHEDULE_SOURCE = 'https://www.etsy.com/legal/fees/';
export const FEE_SCHEDULE_VERIFIED_ON = '2026-07-19';

/** Flat fee per listing, charged when the listing is created or renewed. */
export const LISTING_FEE_USD = 0.2;

/** Listings run for this long before requiring (paid) renewal. */
export const LISTING_DURATION_MONTHS = 4;

/**
 * 6.5% of "the price you display for each listing plus the amount you charge
 * for shipping and gift wrapping" — so shipping IS in the fee base.
 */
export const TRANSACTION_FEE_RATE = 0.065;

/**
 * Etsy Payments processing. Rates are PER COUNTRY; only the United States rate
 * is encoded here because that is what we verified. Sellers elsewhere should
 * override these in the UI with their country's published rate rather than
 * trusting a guessed constant.
 */
export const PAYMENT_PROCESSING_US = {
  rate: 0.03,
  fixed: 0.25,
} as const;

/** Applied when the listing currency differs from the payment account currency. */
export const CURRENCY_CONVERSION_RATE = 0.025;

/**
 * Offsite Ads. 15% is standard; 12% applies once a shop has made $10,000+ in
 * the past 365 days (at which point participation is mandatory). Charged only
 * on orders actually attributed to an offsite ad, so this is opt-in per calc.
 */
export const OFFSITE_ADS_STANDARD_RATE = 0.15;
export const OFFSITE_ADS_REDUCED_RATE = 0.12;

/**
 * Regulatory operating fee — applies to sellers in certain countries (UK,
 * France, Italy, Spain, Turkey), as a fixed percentage of item price plus
 * shipping. Published range is 0.25%–1.1% and varies by country, so we do NOT
 * hardcode a per-country value; the seller supplies their own rate.
 */
export const REGULATORY_FEE_RANGE = { min: 0.0025, max: 0.011 } as const;
