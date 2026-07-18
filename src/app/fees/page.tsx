'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';
import { calculateFees, type OffsiteAdsMode } from '@/lib/fees/calculate';
import {
  FEE_SCHEDULE_SOURCE,
  FEE_SCHEDULE_VERIFIED_ON,
  LISTING_FEE_USD,
  PAYMENT_PROCESSING_US,
  TRANSACTION_FEE_RATE,
} from '@/lib/fees/schedule';

interface SavedCalc {
  id: string;
  label: string | null;
  salePrice: number;
  netProfit: number;
  marginPct: number;
  createdAt: string;
}

function usd(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function NumberField({
  label,
  value,
  onChange,
  step = '0.01',
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-950"
      />
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export default function FeesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Core inputs
  const [itemCost, setItemCost] = useState(8);
  const [shippingCost, setShippingCost] = useState(4.5);
  const [salePrice, setSalePrice] = useState(30);
  const [shippingCharged, setShippingCharged] = useState(5);

  // Options
  const [currencyConversion, setCurrencyConversion] = useState(false);
  const [offsiteAds, setOffsiteAds] = useState<OffsiteAdsMode>('none');
  const [regulatoryPct, setRegulatoryPct] = useState(0);
  const [processingRate, setProcessingRate] = useState(PAYMENT_PROCESSING_US.rate * 100);
  const [processingFixed, setProcessingFixed] = useState(PAYMENT_PROCESSING_US.fixed);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedCalc[]>([]);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  const loadSaved = async () => {
    const res = await authedFetch('/api/fees');
    if (!res.ok) return;
    const data = await res.json();
    setSaved(data.calculations ?? []);
  };

  useEffect(() => {
    if (authed) loadSaved();
  }, [authed]);

  const result = useMemo(
    () =>
      calculateFees({
        itemCost,
        shippingCost,
        salePrice,
        shippingCharged,
        currencyConversion,
        offsiteAds,
        regulatoryFeeRate: regulatoryPct / 100,
        paymentProcessingRate: processingRate / 100,
        paymentProcessingFixed: processingFixed,
      }),
    [
      itemCost,
      shippingCost,
      salePrice,
      shippingCharged,
      currencyConversion,
      offsiteAds,
      regulatoryPct,
      processingRate,
      processingFixed,
    ],
  );

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    const res = await authedFetch('/api/fees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: label.trim() || undefined,
        itemCost,
        shippingCost,
        salePrice,
        shippingCharged,
        currencyConversion,
        offsiteAds,
        regulatoryFeeRate: regulatoryPct / 100,
        paymentProcessingRate: processingRate / 100,
        paymentProcessingFixed: processingFixed,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaveMsg('Saved.');
      setLabel('');
      loadSaved();
    } else {
      const d = await res.json().catch(() => ({}));
      setSaveMsg(d.error ?? 'Could not save.');
    }
  }

  const profitable = result.netProfit > 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fee &amp; profit calculator</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Pure math on Etsy&apos;s published fee schedule. Every fee below is itemized,
            and the lines sum exactly to the total.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm font-medium text-brand hover:underline">
          ← Research
        </Link>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* ---------------- Inputs ---------------- */}
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Item cost" value={itemCost} onChange={setItemCost} hint="What it costs you" />
            <NumberField
              label="Shipping cost"
              value={shippingCost}
              onChange={setShippingCost}
              hint="What you pay to ship"
            />
            <NumberField label="Sale price" value={salePrice} onChange={setSalePrice} hint="Buyer pays" />
            <NumberField
              label="Shipping charged"
              value={shippingCharged}
              onChange={setShippingCharged}
              hint="0 = free shipping"
            />
          </div>

          <div className="space-y-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={currencyConversion}
                onChange={(e) => setCurrencyConversion(e.target.checked)}
                className="rounded"
              />
              Currency conversion applies (2.5%)
            </label>

            <label className="block text-sm">
              <span className="mb-1 block">Offsite Ads</span>
              <select
                value={offsiteAds}
                onChange={(e) => setOffsiteAds(e.target.value as OffsiteAdsMode)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="none">Not an Offsite Ads order</option>
                <option value="standard">Attributed — 15%</option>
                <option value="reduced">Attributed — 12% ($10k+ shops)</option>
              </select>
            </label>

            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="text-xs font-medium text-brand hover:underline"
            >
              {showAdvanced ? 'Hide' : 'Show'} advanced (non-US rates, regulatory fee)
            </button>

            {showAdvanced && (
              <div className="grid grid-cols-2 gap-3 pt-2">
                <NumberField
                  label="Processing rate %"
                  value={processingRate}
                  onChange={setProcessingRate}
                  step="0.1"
                  hint="US: 3%"
                />
                <NumberField
                  label="Processing fixed"
                  value={processingFixed}
                  onChange={setProcessingFixed}
                  hint="US: $0.25"
                />
                <NumberField
                  label="Regulatory fee %"
                  value={regulatoryPct}
                  onChange={setRegulatoryPct}
                  step="0.05"
                  hint="UK/FR/IT/ES/TR: 0.25–1.1%"
                />
              </div>
            )}
          </div>

          {authed && (
            <div className="flex gap-2">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (optional)"
                className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              />
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
          {saveMsg && <p className="text-xs text-neutral-500">{saveMsg}</p>}
          {authed === false && (
            <p className="text-xs text-neutral-500">
              <Link href="/login" className="text-brand hover:underline">
                Log in
              </Link>{' '}
              to save calculations.
            </p>
          )}
        </section>

        {/* ---------------- Breakdown ---------------- */}
        <section>
          <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="mb-3 flex items-baseline justify-between border-b border-neutral-200 pb-3 dark:border-neutral-800">
              <span className="text-sm font-medium">Buyer pays</span>
              <span className="text-lg font-bold tabular-nums">{usd(result.revenue)}</span>
            </div>

            <ul className="space-y-2 text-sm">
              {result.fees.map((f) => (
                <li key={f.key} className="flex items-baseline justify-between gap-3">
                  <span>
                    {f.label}
                    <span className="ml-1 text-xs text-neutral-500">({f.basis})</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-red-600 dark:text-red-400">
                    −{usd(f.amount)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-baseline justify-between border-t border-neutral-200 pt-3 text-sm font-semibold dark:border-neutral-800">
              <span>Total Etsy fees</span>
              <span className="tabular-nums text-red-600 dark:text-red-400">
                −{usd(result.totalFees)}
              </span>
            </div>

            <ul className="mt-3 space-y-2 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
              <li className="flex justify-between">
                <span>Item cost</span>
                <span className="tabular-nums text-red-600 dark:text-red-400">−{usd(itemCost)}</span>
              </li>
              <li className="flex justify-between">
                <span>Shipping cost</span>
                <span className="tabular-nums text-red-600 dark:text-red-400">
                  −{usd(shippingCost)}
                </span>
              </li>
            </ul>

            <div
              className={`mt-4 rounded-lg p-4 ${
                profitable
                  ? 'bg-green-50 dark:bg-green-950/40'
                  : 'bg-red-50 dark:bg-red-950/40'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">Net profit</span>
                <span
                  className={`text-2xl font-bold tabular-nums ${
                    profitable
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-red-700 dark:text-red-400'
                  }`}
                >
                  {usd(result.netProfit)}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-xs text-neutral-600 dark:text-neutral-400">
                <span>Margin {result.marginPct.toFixed(1)}%</span>
                <span>Etsy takes {result.feePctOfRevenue.toFixed(1)}% of revenue</span>
              </div>
            </div>

            {result.breakevenSalePrice !== null && result.breakevenSalePrice > 0 && (
              <p className="mt-3 text-xs text-neutral-500">
                Breakeven sale price (at {usd(shippingCharged)} shipping charged):{' '}
                <strong className="tabular-nums">{usd(result.breakevenSalePrice)}</strong>
              </p>
            )}
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            Rates per Etsy&apos;s published schedule ({LISTING_FEE_USD.toFixed(2)} listing,{' '}
            {(TRANSACTION_FEE_RATE * 100).toFixed(1)}% transaction, US processing{' '}
            {(PAYMENT_PROCESSING_US.rate * 100).toFixed(0)}% + ${PAYMENT_PROCESSING_US.fixed.toFixed(2)}),
            verified {FEE_SCHEDULE_VERIFIED_ON}.{' '}
            <a
              href={FEE_SCHEDULE_SOURCE}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              Check current rates
            </a>
            . Sales tax is excluded — Etsy remits it in most jurisdictions.
          </p>
        </section>
      </div>

      {/* ---------------- Saved ---------------- */}
      {authed && saved.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Saved calculations</h2>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
                <tr>
                  <th className="px-3 py-2.5">Label</th>
                  <th className="px-3 py-2.5 text-right">Sale price</th>
                  <th className="px-3 py-2.5 text-right">Net profit</th>
                  <th className="px-3 py-2.5 text-right">Margin</th>
                  <th className="px-3 py-2.5">Saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {saved.map((c) => (
                  <tr key={c.id} className="bg-white dark:bg-neutral-950">
                    <td className="px-3 py-2.5">{c.label ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{usd(c.salePrice)}</td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums ${
                        c.netProfit > 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {usd(c.netProfit)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {c.marginPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-neutral-500">
                      {new Date(c.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
