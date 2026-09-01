const BFF = process.env.BFF_URL || "http://127.0.0.1:8080";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

async function login(username, password = "demo1234") {
  const response = await fetch(`${BFF}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function chat(token, message, sessionId) {
  const response = await fetch(`${BFF}/v1/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-correlation-id": `chain-${sessionId}`,
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  const text = await response.text();
  const events = [];
  let name = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:") && name) {
      events.push([name, JSON.parse(line.slice(5).trim())]);
    }
  }
  return { status: response.status, correlationId: response.headers.get("x-correlation-id"), events };
}

const textOf = (events) =>
  events.filter(([name]) => name === "token").map(([, data]) => data.text).join("");
const first = (events, name) => events.find(([event]) => event === name)?.[1];

async function main() {
  const health = await fetch(`${BFF}/health`).then((r) => r.json());
  check("gateway is healthy", health.status === "ok", health.service);

  const bad = await login("marina", "wrong-password");
  check("wrong password is rejected", bad.status === 401, String(bad.status));

  const marina = await login("marina");
  check("subscriber logs in", marina.status === 200 && Boolean(marina.body.access_token));
  check(
    "login returns the customer binding",
    marina.body.user?.customer_id === "CUS-1001",
    String(marina.body.user?.customer_id),
  );

  const turn = await chat(marina.body.access_token, "I want to see my invoice", "chain-0001");
  check("stream returns 200", turn.status === 200, String(turn.status));
  check("correlation id survives the whole chain", turn.correlationId === "chain-chain-0001", String(turn.correlationId));
  check("agent reports the tools the MCP exposed", first(turn.events, "ready")?.tools?.length === 8,
    (first(turn.events, "ready")?.tools || []).join(","));
  check("tool call announced", first(turn.events, "tool_call")?.name === "list_invoices",
    JSON.stringify(first(turn.events, "tool_call")));
  check("answer carries real corporate data", textOf(turn.events).includes("invoices"), textOf(turn.events));
  check("done reports usage", (first(turn.events, "done")?.usage?.total_tokens ?? 0) > 0,
    JSON.stringify(first(turn.events, "done")?.usage));

  const usage = await chat(marina.body.access_token, "how much data have I used", "chain-0002");
  check("usage question reaches the line", textOf(usage.events).includes("GB"), textOf(usage.events));

  const write = await chat(marina.body.access_token, "I want to open a ticket", "chain-0003");
  check("write stops at confirmation", textOf(write.events).toLowerCase().includes("confirmation"),
    textOf(write.events).slice(0, 80));

  const staff = await login("agent-smith");
  const staffTurn = await chat(staff.body.access_token, "which plans are available", "chain-0004");
  check("attendant also reaches the catalogue", textOf(staffTurn.events).includes("plans"),
    textOf(staffTurn.events));

  const anonymous = await fetch(`${BFF}/v1/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi", session_id: "chain-0005" }),
  });
  check("anonymous request is refused at the edge", anonymous.status === 401, String(anonymous.status));

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks ok`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("full chain smoke failed:", error.message);
  process.exit(1);
});
