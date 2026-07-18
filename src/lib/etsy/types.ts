/** Where a piece of Etsy data came from — surfaced to the UI for honesty. */
export type DataSource = 'mock' | 'live';

/** A single active Etsy listing (only the fields the analytics layer uses). */
export interface EtsyListing {
  listingId: string;
  title: string;
  price: number;
  currencyCode: string;
  numFavorers: number;
  views: number;
  tags: string[];
}

/**
 * Result of an active-listing search for a query.
 * `count` is the REAL total number of active listings Etsy reports for the
 * query — this is the competition signal (CLAUDE.md §1). `listings` is a bounded
 * sample used to derive favorites/price aggregates.
 */
export interface ListingSearchResult {
  query: string;
  count: number;
  listings: EtsyListing[];
  source: DataSource;
}

export interface AutosuggestResult {
  seed: string;
  suggestions: string[];
  source: DataSource;
}

export interface EtsyClient {
  readonly source: DataSource;
  searchActiveListings(query: string, opts?: { limit?: number }): Promise<ListingSearchResult>;
  getAutosuggestions(seed: string): Promise<AutosuggestResult>;
}
