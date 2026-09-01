import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { TokenVerifier, issueToken, type Scope } from "../src/auth/tokens.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { CircuitBreaker } from "../src/upstream/circuitBreaker.js";
import { TelecomClient } from "../src/upstream/telecomClient.js";
import { createFakeUpstream, type UpstreamCall } from "./helpers/upstream.js";

const config = loadConfig({
  ENVIRONMENT: "dev",
  LOG_LEVEL: "silent",
  JWT_SIGNING_SECRET: "integration-test-signing-secret",
} as NodeJS.ProcessEnv);

const tokenOptions = {
  issuer: config.JWT_ISSUER,
  audience: config.JWT_AUDIENCE,
  signingSecret: config.JWT_SIGNING_SECRET,
};

let httpServer: Server;
let baseUrl: string;
let calls: UpstreamCall[];

beforeEach(async () => {
  const logger = createLogger("test", "dev", "silent");
  const upstream = createFakeUpstream();
  calls = upstream.calls;

  const client = new TelecomClient({
    baseUrl: "http://upstream.test",
    apiKey: "test-key",
    timeoutMs: 2000,
    maxRetries: 0,
    breaker: new CircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 }),
    logger,
    fetchImpl: upstream.fetchImpl,
    sleep: async () => {},
  });

  const app = createApp({
    config,
    logger,
    client,
    verifier: new TokenVerifier(tokenOptions),
  });

  httpServer = await new Promise<Server>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

async function connect(scopes: Scope[], customerId?: string, actor?: "subscriber" | "attendant") {
  const token = await issueToken(
    { subject: "user-under-test", scopes, customerId, actor: actor ?? "subscriber" },
    tokenOptions,
  );
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

function textOf(result: { content?: unknown }): string {
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

const SUBSCRIBER_SCOPES: Scope[] = [
  "catalog:read",
  "customer:read",
  "usage:read",
  "billing:read",
  "support:read",
  "support:write",
];

describe("tool discovery is identity aware", () => {
  it("lists only the tools the caller is entitled to", async () => {
    const client = await connect(["catalog:read"]);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["list_plans"]);
    await client.close();
  });

  it("lists the full toolset for a fully scoped subscriber", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "get_customer_profile",
        "get_invoice_details",
        "get_line_usage",
        "list_customer_lines",
        "list_invoices",
        "list_plans",
        "list_support_tickets",
        "open_support_ticket",
      ].sort(),
    );
    await client.close();
  });

  it("marks the write tool as non read-only", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const { tools } = await client.listTools();
    const write = tools.find((tool) => tool.name === "open_support_ticket");
    expect(write?.annotations?.readOnlyHint).toBe(false);
    expect(write?.annotations?.destructiveHint).toBe(true);
    await client.close();
  });
});

