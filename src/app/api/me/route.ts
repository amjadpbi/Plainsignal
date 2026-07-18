import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

/**
 * Returns the current user's row from OUR database. Hitting this endpoint after
 * login is what provisions the User row on first sight (see requireUser).
 */
export async function GET(request: Request) {
  try {
    const { user } = await requireUser(request);
    return NextResponse.json({
      id: user.id,
      email: user.email,
      plan: user.plan,
      supabaseAuthId: user.supabaseAuthId,
      createdAt: user.createdAt,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
