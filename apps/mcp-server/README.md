# sinal-mcp-server

MCP Server exposing Onda Telecom corporate capabilities as **authorized tools**. It
is the only door between the agent and the business API.

Transport: **Streamable HTTP** on `POST /mcp`, stateless — every request carries the
caller identity and gets an MCP server built for it.

## Authorization in three layers

1. **Identity-filtered discovery.** `tools/list` only returns the tools whose scopes
   the token holds. The model never sees a capability the user cannot use, so there
   is nothing for it to "try".
2. **Check at invocation.** `authorizeToolCall` revalidates scopes on every call.
   Defense in depth: guessing a tool name is not enough.
3. **Deterministic customer binding.** `customer_id` comes from the token, not from
   an argument produced by the model. Asking for a different customer requires the
   `customer:any` scope; without it the call is denied **before** touching the API.

Critical rules live in code, outside the prompt and outside the probabilistic
decision of the model.

## Tools

| Tool | Scopes | Writes |
|---|---|---|
| `list_plans` | `catalog:read` | no |
| `get_customer_profile` | `customer:read` | no |
| `list_customer_lines` | `customer:read` | no |
| `get_line_usage` | `usage:read` | no |
| `list_invoices` | `billing:read` | no |
| `get_invoice_details` | `billing:read` | no |
| `list_support_tickets` | `support:read` | no |
| `open_support_ticket` | `support:write` | yes, with confirmation |

MCP resource: `sinal://catalog/plans` (only with `catalog:read`).

## Human in the loop

`open_support_ticket` only writes with `confirmed=true`. Without confirmation the
tool returns `confirmation_required` with a preview and **no side effect** — the
agent has to ask the user before repeating the call.

## Resilience

Per-attempt timeout, retry with exponential backoff and jitter only on
`429/502/503/504` (honouring `Retry-After`), and a circuit breaker per upstream. An
error never leaks a stack trace to the model: it becomes an actionable message.

## Run

```bash
npm install
npm run dev
```

With `ENVIRONMENT=dev` a `POST /dev/token` endpoint mints test tokens. The endpoint
is **not registered** outside dev.

```bash
curl -s localhost:8082/dev/token -H 'content-type: application/json' \
  -d '{"subject":"user-1","customer_id":"CUS-1001","scopes":["catalog:read","billing:read"]}'
```

## Tests

```bash
npm test
```

50 tests: authorization policy, JWT handling, resilience (retry/timeout/breaker) and
**MCP protocol tests** driven by a real client — filtered discovery, denied customer
escalation, resource ownership and the confirmation flow.
