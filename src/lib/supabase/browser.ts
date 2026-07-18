'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseOrigin } from '../env';

/**
 * Browser Supabase client — used only for auth (sign-up, login, session).
 * It persists the session in localStorage so the access token survives reloads.
 * The URL is normalized to the project origin (the dashboard sometimes provides
 * the …/rest/v1/ endpoint).
 */
let client: SupabaseClient | undefined;

export function getBrowserSupabase(): SupabaseClient {
  if (client) return client;
  const url = supabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  client = createClient(url, anonKey);
  return client;
}

/**
 * fetch() wrapper that attaches the current Supabase access token as a bearer
 * header, so protected API routes can verify the JWT. Returns 401-shaped
 * behavior naturally when there is no session.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const supabase = getBrowserSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers = new Headers(init.headers);
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  return fetch(input, { ...init, headers });
}
