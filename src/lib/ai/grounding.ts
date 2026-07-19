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
  kind: 'currency' | 'percent';
  value: number;
};

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

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/** Round to cents so $18.7 and $18.70 compare equal. */
function keyCurrency(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * Round percentages to 1dp. The model legitimately rounds 53.49% to "53.5%"
 * or "53%", so accept anything that matches at 1dp or at whole-number
 * precision.
 */
function percentKeys(n: number): string[] {
  return [(Math.round(n * 10) / 10).toFixed(1), Math.round(n).toFixed(0)];
}

/**
 * Build the allowed set from the exact facts passed to the model.
 * Pass every number the model is permitted to cite.
 */
export function buildAllowedFigures(input: {
  currency?: Array<number | null | undefined>;
  percent?: Array<number | null | undefined>;
}): { currency: Set<string>; percent: Set<string> } {
  const currency = new Set<string>();
  const percent = new Set<string>();

  for (const c of input.currency ?? []) {
    if (typeof c === 'number' && Number.isFinite(c)) currency.add(keyCurrency(c));
  }
  for (const p of input.percent ?? []) {
    if (typeof p === 'number' && Number.isFinite(p)) {
      for (const k of percentKeys(p)) percent.add(k);
    }
  }
  return { currency, percent };
}

/**
 * Verify every figure in `text` was supplied in `allowed`.
 * Returns the violations rather than throwing, so the caller decides policy.
 */
export function verifyGrounding(
  text: string,
  allowed: { currency: Set<string>; percent: Set<string> },
): GroundingReport {
  const violations: GroundingViolation[] = [];
  let checked = 0;

  for (const match of text.matchAll(CURRENCY_RE)) {
    checked++;
    const value = toNumber(match[1]);
    if (!allowed.currency.has(keyCurrency(value))) {
      violations.push({ cited: match[0].trim(), kind: 'currency', value });
    }
  }

  for (const match of text.matchAll(PERCENT_RE)) {
    checked++;
    const value = toNumber(match[1]);
    if (!percentKeys(value).some((k) => allowed.percent.has(k))) {
      violations.push({ cited: match[0].trim(), kind: 'percent', value });
    }
  }

  return { ok: violations.length === 0, violations, checked };
}
