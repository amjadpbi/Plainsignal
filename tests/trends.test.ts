import { describe, expect, it } from 'vitest';
import { summarizeTrend, type TrendPoint } from '@/lib/keywords/trends';

function pt(over: Partial<TrendPoint> & { capturedAt: string }): TrendPoint {
  return {
    competitionCount: 1000,
    avgFavorites: 100,
    priceMed: 20,
    difficulty: 50,
    demand: 50,
    opportunity: 25,
    verdict: 'CROWDED',
    ...over,
  };
}

describe('summarizeTrend', () => {
  it('handles an empty series', () => {
    const s = summarizeTrend('x', []);
    expect(s.pointCount).toBe(0);
    expect(s.unchanged).toBe(true);
    expect(s.competitionChange).toBe(0);
  });

  it('reports a single capture as unchanged', () => {
    const s = summarizeTrend('x', [pt({ capturedAt: '2026-01-01T00:00:00Z' })]);
    expect(s.pointCount).toBe(1);
    expect(s.unchanged).toBe(true);
    expect(s.competitionChange).toBe(0);
    expect(s.firstCapturedAt).toBe(s.lastCapturedAt);
  });

  it('detects a market getting more crowded (competition up, opportunity down)', () => {
    const s = summarizeTrend('x', [
      pt({ capturedAt: '2026-01-01T00:00:00Z', competitionCount: 1000, opportunity: 60, difficulty: 40 }),
      pt({ capturedAt: '2026-02-01T00:00:00Z', competitionCount: 4200, opportunity: 35, difficulty: 62 }),
    ]);

    expect(s.pointCount).toBe(2);
    expect(s.competitionChange).toBe(3200);
    expect(s.competitionDirection).toBe('up');
    expect(s.opportunityChange).toBe(-25);
    expect(s.opportunityDirection).toBe('down');
    expect(s.difficultyChange).toBe(22);
    expect(s.unchanged).toBe(false);
  });

  it('detects an opening market (competition down, opportunity up)', () => {
    const s = summarizeTrend('x', [
      pt({ capturedAt: '2026-01-01T00:00:00Z', competitionCount: 9000, opportunity: 10 }),
      pt({ capturedAt: '2026-03-01T00:00:00Z', competitionCount: 2500, opportunity: 48 }),
    ]);
    expect(s.competitionDirection).toBe('down');
    expect(s.opportunityDirection).toBe('up');
    expect(s.opportunityChange).toBe(38);
  });

  it('compares first vs latest across more than two captures', () => {
    const s = summarizeTrend('x', [
      pt({ capturedAt: '2026-01-01T00:00:00Z', competitionCount: 100, opportunity: 70 }),
      pt({ capturedAt: '2026-01-15T00:00:00Z', competitionCount: 5000, opportunity: 20 }),
      pt({ capturedAt: '2026-02-01T00:00:00Z', competitionCount: 300, opportunity: 65 }),
    ]);
    expect(s.pointCount).toBe(3);
    // first (100/70) vs last (300/65) — not the intermediate spike.
    expect(s.competitionChange).toBe(200);
    expect(s.opportunityChange).toBe(-5);
  });

  it('flags an identical series as unchanged (deterministic mock captures)', () => {
    const same = { competitionCount: 777, opportunity: 42, difficulty: 33 };
    const s = summarizeTrend('x', [
      pt({ capturedAt: '2026-01-01T00:00:00Z', ...same }),
      pt({ capturedAt: '2026-01-01T00:05:00Z', ...same }),
    ]);
    expect(s.pointCount).toBe(2);
    expect(s.unchanged).toBe(true);
    expect(s.competitionChange).toBe(0);
    expect(s.opportunityChange).toBe(0);
  });
});
