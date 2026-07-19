'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Wraps a gated feature page. Renders children only when the account may act;
 * otherwise shows a specific blocked screen (Phase 5) — a trial-expired notice
 * with a contact, or a device-lock screen with a "request access" action.
 */

export type AccessState = {
  allowed: boolean;
  code: 'OK' | 'TRIAL_EXPIRED' | 'DEVICE_LOCKED';
  status: string;
  trialEndsAt: string | null;
  daysLeft: number | null;
  message: string;
};

type Me = {
  email: string;
  isAdmin: boolean;
  access: AccessState;
  accessRequestedAt: string | null;
};

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requestedAt, setRequestedAt] = useState<string | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  useEffect(() => {
    if (!authed) return;
    authedFetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Me | null) => {
        if (d) {
          setMe(d);
          setRequestedAt(d.accessRequestedAt);
        }
      })
      .catch(() => {});
  }, [authed]);

  const requestAccess = useCallback(async () => {
    setRequesting(true);
    try {
      const res = await authedFetch('/api/access/request', { method: 'POST' });
      const data = await res.json();
      if (res.ok) setRequestedAt(data.requestedAt);
    } finally {
      setRequesting(false);
    }
  }, []);

  if (authed === null) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Log in to continue.</p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Log in
        </Link>
      </main>
    );
  }

  // Still loading /api/me — render children rather than flashing a gate.
  if (!me) return <>{children}</>;

  if (me.access.allowed) {
    return (
      <>
        {me.access.status === 'TRIAL' && me.access.daysLeft !== null && me.access.daysLeft <= 3 && (
          <div className="mx-auto max-w-5xl px-4 pt-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {me.access.message}
            </div>
          </div>
        )}
        {children}
      </>
    );
  }

  const isDeviceLock = me.access.code === 'DEVICE_LOCKED';

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
            isDeviceLock
              ? 'bg-amber-100 dark:bg-amber-900/40'
              : 'bg-red-100 dark:bg-red-900/40'
          }`}
        >
          {isDeviceLock ? '🔒' : '⏳'}
        </div>

        <h1 className="mt-4 text-xl font-bold">
          {isDeviceLock ? 'Active session on another device' : 'Your trial has ended'}
        </h1>

        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{me.access.message}</p>

        {isDeviceLock && (
          <div className="mt-6">
            {requestedAt ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                Request sent {new Date(requestedAt).toLocaleString()}. An administrator will
                review it.
              </div>
            ) : (
              <button
                onClick={requestAccess}
                disabled={requesting}
                className="w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {requesting ? 'Sending…' : 'Request access for this device'}
              </button>
            )}
          </div>
        )}

        {!isDeviceLock && requestedAt && (
          <p className="mt-4 text-xs text-neutral-500">
            Request sent {new Date(requestedAt).toLocaleString()}.
          </p>
        )}

        {!isDeviceLock && !requestedAt && (
          <button
            onClick={requestAccess}
            disabled={requesting}
            className="mt-6 w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {requesting ? 'Sending…' : 'Request activation'}
          </button>
        )}

        <p className="mt-6 text-xs text-neutral-400">
          Signed in as {me.email} ·{' '}
          <button
            onClick={() => getBrowserSupabase().auth.signOut()}
            className="underline hover:text-neutral-600"
          >
            Log out
          </button>
        </p>
      </div>
    </main>
  );
}
