'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';
import type { RiskLevel, TrademarkCheckResult } from '@/lib/trademark/types';

const RISK_STYLES: Record<RiskLevel, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  info: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300',
};

const MATCH_LABEL: Record<string, string> = {
  exact: 'Exact match',
  contains: 'Appears in text',
  fuzzy: 'Close spelling',
};

export default function TrademarkPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'text' | 'listing'>('text');
  const [text, setText] = useState('');
  const [listing, setListing] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrademarkCheckResult | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body = mode === 'text' ? { text } : { listing };
      const res = await authedFetch('/api/trademark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Check failed.');
        setResult(null);
      } else {
        setResult(data as TrademarkCheckResult);
      }
    } catch {
      setError('Network error — is the dev server running?');
    } finally {
      setLoading(false);
    }
  }

  if (authed === null) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Log in to run trademark checks.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Log in
        </Link>
      </main>
    );
  }

  const clean = result && result.matches.length === 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Trademark risk</h1>
            {result && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  result.isMock
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                }`}
              >
                {result.isMock ? 'MOCK REGISTER' : 'LIVE REGISTER'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Surfaces real registered marks that match your title or tags. Matches only —
            no judgement about infringement.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm font-medium text-brand hover:underline">
          ← Research
        </Link>
      </header>

      <div className="mb-4 flex gap-2 text-sm">
        {(['text', 'listing'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 font-medium ${
              mode === m
                ? 'bg-brand text-white'
                : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
            }`}
          >
            {m === 'text' ? 'Check text' : 'Check a listing'}
          </button>
        ))}
      </div>

      <form onSubmit={check} className="mb-6 flex gap-2">
        {mode === 'text' ? (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Title or phrase, e.g. 'Nike inspired handmade socks'"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-900"
          />
        ) : (
          <input
            value={listing}
            onChange={(e) => setListing(e.target.value)}
            placeholder="Listing ID or Etsy listing URL"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-900"
          />
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Check'}
        </button>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {result && (
        <section>
          <div className="mb-6 space-y-2">
            {result.notes.map((n, i) => (
              <p
                key={i}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
              >
                {n}
              </p>
            ))}
          </div>

          {clean ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-5 dark:border-green-900 dark:bg-green-950/40">
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                No matches found against the register we checked.
              </p>
              <p className="mt-1 text-xs text-green-700 dark:text-green-400">
                This is not clearance — it means nothing matched the marks searched.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex gap-3 text-sm">
                <span className="rounded-lg bg-red-100 px-3 py-1.5 font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
                  {result.summary.high} high
                </span>
                <span className="rounded-lg bg-amber-100 px-3 py-1.5 font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  {result.summary.medium} medium
                </span>
                <span className="rounded-lg bg-neutral-200 px-3 py-1.5 font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
                  {result.summary.info} info
                </span>
              </div>

              <ul className="space-y-3">
                {result.matches.map((m, i) => (
                  <li
                    key={`${m.record.mark}-${i}`}
                    className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${RISK_STYLES[m.riskLevel]}`}
                      >
                        {m.riskLevel}
                      </span>
                      <span className="text-base font-semibold">{m.record.mark}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          m.record.status === 'LIVE'
                            ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                            : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                        }`}
                      >
                        {m.record.statusText}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                      {MATCH_LABEL[m.matchType] ?? m.matchType} in your {m.field}:{' '}
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        &ldquo;{m.matchedText}&rdquo;
                      </span>
                    </p>

                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500">
                      {m.record.owner && <span>Owner: {m.record.owner}</span>}
                      {m.record.serialNumber && <span>Serial: {m.record.serialNumber}</span>}
                      {m.record.classes.length > 0 && (
                        <span>Classes: {m.record.classes.join(', ')}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
