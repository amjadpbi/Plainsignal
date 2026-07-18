/**
 * TRADEMARK RISK — data sources (verified 2026-07-19).
 *
 * What is actually available from the USPTO:
 *
 *  - TESS was RETIRED on 2023-11-30. Its replacement, Trademark Search
 *    (tmsearch.uspto.gov), has NO public API — it is a web UI only.
 *  - TSDR (Trademark Status & Document Retrieval) has an API, but it requires
 *    an API key tied to a USPTO.gov account, and it is a STATUS/DOCUMENT
 *    retrieval service: you look up a known serial or registration number.
 *    It is not a free-text "search marks by name" endpoint.
 *  - The Open Data Portal (data.uspto.gov) offers BULK data downloads of the
 *    trademark register. As of 2026-06-18 it requires signing in with a
 *    USPTO.gov account; the legacy Developer Hub was decommissioned
 *    2026-06-05.
 *
 * Conclusion: there is no official, keyless, on-demand USPTO endpoint that
 * searches trademarks by text. Going live therefore means either ingesting the
 * ODP bulk register ourselves or subscribing to a commercial search API.
 * Until then this module runs in MOCK MODE, exactly like the Etsy modules, and
 * `HttpTrademarkClient` is the seam that switches it on.
 *
 * SCOPE: we surface REAL MATCHES ONLY. No model judges infringement. A match
 * is not a legal conclusion — marks are registered per class, and descriptive
 * or nominative uses may be lawful.
 */

export type TrademarkDataSource = 'mock' | 'live';

/** Live = registered/active at the office. Dead = abandoned/cancelled/expired. */
export type MarkStatus = 'LIVE' | 'DEAD' | 'UNKNOWN';

/** A single trademark record as returned by whichever source is configured. */
export interface TrademarkRecord {
  /** The wordmark text as registered. */
  mark: string;
  status: MarkStatus;
  /** Free-text status from the source, e.g. "REGISTERED", "ABANDONED". */
  statusText: string;
  /** USPTO serial number. Mock records use a MOCK- prefix so they can never be
   *  mistaken for genuine USPTO identifiers. */
  serialNumber: string | null;
  registrationNumber: string | null;
  owner: string | null;
  /** International class numbers, when the source provides them. */
  classes: number[];
  source: TrademarkDataSource;
}

/** How a listing's text lined up with a registered mark. */
export type MatchType = 'exact' | 'contains' | 'fuzzy';

/** Match strength × mark status. NOT a legal opinion. */
export type RiskLevel = 'high' | 'medium' | 'info';

export interface TrademarkMatch {
  record: TrademarkRecord;
  matchType: MatchType;
  /** The text from the listing that matched. */
  matchedText: string;
  /** Where it matched. */
  field: 'title' | 'tag';
  riskLevel: RiskLevel;
}

export interface TrademarkCheckResult {
  source: TrademarkDataSource;
  isMock: boolean;
  /** What we checked. */
  checked: { title: string; tags: string[] };
  matches: TrademarkMatch[];
  /** Counts by risk level, for the summary UI. */
  summary: { high: number; medium: number; info: number };
  notes: string[];
}

export interface TrademarkClient {
  readonly source: TrademarkDataSource;
  /**
   * Return candidate marks relevant to the supplied terms. Implementations may
   * over-return; precise matching happens in matching.ts so the logic is
   * source-independent and unit-testable.
   */
  searchMarks(terms: string[]): Promise<TrademarkRecord[]>;
}
