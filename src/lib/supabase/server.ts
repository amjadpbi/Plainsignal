import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '../env';

/**
 * Server-side Supabase clients. Supabase is our IDENTITY ISSUER ONLY
 * (CLAUDE.md §2) — no application data is stored there. These clients:
 *   - verify user JWTs (anon-key client), and
 *   - perform admin user operations (service-role client).
 *
 * server-only import guard: these must never reach the client bundle, since the
 * service-role key is a full-access secret.
 */

let verifyClient: SupabaseClient | undefined;
let adminClient: SupabaseClient | undefined;

/** Client used solely to validate a user access token via GoTrue. */
function getVerifyClient(): SupabaseClient {
  if (verifyClient) return verifyClient;
  const { url, anonKey } = getSupabaseConfig();
  verifyClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return verifyClient;
}

/** Service-role client for admin operations (create/delete users). */
export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin operations.');
  }
  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return adminClient;
}

export interface VerifiedSupabaseUser {
  id: string;
  email: string;
}

/**
 * Verify a Supabase access token and return the authenticated user.
 * The token is validated server-side by GoTrue (`auth.getUser(token)`); an
 * invalid/expired token yields null. We never trust unverified JWT claims.
 */
export async function verifySupabaseToken(
  token: string,
): Promise<VerifiedSupabaseUser | null> {
  const { data, error } = await getVerifyClient().auth.getUser(token);
  if (error || !data.user) return null;
  return {
    id: data.user.id,
    // Email is effectively always present for password auth; fall back safely.
    email: data.user.email ?? `${data.user.id}@no-email.supabase`,
  };
}
