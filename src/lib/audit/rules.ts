import type { EtsyListingDetail } from '../etsy/types';

/**
 * LISTING AUDIT RULES — pure, deterministic, no AI (CLAUDE.md §4.4).
 *
 * Every rule is grounded in either:
 *   (a) a documented Etsy platform limit, or
 *   (b) real marketplace data (competitor price spread).
 * Nothing here is a language model's opinion about "good copy".
 *
 * Verified Etsy limits (2026): title 140 chars; 13 tag slots, 20 chars each.
 * Etsy's photo maximum is reported inconsistently across sources, so we only
 * flag TOO FEW photos and never assert a maximum.
 */

export const ETSY_TITLE_MAX = 140;
export const ETSY_TAG_SLOTS = 13;
export const ETSY_TAG_MAX_CHARS = 20;
/** Not a platform limit — a practical floor for conversion. */
export const RECOMMENDED_MIN_PHOTOS = 5;
export const RECOMMENDED_MIN_TITLE = 40;
export const RECOMMENDED_MIN_DESCRIPTION = 160;

export type Severity = 'critical' | 'warning' | 'info';
export type AuditCategory = 'title' | 'tags' | 'price' | 'photos' | 'description';

export type Finding = {
  id: string;
  category: AuditCategory;
  severity: Severity;
  message: string;
  recommendation: string;
  /** Points deducted from that category's budget. */
  deduction: number;
};

/** Max points each category contributes to the 100-point total. */
export const CATEGORY_WEIGHTS: Record<AuditCategory, number> = {
  title: 30,
  tags: 30,
  price: 20,
  photos: 10,
  description: 10,
};

/**
 * Real competitor context used by the price rules. A `type`, not an
 * `interface`, so it stays assignable to Prisma's InputJsonValue when the
 * audit is persisted (interfaces lack an implicit index signature).
 */
export type MarketContext = {
  competitionCount: number;
  medianPrice: number | null;
  sampleSize: number;
};

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

// ---------------------------------------------------------------- title ----

