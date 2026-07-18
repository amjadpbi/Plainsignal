import { describe, expect, it, vi } from 'vitest';
import { EtsyApiClient, EtsyApiError, MockEtsyClient } from '@/lib/etsy/client';
import { MemoryKvStore } from '@/lib/kv';
import { RateLimiter } from '@/lib/rate-limit';

describe('MockEtsyClient', () => {
  const client = new MockEtsyClient();

  it('is deterministic per keyword', async () => {
    const a = await client.searchActiveListings('linen apron');
    const b = await client.searchActiveListings('linen apron');
    expect(a).toEqual(b);
    expect(a.source).toBe('mock');
    expect(a.count).toBeGreaterThan(0);
    expect(a.listings.length).toBeGreaterThan(0);
  });

  it('varies across keywords', async () => {
    const a = await client.searchActiveListings('linen apron');
    const b = await client.searchActiveListings('ceramic mug');
    expect(a.count).not.toBe(b.count);
  });

  it('produces long-tail autosuggestions from the seed', async () => {
    const s = await client.getAutosuggestions('linen apron');
    expect(s.suggestions.length).toBeGreaterThan(3);
    expect(s.suggestions.every((x) => x.includes('linen apron'))).toBe(true);
    expect(s.source).toBe('mock');
  });
});

function fakeResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeLiveClient(fetchFn: typeof fetch) {
  const kv = new MemoryKvStore();
  return new EtsyApiClient({
    apiKey: 'test-key',
    apiBase: 'https://openapi.etsy.com/v3/application',
    kv,
    rateLimiter: new RateLimiter({
      perSecond: 1000,
      perDay: 1_000_000,
      kv,
      now: () => 1_000,
    }),
    cacheTtlSeconds: 3600,
    fetchFn,
  });
}

describe('EtsyApiClient (live path with injected fetch)', () => {
  const rawSearch = {
    count: 4213,
    results: [
      {
        listing_id: 111,
        title: 'Linen apron A',
        num_favorers: 120,
        views: 900,
        tags: ['linen apron', 'kitchen gift'],
        price: { amount: 1999, divisor: 100, currency_code: 'USD' },
      },
      {
        listing_id: 222,
        title: 'Linen apron B',
        num_favorers: 40,
        views: 300,
        tags: ['linen apron', 'cooking'],
        price: { amount: 3450, divisor: 100, currency_code: 'USD' },
      },
    ],
  };

  it('maps the Etsy response and normalizes price', async () => {
    const fetchFn = vi.fn(async () => fakeResponse(rawSearch)) as unknown as typeof fetch;
    const client = makeLiveClient(fetchFn);

    const res = await client.searchActiveListings('linen apron');
    expect(res.source).toBe('live');
    expect(res.count).toBe(4213);
    expect(res.listings).toHaveLength(2);
    expect(res.listings[0]).toMatchObject({
      listingId: '111',
      price: 19.99,
      currencyCode: 'USD',
      numFavorers: 120,
    });
  });

  it('serves identical requests from cache without a second fetch', async () => {
    const fetchFn = vi.fn(async () => fakeResponse(rawSearch)) as unknown as typeof fetch;
    const client = makeLiveClient(fetchFn);

    await client.searchActiveListings('linen apron');
    await client.searchActiveListings('linen apron');

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('sends the API key header and keywords param', async () => {
    const fetchFn = vi.fn(async () => fakeResponse(rawSearch)) as unknown as typeof fetch;
    const client = makeLiveClient(fetchFn);

    await client.searchActiveListings('linen apron');

    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('keywords=linen+apron');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'test-key' });
  });

  it('raises a typed auth error on 403 — never falls back to mock data', async () => {
    // The exact response Etsy returns for a key still pending approval.
    const fetchFn = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () =>
        '{"error":"API key not found or not active, or incorrect shared secret for API key."}',
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const client = makeLiveClient(fetchFn);

    const err = await client.searchActiveListings('linen apron').catch((e) => e);

    expect(err).toBeInstanceOf(EtsyApiError);
    expect(err.status).toBe(403);
    expect(err.isAuthError).toBe(true);
    // Etsy's own message is preserved, not swallowed.
    expect(err.etsyMessage).toBe(
      'API key not found or not active, or incorrect shared secret for API key.',
    );
  });

  it('treats 401 as an auth error and 500 as a non-auth upstream error', async () => {
    const make = (status: number) =>
      makeLiveClient(
        vi.fn(async () => ({
          ok: false,
          status,
          statusText: 'x',
          text: async () => '{"error":"boom"}',
          json: async () => ({}),
        })) as unknown as typeof fetch,
      );

    const e401 = await make(401).searchActiveListings('a').catch((e) => e);
    expect(e401.isAuthError).toBe(true);

    const e500 = await make(500).searchActiveListings('b').catch((e) => e);
    expect(e500).toBeInstanceOf(EtsyApiError);
    expect(e500.isAuthError).toBe(false);
  });

  it('keeps a non-JSON error body as raw text', async () => {
    const client = makeLiveClient(
      vi.fn(async () => ({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => '<html>upstream down</html>',
        json: async () => ({}),
      })) as unknown as typeof fetch,
    );
    const err = await client.searchActiveListings('a').catch((e) => e);
    expect(err.etsyMessage).toContain('upstream down');
  });

  it('derives live autosuggestions from real listing tags, ranked by frequency', async () => {
    const fetchFn = vi.fn(async () => fakeResponse(rawSearch)) as unknown as typeof fetch;
    const client = makeLiveClient(fetchFn);

    const s = await client.getAutosuggestions('linen apron');
    // 'linen apron' is filtered out (equals seed); remaining real tags surface.
    expect(s.suggestions).toContain('kitchen gift');
    expect(s.suggestions).toContain('cooking');
    expect(s.suggestions).not.toContain('linen apron');
    expect(s.source).toBe('live');
  });
});
