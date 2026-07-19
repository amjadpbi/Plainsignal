'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authedFetch, getBrowserSupabase } from '@/lib/supabase/browser';
import type { CoachAnswer, CoachTurn } from '@/lib/coach/coach';

type Message = CoachTurn & {
  origin?: 'model' | 'context';
  provider?: string;
  model?: string;
  violations?: { cited: string }[];
  notes?: string[];
};

const SUGGESTIONS = [
  "How's my linen apron niche doing?",
  'Which of my keywords has the best opportunity?',
  'What should I fix on my audited listing first?',
  'Am I pricing high enough to make a profit?',
];

export default function CoachPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getSession()
      .then(({ data }) => setAuthed(!!data.session));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;

    const history: CoachTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await authedFetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, history }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'The coach failed to answer.');
      } else {
        const a = data as CoachAnswer;
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: a.answer,
            origin: a.origin,
            provider: a.provider,
            model: a.model,
            violations: a.groundingViolations,
            notes: a.notes,
          },
        ]);
      }
    } catch {
      setError('Network error — is the dev server running?');
    } finally {
      setLoading(false);
    }
  }

  if (authed === null) {
    return <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-neutral-500">Loading…</main>;
  }

  if (!authed) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Log in to talk to your seller coach.
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Seller coach</h1>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Answers from <strong>your</strong> saved data — keyword scores, audits, and
            pricing. Any figure it can&apos;t trace back to your data is rejected.
          </p>
        </div>
        <Link href="/" className="shrink-0 text-sm font-medium text-brand hover:underline">
          ← Research
        </Link>
      </header>

      {messages.length === 0 && (
        <div className="mb-6 grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-left text-sm hover:border-brand hover:bg-brand/5 dark:border-neutral-800 dark:bg-neutral-900"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'user' ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[95%]">
                <div className="rounded-2xl rounded-bl-sm border border-neutral-200 bg-white px-4 py-3 text-sm leading-relaxed dark:border-neutral-800 dark:bg-neutral-900">
                  {m.content}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      m.origin === 'model'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    {m.origin === 'model' ? `${m.provider} · ${m.model}` : 'your saved figures'}
                  </span>
                </div>

                {m.violations && m.violations.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    <strong>AI answer rejected.</strong> It cited {m.violations.length} figure(s)
                    not found in your data ({m.violations.map((v) => v.cited).join(', ')}), so it
                    was discarded and your real numbers are shown instead.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="text-sm text-neutral-500">Reading your data…</div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-0 mt-6 flex gap-2 bg-neutral-50 py-4 dark:bg-neutral-950"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your keywords, listings, or pricing…"
          className="flex-1 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </main>
  );
}
