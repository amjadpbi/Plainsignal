'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';
import type { NicheVerdict, ResearchResult } from '@/lib/keywords/types';

const VERDICT_STYLES: Record<NicheVerdict, string> = {
  STRONG: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  PROMISING: 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300',
  CROWDED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  AVOID: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function VerdictBadge({ verdict }: { verdict: NicheVerdict }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT_STYLES[verdict]}`}
    >
      {verdict}
    </span>
  );
}

function ScoreBar({ value, tone }: { value: number; tone: 'diff' | 'demand' | 'opp' }) {
  const color =
    tone === 'diff' ? 'bg-red-400' : tone === 'demand' ? 'bg-blue-400' : 'bg-green-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="tabular-nums text-xs text-neutral-600 dark:text-neutral-400">
        {value.toFixed(0)}
      </span>
    </div>
  );
}

function fmtPrice(min: number | null, max: number | null): string {
  if (min === null || max === null) return '—';
  if (min === max) return `$${min.toFixed(2)}`;
  return `$${min.toFixed(2)}–$${max.toFixed(2)}`;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'authed'; email: string };

export default function Home() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [seed, setSeed] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setAuth(
        data.session
          ? { status: 'authed', email: data.session.user.email ?? '(no email)' }
          : { status: 'anon' },
      );
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(
        session
          ? { status: 'authed', email: session.user.email ?? '(no email)' }
          : { status: 'anon' },
      );
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Provision our User row on load (idempotent) once authenticated.
  useEffect(() => {
    if (auth.status === 'authed') {
      authedFetch('/api/me').catch(() => {});
    }
  }, [auth.status]);

  const logout = useCallback(async () => {
    await getBrowserSupabase().auth.signOut();
    setResult(null);
  }, []);

  async function research(e: React.FormEvent) {
    e.preventDefault();
    if (seed.trim().length < 2) {
      setError('Enter at least 2 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/keywords/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.');
        setResult(null);
      } else {
        setResult(data as ResearchResult);
      }
    } catch {
      setError('Network error — is the dev server running?');
    } finally {
      setLoading(false);
    }
  }

  if (auth.status === 'loading') {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  if (auth.status === 'anon') {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Plainsignal</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Honest, data-grounded Etsy keyword research. Log in to start.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Sign up
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">Plainsignal</h1>
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
            Keyword &amp; niche research grounded in real Etsy signals — competition
            counts and listing favorites. No invented metrics.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-neutral-500">{auth.email}</div>
          <div className="mt-1 flex justify-end gap-3">
            <Link href="/trends" className="text-xs font-medium text-brand hover:underline">
              Trends
            </Link>
            <Link href="/fees" className="text-xs font-medium text-brand hover:underline">
              Fees
            </Link>
            <Link href="/audit" className="text-xs font-medium text-brand hover:underline">
              Audit
            </Link>
            <Link href="/trademark" className="text-xs font-medium text-brand hover:underline">
              Trademark
            </Link>
            <Link href="/pricing" className="text-xs font-medium text-brand hover:underline">
              Pricing
            </Link>
            <Link href="/coach" className="text-xs font-medium text-brand hover:underline">
              Coach
            </Link>
            <button onClick={logout} className="text-xs font-medium text-brand hover:underline">
              Log out
            </button>
          </div>
        </div>
      </header>

      <form onSubmit={research} className="mb-6 flex gap-2">
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Seed keyword, e.g. 'linen apron'"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? 'Researching…' : 'Research'}
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
            {result.notes.map((note, i) => (
              <p
                key={i}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
              >
                {note}
              </p>
            ))}
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RollupCard label="Keywords" value={String(result.rollup.keywordCount)} />
            <RollupCard label="Avg difficulty" value={result.rollup.avgDifficulty.toFixed(0)} />
            <RollupCard label="Avg opportunity" value={result.rollup.avgOpportunity.toFixed(0)} />
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="text-xs uppercase tracking-wide text-neutral-500">Niche verdict</div>
              <div className="mt-2">
                <VerdictBadge verdict={result.rollup.verdict} />
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {result.rollup.gemCount} gem{result.rollup.gemCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2.5">Keyword</th>
                  <th className="px-3 py-2.5 text-right">Competition</th>
                  <th className="px-3 py-2.5 text-right">Avg favs</th>
                  <th className="px-3 py-2.5 text-right">Price range</th>
                  <th className="px-3 py-2.5">Difficulty</th>
                  <th className="px-3 py-2.5">Demand</th>
                  <th className="px-3 py-2.5">Opportunity</th>
                  <th className="px-3 py-2.5">Verdict</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {result.keywords.map((k) => (
                  <tr key={k.keyword} className="bg-white dark:bg-neutral-950">
                    <td className="px-3 py-2.5 font-medium">{k.keyword}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {k.competitionCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {k.avgFavorites.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtPrice(k.priceMin, k.priceMax)}
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBar value={k.difficulty} tone="diff" />
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBar value={k.demand} tone="demand" />
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBar value={k.opportunity} tone="opp" />
                    </td>
                    <td className="px-3 py-2.5">
                      <VerdictBadge verdict={k.verdict} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!result && !error && (
        <p className="text-sm text-neutral-500">
          Enter a seed keyword to see real competition, favorites, price spread, and
          difficulty / demand / opportunity scores.
        </p>
      )}
    </main>
  );
}

function RollupCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