describe("authentication", () => {
  it("refuses a connection without a token", async () => {
    const client = new Client({ name: "anon", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
    await expect(client.connect(transport)).rejects.toBeTruthy();
  });

  it("refuses a token signed by another issuer", async () => {
    const token = await issueToken(
      { subject: "attacker", scopes: ["billing:read"] },
      { ...tokenOptions, signingSecret: "forged-signing-secret-value" },
    );
    const client = new Client({ name: "forged", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    await expect(client.connect(transport)).rejects.toBeTruthy();
  });
});

describe("tool invocation", () => {
  it("returns catalogue data for an authorized caller", async () => {
    const client = await connect(["catalog:read"]);
    const result = await client.callTool({ name: "list_plans", arguments: {} });
    expect(textOf(result)).toContain("Onda Pos 50GB");
    await client.close();
  });

  it("refuses to call a tool that was never exposed to the caller", async () => {
    const client = await connect(["catalog:read"]);
    const result = await client.callTool({ name: "list_invoices", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not found");
    expect(calls).toHaveLength(0);
    await client.close();
  });

  it("binds the customer from the token when none is supplied", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({ name: "list_invoices", arguments: {} });
    expect(textOf(result)).toContain("INV-2026-08-1001");
    expect(calls.some((call) => call.path === "/v1/customers/CUS-1001/invoices")).toBe(true);
    await client.close();
  });

  it("denies a subscriber asking for another customer and never calls upstream", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({
      name: "list_invoices",
      arguments: { customer_id: "CUS-2001" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Acesso negado");
    expect(calls.some((call) => call.path.includes("CUS-2001"))).toBe(false);
    await client.close();
  });

  it("allows an attendant holding customer:any to reach another customer", async () => {
    const client = await connect(
      [...SUBSCRIBER_SCOPES, "customer:any"],
      undefined,
      "attendant",
    );
    const result = await client.callTool({
      name: "get_customer_profile",
      arguments: { customer_id: "CUS-2001" },
    });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Verde Campo");
    await client.close();
  });

  it("blocks reading an invoice owned by another customer", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({
      name: "get_invoice_details",
      arguments: { invoice_id: "INV-2026-08-2001" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Acesso negado");
    await client.close();
  });

  it("blocks reading usage of a line the customer does not own", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({
      name: "get_line_usage",
      arguments: { msisdn: "5511970003001" },
    });
    expect(result.isError).toBe(true);
    expect(calls.some((call) => call.path.includes("/usage"))).toBe(false);
    await client.close();
  });

  it("masks the customer email in the tool output", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({ name: "get_customer_profile", arguments: {} });
    const text = textOf(result);
    expect(text).toContain("***@exemplo.test");
    expect(text).not.toContain("marina.andrade@exemplo.test");
    await client.close();
  });

  it("neutralizes injection markers coming from stored free text", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({ name: "list_support_tickets", arguments: {} });
    const text = textOf(result);
    expect(text).toContain("[conteudo removido]");
    expect(text.toLowerCase()).not.toContain("ignore all previous");
    await client.close();
  });

  it("rejects arguments that fail schema validation", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({
      name: "open_support_ticket",
      arguments: { category: "billing", summary: "curto" },
    });
    expect(result.isError).toBe(true);
    await client.close();
  });
});

describe("human in the loop on write operations", () => {
  it("asks for confirmation before writing anything", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({
      name: "open_support_ticket",
      arguments: { category: "billing", summary: "Cobranca duplicada na fatura de agosto" },
    });
    expect(textOf(result)).toContain("confirmation_required");
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await client.close();
  });

  it("writes only after explicit confirmation", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({
      name: "open_support_ticket",
      arguments: {
        category: "billing",
        summary: "Cobranca duplicada na fatura de agosto",
        confirmed: true,
      },
    });
    expect(textOf(result)).toContain("TCK-4701");
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toMatchObject({ customer_id: "CUS-1001", category: "billing" });
    await client.close();
  });

  it("keeps the write bound to the token customer even if another is requested", async () => {
    const client = await connect(SUBSCRIBER_SCOPES, "CUS-1001");
    const result = await client.callTool({
      name: "open_support_ticket",
      arguments: {
        category: "billing",
        summary: "Tentativa de abrir chamado para outro cliente",
        customer_id: "CUS-2001",
        confirmed: true,
      },
    });
    expect(result.isError).toBe(true);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await client.close();
  });
});

describe("resources", () => {
  it("exposes the plan catalogue as an MCP resource", async () => {
    const client = await connect(["catalog:read"]);
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain("sinal://catalog/plans");

    const read = await client.readResource({ uri: "sinal://catalog/plans" });
    expect(String(read.contents[0]?.text)).toContain("onda-pos-50");
    await client.close();
  });

  it("does not even advertise resources to a caller without catalog:read", async () => {
    const client = await connect(["billing:read"], "CUS-1001");
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    await expect(client.listResources()).rejects.toBeTruthy();
    await client.close();
  });
});
