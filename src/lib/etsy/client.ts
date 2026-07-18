import { env, ETSY_MOCK_MODE } from '../env';
import { getKv, type KvStore } from '../kv';
import { RateLimiter } from '../rate-limit';
import { mockAutosuggest, mockSearchActiveListings } from './mock';
import type {
  AutosuggestResult,
  EtsyClient,
  EtsyListing,
  ListingSearchResult,
} from './types';

const DEFAULT_SAMPLE_LIMIT = 24;

/**
 * MOCK client — deterministic synthetic data, no network, no rate limit.
 * Active whenever ETSY_API_KEY is unset (CLAUDE.md §5, step 4).
 */
export class MockEtsyClient implements EtsyClient {
  readonly source = 'mock' as const;

  async searchActiveListings(
    query: string,
    opts?: { limit?: number },
  ): Promise<ListingSearchResult> {
    return mockSearchActiveListings(query, opts?.limit ?? DEFAULT_SAMPLE_LIMIT);
  }

  async getAutosuggestions(seed: string): Promise<AutosuggestResult> {
    return mockAutosuggest(seed);
  }
}

type FetchFn = typeof fetch;

export interface EtsyApiClientOptions {
  apiKey: string;
  apiBase: string;
  kv: KvStore;
  rateLimiter: RateLimiter;
  cacheTtlSeconds: number;
  fetchFn?: FetchFn;
}

/** Raw shape (subset) of Etsy's findAllListingsActive response. */
interface RawListingsResponse {
  count: number;
  results: Array<{
    listing_id: number;
    title: string;
    num_favorers?: number;
    views?: number;
    tags?: string[];
    price?: { amount: number; divisor: number; currency_code: string };
  }>;
}

/**
 * LIVE client — real Etsy Open API v3 calls, wrapped in:
 *   1. Redis response cache (keyed by request; TTL from env), and
 *   2. the shared RateLimiter (5 req/s, 5000/day).
 * The cache is checked before the limiter so cache hits never consume budget.
 */
export class EtsyApiClient implements EtsyClient {
  readonly source = 'live' as const;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: EtsyApiClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private async cached<T>(cacheKey: string, produce: () => Promise<T>): Promise<T> {
    const hit = await this.opts.kv.get(cacheKey);
    if (hit !== null) {
      return JSON.parse(hit) as T;
    }
    const value = await produce();
    await this.opts.kv.set(cacheKey, JSON.stringify(value), this.opts.cacheTtlSeconds);
    return value;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    // Cache hits are handled by the caller; reaching here means we spend budget.
    await this.opts.rateLimiter.acquire();

    const url = new URL(`${this.opts.apiBase}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await this.fetchFn(url.toString(), {
      headers: { 'x-api-key': this.opts.apiKey, Accept: 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Etsy API ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private static normalizePrice(
    price?: { amount: number; divisor: number; currency_code: string },
  ): { price: number; currencyCode: string } {
    if (!price || !price.divisor) return { price: 0, currencyCode: 'USD' };
    return {
      price: price.amount / price.divisor,
      currencyCode: price.currency_code ?? 'USD',
    };
  }

  async searchActiveListings(
    query: string,
    opts?: { limit?: number },
  ): Promise<ListingSearchResult> {
    const limit = opts?.limit ?? DEFAULT_SAMPLE_LIMIT;
    const cacheKey = `etsy:cache:search:${query.trim().toLowerCase()}:${limit}`;

    return this.cached(cacheKey, async () => {
      const raw = await this.request<RawListingsResponse>('/listings/active', {
        keywords: query,
        limit: String(limit),
      });

      const listings: EtsyListing[] = (raw.results ?? []).map((r) => {
        const { price, currencyCode } = EtsyApiClient.normalizePrice(r.price);
        return {
          listingId: String(r.listing_id),
          title: r.title,
          price,
          currencyCode,
          numFavorers: r.num_favorers ?? 0,
          views: r.views ?? 0,
          tags: r.tags ?? [],
        };
      });

      return {
        query: query.trim(),
        count: raw.count ?? 0,
        listings,
        source: this.source,
      } satisfies ListingSearchResult;
    });
  }

  /**
   * Live long-tail keywords. Etsy Open API v3 has no supported autosuggest
   * endpoint, so we derive suggestions from the REAL tags of active listings
   * for the seed — genuine marketplace phrases, ranked by frequency. This keeps
   * the honest-data constraint (CLAUDE.md §1): every suggestion is a tag a real
   * seller actually used.
   */
  async getAutosuggestions(seed: string): Promise<AutosuggestResult> {
    const cacheKey = `etsy:cache:suggest:${seed.trim().toLowerCase()}`;

    return this.cached(cacheKey, async () => {
      const search = await this.searchActiveListings(seed, { limit: 50 });

      const freq = new Map<string, number>();
      for (const listing of search.listings) {
        for (const tag of listing.tags) {
          const t = tag.trim().toLowerCase();
          if (!t) continue;
          freq.set(t, (freq.get(t) ?? 0) + 1);
        }
      }

      const suggestions = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
        .filter((tag) => tag !== seed.trim().toLowerCase())
        .slice(0, 20);

      return {
        seed: seed.trim(),
        suggestions,
        source: this.source,
      } satisfies AutosuggestResult;
    });
  }
}

let cachedClient: EtsyClient | undefined;

/**
 * Process-wide Etsy client. Returns the mock client until ETSY_API_KEY is set,
 * then the live client wired to the shared KV store and rate limiter.
 */
export function getEtsyClient(): EtsyClient {
  if (cachedClient) return cachedClient;

  if (ETSY_MOCK_MODE) {
    cachedClient = new MockEtsyClient();
    return cachedClient;
  }

  const kv = getKv();
  const rateLimiter = new RateLimiter({
    perSecond: env.ETSY_RATE_PER_SECOND,
    perDay: env.ETSY_RATE_PER_DAY,
    kv,
  });

  cachedClient = new EtsyApiClient({
    apiKey: env.ETSY_API_KEY,
    apiBase: env.ETSY_API_BASE,
    kv,
    rateLimiter,
    cacheTtlSeconds: env.ETSY_CACHE_TTL_SECONDS,
  });
  return cachedClient;
}
