import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { summarizeTrend, type TrendPoint } from '@/lib/keywords/trends';
import type { NicheVerdict } from '@/lib/keywords/types';

export const dynamic = 'force-dynamic';

/**
 * Time-series for one keyword, scoped to the caller's own captures.
 * Keyword comes from a query param (not a path segment) so spaces and slashes
 * in keywords need no special encoding.
 */
export async function GET(request: Request) {
  try {
    const { db } = await requireUser(request);

    const keyword = new URL(request.url).searchParams.get('keyword')?.trim();
    if (!keyword) {
      return NextResponse.json({ error: 'Missing ?keyword=' }, { status: 400 });
    }

    const rows = await db.trends.forKeyword(keyword);

    const points: TrendPoint[] = rows.map((r) => ({
      capturedAt: r.capturedAt.toISOString(),
      competitionCount: r.competitionCount,
      avgFavorites: r.avgFavorites,
      priceMed: r.priceMed,
      difficulty: r.score?.difficulty ?? 0,
      demand: r.score?.demand ?? 0,
      opportunity: r.score?.opportunity ?? 0,
      verdict: (r.score?.verdict ?? 'AVOID') as NicheVerdict,
    }));

    return NextResponse.json({
      keyword,
      points,
      summary: summarizeTrend(keyword, points),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
