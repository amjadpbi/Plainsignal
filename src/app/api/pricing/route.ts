import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccessError, AuthError, requireActiveUser } from '@/lib/auth/require-user';
import { getPricingAdvice } from '@/lib/pricing/assistant';
import { AiError } from '@/lib/ai/provider';
import { EtsyApiError } from '@/lib/etsy/client';
import { RateLimitError } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  keyword: z.string().trim().min(2).max(120),
  itemCost: z.number().min(0).max(1_000_000),
  shippingCost: z.number().min(0).max(1_000_000),
  shippingCharged: z.number().min(0).max(1_000_000).optional(),
});

export async function POST(request: Request) {
  try {
    await requireActiveUser(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof AccessError) {
      // Specific, user-facing reason with the decision attached so the UI can
      // render the right blocked screen — never a generic error (Phase 5).
      return NextResponse.json(
        { error: err.message, code: err.decision.code, access: err.decision },
        { status: err.status },
      );
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

  const { keyword, itemCost, shippingCost, shippingCharged } = parsed.data;

  try {
    const advice = await getPricingAdvice(keyword, {
      itemCost,
      shippingCost,
      shippingCharged,
    });
    return NextResponse.json(advice);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof EtsyApiError) {
      console.error('Etsy rejected the pricing lookup:', err.message);
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
    if (err instanceof AiError) {
      console.error('Anthropic call failed:', err.message);
      return NextResponse.json(
        { error: err.message, code: 'AI_ERROR' },
        { status: 502 },
      );
    }
    console.error('Pricing advice failed:', err);
    return NextResponse.json(
      { error: 'Pricing advice failed. Check server logs.' },
      { status: 500 },
    );
  }
}
