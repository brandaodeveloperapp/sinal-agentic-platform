import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { Directory } from "../src/auth/directory.js";
import { TokenService } from "../src/auth/tokens.js";
import { loadConfig, type Config } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { AgentStreamer } from "../src/proxy/agentStream.js";
import { RateLimiter } from "../src/rateLimit.js";

const logger = createLogger("test", "dev", "silent");

const config: Config = loadConfig({
  ENVIRONMENT: "dev",
  LOG_LEVEL: "silent",
  SESSION_SECRET: "gateway-session-secret-value",
  DOWNSTREAM_SECRET: "gateway-downstream-secret-value",
  DEMO_PASSWORD: "demo1234",
  RATE_LIMIT_MAX_REQUESTS: "3",
} as unknown as NodeJS.ProcessEnv);

interface AgentCall {
  authorization: string;
  correlationId: string;
  body: { message: string; session_id: string; subject: string };
}

let server: Server;
let baseUrl: string;
let agentCalls: AgentCall[];
let limiter: RateLimiter;

function sseResponse(frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function buildApp(fetchImpl: typeof fetch) {
  limiter = new RateLimiter({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
  });
  return createApp({
    config,
    logger,
    directory: new Directory(config.DEMO_PASSWORD),
    tokens: new TokenService(config),
    streamer: new AgentStreamer({ config, logger, fetchImpl }),
    limiter,
    loginLimiter: new RateLimiter({ windowMs: 60000, maxRequests: 5 }),
  });
}

const defaultAgent = (async (_url: string | URL | Request, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  agentCalls.push({
    authorization: headers.authorization ?? "",
    correlationId: headers["x-correlation-id"] ?? "",
    body: JSON.parse(String(init?.body ?? "{}")),
  });
  return sseResponse([
    'event: ready\ndata: {"tools":["list_invoices"]}\n\n',
    'event: token\ndata: {"text":"3 invoices, 1 overdue."}\n\n',
    'event: done\ndata: {"stop_reason":"end_turn"}\n\n',
  ]);
}) as unknown as typeof fetch;

beforeEach(async () => {
  agentCalls = [];
  const app = buildApp(defaultAgent);
  server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function login(username = "marina", password = "demo1234") {
  const response = await fetch(`${baseUrl}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, never> };
}

async function chat(token: string, message = "show my invoice", sessionId = "sess-000001") {
  return fetch(`${baseUrl}/v1/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-correlation-id": "corr-gateway",
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
}

describe("authentication", () => {
  it("issues a session token for valid credentials", async () => {
    const { status, body } = await login();
    expect(status).toBe(200);
    expect(body.access_token).toBeTruthy();
    expect(body.user).toMatchObject({ subject: "user-marina", customer_id: "CUS-1001" });
  });

  it("rejects a wrong password", async () => {
    const { status, body } = await login("marina", "wrong-password");
    expect(status).toBe(401);
    expect(body.code).toBe("invalid_credentials");
  });

  it("rejects an unknown user with the same shape as a wrong password", async () => {
    const unknown = await login("nobody", "demo1234");
    const wrong = await login("marina", "wrong-password");
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body.code).toBe(wrong.body.code);
  });

  it("rejects a malformed login payload", async () => {
    const response = await fetch(`${baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "marina" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns the identity behind a valid session", async () => {
    const { body } = await login("agent-smith");
    const response = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    const me = (await response.json()) as Record<string, never>;
    expect(me.actor).toBe("attendant");
    expect(me.scopes).toContain("customer:any");
  });

  it("refuses a protected route without a token", async () => {
    expect((await fetch(`${baseUrl}/v1/auth/me`)).status).toBe(401);
  });

  it("refuses a session token signed with another key", async () => {
    const foreign = new TokenService({
      ...config,
      SESSION_SECRET: "some-other-gateway-secret",
    });
    const token = await foreign.issueSession({
      username: "marina",
      subject: "user-marina",
      displayName: "Marina",
      actor: "subscriber",
      scopes: ["billing:read"],
    });
    expect((await chat(token)).status).toBe(401);
  });
});

describe("token exchange", () => {
  it("sends a downstream token that is not the session token", async () => {
    const { body } = await login();
    await chat(body.access_token);
    const forwarded = agentCalls[0]?.authorization.replace("Bearer ", "");
    expect(forwarded).toBeTruthy();
    expect(forwarded).not.toBe(body.access_token);
  });

  it("narrows the downstream token to the resource audience and the user scopes", async () => {
    const { body } = await login();
    await chat(body.access_token);
    const forwarded = agentCalls[0]?.authorization.replace("Bearer ", "") ?? "";
    const claims = JSON.parse(
      Buffer.from(forwarded.split(".")[1] ?? "", "base64url").toString(),
    ) as Record<string, string>;

    expect(claims.aud).toBe(config.DOWNSTREAM_AUDIENCE);
    expect(claims.customer_id).toBe("CUS-1001");
    expect(claims.scope).toContain("billing:read");
    expect(claims.scope).not.toContain("customer:any");
    expect(claims.channel).toBe("web");
  });

  it("gives the downstream token a shorter life than the session", async () => {
    const { body } = await login();
    await chat(body.access_token);
    const forwarded = agentCalls[0]?.authorization.replace("Bearer ", "") ?? "";
    const downstream = JSON.parse(
      Buffer.from(forwarded.split(".")[1] ?? "", "base64url").toString(),
    ) as { exp: number };
    const session = JSON.parse(
      Buffer.from(String(body.access_token).split(".")[1] ?? "", "base64url").toString(),
    ) as { exp: number };
    expect(downstream.exp).toBeLessThan(session.exp);
  });

  it("keeps customer:any for an attendant", async () => {
    const { body } = await login("agent-smith");
    await chat(body.access_token);
    const forwarded = agentCalls[0]?.authorization.replace("Bearer ", "") ?? "";
    const claims = JSON.parse(
      Buffer.from(forwarded.split(".")[1] ?? "", "base64url").toString(),
    ) as Record<string, string>;
    expect(claims.scope).toContain("customer:any");
  });
});

describe("streaming", () => {
  it("passes the agent frames through to the browser", async () => {
    const { body } = await login();
    const response = await chat(body.access_token);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: ready");
    expect(text).toContain("3 invoices, 1 overdue.");
    expect(text.trimEnd().endsWith('data: {"stop_reason":"end_turn"}')).toBe(true);
  });

  it("propagates the correlation id to the agent and back to the client", async () => {
    const { body } = await login();
    const response = await chat(body.access_token);
    await response.text();
    expect(agentCalls[0]?.correlationId).toBe("corr-gateway");
    expect(response.headers.get("x-correlation-id")).toBe("corr-gateway");
  });

  it("forwards the session id and the subject to the agent", async () => {
    const { body } = await login();
    await (await chat(body.access_token, "hello", "sess-abcdef")).text();
    expect(agentCalls[0]?.body).toMatchObject({
      message: "hello",
      session_id: "sess-abcdef",
      subject: "user-marina",
    });
  });

  it("rejects a malformed chat payload", async () => {
    const { body } = await login();
    const response = await fetch(`${baseUrl}/v1/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${body.access_token}` },
      body: JSON.stringify({ message: "", session_id: "x" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("failure handling", () => {
  it("emits an SSE error frame when the agent answers with an error", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const failing = (async () => new Response("boom", { status: 502 })) as unknown as typeof fetch;
    const app = buildApp(failing);
    server = await new Promise<Server>((resolve) => {
      const started = app.listen(0, () => resolve(started));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { body } = await login();
    const text = await (await chat(body.access_token)).text();
    expect(text).toContain("agent_unavailable");
    expect(text).toContain("event: done");
  });

  it("never leaks the upstream failure detail to the client", async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const failing = (async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.9:8083");
    }) as unknown as typeof fetch;
    const app = buildApp(failing);
    server = await new Promise<Server>((resolve) => {
      const started = app.listen(0, () => resolve(started));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const { body } = await login();
    const text = await (await chat(body.access_token)).text();
    expect(text).not.toContain("10.0.0.9");
    expect(text).toContain("event: done");
  });
});

describe("rate limiting", () => {
  it("limits per authenticated subject", async () => {
    const { body } = await login();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ok = await chat(body.access_token);
      await ok.text();
      expect(ok.status).toBe(200);
    }
    const blocked = await chat(body.access_token);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("keeps separate budgets for different users", async () => {
    const marina = await login("marina");
    const rafael = await login("rafael");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await (await chat(marina.body.access_token)).text();
    }
    expect((await chat(marina.body.access_token)).status).toBe(429);
    const other = await chat(rafael.body.access_token);
    expect(other.status).toBe(200);
    await other.text();
  });
});

describe("rate limiter unit", () => {
  it("reopens the window after it elapses", () => {
    let now = 0;
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1, now: () => now });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    now = 1200;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("reports the remaining budget", () => {
    const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 2 });
    expect(limiter.check("b").remaining).toBe(1);
    expect(limiter.check("b").remaining).toBe(0);
    expect(limiter.check("b").allowed).toBe(false);
  });
});

describe("configuration guardrails", () => {
  it("refuses development defaults in production", () => {
    expect(() =>
      loadConfig({ ENVIRONMENT: "prd" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/still holds its development default/);
  });

  it("accepts production configuration with real secrets", () => {
    const production = loadConfig({
      ENVIRONMENT: "prd",
      SESSION_SECRET: "a-real-session-secret-value",
      DOWNSTREAM_SECRET: "a-real-downstream-secret-value",
      DEMO_PASSWORD: "a-real-password",
    } as unknown as NodeJS.ProcessEnv);
    expect(production.ENVIRONMENT).toBe("prd");
  });
});

describe("password handling", () => {
  it("does not keep the password in memory in clear text", async () => {
    const directory = new Directory("super-secret-password");
    const serialized = JSON.stringify(directory);
    expect(serialized).not.toContain("super-secret-password");
    expect(await directory.authenticate("marina", "super-secret-password")).not.toBeNull();
  });

  it("spends comparable time on an unknown user", async () => {
    const directory = new Directory("demo1234");
    const measure = async (username: string) => {
      const started = performance.now();
      await directory.authenticate(username, "demo1234");
      return performance.now() - started;
    };
    const known = await measure("marina");
    const unknown = await measure("ghost");
    expect(unknown).toBeGreaterThan(known / 10);
  });
});

describe("health", () => {
  it("answers without authentication", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ service: "sinal-bff" });
  });
});

describe("cors", () => {
  it("allows the configured origin", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("does not allow an unlisted origin", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { origin: "https://evil.example" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("logging", () => {
  it("does not log the password on a failed login", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });
    await login("marina", "a-very-secret-password");
    spy.mockRestore();
    expect(lines.join("")).not.toContain("a-very-secret-password");
  });
});

describe("hardening regressions", () => {
  it("rate limits repeated login attempts before the KDF", async () => {
    let blocked = false;
    for (let i = 0; i < 8; i += 1) {
      const r = await login("marina", "wrong-password");
      if (r.status === 429) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it("replaces a malformed correlation id instead of reflecting it", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { "x-correlation-id": "bad id with spaces & <b>" },
    });
    const echoed = response.headers.get("x-correlation-id") ?? "";
    expect(echoed).not.toContain("<b>");
    expect(echoed).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  });

  it("sets defensive response headers", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("returns generic JSON, not an HTML stack trace, on malformed body", async () => {
    const response = await fetch(`${baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    const text = await response.text();
    expect(text).not.toContain("SyntaxError");
    expect(text).not.toContain("at JSON.parse");
  });

  it("refuses a chat request whose subject no longer exists in the directory", async () => {
    const orphan = await new TokenService(config).issueSession({
      username: "ghost",
      subject: "user-ghost",
      displayName: "Ghost",
      actor: "subscriber",
      scopes: ["billing:read"],
    });
    const response = await fetch(`${baseUrl}/v1/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${orphan}` },
      body: JSON.stringify({ message: "hi", session_id: "sess-orphan" }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses a session token that carries no exp", async () => {
    const { SignJWT } = await import("jose");
    const noExp = await new SignJWT({ scope: "billing:read", actor: "subscriber" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-marina")
      .setIssuer(config.SESSION_ISSUER)
      .setAudience(config.SESSION_AUDIENCE)
      .setIssuedAt()
      .sign(new TextEncoder().encode(config.SESSION_SECRET));
    const response = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { authorization: `Bearer ${noExp}` },
    });
    expect(response.status).toBe(401);
  });
});

describe("config guards widen to hom", () => {
  it("rejects dev defaults in hom, not only prd", () => {
    expect(() => loadConfig({ ENVIRONMENT: "hom" } as unknown as NodeJS.ProcessEnv)).toThrow(
      /development default/,
    );
  });

  it("rejects identical session and downstream secrets outside dev", () => {
    expect(() =>
      loadConfig({
        ENVIRONMENT: "prd",
        SESSION_SECRET: "same-secret-value-for-both-here",
        DOWNSTREAM_SECRET: "same-secret-value-for-both-here",
        DEMO_PASSWORD: "a-real-password",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/must differ/);
  });
});
