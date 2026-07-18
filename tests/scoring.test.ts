import { describe, expect, it } from 'vitest';
import {
  clamp,
  demandScore,
  difficultyScore,
  logNormalize,
  opportunityScore,
  scoreKeyword,
  verdictFor,
} from '@/lib/keywords/scoring';
import type { KeywordSignals } from '@/lib/keywords/types';

describe('clamp', () => {
  it('bounds to [0,100] by default', () => {
    expect(clamp(-5)).toBe(0);
    expect(clamp(150)).toBe(100);
    expect(clamp(42)).toBe(42);
  });
});

describe('logNormalize', () => {
  it('maps <= min to 0 and >= max to 100', () => {
    expect(logNormalize(100, 100, 100_000)).toBe(0);
    expect(logNormalize(50, 100, 100_000)).toBe(0);
    expect(logNormalize(100_000, 100, 100_000)).toBe(100);
    expect(logNormalize(200_000, 100, 100_000)).toBe(100);
  });

  it('is monotonically increasing between bounds', () => {
    const a = logNormalize(500, 100, 100_000);
    const b = logNormalize(5_000, 100, 100_000);
    const c = logNormalize(50_000, 100, 100_000);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(a).toBeGreaterThan(0);
    expect(c).toBeLessThan(100);
  });

  it('places the geometric midpoint near 50', () => {
    // sqrt(100 * 100000) ≈ 3162 is the log-midpoint.
    expect(logNormalize(3162, 100, 100_000)).toBeGreaterThan(49);
    expect(logNormalize(3162, 100, 100_000)).toBeLessThan(51);
  });
});

describe('difficulty / demand', () => {
  it('difficulty rises with competition', () => {
    expect(difficultyScore(50)).toBe(0);
    expect(difficultyScore(1_000)).toBeGreaterThan(0);
    expect(difficultyScore(100_000)).toBe(100);
    expect(difficultyScore(1_000)).toBeLessThan(difficultyScore(50_000));
  });

  it('demand rises with favorites', () => {
    expect(demandScore(0)).toBe(0);
    expect(demandScore(2_000)).toBe(100);
    expect(demandScore(50)).toBeLessThan(demandScore(500));
  });
});

describe('opportunityScore', () => {
  it('is high when demand is high and difficulty low', () => {
    expect(opportunityScore(90, 10)).toBeGreaterThan(70);
  });

  it('collapses toward 0 as difficulty approaches 100', () => {
    expect(opportunityScore(90, 100)).toBe(0);
    expect(opportunityScore(90, 95)).toBeLessThan(10);
  });

  it('equals demand when difficulty is 0', () => {
    expect(opportunityScore(60, 0)).toBe(60);
  });
});

describe('verdictFor', () => {
  it('maps opportunity bands to verdicts', () => {
    expect(verdictFor(80)).toBe('STRONG');
    expect(verdictFor(60)).toBe('STRONG');
    expect(verdictFor(59.9)).toBe('PROMISING');
    expect(verdictFor(40)).toBe('PROMISING');
    expect(verdictFor(39)).toBe('CROWDED');
    expect(verdictFor(20)).toBe('CROWDED');
    expect(verdictFor(19)).toBe('AVOID');
    expect(verdictFor(0)).toBe('AVOID');
  });
});

describe('scoreKeyword', () => {
  it('produces a coherent low-competition / high-favorites gem', () => {
    const signals: KeywordSignals = {
      keyword: 'niche gem',
      competitionCount: 300,
      avgFavorites: 800,
      priceMin: 10,
      priceMed: 20,
      priceMax: 40,
      sampleSize: 24,
    };
    const s = scoreKeyword(signals);
    expect(s.difficulty).toBeLessThan(30);
    expect(s.demand).toBeGreaterThan(70);
    expect(s.opportunity).toBeGreaterThan(50);
    expect(['STRONG', 'PROMISING']).toContain(s.verdict);
  });

  it('flags a saturated market as low opportunity', () => {
    const signals: KeywordSignals = {
      keyword: 'saturated',
      competitionCount: 95_000,
      avgFavorites: 30,
      priceMin: 5,
      priceMed: 10,
      priceMax: 15,
      sampleSize: 24,
    };
    const s = scoreKeyword(signals);
    expect(s.difficulty).toBeGreaterThan(90);
    expect(s.opportunity).toBeLessThan(20);
    expect(s.verdict).toBe('AVOID');
  });
});
