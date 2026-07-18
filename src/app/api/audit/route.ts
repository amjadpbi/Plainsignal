import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { auditListing } from '@/lib/audit/audit';
import { EtsyApiError } from '@/lib/etsy/client';
import { extractListingId } from '@/lib/audit/listing-id';
import { RateLimitError } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  // Accept a bare id or a full Etsy URL; we extract the id below.
  listing: z.string().trim().min(1).max(300),
});

/** List the caller's past audits. */
export async function GET(request: Request) {
  try {
    const { db } = await requireUser(request);
    const audits = await db.audits.list({ take: 50 });
    return NextResponse.json({ audits });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function POST(request: Request) {
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

  const listingId = extractListingId(parsed.data.listing);
  if (!listingId) {
    return NextResponse.json(
      { error: 'Could not read a listing ID. Paste a numeric ID or an Etsy listing URL.' },
      { status: 400 },
    );
  }

  try {
    const result = await auditListing(listingId);

    // Persist under the user's shop (auto-provisioned), via the scoped client.
    const shop = await auth.db.shops.getOrCreateDefault();
    const saved = await auth.db.audits.create({
      shopId: shop.id,
      listingId: result.listingId,
      score: result.score,
      findingsJson: {
        findings: result.findings,
        categoryScores: result.categoryScores,
        focusKeyword: result.focusKeyword,
        market: result.market,
        listing: result.listing,
        source: result.source,
      },
    });

    return NextResponse.json({ ...result, auditRunId: saved.id });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof EtsyApiError) {
      console.error('Etsy API rejected the audit request:', err.message);
      if (err.isAuthError) {
        return NextResponse.json(
          {
            error:
              `Etsy rejected the API key (HTTP ${err.status}): "${err.etsyMessage}" ` +
              'If your app is still "Pending Personal Approval", the key is not active yet. ' +
              'Clear ETSY_API_KEY to run the audit in mock mode.',
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
    console.error('Listing audit failed:', err);
    return NextResponse.json(
      { error: 'Listing audit failed. Check server logs.' },
      { status: 500 },
    );
  }
}
