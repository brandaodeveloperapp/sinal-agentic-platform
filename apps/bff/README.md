# sinal-bff

Edge gateway. It authenticates the end user, exchanges that session for a narrow
downstream token, rate limits per identity and streams the agent answer to the
browser.

## Inbound and outbound authentication

Two different tokens, signed with two different keys:

| Token | Audience | Signed with | Lifetime | Accepted by |
|---|---|---|---|---|
| Session | `sinal-bff` | gateway key | 30 min | the gateway only |
| Downstream | `sinal-mcp` | resource key | 5 min | agent and MCP Server |

A leaked session token cannot be replayed against the MCP Server — wrong audience,
wrong key. A leaked downstream token expires long before the session does. The
exchange happens per request, so revoking a session stops new downstream tokens
without waiting for anything to expire.

`Directory` is the simulated identity provider: the demo password is derived with
scrypt under a per-user salt at boot and compared in constant time, and an unknown
username spends the same work as a wrong password. Swapping it for a real OIDC
provider changes nothing outside that class.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness |
| `POST /v1/auth/login` | none | Credentials in, session token out |
| `GET /v1/auth/me` | session | Identity behind the current session |
| `POST /v1/chat/stream` | session | Token exchange, then SSE proxy to the agent |

## Rate limiting

Fixed window keyed by **authenticated subject**, not by IP: one conversation can be
expensive in model tokens, so the budget follows the user rather than the network
path. Over the limit returns `429` with `Retry-After`.

## Streaming

The gateway never buffers the body — SSE frames are forwarded as they arrive, so the
first token reaches the browser without waiting for the turn to finish. When the
agent is unreachable or times out the client still receives well formed `error` and
`done` frames instead of a dangling connection, and the upstream failure detail
never reaches the browser.

## Demo users

| Username | Role | Customer | Notable scope |
|---|---|---|---|
| `marina` | subscriber | CUS-1001 | — |
| `rafael` | subscriber | CUS-1002 | — |
| `agent-smith` | attendant | none | `customer:any` |

Password comes from `DEMO_PASSWORD` (default `demo1234` in dev). With
`ENVIRONMENT=prd` the service refuses to boot while any secret still holds its
development default.

## Run

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
```

29 tests (96.8% coverage): credential handling, session verification, the audience
and lifetime of the exchanged token, SSE pass-through, correlation id propagation,
failures that leak nothing, per-subject rate limiting, CORS and the production
configuration guard.
