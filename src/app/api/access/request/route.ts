import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth/require-user';

export const dynamic = 'force-dynamic';

/**
 * "Request access" — used by a device-locked or expired user to flag
 * themselves for an admin. Intentionally uses `requireUser`, since by
 * definition the caller is blocked.
 *
 * Idempotent: repeated presses just refresh the timestamp.
 */
export async function POST(request: Request) {
  try {
    const { user } = await requireUser(request);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { accessRequestedAt: new Date() },
      select: { accessRequestedAt: true },
    });

    return NextResponse.json({
      requested: true,
      requestedAt: updated.accessRequestedAt,
      message: 'Your request has been sent to the administrator.',
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
