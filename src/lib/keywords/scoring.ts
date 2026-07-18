import type { KeywordScoreResult, KeywordSignals, NicheVerdict } from './types';

/**
 * Keyword scoring — the load-bearing, honest-data core (CLAUDE.md §1, §7).
 *
 * Every score is derived ONLY from real Etsy signals:
 *   - difficulty  ← active-listing count (real competition)
 *   - demand      ← average favorites of sampled listings (real engagement)
 *   - opportunity ← demand tempered by difficulty
 *
 * No search volume is used or invented — Etsy exposes none (CLAUDE.md §1).
 * All functions are pure and deterministic so they can be unit-tested.
 */

export function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Map a value onto 0–100 using a log scale between `min` and `max`.
 * Log scale because competition/favorites span several orders of magnitude;
 * a linear scale would bunch almost everything at the bottom.
 * Values at or below `min` map to 0; at or above `max` map to 100.
 */
export function logNormalize(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 100;
  const lo = Math.log(min);
  const hi = Math.log(max);
  return clamp(((Math.log(value) - lo) / (hi - lo)) * 100);
}

// Calibration bounds. Chosen so typical Etsy niches spread across the range.
const COMPETITION_MIN = 100; // ~no meaningful competition below this
const COMPETITION_MAX = 100_000; // saturated above this
const FAVORITES_MIN = 1;
const FAVORITES_MAX = 2_000;

/** Difficulty (0–100) from the real active-listing count. Higher = harder. */
export function difficultyScore(competitionCount: number): number {
  return round1(logNormalize(competitionCount, COMPETITION_MIN, COMPETITION_MAX));
}

/** Demand (0–100) from average favorites of sampled listings. Higher = more pull. */
export function demandScore(avgFavorites: number): number {
  return round1(logNormalize(avgFavorites, FAVORITES_MIN, FAVORITES_MAX));
}

/**
 * Opportunity (0–100): demand you can realistically capture given competition.
 * demand × (1 − difficulty/100): high demand + low difficulty ranks highest;
 * a saturated market (difficulty→100) collapses opportunity toward 0 regardless
 * of demand.
 */
export function opportunityScore(demand: number, difficulty: number): number {
  return round1(clamp(demand * (1 - difficulty / 100)));
}

/** Bucket opportunity into an actionable verdict. */
export function verdictFor(opportunity: number): NicheVerdict {
  if (opportunity >= 60) return 'STRONG';
  if (opportunity >= 40) return 'PROMISING';
  if (opportunity >= 20) return 'CROWDED';
  return 'AVOID';
}

/** Compute all derived scores for a keyword's real signals. */
export function scoreKeyword(signals: KeywordSignals): KeywordScoreResult {
  const difficulty = difficultyScore(signals.competitionCount);
  const demand = demandScore(signals.avgFavorites);
  const opportunity = opportunityScore(demand, difficulty);
  return { difficulty, demand, opportunity, verdict: verdictFor(opportunity) };
}
