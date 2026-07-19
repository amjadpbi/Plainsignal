/**
 * NUMERIC GROUNDING GUARD.
 *
 * CLAUDE.md §1: "Every metric shown to a user must be grounded in real data,
 * not invented by a language model... the LLM is a reasoning layer on top of
 * real numbers, never a substitute for them."
 *
 * A prompt instructing the model not to invent figures is not an enforcement
 * mechanism. This module IS the enforcement: it extracts every dollar amount
 * and percentage the model wrote and checks each against the set of figures we
 * actually handed it. Anything else is a fabrication, and the caller suppresses
 * the narrative rather than showing it.
 *
 * Pure and deterministic — no network, no model.
 */

export type GroundingViolation = {
  /** The literal token as written by the model, e.g. "$41.20". */
  cited: string;
  kind: 'currency' | 'percent' | 'count';
  value: number;
};

export interface GroundingOptions {
  /**
   * Also check bare numbers (competition counts, favourites, view counts).
   * OFF by default so existing callers keep their exact prior behavior.
   */
  checkCounts?: boolean;
  /**
   * Bare numbers below this are treated as prose ("3 searches", "13 tags")
   * and skipped. Data figures like competition counts are far larger.
   */
  countThreshold?: number;
}

export type GroundingReport = {
  ok: boolean;
  /** Figures the model cited that we did NOT supply. */
  violations: GroundingViolation[];
  /** Count of figures checked. */
  checked: number;
};

/** Currency like $1,234.56 / $12 / $0.20 */
const CURRENCY_RE = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/g;
/** Percentages like 12%, 4.5 %, 100% */
const PERCENT_RE = /(\d+(?:\.\d+)?)\s?%/g;
/** Any bare number, e.g. 4,213 or 98 or 120.5 */
const NUMBER_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

const DEFAULT_COUNT_THRESHOLD = 100;

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/** Round to cents so $18.7 and $18.70 compare equal. */
function keyCurrency(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Keys stored for a SUPPLIED percentage. The model legitimately rounds 53.49%
 * to "53.5%" or "53%", so store both precisions.
 */
function percentKeys(n: number): string[] {
  return [(Math.round(n * 10) / 10).toFixed(1), Math.round(n).toFixed(0)];
}

/**
 * Keys to look up for a CITED figure — precision-aware, and deliberately
 * narrower than the stored keys.
 *
 * A cited value must be a rounding of something we supplied, not merely share
 * an integer part with it. Matching on both precisions here would let "2.3%"
 * pass whenever the integer 2 appears anywhere in the data (it rounds to "2"),
 * which silently defeats the guard. So: a decimal citation must match at 1dp,
 * and only a whole-number citation may match a whole-number rounding.
 */
function citedKeys(raw: string, value: number): string[] {
  return raw.includes('.')
    ? [(Math.round(value * 10) / 10).toFixed(1)]
    : [Math.round(value).toFixed(0)];
}

/**
 * Pull every figure out of a free-text field that we supplied to the model.
 *
 * Context often contains prose we generated from real data — e.g. an audit
 * finding reading "Priced 247% above the market median of $15.00". Those
 * numbers ARE real supplied data, so they must land in the allowed set;
 * otherwise the guard rejects an answer that correctly quotes our own text.
 */
export function extractFigures(text: string): {
  currency: number[];
  percent: number[];
  counts: number[];
} {
  const currency: number[] = [];
  const percent: number[] = [];
  const counts: number[] = [];
  const consumed: Array<[number, number]> = [];

  for (const m of text.matchAll(CURRENCY_RE)) {
    currency.push(toNumber(m[1]));
    consumed.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of text.matchAll(PERCENT_RE)) {
    percent.push(toNumber(m[1]));
    consumed.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of text.matchAll(NUMBER_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (consumed.some(([s, e]) => start < e && end > s)) continue;
    counts.push(toNumber(m[0]));
  }

  return { currency, percent, counts };
}

/**
 * Build the allowed set from the exact facts passed to the model.
 * Pass every number the model is permitted to cite.
 */
export function buildAllowedFigures(input: {
  currency?: Array<number | null | undefined>;
  percent?: Array<number | null | undefined>;
  /** Bare figures: competition counts, favourites, views, sample sizes. */
  counts?: Array<number | null | undefined>;
}): { currency: Set<string>; percent: Set<string>; counts: Set<string> } {
  const currency = new Set<string>();
  const percent = new Set<string>();
  const counts = new Set<string>();

  for (const c of input.currency ?? []) {
    if (typeof c === 'number' && Number.isFinite(c)) currency.add(keyCurrency(c));
  }
  for (const p of input.percent ?? []) {
    if (typeof p === 'number' && Number.isFinite(p)) {
      for (const k of percentKeys(p)) percent.add(k);
    }
  }
  for (const n of input.counts ?? []) {
    if (typeof n === 'number' && Number.isFinite(n)) {
      // Accept the exact value and its 1dp rounding (models round averages).
      counts.add(String(n));
      counts.add((Math.round(n * 10) / 10).toString());
      counts.add(String(Math.round(n)));
    }
  }
  return { currency, percent, counts };
}

/**
 * Verify every figure in `text` was supplied in `allowed`.
 * Returns the violations rather than throwing, so the caller decides policy.
 */
export function verifyGrounding(
  text: string,
  allowed: { currency: Set<string>; percent: Set<string>; counts?: Set<string> },
  opts: GroundingOptions = {},
): GroundingReport {
  const violations: GroundingViolation[] = [];
  let checked = 0;

  // Spans consumed by $ / % matches, so the bare-number pass doesn't
  // re-flag the digits inside "$30.00" or "3.5%".
  const consumed: Array<[number, number]> = [];

  for (const match of text.matchAll(CURRENCY_RE)) {
    checked++;
    const value = toNumber(match[1]);
    consumed.push([match.index!, match.index! + match[0].length]);
    if (!allowed.currency.has(keyCurrency(value))) {
      violations.push({ cited: match[0].trim(), kind: 'currency', value });
    }
  }

  for (const match of text.matchAll(PERCENT_RE)) {
    checked++;
    const value = toNumber(match[1]);
    consumed.push([match.index!, match.index! + match[0].length]);
    if (!citedKeys(match[1], value).some((k) => allowed.percent.has(k))) {
      violations.push({ cited: match[0].trim(), kind: 'percent', value });
    }
  }

  if (opts.checkCounts) {
    const threshold = opts.countThreshold ?? DEFAULT_COUNT_THRESHOLD;
    const allowedCounts = allowed.counts ?? new Set<string>();

    for (const match of text.matchAll(NUMBER_RE)) {
      const start = match.index!;
      const end = start + match[0].length;
      // Skip digits already accounted for as currency or a percentage.
      if (consumed.some(([s, e]) => start < e && end > s)) continue;

      const value = toNumber(match[0]);
      // Small numbers are prose ("3 searches", "13 tags"), not data claims.
      if (value < threshold) continue;
      // Bare 4-digit values in this range are almost always years. Known,
      // documented gap: a real count in 1990-2100 goes unchecked.
      if (Number.isInteger(value) && value >= 1990 && value <= 2100) continue;

      checked++;
      // Same precision rule as percentages: a decimal citation must match a
      // supplied decimal, not just an integer that happens to be present.
      const keys = match[0].includes('.')
        ? [String(value), (Math.round(value * 10) / 10).toFixed(1)]
        : [String(value), String(Math.round(value))];
      if (!keys.some((k) => allowedCounts.has(k))) {
        violations.push({ cited: match[0].trim(), kind: 'count', value });
      }
    }
  }

  return { ok: violations.length === 0, violations, checked };
}
