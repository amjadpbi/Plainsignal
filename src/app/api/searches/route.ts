import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

/** List the authenticated user's saved searches — scoped by tenantDb. */
export async function GET(request: Request) {
  try {
    const { db } = await requireUser(request);
    const searches = await db.searches.list({ take: 50 });
    return NextResponse.json({ searches });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
