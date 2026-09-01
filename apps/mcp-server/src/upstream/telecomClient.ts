import { setTimeout as delay } from "node:timers/promises";

import type { CircuitBreaker} from "./circuitBreaker.js";
import { CircuitOpenError } from "./circuitBreaker.js";
import { CORRELATION_HEADER, SESSION_HEADER, currentContext, type Logger } from "../logger.js";

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly attempts: number,
  ) {
    super(message);
  }
}

export interface TelecomClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  breaker: CircuitBreaker;
  logger: Logger;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface RequestOptions {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  actingUser: string;
  simulateFault?: string;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export class TelecomClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: TelecomClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms: number) => delay(ms));
  }

  async request<T>(request: RequestOptions): Promise<T> {
    this.options.breaker.assertClosed();

    if (request.path.split("/").some((segment) => segment === "." || segment === "..")) {
      throw new UpstreamError("rejected a path with relative segments", 400, false, 1);
    }

    const url = new URL(request.path, this.options.baseUrl);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const maxAttempts = this.options.maxRetries + 1;
    let lastError: UpstreamError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      try {
        const response = await this.execute(url, request);
        const latencyMs = Date.now() - startedAt;

        if (response.ok) {
          this.options.breaker.recordSuccess();
          this.options.logger.info(
            {
              upstream_path: request.path,
              upstream_status: response.status,
              latency_ms: latencyMs,
              attempt,
            },
            "upstream_call_succeeded",
          );
          return (await response.json()) as T;
        }

        const retryable =
          RETRYABLE_STATUSES.has(response.status) && (request.method ?? "GET") !== "POST";
        lastError = new UpstreamError(
          await this.describe(response),
          response.status,
          retryable,
          attempt,
        );
        this.options.logger.warn(
          {
            upstream_path: request.path,
            upstream_status: response.status,
            latency_ms: latencyMs,
            attempt,
            retryable,
          },
          "upstream_call_failed",
        );

        if (!retryable) {
          this.options.breaker.recordSuccess();
          throw lastError;
        }
        this.options.breaker.recordFailure();
        if (attempt < maxAttempts) {
          await this.sleep(this.backoffMs(attempt, response.headers.get("retry-after")));
          continue;
        }
      } catch (error) {
        if (error instanceof UpstreamError) {
          if (!error.retryable) throw error;
          lastError = error;
        } else if (error instanceof CircuitOpenError) {
          throw error;
        } else {
          const isAbort = error instanceof Error && error.name === "AbortError";
          const postRetryable = (request.method ?? "GET") !== "POST";
          lastError = new UpstreamError(
            isAbort ? `upstream timed out after ${this.options.timeoutMs}ms` : String(error),
            isAbort ? 504 : 502,
            postRetryable,
            attempt,
          );
          this.options.breaker.recordFailure();
          if (!postRetryable) throw lastError;
          this.options.logger.warn(
            { upstream_path: request.path, attempt, reason: lastError.message },
            "upstream_call_errored",
          );
          if (attempt < maxAttempts) {
            await this.sleep(this.backoffMs(attempt, null));
            continue;
          }
        }
      }
    }

    throw lastError ?? new UpstreamError("upstream call failed", 502, true, maxAttempts);
  }

  private async execute(url: URL, request: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const context = currentContext();

    const headers: Record<string, string> = {
      "x-api-key": this.options.apiKey,
      "x-acting-user": request.actingUser,
      accept: "application/json",
    };
    if (context) {
      headers[CORRELATION_HEADER] = context.correlationId;
      headers[SESSION_HEADER] = context.sessionId;
    }
    if (request.simulateFault) headers["x-simulate-fault"] = request.simulateFault;
    if (request.body !== undefined) headers["content-type"] = "application/json";

    try {
      return await this.fetchImpl(url, {
        method: request.method ?? "GET",
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private backoffMs(attempt: number, retryAfterHeader: string | null): number {
    if (retryAfterHeader) {
      const seconds = Number.parseFloat(retryAfterHeader);
      if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 5000);
    }
    const base = Math.min(2 ** (attempt - 1) * 150, 2000);
    return base + Math.random() * 100;
  }

  private async describe(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { message?: string; detail?: string };
      return body.message ?? body.detail ?? `upstream responded ${response.status}`;
    } catch {
      return `upstream responded ${response.status}`;
    }
  }
}