export function auditTitle(listing: EtsyListingDetail, focusKeyword: string): Finding[] {
  const out: Finding[] = [];
  const title = listing.title ?? '';
  const len = title.length;

  if (len === 0) {
    return [
      {
        id: 'title.missing',
        category: 'title',
        severity: 'critical',
        message: 'This listing has no title.',
        recommendation: 'Add a descriptive, keyword-led title up to 140 characters.',
        deduction: 30,
      },
    ];
  }

  if (len > ETSY_TITLE_MAX) {
    out.push({
      id: 'title.tooLong',
      category: 'title',
      severity: 'critical',
      message: `Title is ${len} characters — over Etsy's ${ETSY_TITLE_MAX}-character limit.`,
      recommendation: `Trim ${len - ETSY_TITLE_MAX} characters; Etsy truncates past the limit.`,
      deduction: 15,
    });
  } else if (len < RECOMMENDED_MIN_TITLE) {
    out.push({
      id: 'title.tooShort',
      category: 'title',
      severity: 'warning',
      message: `Title is only ${len} characters of the ${ETSY_TITLE_MAX} available.`,
      recommendation:
        'Add descriptive long-tail terms buyers actually search. Unused title space is wasted search surface.',
      deduction: 10,
    });
  }

  // Etsy weights the front of the title most heavily.
  if (focusKeyword && !title.slice(0, 40).toLowerCase().includes(focusKeyword.toLowerCase())) {
    out.push({
      id: 'title.keywordNotLeading',
      category: 'title',
      severity: 'warning',
      message: `Focus keyword "${focusKeyword}" does not appear in the first 40 characters.`,
      recommendation: 'Move the main keyword to the front — the opening carries the most weight.',
      deduction: 8,
    });
  }

  // Keyword stuffing: the same word repeated many times.
  const counts = new Map<string, number>();
  for (const w of words(title)) {
    if (w.length < 4) continue; // ignore short connectives
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const stuffed = [...counts.entries()].filter(([, n]) => n >= 3).map(([w]) => w);
  if (stuffed.length > 0) {
    out.push({
      id: 'title.repetition',
      category: 'title',
      severity: 'warning',
      message: `Repeated word(s) in title: ${stuffed.join(', ')}.`,
      recommendation: 'Replace repeats with distinct long-tail terms to cover more searches.',
      deduction: 7,
    });
  }

  return out;
}

// ----------------------------------------------------------------- tags ----

export function auditTags(listing: EtsyListingDetail): Finding[] {
  const out: Finding[] = [];
  const tags = listing.tags ?? [];

  const unused = ETSY_TAG_SLOTS - tags.length;
  if (unused > 0) {
    out.push({
      id: 'tags.unusedSlots',
      category: 'tags',
      severity: unused >= 5 ? 'critical' : 'warning',
      message: `Only ${tags.length} of ${ETSY_TAG_SLOTS} tag slots used — ${unused} left empty.`,
      recommendation: `Fill all ${ETSY_TAG_SLOTS} slots. Every empty tag is a search you cannot appear in.`,
      deduction: Math.min(unused * 2, 18),
    });
  }

  const overLong = tags.filter((t) => t.length > ETSY_TAG_MAX_CHARS);
  if (overLong.length > 0) {
    out.push({
      id: 'tags.tooLong',
      category: 'tags',
      severity: 'critical',
      message: `${overLong.length} tag(s) exceed Etsy's ${ETSY_TAG_MAX_CHARS}-character limit: ${overLong
        .map((t) => `"${t}"`)
        .join(', ')}.`,
      recommendation: 'Shorten these; Etsy rejects tags over the limit.',
      deduction: 6,
    });
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const t of tags) {
    const k = t.trim().toLowerCase();
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  if (dupes.size > 0) {
    out.push({
      id: 'tags.duplicates',
      category: 'tags',
      severity: 'warning',
      message: `Duplicate tag(s): ${[...dupes].join(', ')}.`,
      recommendation: 'Duplicates waste a slot — replace them with new phrases.',
      deduction: 5,
    });
  }

  const singleWord = tags.filter((t) => t.trim().split(/\s+/).length === 1);
  if (tags.length > 0 && singleWord.length >= Math.ceil(tags.length / 2)) {
    out.push({
      id: 'tags.singleWordHeavy',
      category: 'tags',
      severity: 'info',
      message: `${singleWord.length} of ${tags.length} tags are single words.`,
      recommendation:
        'Favor multi-word long-tail phrases — single words compete against the whole marketplace.',
      deduction: 4,
    });
  }

  return out;
}

// ---------------------------------------------------------------- price ----

export function auditPrice(listing: EtsyListingDetail, market: MarketContext | null): Finding[] {
  // Honest behavior: with no real competitor data we make NO judgement.
  if (!market || market.medianPrice === null || market.sampleSize === 0) {
    return [];
  }

  const median = market.medianPrice;
  const price = listing.price;
  const out: Finding[] = [];

  if (price > median * 1.5) {
    const pct = Math.round(((price - median) / median) * 100);
    out.push({
      id: 'price.aboveMarket',
      category: 'price',
      severity: 'warning',
      message: `Priced ${pct}% above the market median of $${median.toFixed(2)} (from ${market.sampleSize} competing listings).`,
      recommendation:
        'Justify the premium in your photos and description, or test a price nearer the median.',
      deduction: 10,
    });
  } else if (price < median * 0.5) {
    const pct = Math.round(((median - price) / median) * 100);
    out.push({
      id: 'price.belowMarket',
      category: 'price',
      severity: 'warning',
      message: `Priced ${pct}% below the market median of $${median.toFixed(2)} — check your margins.`,
      recommendation:
        'Underpricing erodes profit and can read as low quality. Run the fee calculator to confirm you clear a margin.',
      deduction: 8,
    });
  }

  return out;
}

// --------------------------------------------------------------- photos ----

export function auditPhotos(listing: EtsyListingDetail): Finding[] {
  const n = listing.imageCount;
  if (n === 0) {
    return [
      {
        id: 'photos.none',
        category: 'photos',
        severity: 'critical',
        message: 'This listing has no photos.',
        recommendation: 'Add photos — listings without images effectively do not convert.',
        deduction: 10,
      },
    ];
  }
  if (n < RECOMMENDED_MIN_PHOTOS) {
    return [
      {
        id: 'photos.tooFew',
        category: 'photos',
        severity: 'warning',
        message: `Only ${n} photo${n === 1 ? '' : 's'}.`,
        recommendation: `Aim for at least ${RECOMMENDED_MIN_PHOTOS}: scale, detail, in-use, and packaging shots.`,
        deduction: (RECOMMENDED_MIN_PHOTOS - n) * 2,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------- description ----

export function auditDescription(listing: EtsyListingDetail): Finding[] {
  const len = (listing.description ?? '').trim().length;
  if (len === 0) {
    return [
      {
        id: 'description.missing',
        category: 'description',
        severity: 'critical',
        message: 'This listing has no description.',
        recommendation: 'Describe materials, dimensions, and shipping to answer buyer questions.',
        deduction: 10,
      },
    ];
  }
  if (len < RECOMMENDED_MIN_DESCRIPTION) {
    return [
      {
        id: 'description.thin',
        category: 'description',
        severity: 'warning',
        message: `Description is only ${len} characters.`,
        recommendation:
          'Cover materials, size, care, and shipping — thin descriptions leave buyer questions unanswered.',
        deduction: 5,
      },
    ];
  }
  return [];
}
