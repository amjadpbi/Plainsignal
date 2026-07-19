'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AccessGate } from '@/components/access-gate';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';
import type { PricingAdvice } from '@/lib/pricing/assistant';

function usd(n: number | null): string {
  if (n === null) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-950"
      />
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

function PricingPageInner() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [keyword, setKeyword] = useState('linen apron');
  const [itemCost, setItemCost] = useState(8);
  const [shippingCost, setShippingCost] = useState(4.5);
  const [shippingCharged, setShippingCharged] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<PricingAdvice | null>(null);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, itemCost, shippingCost, shippingCharged }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Pricing lookup failed.');
        setAdvice(null);
      } else {
        setAdvice(data as PricingAdvice);
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
          Log in to use the pricing assistant.
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
            <h1 className="text-2xl font-bold tracking-tight">Pricing assistant</h1>
            {advice && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  advice.isMock
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                }`}
              >
                {advice.isMock ? 'MOCK DATA' : 'LIVE ETSY DATA'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Tiers are real competitor price percentiles run through the fee calculator.
            The AI only explains them — it never picks a number.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm font-medium text-brand hover:underline">
          ← Research
        </Link>
      </header>

      <form onSubmit={run} className="mb-6 space-y-3">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Keyword, e.g. 'linen apron'"
          className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField label="Item cost" value={itemCost} onChange={setItemCost} hint="Your cost" />
          <NumberField
            label="Shipping cost"
            value={shippingCost}
            onChange={setShippingCost}
            hint="What you pay"
          />
          <NumberField
            label="Shipping charged"
            value={shippingCharged}
            onChange={setShippingCharged}
            hint="0 = free shipping"
          />
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {loading ? 'Analyzing…' : 'Get tiers'}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {advice && (
        <section>
          <div className="mb-6 space-y-2">
            {advice.notes.map((n, i) => (
              <p
                key={i}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400"
              >
                {n}
              </p>
            ))}
          </div>

          {/* Real competitor spread */}
          <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-neutral-500">
                Competitor price spread
              </span>
              <span className="text-xs text-neutral-500">
                {advice.spread.sampleSize} listings ·{' '}
                {advice.competitionCount.toLocaleString()} total competitors
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
              {(
                [
                  ['Min', advice.spread.min],
                  ['25th', advice.spread.p25],
                  ['Median', advice.spread.median],
                  ['75th', advice.spread.p75],
                  ['Max', advice.spread.max],
                  ['Mean', advice.spread.mean],
                ] as const
              ).map(([label, v]) => (
                <div key={label}>
                  <div className="text-xs text-neutral-500">{label}</div>
                  <div className="font-semibold tabular-nums">{usd(v)}</div>
                </div>
              ))}
            </div>
            {advice.breakeven !== null && advice.breakeven > 0 && (
              <p className="mt-3 text-xs text-neutral-500">
                Your breakeven sale price:{' '}
                <strong className="tabular-nums">{usd(advice.breakeven)}</strong>
              </p>
            )}
          </div>

          {/* Tiers */}
          {advice.tiers.length === 0 ? (
            <p className="mb-6 text-sm text-neutral-500">
              No competitor prices were available, so no tiers could be built.
            </p>
          ) : (
            <div className="mb-6 grid gap-4 md:grid-cols-3">
              {advice.tiers.map((t) => {
                const isPick = advice.recommendedTier?.key === t.key;
                return (
                  <div
                    key={t.key}
                    className={`rounded-xl border p-5 ${
                      isPick
                        ? 'border-brand bg-brand/5 dark:bg-brand/10'
                        : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{t.label}</span>
                      {isPick && (
                        <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">
                          Best profit
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-3xl font-bold tabular-nums">{usd(t.price)}</div>
                    <div className="mt-1 text-xs text-neutral-500">{t.basis}</div>

                    <dl className="mt-4 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">Etsy fees</dt>
                        <dd className="tabular-nums text-red-600 dark:text-red-400">
                          −{usd(t.totalFees)}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">Net profit</dt>
                        <dd
                          className={`font-semibold tabular-nums ${
                            t.profitable
                              ? 'text-green-600 dark:text-green-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {usd(t.netProfit)}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-neutral-500">Margin</dt>
                        <dd className="tabular-nums">{t.marginPct.toFixed(1)}%</dd>
                      </div>
                      {t.vsMedianPct !== null && (
                        <div className="flex justify-between">
                          <dt className="text-neutral-500">vs median</dt>
                          <dd className="tabular-nums">
                            {t.vsMedianPct > 0 ? '+' : ''}
                            {t.vsMedianPct.toFixed(1)}%
                          </dd>
                        </div>
                      )}
                    </dl>

                    {!t.profitable && (
                      <p className="mt-3 text-xs font-medium text-red-600 dark:text-red-400">
                        Does not clear a profit at your costs.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Narrative */}
          <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Rationale</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  advice.narrative.origin === 'model'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300'
                }`}
              >
                {advice.narrative.origin === 'model'
                  ? `${advice.narrative.provider} · ${advice.narrative.model}`
                  : 'computed summary'}
              </span>
            </div>
            <p className="text-sm leading-relaxed">{advice.narrative.text}</p>

            {advice.narrative.groundingViolations.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <strong>AI output rejected.</strong> The model cited{' '}
                {advice.narrative.groundingViolations.length} figure(s) that are not in the real
                data (
                {advice.narrative.groundingViolations.map((v) => v.cited).join(', ')}), so its
                text was discarded and the computed summary is shown instead.
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

export default function PricingPage() {
  return (
    <AccessGate>
      <PricingPageInner />
    </AccessGate>
  );
}
