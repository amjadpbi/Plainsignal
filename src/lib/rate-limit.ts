import type { KvStore } from './kv';

/**
 * Fixed-window rate limiter enforcing Etsy's documented ceilings
 * (CLAUDE.md §5, step 3): 5 requests/second and 5000 requests/day.
 *
 * Counters live in the shared KvStore so the limit holds across app instances.
 * Per-second bursts are smoothed by blocking until the next 1-second window;
 * daily exhaustion is terminal and throws.
 *
 * `now`/`sleep` are injectable so the limiter is deterministically testable.
 */
export class RateLimitError extends Error {
  constructor(
    public readonly kind: 'second' | 'day',
    message: string,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export interface RateLimiterOptions {
  perSecond: number;
  perDay: number;
  kv: KvStore;
  keyPrefix?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Max blocking attempts to secure a per-second slot before giving up. */
  maxSecondAttempts?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  private readonly perSecond: number;
  private readonly perDay: number;
  private readonly kv: KvStore;
  private readonly prefix: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxSecondAttempts: number;

  constructor(opts: RateLimiterOptions) {
    this.perSecond = opts.perSecond;
    this.perDay = opts.perDay;
    this.kv = opts.kv;
    this.prefix = opts.keyPrefix ?? 'etsy:rl';
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.maxSecondAttempts = opts.maxSecondAttempts ?? 10;
  }

  private secondKey(nowMs: number): string {
    return `${this.prefix}:sec:${Math.floor(nowMs / 1000)}`;
  }

  private dayKey(nowMs: number): string {
    // UTC day bucket — stable regardless of server tz.
    const iso = new Date(nowMs).toISOString().slice(0, 10);
    return `${this.prefix}:day:${iso}`;
  }

  private secondsUntilEndOfUtcDay(nowMs: number): number {
    const d = new Date(nowMs);
    const endOfDay = Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    );
    return Math.max(1, Math.ceil((endOfDay - nowMs) / 1000));
  }

  /** Consume the day budget once. Throws RateLimitError('day') when exhausted. */
  private async consumeDay(): Promise<void> {
    const nowMs = this.now();
    const key = this.dayKey(nowMs);
    const count = await this.kv.incrWithTtl(key, this.secondsUntilEndOfUtcDay(nowMs));
    if (count > this.perDay) {
      throw new RateLimitError(
        'day',
        `Etsy daily request limit reached (${this.perDay}/day). Resets at UTC midnight.`,
      );
    }
  }

  /** Try to claim one per-second slot in the current window (non-blocking). */
  private async tryReserveSecond(): Promise<boolean> {
    const nowMs = this.now();
    const count = await this.kv.incrWithTtl(this.secondKey(nowMs), 2);
    return count <= this.perSecond;
  }

  /**
   * Acquire permission to make one Etsy request. Blocks (up to
   * maxSecondAttempts windows) to respect the per-second ceiling; throws
   * immediately if the daily budget is spent.
   */
  async acquire(): Promise<void> {
    await this.consumeDay();

    for (let attempt = 0; attempt < this.maxSecondAttempts; attempt++) {
      if (await this.tryReserveSecond()) return;
      // Wait until the start of the next 1-second window, then retry.
      const nowMs = this.now();
      const msToNextWindow = 1000 - (nowMs % 1000);
      await this.sleep(msToNextWindow);
    }

    throw new RateLimitError(
      'second',
      `Could not secure a per-second slot within ${this.maxSecondAttempts} windows.`,
    );
  }
}
