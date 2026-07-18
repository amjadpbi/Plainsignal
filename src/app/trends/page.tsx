'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';
import { TrendChart } from '@/components/trend-chart';
import type { TrendPoint, TrendSummary } from '@/lib/keywords/trends';
import type { NicheVerdict } from '@/lib/keywords/types';

interface TrackedKeyword {
  keyword: string;
  captureCount: number;
  lastCapturedAt: string | null;
}

const VERDICT_STYLES: Record<NicheVerdict, string> = {
  STRONG: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  PROMISING: 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300',
  CROWDED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  AVOID: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

function Delta({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="text-neutral-400">no change</span>;
  // For competition/difficulty, "up" is bad; for opportunity, "up" is good.
  const good = invert ? value < 0 : value > 0;
  const cls = good ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={`font-medium tabular-nums ${cls}`}>
      {sign}
      {value.toLocaleString()}
    </span>
  );
}

export default function TrendsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [keywords, setKeywords] = useState<TrackedKeyword[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [summary, setSummary] = useState<TrendSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  const loadKeywords = useCallback(async () => {
    const res = await authedFetch('/api/trends');
    if (!res.ok) return;
    const data = await res.json();
    setKeywords(data.keywords ?? []);
    if (!selected && data.keywords?.length) {
      setSelected(data.keywords[0].keyword);
    }
  }, [selected]);

  useEffect(() => {
    if (authed) loadKeywords();
  }, [authed, loadKeywords]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    authedFetch(`/api/trends/series?keyword=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((d) => {
        setPoints(d.points ?? []);
        setSummary(d.summary ?? null);
      })
      .finally(() => setLoading(false));
  }, [selected]);

  if (authed === null) {
    return <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Log in to see your keyword history.
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
          <h1 className="text-2xl font-bold tracking-tight">Keyword trends</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Every research run saves a dated snapshot. This is how your keywords moved
            over time — not just the latest reading.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm font-medium text-brand hover:underline">
          ← Research
        </Link>
      </header>

      {keywords.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No history yet. Run a search on the{' '}
          <Link href="/" className="text-brand hover:underline">
            research page
          </Link>
          , then come back — run it again later to see movement.
        </p>
      ) : (
        <>
          <div className="mb-6">
            <label className="mb-1 block text-xs uppercase tracking-wide text-neutral-500">
              Keyword
            </label>
            <select
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full max-w-md rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              {keywords.map((k) => (
                <option key={k.keyword} value={k.keyword}>
                  {k.keyword} ({k.captureCount} capture{k.captureCount === 1 ? '' : 's'})
                </option>
              ))}
            </select>
          </div>

          {loading && <p className="text-sm text-neutral-500">Loading history…</p>}

          {!loading && points.length > 0 && summary && (
            <>
              <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Captures</div>
                  <div className="mt-2 text-2xl font-bold tabular-nums">{summary.pointCount}</div>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    Competition change
                  </div>
                  <div className="mt-2 text-lg">
                    <Delta value={summary.competitionChange} invert />
                  </div>
                </div>
                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">
                    Opportunity change
                  </div>
                  <div className="mt-2 text-lg">
                    <Delta value={summary.opportunityChange} />
                  </div>
                </div>
              </div>

              <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <TrendChart
                  label="Competition (active listings)"
                  color="#ef4444"
                  points={points.map((p) => ({
                    t: new Date(p.capturedAt).getTime(),
                    v: p.competitionCount,
                  }))}
                  format={(n) => n.toLocaleString()}
                />
                <TrendChart
                  label="Opportunity (0–100)"
                  color="#22c55e"
                  points={points.map((p) => ({
                    t: new Date(p.capturedAt).getTime(),
                    v: p.opportunity,
                  }))}
                  format={(n) => n.toFixed(1)}
                />
                <TrendChart
                  label="Avg favorites"
                  color="#3b82f6"
                  points={points.map((p) => ({
                    t: new Date(p.capturedAt).getTime(),
                    v: p.avgFavorites,
                  }))}
                  format={(n) => n.toLocaleString()}
                />
              </div>

              <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                    <tr>
                      <th className="px-3 py-2.5">Captured</th>
                      <th className="px-3 py-2.5 text-right">Competition</th>
                      <th className="px-3 py-2.5 text-right">Avg favs</th>
                      <th className="px-3 py-2.5 text-right">Median price</th>
                      <th className="px-3 py-2.5 text-right">Difficulty</th>
                      <th className="px-3 py-2.5 text-right">Opportunity</th>
                      <th className="px-3 py-2.5">Verdict</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {[...points].reverse().map((p, i) => (
                      <tr key={i} className="bg-white dark:bg-neutral-950">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {new Date(p.capturedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.competitionCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.avgFavorites.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.priceMed === null ? '—' : `$${p.priceMed.toFixed(2)}`}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.difficulty.toFixed(1)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {p.opportunity.toFixed(1)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT_STYLES[p.verdict]}`}
                          >
                            {p.verdict}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
