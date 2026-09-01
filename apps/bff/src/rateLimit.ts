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
 * Fixed-window limiter keyed by subject.
 *
 * The gateway rate limits per authenticated identity rather than per IP: a single
 * conversation can be expensive in model tokens, so the budget has to follow the
 * user, not the network path they arrived from.
 */
export class RateLimiter {
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
