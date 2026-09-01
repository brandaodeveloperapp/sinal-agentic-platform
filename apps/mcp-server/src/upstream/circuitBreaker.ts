export type BreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => number;
}

export class CircuitOpenError extends Error {
  readonly status = 503;
  constructor(readonly retryAfterMs: number) {
    super(`upstream circuit is open, retry in ${retryAfterMs}ms`);
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: BreakerState = "closed";
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  get currentState(): BreakerState {
    this.refresh();
    return this.state;
  }

  private refresh(): void {
    if (this.state === "open" && this.now() - this.openedAt >= this.options.cooldownMs) {
      this.state = "half-open";
    }
  }

  assertClosed(): void {
    this.refresh();
    if (this.state === "open") {
      throw new CircuitOpenError(this.options.cooldownMs - (this.now() - this.openedAt));
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.refresh();
    if (this.state === "half-open") {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = "open";
    this.openedAt = this.now();
    this.failures = 0;
  }
}
