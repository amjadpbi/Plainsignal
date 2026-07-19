import 'server-only';
import { prisma } from '../prisma';
import { extractFigures } from '../ai/grounding';
import type { TenantDb } from '../db/tenant';

/**
 * SELLER CONTEXT — the real data the coach is allowed to talk about
 * (CLAUDE.md §4.7: "always fed the user's real shop/keyword data").
 *
 * Everything here comes from OUR Postgres, scoped to the caller. The coach
 * gets no general knowledge to draw numbers from — if a figure is not in this
 * object, the grounding guard rejects it.
 */

export type CoachKeyword = {
  keyword: string;
  competitionCount: number;
  avgFavorites: number;
  priceMin: number | null;
  priceMed: number | null;
  priceMax: number | null;
  difficulty: number | null;
  demand: number | null;
  opportunity: number | null;
  verdict: string | null;
  capturedAt: string;
  captureCount: number;
};

export type CoachAudit = {
  listingId: string;
  score: number;
  createdAt: string;
  findingCount: number;
  topFindings: string[];
};

export type CoachFeeCalc = {
  label: string | null;
  salePrice: number;
  netProfit: number;
  marginPct: number;
  createdAt: string;
};

export type SellerContext = {
  searchCount: number;
  recentSeeds: string[];
  keywords: CoachKeyword[];
  audits: CoachAudit[];
  feeCalculations: CoachFeeCalc[];
  isEmpty: boolean;
};

/** Every numeric figure in the context, for the grounding guard's allowed set. */
export type ContextFigures = {
  currency: number[];
  percent: number[];
  counts: number[];
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Load the caller's real data. All reads go through the tenant-scoped client
 * (or an explicit userId filter), so one seller can never be shown another's
 * numbers.
 */
export async function buildSellerContext(
  db: TenantDb,
  opts: { keywordLimit?: number; auditLimit?: number } = {},
): Promise<SellerContext> {
  const keywordLimit = opts.keywordLimit ?? 12;
  const auditLimit = opts.auditLimit ?? 5;

  const [searches, tracked, audits, feeCalcs] = await Promise.all([
    db.searches.list({ take: 10 }),
    db.trends.keywords(),
    db.audits.list({ take: auditLimit }),
    db.feeCalculations.list({ take: 5 }),
  ]);

  // Latest snapshot per tracked keyword — the current state of each niche.
  const keywords: CoachKeyword[] = [];
  for (const t of tracked.slice(0, keywordLimit)) {
    const series = await db.trends.forKeyword(t.keyword);
    const latest = series[series.length - 1];
    if (!latest) continue;
    keywords.push({
      keyword: t.keyword,
      competitionCount: latest.competitionCount,
      avgFavorites: latest.avgFavorites,
      priceMin: latest.priceMin,
      priceMed: latest.priceMed,
      priceMax: latest.priceMax,
      difficulty: latest.score?.difficulty ?? null,
      demand: latest.score?.demand ?? null,
      opportunity: latest.score?.opportunity ?? null,
      verdict: latest.score?.verdict ?? null,
      capturedAt: iso(latest.capturedAt),
      captureCount: t.captureCount,
    });
  }

  // Audit findings live in JSON; pull just the messages for context.
  const auditRows: CoachAudit[] = audits.map((a) => {
    const findings =
      (a.findingsJson as { findings?: Array<{ message?: string }> } | null)?.findings ?? [];
    return {
      listingId: a.listingId,
      score: a.score,
      createdAt: iso(a.createdAt),
      findingCount: findings.length,
      topFindings: findings
        .slice(0, 3)
        .map((f) => f.message ?? '')
        .filter(Boolean),
    };
  });

  return {
    searchCount: searches.length,
    recentSeeds: [...new Set(searches.map((s) => s.seedKeyword))].slice(0, 8),
    keywords,
    audits: auditRows,
    feeCalculations: feeCalcs.map((f) => ({
      label: f.label,
      salePrice: f.salePrice,
      netProfit: f.netProfit,
      marginPct: f.marginPct,
      createdAt: iso(f.createdAt),
    })),
    isEmpty: tracked.length === 0 && audits.length === 0 && feeCalcs.length === 0,
  };
}

/**
 * Collect every number present in the context. This is the ONLY set of figures
 * the coach may cite; anything else is a fabrication.
 *
 * Derived from the SERIALIZED context — i.e. literally every number in the JSON
 * we hand the model — rather than a hand-written list of fields. Two
 * end-to-end runs proved the hand-written approach wrong: it rejected a correct
 * answer quoting "247%" from an audit finding's text, then rejected another for
 * citing listing id "1234567890". Both were real supplied data that the field
 * list happened to omit.
 *
 * Every extracted number is admitted in all three forms, because the same
 * datum is legitimately spoken in different ways: a price of 28 as "$28.00",
 * an opportunity score of 22.7 as "22.7" or "22.7%". The guarantee is
 * unchanged — a figure must appear in the data we supplied — while removing a
 * whole class of false positive.
 */
export function contextFigures(ctx: SellerContext): ContextFigures {
  const { currency, percent, counts } = extractFigures(JSON.stringify(ctx));

  // Any supplied number may be cited as currency, a percentage, or a bare
  // count. Prose figures (e.g. "$15.00" inside a finding) are already split
  // out by extractFigures, so union all three.
  const all = [...currency, ...percent, ...counts];

  return { currency: all, percent: all, counts: all };
}
