'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';
import type { AuditResult } from '@/lib/audit/audit';
import type { Severity } from '@/lib/audit/rules';

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
};

function scoreTone(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 60) return 'text-lime-600 dark:text-lime-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

export default function AuditPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [listing, setListing] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!listing.trim()) {
      setError('Enter a listing ID or Etsy listing URL.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Audit failed.');
        setResult(null);
      } else {
        setResult(data as AuditResult);
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
          Log in to audit your listings.
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

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Listing audit</h1>
            {result && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  result.isMock
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                }`}
              >
                {result.isMock ? 'MOCK DATA' : 'LIVE ETSY DATA'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Scores title, tags, and price against Etsy&apos;s documented limits and real
            competitor prices. Rule-based — no AI opinions.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm font-medium text-brand hover:underline">
          ← Research
        </Link>
      </header>

      <form onSubmit={run} className="mb-6 flex gap-2">
        <input
          value={listing}
          onChange={(e) => setListing(e.target.value)}
          placeholder="Listing ID (e.g. 1234567890) or Etsy listing URL"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? 'Auditing…' : 'Audit'}
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

          {/* Score + category breakdown */}
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-neutral-200 bg-white p-5 text-center dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Audit score</div>
              <div className={`mt-2 text-5xl font-bold tabular-nums ${scoreTone(result.score)}`}>
                {result.score}
              </div>
              <div className="mt-1 text-xs text-neutral-500">out of 100</div>
            </div>

            <div className="md:col-span-2 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="mb-3 text-xs uppercase tracking-wide text-neutral-500">
                By category
              </div>
              <ul className="space-y-2">
                {result.categoryScores.map((c) => (
                  <li key={c.category} className="flex items-center gap-3 text-sm">
                    <span className="w-24 capitalize">{c.category}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                      <div
                        className={`h-full ${
                          c.score / c.max >= 0.8
                            ? 'bg-green-500'
                            : c.score / c.max >= 0.5
                              ? 'bg-amber-400'
                              : 'bg-red-400'
                        }`}
                        style={{ width: `${(c.score / c.max) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 text-right tabular-nums text-xs text-neutral-500">
                      {c.score}/{c.max}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Listing facts */}
          <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 text-sm dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
              Listing {result.listingId}
            </div>
            <p className="font-medium">{result.listing.title || '(no title)'}</p>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-neutral-600 sm:grid-cols-4 dark:text-neutral-400">
              <span>Title: {result.listing.title.length}/140 chars</span>
              <span>Tags: {result.listing.tagCount}/13</span>
              <span>Photos: {result.listing.imageCount}</span>
              <span>
                Price: ${result.listing.price.toFixed(2)} {result.listing.currencyCode}
              </span>
              <span>Description: {result.listing.descriptionLength} chars</span>
              <span>Focus keyword: {result.focusKeyword || '—'}</span>
              {result.market && (
                <>
                  <span>Competition: {result.market.competitionCount.toLocaleString()}</span>
                  <span>
                    Market median:{' '}
                    {result.market.medianPrice === null
                      ? '—'
                      : `$${result.market.medianPrice.toFixed(2)}`}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Findings */}
          <h2 className="mb-3 text-lg font-semibold">
            {result.findings.length === 0
              ? 'No issues found'
              : `${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}`}
          </h2>

          {result.findings.length === 0 ? (
            <p className="text-sm text-neutral-500">
              This listing passes every rule we check. Nice.
            </p>
          ) : (
            <ul className="space-y-3">
              {result.findings.map((f) => (
                <li
                  key={f.id}
                  className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLES[f.severity]}`}
                    >
                      {f.severity}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-neutral-500">
                      {f.category}
                    </span>
                    <span className="ml-auto text-xs tabular-nums text-neutral-400">
                      −{f.deduction} pts
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{f.message}</p>
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                    {f.recommendation}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
