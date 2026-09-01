import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker, CircuitOpenError } from "../src/upstream/circuitBreaker.js";
import { TelecomClient, UpstreamError } from "../src/upstream/telecomClient.js";
import { createLogger } from "../src/logger.js";

const logger = createLogger("test", "dev", "silent");

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function buildClient(fetchImpl: typeof fetch, overrides: Partial<{ maxRetries: number }> = {}) {
  const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
  const client = new TelecomClient({
    baseUrl: "http://upstream.test",
    apiKey: "k",
    timeoutMs: 50,
    maxRetries: overrides.maxRetries ?? 2,
    breaker,
    logger,
    fetchImpl,
    sleep: async () => {},
  });
  return { client, breaker };
}

describe("circuit breaker", () => {
  it("opens after the failure threshold and blocks further calls", () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });
    breaker.recordFailure();
    expect(breaker.currentState).toBe("closed");
    breaker.recordFailure();
    expect(breaker.currentState).toBe("open");
    expect(() => breaker.assertClosed()).toThrow(CircuitOpenError);

    now = 1500;
    expect(breaker.currentState).toBe("half-open");
    expect(() => breaker.assertClosed()).not.toThrow();
  });

  it("reopens immediately when the probe call fails in half-open", () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100, now: () => now });
    breaker.recordFailure();
    breaker.recordFailure();
    now = 200;
    expect(breaker.currentState).toBe("half-open");
    breaker.recordFailure();
    expect(breaker.currentState).toBe("open");
  });

  it("closes again after a successful call", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 100 });
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.currentState).toBe("closed");
  });
});

describe("upstream client resilience", () => {
  it("returns the payload on the happy path", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const { client } = buildClient(fetchImpl as unknown as typeof fetch);
    await expect(client.request({ path: "/v1/plans", actingUser: "u" })).resolves.toEqual({
      ok: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 502 and succeeds on the second attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, { message: "bad gateway" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const { client } = buildClient(fetchImpl as unknown as typeof fetch);
    await expect(client.request({ path: "/v1/plans", actingUser: "u" })).resolves.toEqual({
      ok: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404 and surfaces it as a non retryable error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, { message: "customer not found" }));
    const { client } = buildClient(fetchImpl as unknown as typeof fetch);
    const error = await client
      .request({ path: "/v1/customers/x", actingUser: "u" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as UpstreamError).status).toBe(404);
    expect((error as UpstreamError).retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting the retry budget", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { message: "unavailable" }));
    const { client } = buildClient(fetchImpl as unknown as typeof fetch, { maxRetries: 1 });
    const error = await client
      .request({ path: "/v1/plans", actingUser: "u" })
      .catch((e: unknown) => e);
    expect((error as UpstreamError).status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("converts an aborted request into a 504 upstream error", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });
    const { client } = buildClient(fetchImpl as unknown as typeof fetch, { maxRetries: 0 });
    const error = await client
      .request({ path: "/v1/plans", actingUser: "u" })
      .catch((e: unknown) => e);
    expect((error as UpstreamError).status).toBe(504);
  });

  it("trips the breaker once failures accumulate", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { message: "unavailable" }));
    const { client, breaker } = buildClient(fetchImpl as unknown as typeof fetch, {
      maxRetries: 1,
    });
    await client.request({ path: "/v1/plans", actingUser: "u" }).catch(() => undefined);
    expect(breaker.currentState).toBe("open");
    await expect(client.request({ path: "/v1/plans", actingUser: "u" })).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
  });

  it("forwards the workload credential and the acting user", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const { client } = buildClient(fetchImpl as unknown as typeof fetch);
    await client.request({ path: "/v1/plans", actingUser: "user-42" });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("k");
    expect(headers["x-acting-user"]).toBe("user-42");
  });
});
