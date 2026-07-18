import { describe, expect, it, vi } from 'vitest';
import { MemoryKvStore } from '@/lib/kv';
import { RateLimiter, RateLimitError } from '@/lib/rate-limit';

describe('RateLimiter — daily budget', () => {
  it('allows up to perDay requests then throws a day error', async () => {
    const limiter = new RateLimiter({
      perSecond: 100,
      perDay: 3,
      kv: new MemoryKvStore(),
      now: () => 1_000, // fixed time → same day + second window
    });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    await expect(limiter.acquire()).rejects.toMatchObject({
      name: 'RateLimitError',
      kind: 'day',
    });
  });
});

describe('RateLimiter — per-second window', () => {
  it('blocks until the next window when the second budget is spent', async () => {
    const clock = { t: 1_000 };
    const sleep = vi.fn(async (ms: number) => {
      clock.t += ms; // advance into the next 1s window
    });

    const limiter = new RateLimiter({
      perSecond: 2,
      perDay: 1_000,
      kv: new MemoryKvStore(),
      now: () => clock.t,
      sleep,
    });

    await limiter.acquire(); // window 1: count 1
    await limiter.acquire(); // window 1: count 2
    await limiter.acquire(); // window 1 full → sleeps → window 2: count 1

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it('gives up with a second error after maxSecondAttempts', async () => {
    const limiter = new RateLimiter({
      perSecond: 1,
      perDay: 1_000,
      kv: new MemoryKvStore(),
      now: () => 5_000, // clock never advances (sleep is a no-op)
      sleep: async () => {},
      maxSecondAttempts: 2,
    });

    await limiter.acquire(); // ok: count 1
    await expect(limiter.acquire()).rejects.toBeInstanceOf(RateLimitError);
  });
});
