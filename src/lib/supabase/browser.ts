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

const DEVICE_STORAGE_KEY = 'plainsignal.device-id';

/**
 * A stable per-browser device id for single-device enforcement (Phase 5).
 * Generated once and kept in localStorage; the server only ever stores a hash.
 * A different browser or profile is a different device — which is the point.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    window.localStorage.setItem(DEVICE_STORAGE_KEY, id);
  }
  return id;
}

/**
 * fetch() wrapper that attaches the current Supabase access token as a bearer
 * header, so protected API routes can verify the JWT, plus the device id used
 * for single-device enforcement. Returns 401-shaped behavior naturally when
 * there is no session.
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
  const deviceId = getDeviceId();
  if (deviceId) headers.set('x-device-id', deviceId);

  return fetch(input, { ...init, headers });
}
