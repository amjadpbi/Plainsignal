import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { AuthError, requireAdmin } from '@/lib/auth/require-user';
import { trialEndsAtFrom, TRIAL_DAYS } from '@/lib/access/policy';

export const dynamic = 'force-dynamic';

/**
 * ADMIN PANEL API (Phase 5). Gated by is_admin via `requireAdmin`, which
 * denies with a 404 so the panel's existence isn't advertised.
 *
 * Manual, admin-driven only — no payment provider. Every action here maps
 * cleanly onto something a billing webhook could later call instead.
 */

const actionSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(['activate', 'restore', 'extend_trial', 'end_trial', 'disable']),
  /** Days to extend by, for extend_trial. */
  days: z.number().int().min(1).max(365).optional(),
});

/** List every user with their access state. */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        plan: true,
        planStatus: true,
        trialEndsAt: true,
        isAdmin: true,
        createdAt: true,
        accessRequestedAt: true,
        // Booleans only — never expose device hashes to the client.
        activeDeviceId: true,
        pendingDeviceId: true,
      },
    });

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        plan: u.plan,
        planStatus: u.planStatus,
        trialEndsAt: u.trialEndsAt,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt,
        accessRequestedAt: u.accessRequestedAt,
        hasBoundDevice: u.activeDeviceId !== null,
        hasPendingDevice: u.pendingDeviceId !== null,
      })),
      trialDays: TRIAL_DAYS,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const parsed = actionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request.', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { userId, action, days } = parsed.data;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const now = new Date();
    let data: Record<string, unknown>;
    let summary: string;

    switch (action) {
      case 'activate':
        // Full access, trial clock no longer relevant.
        data = { planStatus: 'ACTIVE', accessRequestedAt: null };
        summary = `${target.email} activated.`;
        break;

      case 'restore': {
        // Clear the device lock and adopt the device they're actually on.
        const newDevice = target.pendingDeviceId ?? target.activeDeviceId;
        const restoredStatus =
          target.trialEndsAt && target.trialEndsAt.getTime() < now.getTime()
            ? 'EXPIRED'
            : 'TRIAL';
        data = {
          // Never silently upgrade: a restored user returns to the state they
          // would have been in, not to ACTIVE.
          planStatus: target.planStatus === 'DISABLED' ? restoredStatus : target.planStatus,
          activeDeviceId: newDevice,
          pendingDeviceId: null,
          accessRequestedAt: null,
        };
        summary = `${target.email} restored; their new device is now the active one.`;
        break;
      }

      case 'extend_trial': {
        const from =
          target.trialEndsAt && target.trialEndsAt.getTime() > now.getTime()
            ? target.trialEndsAt
            : now;
        data = {
          trialEndsAt: trialEndsAtFrom(from, days ?? TRIAL_DAYS),
          planStatus: 'TRIAL',
        };
        summary = `${target.email} trial extended by ${days ?? TRIAL_DAYS} day(s).`;
        break;
      }

      case 'end_trial':
        data = { trialEndsAt: now, planStatus: 'EXPIRED' };
        summary = `${target.email} trial ended.`;
        break;

      case 'disable':
        data = { planStatus: 'DISABLED' };
        summary = `${target.email} disabled.`;
        break;
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        planStatus: true,
        trialEndsAt: true,
        accessRequestedAt: true,
      },
    });

    return NextResponse.json({ ok: true, summary, user: updated });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
