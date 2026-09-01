# Security findings

Findings from the red-team passes over this repository, with the fix status of each.
Three static passes (auth/token, MCP authorization, gateway/proxy/agent/web) plus a
live adversarial harness. Only code-anchored, confirmed items are listed.

**Headline:** the static MCP-authorization pass confirmed **no horizontal privilege
escalation** — a subscriber bound to one customer cannot reach another through any of
the eight tools — matching the live harness result of 24/24 attacks refused. The real
exposure was in configuration defaults, the write gate, retries, sanitization breadth,
and the agent trusting an unverified token. Those are addressed below.

## Live harness

`security/redteam/attack.mjs` — **24/24 attacks refused** against the running stack.
See `security/redteam/README.md`.

## Fixed

| # | Severity | Area | Finding | Fix |
|---|---|---|---|---|
| 1 | critical | mcp config | `JWT_SIGNING_SECRET` / `API_TELECOM_KEY` shipped a working default with no prod guard on MCP | `loadConfig` now refuses to boot for any non-`dev` environment while a secret holds its dev default (`apps/mcp-server/src/config.ts`) |
| 2 | critical | api config | corporate API key defaulted to the repo value with no guard | non-`dev` boot fails on the default key (`apps/api-telecom/src/sinal_api/config.py`) |
| 3 | high | agent auth | the agent never verified the bearer token and took `subject` from the request body | agent verifies HS256 signature + iss/aud/exp + `sub` and acts on the verified subject only; body `subject` removed (`apps/agent/src/sinal_agent/auth.py`, `main.py`) |
| 4 | high | bff login | `/v1/auth/login` had no rate limit — credential brute force and an unauthenticated scrypt DoS | per-IP + per-username limiter runs before the KDF (`apps/bff/src/app.ts`) |
| 5 | high | mcp write | `open_support_ticket` retried on POST, creating duplicate tickets while reporting "no data changed" | POST is never retried; only idempotent GETs retry (`apps/mcp-server/src/upstream/telecomClient.ts`) |
| 6 | medium | jwt | tokens with no `exp` verified forever | both verifiers require `exp`+`iat` (`mcp` and `bff` token layers) |
| 7 | medium | bff config | prod guard fired only on `prd`; `hom` booted on dev defaults | guard widened to every non-`dev` environment, and it rejects identical session/downstream secrets |
| 8 | medium | bff exchange | downstream token copied session scopes verbatim; privilege changes never took effect | scopes and customer binding are re-resolved from the directory at exchange time (`apps/bff/src/app.ts`) |
| 9 | medium | mcp injection | the injection denylist was evadable (spacing, zero-width, fullwidth) and applied to one field only | sanitizer normalizes NFKC + strips zero-width/control + collapses whitespace, and every upstream free-text string is run through it; `full_name` and the write-path ticket now sanitized |
| 10 | medium | mcp errors | denial and upstream messages leaked scope names, resource ids and upstream text to the model | caller-facing text is fixed and generic; an unowned resource reads exactly like a missing one (closes the existence oracle); detail stays in logs |
| 11 | medium | mcp args | ids were unvalidated; `..` segments could rewrite the upstream route | `customer_id`/`invoice_id`/`msisdn` are format-constrained in zod, and the client rejects any `.`/`..` path segment |
| 12 | medium | bff express | no error handler → Express returned HTML stack traces | terminal handler returns generic JSON; `NODE_ENV=production` set in the image |
| 13 | medium | agent dos | the session store had no cardinality cap | LRU cap evicts oldest-first (`apps/agent/src/sinal_agent/sessions.py`) |
| 14 | low | mcp pii | `document` was returned unmasked despite the tool description | `maskDocument` applied in the handler |
| 15 | low | agent diag | `/v1/diagnostics` was unauthenticated | now behind the same bearer check |
| 16 | low | api timing | workload key compared with `!=` | `hmac.compare_digest` |
| 17 | low | bff headers | only `x-content-type-options` was set | added `x-frame-options`, `referrer-policy`, and a restrictive CSP; correlation/session ids are charset-validated before use |
| 18 | low | web dos | the SSE parser buffer could grow without bound | 1 MB cap that aborts the stream |
| 19 | doc | env | `.env.example` used names no service reads and the wrong audience | rewritten with the real per-service variables |

## Accepted (documented, not a bypass)

- A validly signed token carrying the `customer:any` scope reaching another customer is
  a real attendant grant, not an escalation. It depends on the signing secret staying
  out of reach, which is why the secret is generated in the cluster and never committed.
- `/dev/token` exists only when `ENVIRONMENT=dev`; the k8s manifests pin `ENVIRONMENT=hom`,
  so it is absent in the deployed environment (verified: 404).

## Deferred (tracked, not yet done)

- **Server-side write approval nonce.** `open_support_ticket` still gates on a
  model-supplied `confirmed` flag. Defense in depth today: the write is bound to the
  token's customer, POST is not retried, and the summary is sanitized. A host-issued
  approval nonce bound to the preview (so the model cannot fabricate `confirmed=true`
  without a prior preview) is the next step.
- **Per-subject concurrent-stream cap** on the BFF (rate is limited; concurrency is not).
- **scrypt cost parameters** raised above Node defaults, and per-user credentials
  replacing the shared demo password.
