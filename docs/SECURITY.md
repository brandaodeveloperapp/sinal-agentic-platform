# Security

The platform is built around one idea: **critical rules live in code, not in the
prompt**. A language model is probabilistic; authorization cannot be. Everything below
is enforced in a place the model cannot talk its way past, and proven by the tests and
the red-team harness.

## Three identities, never conflated

| Identity | Token / credential | Audience | Signed / held | Verified where |
|---|---|---|---|---|
| User | session JWT | `sinal-bff` | gateway secret | BFF |
| Agent | downstream JWT (forwarded) | `sinal-mcp` | resource secret | agent + MCP |
| Tool | workload key | — | Secrets Manager | corporate API |

The agent has **no data credential of its own**. It forwards the end-user token, so it
can never see more than the signed-in user. Three separate secrets, two separate
audiences: a token minted for one hop is rejected at another.

## Authentication, inbound and outbound

- **Inbound:** the BFF verifies the session JWT — HS256 pinned, issuer and audience
  checked, `exp`+`iat` required (a token without `exp` is rejected, not trusted
  forever). The agent independently verifies the downstream JWT before acting, and
  derives the acting subject from the verified `sub` claim, never from the request body.
- **Outbound:** the BFF exchanges the session for a short-lived (5 min) downstream token
  scoped to the resource audience, re-resolving the user's current scopes from the
  directory at exchange time so a privilege change takes effect on the next request.

## Authorization of tools

- **Identity-filtered discovery** — `tools/list` returns only what the caller's scopes
  permit; the model never sees a forbidden capability.
- **Re-check on every call** — scope is revalidated at invocation; a guessed tool name
  is refused.
- **Deterministic customer binding** — `customer_id` comes from the token; reaching
  another customer needs `customer:any` and is denied before the upstream call.
- **Ownership re-checked** — resource-level tools (`get_invoice_details`,
  `get_line_usage`) re-verify ownership after fetching, and an unowned resource is
  reported exactly like a missing one, so a denial is not an existence oracle.

## Keeping critical rules out of the prompt

The system prompt tells the model to behave, but nothing depends on it obeying:

- The write confirmation, the customer binding and the scope checks are enforced by the
  MCP server, not by the prompt.
- Untrusted free text from the corporate system (a customer name, a ticket body) is run
  through a sanitizer that normalizes NFKC, strips zero-width and control characters,
  collapses whitespace and neutralizes injection markers — so a prompt injection stored
  in a support ticket reaches the model as `[content removed]`, proven on the live path.
- The agent forwards the user's own token, so even if the model is talked into calling a
  tool, the call is still bound to what that user may do.

## Guardrails and hygiene

- Documents and emails are masked at the MCP boundary.
- Tool arguments are format-validated (`CUS-…`, `INV-…`, digit MSISDN) and `..` path
  segments are rejected before an upstream URL is built.
- Errors to the model are fixed, generic strings — no scope names, resource ids or
  upstream detail leak through; details go to the logs.
- The BFF rate-limits login per IP+username before the KDF runs, rate-limits chat per
  subject, sets defensive headers, validates the correlation-id charset, and returns
  generic JSON instead of stack traces.
- Every service refuses to boot outside `dev` while any secret still holds its
  development default.
- Environments are segregated (`dev` / `hom` / `prd`); the dev-only token issuer does
  not exist outside `dev` (verified 404 in the deployed `hom`).

## Proven, not asserted

- **Static red team** — three independent passes over the auth/token, MCP-authorization
  and gateway/agent/web layers. The authorization pass confirmed **no horizontal
  privilege escalation**: a subscriber cannot reach another customer through any tool.
- **Live red team** — `security/redteam/attack.mjs` fires 24 real attacks at the running
  stack (JWT `alg=none` / wrong key / expired / wrong audience, cross-customer
  escalation through every tool, hidden-tool invocation, path traversal, write without
  confirmation, prompt injection in the message and stored in a ticket, brute force,
  oversized body, CRLF, CORS, rate-limit flood). Result: **24/24 refused**, and it runs
  in CI so a regression fails the build.

Full findings and fix status: `security/FINDINGS.md`.

## What is deferred

Tracked in `security/FINDINGS.md`: a server-issued write-approval nonce (today the
write is bound to the token customer, not retried, and sanitized), a per-subject
concurrent-stream cap, raised scrypt cost parameters, and per-user credentials
replacing the shared demo password.
