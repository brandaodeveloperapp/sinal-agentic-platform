const crypto = require("node:crypto");

const BASE = process.env.SMOKE_TARGET || "http://127.0.0.1:8082";
const SECRET = process.env.JWT_SIGNING_SECRET;
const ISSUER = process.env.JWT_ISSUER || "https://sinal.local/idp";
const AUDIENCE = process.env.JWT_AUDIENCE || "sinal-mcp";

function b64(input) {
  return Buffer.from(input).toString("base64url");
}

function mintToken(claims) {
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(
    JSON.stringify({ iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + 300, ...claims }),
  );
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function rpc(token, method, params, id) {
  const response = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "x-correlation-id": `smoke-${method}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const raw = await response.text();
  if (!response.ok) return { httpStatus: response.status, raw };
  const line = raw
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6))
    .pop();
  return JSON.parse(line || raw);
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: Boolean(condition), detail });
}

async function main() {
  if (!SECRET) throw new Error("JWT_SIGNING_SECRET missing in environment");

  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  check("health responde ok", health.status === "ok", JSON.stringify(health));

  const subscriber = mintToken({
    sub: "smoke-subscriber",
    scope: "catalog:read customer:read billing:read support:read support:write usage:read",
    customer_id: "CUS-1001",
    actor: "subscriber",
    channel: "smoke",
  });

  const init = await rpc(
    subscriber,
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1.0.0" },
    },
    1,
  );
  check("initialize devolve o servidor", init.result?.serverInfo?.name === "sinal-mcp-server", JSON.stringify(init.result?.serverInfo));

  const list = await rpc(subscriber, "tools/list", {}, 2);
  const toolNames = (list.result?.tools || []).map((t) => t.name).sort();
  check("subscriber enxerga 8 tools", toolNames.length === 8, toolNames.join(","));

  const ownInvoices = await rpc(
    subscriber,
    "tools/call",
    { name: "list_invoices", arguments: {} },
    3,
  );
  const ownText = JSON.stringify(ownInvoices.result?.content || []);
  check("le a propria fatura", ownText.includes("INV-2026-08-1001"), ownText.slice(0, 120));

  const escalation = await rpc(
    subscriber,
    "tools/call",
    { name: "list_invoices", arguments: { customer_id: "CUS-2001" } },
    4,
  );
  const escalationText = JSON.stringify(escalation.result?.content || []);
  check(
    "escalacao de cliente negada",
    escalation.result?.isError === true && escalationText.includes("Acesso negado"),
    escalationText.slice(0, 160),
  );

  const write = await rpc(
    subscriber,
    "tools/call",
    {
      name: "open_support_ticket",
      arguments: { category: "billing", summary: "Teste de fumaca do fluxo de confirmacao" },
    },
    5,
  );
  check(
    "escrita exige confirmacao",
    JSON.stringify(write.result?.content || []).includes("confirmation_required"),
    "",
  );

  const limited = mintToken({ sub: "smoke-limited", scope: "catalog:read", actor: "service" });
  const limitedList = await rpc(limited, "tools/list", {}, 6);
  const limitedNames = (limitedList.result?.tools || []).map((t) => t.name);
  check(
    "token restrito enxerga apenas list_plans",
    limitedNames.length === 1 && limitedNames[0] === "list_plans",
    limitedNames.join(","),
  );

  const forged = mintToken.call(null, { sub: "attacker", scope: "billing:read" });
  const tampered = `${forged.split(".").slice(0, 2).join(".")}.aaaa`;
  const rejected = await rpc(tampered, "tools/list", {}, 7);
  check("token adulterado rejeitado", rejected.httpStatus === 401, String(rejected.httpStatus));

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks ok`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("smoke failed:", error.message);
  process.exit(1);
});
