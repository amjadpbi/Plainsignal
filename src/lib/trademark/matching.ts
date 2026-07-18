import type {
  MatchType,
  RiskLevel,
  TrademarkMatch,
  TrademarkRecord,
} from './types';

/**
 * Trademark matching — pure, deterministic, no AI (CLAUDE.md §4.6:
 * "real check ... not an LLM opinion").
 *
 * We report only that a listing's text matches a registered mark, how it
 * matched, and that mark's real status. We never assert infringement.
 */

/** Marks shorter than this are skipped — they generate noise, not signal. */
export const MIN_MARK_LENGTH = 3;

/**
 * Normalize text for comparison: lowercase, strip accents, drop punctuation,
 * collapse whitespace. "Lululemon®" and "lululemon" must compare equal.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Split normalized text into word tokens. */
export function tokenize(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** All contiguous word windows of length 1..maxN. */
export function ngrams(text: string, maxN = 3): string[] {
  const tokens = tokenize(text);
  const out: string[] = [];
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      out.push(tokens.slice(i, i + n).join(' '));
    }
  }
  return out;
}

/** Levenshtein edit distance (iterative, two-row). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Edit-distance budget for a "close" match, scaled to mark length.
 * Short marks get zero tolerance — at 4 characters, one edit is a different
 * word ("nike" vs "bike"), which would be a false positive.
 */
export function fuzzyThreshold(markLength: number): number {
  if (markLength <= 4) return 0;
  if (markLength <= 8) return 1;
  return 2;
}

/** Does `phrase` appear in `haystack` on whole-word boundaries? */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const h = normalize(haystack);
  const p = normalize(phrase);
  if (!p) return false;
  const hTokens = h.split(' ');
  const pTokens = p.split(' ');
  for (let i = 0; i + pTokens.length <= hTokens.length; i++) {
    if (hTokens.slice(i, i + pTokens.length).join(' ') === p) return true;
  }
  return false;
}

/**
 * Risk is match strength combined with the mark's real status. A dead mark is
 * reported for transparency but is not a live registration, so it is info-only.
 */
export function riskFor(matchType: MatchType, record: TrademarkRecord): RiskLevel {
  if (record.status !== 'LIVE') return 'info';
  return matchType === 'fuzzy' ? 'medium' : 'high';
}

/** Rank for sorting: highest risk, strongest match first. */
const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, info: 2 };
const MATCH_ORDER: Record<MatchType, number> = { exact: 0, contains: 1, fuzzy: 2 };

/**
 * Compare one field's text against a set of marks.
 * Returns at most one match per mark — the strongest one found.
 */
export function matchFieldAgainstMarks(
  fieldText: string,
  field: 'title' | 'tag',
  marks: TrademarkRecord[],
): TrademarkMatch[] {
  const normalizedField = normalize(fieldText);
  if (!normalizedField) return [];

  const candidates = ngrams(fieldText, 3);
  const out: TrademarkMatch[] = [];

  for (const record of marks) {
    const markNorm = normalize(record.mark);
    if (markNorm.length < MIN_MARK_LENGTH) continue;

    let best: { type: MatchType; text: string } | null = null;

    // 1. Exact — the whole field is the mark.
    if (normalizedField === markNorm) {
      best = { type: 'exact', text: fieldText.trim() };
    }

    // 2. Contains — the mark appears as a whole-word phrase.
    if (!best && containsPhrase(fieldText, record.mark)) {
      best = { type: 'contains', text: record.mark };
    }

    // 3. Fuzzy — a same-length-in-words candidate within the edit budget.
    if (!best) {
      const markWordCount = markNorm.split(' ').length;
      const budget = fuzzyThreshold(markNorm.length);
      if (budget > 0) {
        for (const cand of candidates) {
          if (cand.split(' ').length !== markWordCount) continue;
          // Cheap length prefilter before the O(n*m) distance.
          if (Math.abs(cand.length - markNorm.length) > budget) continue;
          if (levenshtein(cand, markNorm) <= budget) {
            best = { type: 'fuzzy', text: cand };
            break;
          }
        }
      }
    }

    if (best) {
      out.push({
        record,
        matchType: best.type,
        matchedText: best.text,
        field,
        riskLevel: riskFor(best.type, record),
      });
    }
  }

  return out;
}

/**
 * Check a listing's title and tags against a set of marks.
 * De-duplicates so each mark is reported once, at its strongest match.
 */
export function findTrademarkMatches(
  input: { title: string; tags: string[] },
  marks: TrademarkRecord[],
): TrademarkMatch[] {
  const all: TrademarkMatch[] = [
    ...matchFieldAgainstMarks(input.title ?? '', 'title', marks),
    ...(input.tags ?? []).flatMap((tag) => matchFieldAgainstMarks(tag, 'tag', marks)),
  ];

  // Keep the strongest match per mark.
  const bestByMark = new Map<string, TrademarkMatch>();
  for (const m of all) {
    const key = `${normalize(m.record.mark)}|${m.record.serialNumber ?? ''}`;
    const existing = bestByMark.get(key);
    if (!existing || MATCH_ORDER[m.matchType] < MATCH_ORDER[existing.matchType]) {
      bestByMark.set(key, m);
    }
  }

  return [...bestByMark.values()].sort(
    (a, b) =>
      RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel] ||
      MATCH_ORDER[a.matchType] - MATCH_ORDER[b.matchType] ||
      a.record.mark.localeCompare(b.record.mark),
  );
}
