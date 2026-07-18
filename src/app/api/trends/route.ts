import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

/** Keywords the authenticated user has capture history for. */
export async function GET(request: Request) {
  try {
    const { db } = await requireUser(request);
    const keywords = await db.trends.keywords();
    return NextResponse.json({ keywords });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
