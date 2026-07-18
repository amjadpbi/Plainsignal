import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runKeywordResearch } from '@/lib/keywords/service';
import { RateLimitError } from '@/lib/rate-limit';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { EtsyApiError } from '@/lib/etsy/client';

// Keyword research does live/mocked I/O — never statically prerender it.
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  seed: z.string().trim().min(2, 'Enter at least 2 characters.').max(120),
  maxKeywords: z.number().int().min(1).max(24).optional(),
});

export async function POST(request: Request) {
  // Auth gate: verify JWT + resolve to our User row + get a tenant-scoped DB.
  let auth;
  try {
    auth = await requireUser(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const result = await runKeywordResearch(parsed.data.seed, {
      maxKeywords: parsed.data.maxKeywords,
    });

    // Persist the run + a dated snapshot per keyword, via the tenant-scoped DB
    // (userId is stamped automatically — never passed from the request).
    // Each run appends a new point to that keyword's time-series.
    const saved = await auth.db.searches.createWithSnapshots({
      seedKeyword: parsed.data.seed,
      snapshots: result.keywords.map((k) => ({
        keyword: k.keyword,
        competitionCount: k.competitionCount,
        avgFavorites: k.avgFavorites,
        priceMin: k.priceMin,
        priceMed: k.priceMed,
        priceMax: k.priceMax,
        difficulty: k.difficulty,
        demand: k.demand,
        opportunity: k.opportunity,
        verdict: k.verdict,
      })),
    });

    return NextResponse.json({
      ...result,
      searchId: saved.id,
      snapshotsSaved: saved.snapshots.length,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      // 429 for the daily/second Etsy ceilings.
      return NextResponse.json({ error: err.message }, { status: 429 });
    }

    if (err instanceof EtsyApiError) {
      console.error('Etsy API rejected the request:', err.message);
      // Upstream failure — 502, never a silent fallback to mock data.
      if (err.isAuthError) {
        return NextResponse.json(
          {
            error:
              `Etsy rejected the API key (HTTP ${err.status}): "${err.etsyMessage}" ` +
              'If your app is still "Pending Personal Approval", the key is not active yet — ' +
              'this call will keep failing until Etsy approves it. Clear ETSY_API_KEY to return to mock mode.',
            code: 'ETSY_AUTH_FAILED',
            etsyStatus: err.status,
            etsyMessage: err.etsyMessage,
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          error: `Etsy API error (HTTP ${err.status}): "${err.etsyMessage}"`,
          code: 'ETSY_UPSTREAM_ERROR',
          etsyStatus: err.status,
          etsyMessage: err.etsyMessage,
        },
        { status: 502 },
      );
    }

    console.error('Keyword research failed:', err);
    return NextResponse.json(
      { error: 'Keyword research failed. Check server logs.' },
      { status: 500 },
    );
  }
}
