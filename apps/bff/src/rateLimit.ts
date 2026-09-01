export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  now?: () => number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * A limiter the gateway can await. The in-memory implementation resolves
 * synchronously; the Redis one resolves over the network. `await` handles both, so
 * the call site does not care which is wired.
 */
export interface RateLimiterLike {
  check(key: string): RateLimitVerdict | Promise<RateLimitVerdict>;
}

/**
 * Fixed-window limiter keyed by subject.
 *
 * The gateway rate limits per authenticated identity rather than per IP: a single
 * conversation can be expensive in model tokens, so the budget has to follow the
 * user, not the network path they arrived from. This in-process implementation is
 * the fallback when no Redis is configured; with more than one replica the shared
 * budget requires the Redis limiter instead.
 */
export class RateLimiter implements RateLimiterLike {
  private windows = new Map<string, { count: number; startedAt: number }>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  check(key: string): RateLimitVerdict {
    const timestamp = this.now();
    const window = this.windows.get(key);

    if (!window || timestamp - window.startedAt >= this.options.windowMs) {
      this.windows.set(key, { count: 1, startedAt: timestamp });
      return {
        allowed: true,
        remaining: this.options.maxRequests - 1,
        retryAfterMs: 0,
      };
    }

    window.count += 1;
    const remaining = this.options.maxRequests - window.count;
    if (remaining < 0) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: this.options.windowMs - (timestamp - window.startedAt),
      };
    }
    return { allowed: true, remaining, retryAfterMs: 0 };
  }

  reset(): void {
    this.windows.clear();
  }
}

/**
 * The minimal slice of a Redis client this limiter needs. Kept as an interface so a
 * fake can drive it in tests without a live server.
 */
export interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
}

/**
 * Fixed-window limiter backed by Redis, so the budget is shared across every replica
 * of the gateway. The window is a single INCR with a PEXPIRE set on the first hit;
 * the key's remaining TTL is the retry-after. Fail-open: if Redis is unreachable the
 * request is allowed rather than the gateway going dark, and the failure is the
 * caller's to log.
 */
export class RedisRateLimiter implements RateLimiterLike {
  constructor(
    private readonly redis: RedisLike,
    private readonly options: { windowMs: number; maxRequests: number; prefix?: string },
  ) {}

  async check(key: string): Promise<RateLimitVerdict> {
    const redisKey = `${this.options.prefix ?? "rl"}:${key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.pexpire(redisKey, this.options.windowMs);
    }
    if (count > this.options.maxRequests) {
      const ttl = await this.redis.pttl(redisKey);
      return { allowed: false, remaining: 0, retryAfterMs: ttl > 0 ? ttl : this.options.windowMs };
    }
    return { allowed: true, remaining: this.options.maxRequests - count, retryAfterMs: 0 };
  }
}
