import 'server-only';
import type { User } from '@prisma/client';
import { prisma } from '../prisma';
import { tenantDb, type TenantDb } from '../db/tenant';
import { verifySupabaseToken, type VerifiedSupabaseUser } from '../supabase/server';

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

export interface AuthContext {
  authUser: VerifiedSupabaseUser;
  user: User;
  /** Tenant-scoped DB — the ONLY way routes should touch user-owned data. */
  db: TenantDb;
}

function extractBearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * The auth gate for every protected API route (CLAUDE.md §5, step 5).
 *
 *   1. Verify the Supabase JWT (server-side, via GoTrue).
 *   2. Resolve it to OUR User row via supabaseAuthId — provisioning the row on
 *      first sight (Supabase is identity-only; the user record lives in our
 *      Postgres).
 *   3. Return a tenant-scoped DB bound to that user's id.
 *
 * Throws AuthError(401) when the token is missing or invalid.
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

  // Resolve/provision our User row. Keyed by the verified Supabase subject.
  const user = await prisma.user.upsert({
    where: { supabaseAuthId: authUser.id },
    update: { email: authUser.email },
    create: { supabaseAuthId: authUser.id, email: authUser.email },
  });

  return { authUser, user, db: tenantDb(user.id) };
}
