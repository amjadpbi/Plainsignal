import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { checkTrademarkRisk } from '@/lib/trademark/check';
import { getEtsyClient, EtsyApiError } from '@/lib/etsy/client';
import { extractListingId } from '@/lib/audit/listing-id';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    /** Free text to check (a title, phrase, or single term). */
    text: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().max(100)).max(20).optional(),
    /** Or an Etsy listing id / URL, whose title + tags get checked. */
    listing: z.string().trim().max(300).optional(),
  })
  .refine((v) => Boolean(v.text?.length) || Boolean(v.listing?.length), {
    message: 'Provide either text or a listing.',
  });

export async function POST(request: Request) {
  try {
    await requireUser(request);
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

  const { text, tags, listing } = parsed.data;

  try {
    // Listing path: pull the real listing and check its title + tags.
    if (listing) {
      const listingId = extractListingId(listing);
      if (!listingId) {
        return NextResponse.json(
          { error: 'Could not read a listing ID. Paste a numeric ID or an Etsy listing URL.' },
          { status: 400 },
        );
      }
      const detail = await getEtsyClient().getListing(listingId);
      const result = await checkTrademarkRisk({ title: detail.title, tags: detail.tags });
      return NextResponse.json({ ...result, listingId: detail.listingId });
    }

    // Free-text path.
    const result = await checkTrademarkRisk({ title: text ?? '', tags: tags ?? [] });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EtsyApiError) {
      console.error('Etsy rejected the listing fetch for trademark check:', err.message);
      return NextResponse.json(
        {
          error: err.isAuthError
            ? `Etsy rejected the API key (HTTP ${err.status}): "${err.etsyMessage}" ` +
              'A key pending approval is not active yet. Clear ETSY_API_KEY to use mock mode.'
            : `Etsy API error (HTTP ${err.status}): "${err.etsyMessage}"`,
          code: err.isAuthError ? 'ETSY_AUTH_FAILED' : 'ETSY_UPSTREAM_ERROR',
        },
        { status: 502 },
      );
    }
    console.error('Trademark check failed:', err);
    return NextResponse.json(
      { error: 'Trademark check failed. Check server logs.' },
      { status: 500 },
    );
  }
}
