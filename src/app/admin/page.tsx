'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';

type AdminUser = {
  id: string;
  email: string;
  plan: string;
  planStatus: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'DISABLED';
  trialEndsAt: string | null;
  isAdmin: boolean;
  createdAt: string;
  accessRequestedAt: string | null;
  hasBoundDevice: boolean;
  hasPendingDevice: boolean;
};

const STATUS_STYLES: Record<AdminUser['planStatus'], string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  TRIAL: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  EXPIRED: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300',
  DISABLED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  const load = useCallback(async () => {
    const res = await authedFetch('/api/admin/users');
    if (res.status === 404 || res.status === 401) {
      setForbidden(true);
      return;
    }
    const data = await res.json();
    setUsers(data.users ?? []);
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  async function act(userId: string, action: string, days?: number) {
    setBusy(`${userId}:${action}`);
    setToast(null);
    try {
      const res = await authedFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, days }),
      });
      const data = await res.json();
      setToast(res.ok ? data.summary : (data.error ?? 'Action failed.'));
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
  }

  if (authed === null) {
    return <main className="mx-auto max-w-6xl px-4 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  if (!authed || forbidden) {
    // Same screen for "not logged in" and "not an admin" — don't reveal the panel.
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-xl font-bold">Not found</h1>
        <p className="mt-2 text-sm text-neutral-500">
          This page does not exist or you do not have access to it.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-brand hover:underline">
          ← Back
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin — access control</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Manual activation. No payment provider is connected.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm font-medium text-brand hover:underline">
          ← App
        </Link>
      </header>

      {toast && (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm dark:border-neutral-800 dark:bg-neutral-900">
          {toast}
        </div>
      )}

      {!users ? (
        <p className="text-sm text-neutral-500">Loading users…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
              <tr>
                <th className="px-3 py-2.5">User</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Trial ends</th>
                <th className="px-3 py-2.5">Device</th>
                <th className="px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {users.map((u) => {
                const requested = u.accessRequestedAt !== null;
                return (
                  <tr key={u.id} className="bg-white align-top dark:bg-neutral-950">
                    <td className="px-3 py-3">
                      <div className="font-medium">{u.email}</div>
                      <div className="text-xs text-neutral-500">
                        {u.isAdmin && (
                          <span className="mr-1 rounded bg-brand/15 px-1.5 py-0.5 font-medium text-brand">
                            admin
                          </span>
                        )}
                        joined {new Date(u.createdAt).toLocaleDateString()}
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[u.planStatus]}`}
                      >
                        {u.planStatus}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap text-xs">
                      {u.trialEndsAt ? new Date(u.trialEndsAt).toLocaleDateString() : '—'}
                    </td>

                    <td className="px-3 py-3 text-xs">
                      <div>{u.hasBoundDevice ? 'bound' : 'none'}</div>
                      {u.hasPendingDevice && (
                        <div className="text-amber-600 dark:text-amber-400">2nd device waiting</div>
                      )}
                      {requested && (
                        <div className="font-medium text-brand">
                          requested {new Date(u.accessRequestedAt!).toLocaleDateString()}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {u.planStatus !== 'ACTIVE' && (
                          <ActionBtn
                            label="Activate"
                            busy={busy === `${u.id}:activate`}
                            onClick={() => act(u.id, 'activate')}
                            primary
                          />
                        )}
                        {u.planStatus === 'DISABLED' && (
                          <ActionBtn
                            label="Restore device"
                            busy={busy === `${u.id}:restore`}
                            onClick={() => act(u.id, 'restore')}
                            primary
                          />
                        )}
                        <ActionBtn
                          label="+7d trial"
                          busy={busy === `${u.id}:extend_trial`}
                          onClick={() => act(u.id, 'extend_trial', 7)}
                        />
                        {u.planStatus !== 'EXPIRED' && (
                          <ActionBtn
                            label="End trial"
                            busy={busy === `${u.id}:end_trial`}
                            onClick={() => act(u.id, 'end_trial')}
                          />
                        )}
                        {u.planStatus !== 'DISABLED' && (
                          <ActionBtn
                            label="Disable"
                            busy={busy === `${u.id}:disable`}
                            onClick={() => act(u.id, 'disable')}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function ActionBtn({
  label,
  onClick,
  busy,
  primary,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
        primary
          ? 'bg-brand text-white hover:bg-brand-dark'
          : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
      }`}
    >
      {busy ? '…' : label}
    </button>
  );
}
