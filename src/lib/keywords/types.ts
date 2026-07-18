import type { DataSource } from '../etsy/types';

/** Verdict labels — mirror the Prisma NicheVerdict enum. */
export type NicheVerdict = 'STRONG' | 'PROMISING' | 'CROWDED' | 'AVOID';

/** The real marketplace signals captured for one keyword. */
export interface KeywordSignals {
  keyword: string;
  /** REAL count of active Etsy listings for the query — the competition signal. */
  competitionCount: number;
  /** Mean favorites across the sampled listings — an engagement/demand proxy. */
  avgFavorites: number;
  priceMin: number | null;
  priceMed: number | null;
  priceMax: number | null;
  /** How many listings the aggregates were computed from. */
  sampleSize: number;
}

/** Derived 0–100 scores plus verdict for a keyword. */
export interface KeywordScoreResult {
  difficulty: number;
  demand: number;
  opportunity: number;
  verdict: NicheVerdict;
}

/** A fully analyzed keyword: real signals + derived scores + provenance. */
export interface AnalyzedKeyword extends KeywordSignals, KeywordScoreResult {
  source: DataSource;
}

/** Top-level result of a research run over a seed keyword. */
export interface ResearchResult {
  seed: string;
  source: DataSource;
  /** True when numbers are synthetic (mock mode) — surface this in the UI. */
  isMock: boolean;
  keywords: AnalyzedKeyword[];
  rollup: {
    keywordCount: number;
    avgDifficulty: number;
    avgOpportunity: number;
    /** Keywords with a STRONG or PROMISING verdict. */
    gemCount: number;
    verdict: NicheVerdict;
  };
  /**
   * Honesty note rendered in the UI. Etsy exposes no search-volume endpoint,
   * so no volume metric is shown here (CLAUDE.md §1).
   */
  notes: string[];
}
