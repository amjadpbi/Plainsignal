import { getEtsyClient } from '../etsy/client';
import type { DataSource, EtsyClient, EtsyListingDetail } from '../etsy/types';
import {
  auditDescription,
  auditPhotos,
  auditPrice,
  auditTags,
  auditTitle,
  CATEGORY_WEIGHTS,
  type AuditCategory,
  type Finding,
  type MarketContext,
} from './rules';

/** A `type` (not an interface) so it remains JSON-serializable for Prisma. */
export type CategoryScore = {
  category: AuditCategory;
  score: number;
  max: number;
};

export interface AuditResult {
  listingId: string;
  source: DataSource;
  isMock: boolean;
  listing: {
    title: string;
    tagCount: number;
    tags: string[];
    price: number;
    currencyCode: string;
    imageCount: number;
    descriptionLength: number;
  };
  /** Keyword the listing was judged against (drives title + price rules). */
  focusKeyword: string;
  market: MarketContext | null;
  /** Overall 0–100. */
  score: number;
  categoryScores: CategoryScore[];
  findings: Finding[];
  notes: string[];
}

/**
 * Pick the keyword this listing is really competing for. Prefers the first
 * tag (the seller's own stated target); falls back to the leading words of the
 * title. Deliberately simple and inspectable — no model guessing intent.
 */
export function deriveFocusKeyword(listing: EtsyListingDetail): string {
  const firstTag = listing.tags?.find((t) => t.trim().length > 0);
  if (firstTag) return firstTag.trim();
  const titleWords = (listing.title ?? '').trim().split(/\s+/).filter(Boolean);
  return titleWords.slice(0, 3).join(' ');
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Roll findings up into per-category and overall scores. */
export function scoreFindings(findings: Finding[]): {
  score: number;
  categoryScores: CategoryScore[];
} {
  const categories = Object.keys(CATEGORY_WEIGHTS) as AuditCategory[];

  const categoryScores = categories.map((category) => {
    const max = CATEGORY_WEIGHTS[category];
    const deducted = findings
      .filter((f) => f.category === category)
      .reduce((sum, f) => sum + f.deduction, 0);
    return { category, score: Math.max(0, max - deducted), max };
  });

  const score = categoryScores.reduce((sum, c) => sum + c.score, 0);
  return { score: Math.round(score), categoryScores };
}

export interface AuditOptions {
  client?: EtsyClient;
}

/**
 * Audit one listing (CLAUDE.md §4.4): pull the real listing, compare its
 * title/tags/price against Etsy's documented limits and REAL competitor data,
 * and return itemized findings with a score.
 *
 * Runs against the mock client until an Etsy key is active — same pattern as
 * the keyword module, so it goes live the moment the key is approved.
 */
export async function auditListing(
  listingId: string,
  opts: AuditOptions = {},
): Promise<AuditResult> {
  const client = opts.client ?? getEtsyClient();
  const id = listingId.trim();
  if (!id) throw new Error('Listing ID must not be empty.');

  const listing = await client.getListing(id);
  const focusKeyword = deriveFocusKeyword(listing);

  // Real competitor context for the price rules. If this lookup fails we audit
  // everything else rather than failing the whole run — but we say so.
  let market: MarketContext | null = null;
  const notes: string[] = [];
  if (focusKeyword) {
    try {
      const search = await client.searchActiveListings(focusKeyword);
      const prices = search.listings
        .map((l) => l.price)
        .filter((p) => p > 0)
        .sort((a, b) => a - b);
      market = {
        competitionCount: search.count,
        medianPrice: median(prices),
        sampleSize: prices.length,
      };
    } catch {
      notes.push(
        `Could not load competitor data for "${focusKeyword}" — price was not scored against the market.`,
      );
    }
  }

  const findings: Finding[] = [
    ...auditTitle(listing, focusKeyword),
    ...auditTags(listing),
    ...auditPrice(listing, market),
    ...auditPhotos(listing),
    ...auditDescription(listing),
  ];

  // Most severe first, then by size of deduction.
  const order = { critical: 0, warning: 1, info: 2 } as const;
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || b.deduction - a.deduction,
  );

  const { score, categoryScores } = scoreFindings(findings);
  const isMock = listing.source === 'mock';

  if (isMock) {
    notes.unshift(
      'MOCK MODE: this listing is deterministic synthetic data. Set an approved ETSY_API_KEY to audit real listings.',
    );
  }
  if (!market) {
    notes.push('Price was not scored — no competitor data available for this keyword.');
  }

  return {
    listingId: listing.listingId,
    source: listing.source,
    isMock,
    listing: {
      title: listing.title,
      tagCount: listing.tags.length,
      tags: listing.tags,
      price: listing.price,
      currencyCode: listing.currencyCode,
      imageCount: listing.imageCount,
      descriptionLength: (listing.description ?? '').length,
    },
    focusKeyword,
    market,
    score,
    categoryScores,
    findings,
    notes,
  };
}
