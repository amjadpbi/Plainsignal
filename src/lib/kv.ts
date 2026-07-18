import Redis from 'ioredis';
import { env } from './env';

/**
 * Minimal key/value store used for the Etsy response cache and rate-limit
 * counters. Backed by Redis in real deployments; falls back to an in-process
 * store so the app (and tests) run with no Redis available.
 *
 * Only the handful of operations the Etsy layer needs are exposed.
 */
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Increment a counter and (on first write) set its TTL. Returns new value. */
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
  /** Seconds remaining on a key's TTL, or null if no TTL / missing. */
  ttl(key: string): Promise<number | null>;
}

/** In-process store with lazy TTL expiry. Not shared across processes. */
export class MemoryKvStore implements KvStore {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) {
      this.store.set(key, { value: '1', expiresAt: Date.now() + ttlSeconds * 1000 });
      return 1;
    }
    const next = Number(entry.value) + 1;
    entry.value = String(next);
    return next;
  }

  async ttl(key: string): Promise<number | null> {
    const entry = this.live(key);
    if (!entry || entry.expiresAt === null) return null;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }
}

/** Redis-backed store. Shared across processes/instances. */
export class RedisKvStore implements KvStore {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const next = await this.redis.incr(key);
    if (next === 1) {
      await this.redis.expire(key, ttlSeconds);
    }
    return next;
  }

  async ttl(key: string): Promise<number | null> {
    const t = await this.redis.ttl(key);
    // ioredis returns -2 (missing) or -1 (no expiry).
    return t < 0 ? null : t;
  }
}

let cached: KvStore | undefined;

/**
 * Returns the process-wide KvStore. Uses Redis when REDIS_URL is set and the
 * connection can be established; otherwise logs once and uses in-memory.
 */
export function getKv(): KvStore {
  if (cached) return cached;

  if (env.REDIS_URL) {
    try {
      const redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
        // Don't crash the process on a transient Redis outage.
        enableOfflineQueue: true,
      });
      redis.on('error', (err) => {
        // Avoid noisy repeated logs; ioredis retries connections itself.
        if ((redis as unknown as { _loggedError?: boolean })._loggedError) return;
        (redis as unknown as { _loggedError?: boolean })._loggedError = true;
        console.warn('⚠️  Redis error (falling back to degraded behavior):', err.message);
      });
      cached = new RedisKvStore(redis);
      return cached;
    } catch (err) {
      console.warn('⚠️  Could not init Redis, using in-memory KV:', (err as Error).message);
    }
  } else {
    console.warn('⚠️  REDIS_URL not set — using in-memory KV (single-process only).');
  }

  cached = new MemoryKvStore();
  return cached;
}
