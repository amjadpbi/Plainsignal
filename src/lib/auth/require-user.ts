import 'server-only';
import type { User } from '@prisma/client';
import { prisma } from '../prisma';
import { tenantDb, type TenantDb } from '../db/tenant';
import { verifySupabaseToken, type VerifiedSupabaseUser } from '../supabase/server';
import { env } from '../env';
import { deviceHashFromRequest, evaluateDevice } from '../access/device';
import {
  evaluateAccess,
  shouldExpire,
  trialEndsAtFrom,
  type AccessDecision,
} from '../access/policy';

/** Thrown when a request is unauthenticated; carries the HTTP status to return. */
export class AuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Thrown when the user is authenticated but not permitted to act (Phase 5). */
export class AccessError extends Error {
  constructor(
    public readonly decision: AccessDecision,
    public readonly status = 403,
  ) {
    super(decision.message);
    this.name = 'AccessError';
  }
}

export interface AuthContext {
  authUser: VerifiedSupabaseUser;
  user: User;
  /** Tenant-scoped DB — the ONLY way routes should touch user-owned data. */
  db: TenantDb;
  /** Current access state; feature routes must honour `allowed`. */
  access: AccessDecision;
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/** Emails that get is_admin on provisioning. Kept in env, never in code. */
function adminEmails(): string[] {
  return env.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The auth gate for every protected API route (CLAUDE.md §5, step 5).
 *
 *   1. Verify the Supabase JWT (server-side, via GoTrue).
 *   2. Resolve it to OUR User row via supabaseAuthId, provisioning on first
 *      sight with a trial window and the admin flag.
 *   3. Apply single-device enforcement (Phase 5).
 *   4. Evaluate access and return the decision.
 *
 * This does NOT block on access — it reports it, so endpoints like /api/me
 * still work for a blocked user (they need it to render the blocked screen).
 * Gated feature routes use `requireActiveUser`.
 */
export async function requireUser(request: Request): Promise<AuthContext> {
  const token = extractBearer(request);
  if (!token) {
    throw new AuthError(401, 'Missing bearer token.');
  }

  const authUser = await verifySupabaseToken(token);
  if (!authUser) {
    throw new AuthError(401, 'Invalid or expired session.');
  }

  const now = new Date();
  const isAdmin = adminEmails().includes(authUser.email.toLowerCase());

  // Resolve/provision our User row. New users start a trial immediately.
  let user = await prisma.user.upsert({
    where: { supabaseAuthId: authUser.id },
    update: { email: authUser.email, ...(isAdmin ? { isAdmin: true } : {}) },
    create: {
      supabaseAuthId: authUser.id,
      email: authUser.email,
      isAdmin,
      planStatus: 'TRIAL',
      trialEndsAt: trialEndsAtFrom(now),
    },
  });

  // Backfill a trial window for rows created before Phase 5.
  if (user.planStatus === 'TRIAL' && user.trialEndsAt === null) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { trialEndsAt: trialEndsAtFrom(now) },
    });
  }

  // --- Single-device enforcement ---
  const incoming = deviceHashFromRequest(request);
  const deviceAction = evaluateDevice(user.activeDeviceId, incoming, user.planStatus);

  if (deviceAction.action === 'bind') {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { activeDeviceId: deviceAction.deviceHash },
    });
  } else if (deviceAction.action === 'lock') {
    // A second device locks the account rather than evicting the first.
    user = await prisma.user.update({
      where: { id: user.id },
      data: { planStatus: 'DISABLED', pendingDeviceId: deviceAction.deviceHash },
    });
  }

  // --- Lazy trial expiry, so the admin list reflects reality ---
  if (shouldExpire(user, now)) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { planStatus: 'EXPIRED' },
    });
  }

  const access = evaluateAccess(user, now, { supportContact: env.SUPPORT_CONTACT });

  return { authUser, user, db: tenantDb(user.id), access };
}

/**
 * Gate for value-generating actions (research, audit, pricing, coach).
 * Throws AccessError(403) with a specific, user-facing reason — never a
 * generic error.
 */
export async function requireActiveUser(request: Request): Promise<AuthContext> {
  const ctx = await requireUser(request);
  if (!ctx.access.allowed) {
    throw new AccessError(ctx.access);
  }
  return ctx;
}

/** Gate for the admin panel. */
export async function requireAdmin(request: Request): Promise<AuthContext> {
  const ctx = await requireUser(request);
  if (!ctx.user.isAdmin) {
    // Deliberately a 404-shaped denial: don't advertise the panel's existence.
    throw new AuthError(404, 'Not found.');
  }
  return ctx;
}
