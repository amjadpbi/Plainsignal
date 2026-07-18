import { env } from '../env';
import { MOCK_TRADEMARK_REGISTER } from './mock-data';
import { normalize } from './matching';
import type { MarkStatus, TrademarkClient, TrademarkRecord } from './types';

/**
 * MOCK client — matches against the offline register in mock-data.ts.
 * Active until a live trademark source is configured (see types.ts for why
 * there is no official keyless USPTO text-search endpoint).
 */
export class MockTrademarkClient implements TrademarkClient {
  readonly source = 'mock' as const;

  constructor(private readonly register: TrademarkRecord[] = MOCK_TRADEMARK_REGISTER) {}

  async searchMarks(terms: string[]): Promise<TrademarkRecord[]> {
    if (terms.every((t) => !normalize(t))) return [];

    // Return the WHOLE register and let matching.ts decide.
    //
    // Filtering candidates by exact token overlap here would silently break
    // fuzzy matching: a misspelling like "lulullemon" shares no token with
    // "lululemon", so the mark would never be retrieved and the close-spelling
    // rule could never fire. The offline register is small enough that
    // returning all of it is both correct and cheap.
    //
    // A live source backed by a full register needs real fuzzy retrieval
    // (trigram/n-gram index) to avoid the same blind spot.
    return this.register;
  }
}

type FetchFn = typeof fetch;

export interface HttpTrademarkClientOptions {
  apiUrl: string;
  apiKey: string;
  fetchFn?: FetchFn;
}

/** Shape we expect from a configured trademark search endpoint. */
interface RawMarkResponse {
  results?: Array<{
    mark?: string;
    wordmark?: string;
    status?: string;
    status_text?: string;
    serial_number?: string | number;
    registration_number?: string | number;
    owner?: string;
    classes?: number[];
  }>;
}

/**
 * LIVE client — the adapter seam.
 *
 * There is no official, keyless USPTO endpoint that searches marks by text
 * (TESS is retired; TSDR is serial-number lookup behind an API key; the Open
 * Data Portal is bulk downloads behind a USPTO.gov account). So this client is
 * deliberately source-agnostic: point TRADEMARK_API_URL at whatever register
 * you have rights to query — your own service built from the ODP bulk data, or
 * a commercial search API — and supply TRADEMARK_API_KEY.
 *
 * It normalizes whatever comes back into TrademarkRecord so the matching logic
 * (and its tests) stay source-independent.
 */
export class HttpTrademarkClient implements TrademarkClient {
  readonly source = 'live' as const;
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: HttpTrademarkClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private static toStatus(raw: string | undefined): MarkStatus {
    const s = (raw ?? '').toUpperCase();
    if (s.includes('LIVE') || s.includes('REGISTERED')) return 'LIVE';
    if (
      s.includes('DEAD') ||
      s.includes('ABANDON') ||
      s.includes('CANCEL') ||
      s.includes('EXPIRED')
    ) {
      return 'DEAD';
    }
    return 'UNKNOWN';
  }

  async searchMarks(terms: string[]): Promise<TrademarkRecord[]> {
    const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
    const out: TrademarkRecord[] = [];

    for (const term of unique) {
      const url = new URL(this.opts.apiUrl);
      url.searchParams.set('q', term);

      const res = await this.fetchFn(url.toString(), {
        headers: { 'x-api-key': this.opts.apiKey, Accept: 'application/json' },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `Trademark API ${res.status} for "${term}": ${body.slice(0, 200)}`,
        );
      }

      const raw = (await res.json()) as RawMarkResponse;
      for (const r of raw.results ?? []) {
        const markText = r.mark ?? r.wordmark;
        if (!markText) continue;
        out.push({
          mark: markText,
          status: HttpTrademarkClient.toStatus(r.status ?? r.status_text),
          statusText: r.status_text ?? r.status ?? 'UNKNOWN',
          serialNumber: r.serial_number != null ? String(r.serial_number) : null,
          registrationNumber:
            r.registration_number != null ? String(r.registration_number) : null,
          owner: r.owner ?? null,
          classes: Array.isArray(r.classes) ? r.classes : [],
          source: 'live',
        });
      }
    }

    return out;
  }
}

let cached: TrademarkClient | undefined;

/** True when a live trademark source is fully configured. */
export const TRADEMARK_LIVE_CONFIGURED =
  env.TRADEMARK_API_URL.trim().length > 0 && env.TRADEMARK_API_KEY.trim().length > 0;

export function getTrademarkClient(): TrademarkClient {
  if (cached) return cached;
  cached = TRADEMARK_LIVE_CONFIGURED
    ? new HttpTrademarkClient({
        apiUrl: env.TRADEMARK_API_URL,
        apiKey: env.TRADEMARK_API_KEY,
      })
    : new MockTrademarkClient();
  return cached;
}
