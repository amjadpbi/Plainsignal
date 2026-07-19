import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccessError, AuthError, requireActiveUser } from '@/lib/auth/require-user';
import { calculateFees } from '@/lib/fees/calculate';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  label: z.string().trim().max(120).optional(),
  itemCost: z.number().min(0).max(1_000_000),
  shippingCost: z.number().min(0).max(1_000_000),
  salePrice: z.number().min(0).max(1_000_000),
  shippingCharged: z.number().min(0).max(1_000_000).optional(),
  giftWrapCharged: z.number().min(0).max(1_000_000).optional(),
  currencyConversion: z.boolean().optional(),
  offsiteAds: z.enum(['none', 'standard', 'reduced']).optional(),
  regulatoryFeeRate: z.number().min(0).max(1).optional(),
  listingFee: z.number().min(0).max(100).optional(),
  paymentProcessingRate: z.number().min(0).max(1).optional(),
  paymentProcessingFixed: z.number().min(0).max(100).optional(),
  transactionFeeRate: z.number().min(0).max(1).optional(),
});

/** List the caller's saved calculations. */
export async function GET(request: Request) {
  try {
    const { db } = await requireActiveUser(request);
    const calculations = await db.feeCalculations.list({ take: 50 });
    return NextResponse.json({ calculations });
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
}

/**
 * Save a calculation. The result is RECOMPUTED here from the inputs rather
 * than trusting numbers sent by the client, so a stored record always matches
 * what the fee engine actually produces.
 */
export async function POST(request: Request) {
  let auth;
  try {
    auth = await requireActiveUser(request);
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

  const input = parsed.data;
  const result = calculateFees(input);

  const saved = await auth.db.feeCalculations.create({
    label: input.label ?? null,
    itemCost: input.itemCost,
    shippingCost: input.shippingCost,
    salePrice: input.salePrice,
    shippingCharged: input.shippingCharged ?? 0,
    revenue: result.revenue,
    totalFees: result.totalFees,
    netProfit: result.netProfit,
    marginPct: result.marginPct,
    breakdownJson: { inputs: input, fees: result.fees },
  });

  return NextResponse.json({ calculation: saved, result });
}
