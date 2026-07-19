import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

/**
 * Current user + access state.
 *
 * Deliberately uses `requireUser`, not `requireActiveUser`: a blocked user
 * must still be able to load this in order to render the blocked screen.
 */
export async function GET(request: Request) {
  try {
    const { user, access } = await requireUser(request);
    return NextResponse.json({
      id: user.id,
      email: user.email,
      plan: user.plan,
      isAdmin: user.isAdmin,
      supabaseAuthId: user.supabaseAuthId,
      createdAt: user.createdAt,
      access: {
        allowed: access.allowed,
        code: access.code,
        status: access.status,
        trialEndsAt: access.trialEndsAt,
        daysLeft: access.daysLeft,
        message: access.message,
      },
      accessRequestedAt: user.accessRequestedAt,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
