import type { NicheVerdict } from './types';

/** One dated capture of a keyword's market signals. */
export interface TrendPoint {
  capturedAt: string;
  competitionCount: number;
  avgFavorites: number;
  priceMed: number | null;
  difficulty: number;
  demand: number;
  opportunity: number;
  verdict: NicheVerdict;
}

export type TrendDirection = 'up' | 'down' | 'flat';

export interface TrendSummary {
  keyword: string;
  pointCount: number;
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
  /** Absolute change from the first capture to the latest. */
  competitionChange: number;
  opportunityChange: number;
  difficultyChange: number;
  competitionDirection: TrendDirection;
  opportunityDirection: TrendDirection;
  /** True when every capture holds identical values (e.g. deterministic mock). */
  unchanged: boolean;
}

function direction(delta: number): TrendDirection {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Summarize how a keyword moved between its first and latest capture.
 * Pure and deterministic — the trend view's headline numbers come from here.
 */
export function summarizeTrend(keyword: string, points: TrendPoint[]): TrendSummary {
  if (points.length === 0) {
    return {
      keyword,
      pointCount: 0,
      firstCapturedAt: null,
      lastCapturedAt: null,
      competitionChange: 0,
      opportunityChange: 0,
      difficultyChange: 0,
      competitionDirection: 'flat',
      opportunityDirection: 'flat',
      unchanged: true,
    };
  }

  const first = points[0];
  const last = points[points.length - 1];

  const competitionChange = last.competitionCount - first.competitionCount;
  const opportunityChange = round2(last.opportunity - first.opportunity);
  const difficultyChange = round2(last.difficulty - first.difficulty);

  const unchanged = points.every(
    (p) =>
      p.competitionCount === first.competitionCount &&
      p.opportunity === first.opportunity &&
      p.difficulty === first.difficulty,
  );

  return {
    keyword,
    pointCount: points.length,
    firstCapturedAt: first.capturedAt,
    lastCapturedAt: last.capturedAt,
    competitionChange,
    opportunityChange,
    difficultyChange,
    competitionDirection: direction(competitionChange),
    opportunityDirection: direction(opportunityChange),
    unchanged,
  };
}
