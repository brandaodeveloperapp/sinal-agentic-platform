# Sinal — Agentic Platform

Conversational support platform for the fictional carrier **Onda Telecom**. An agent
answers customer questions by consuming corporate capabilities exposed as **tools
over MCP** — it never reaches the business API directly.

> All data here is fictional. "Onda Telecom" does not exist and no real subscriber
> data is used anywhere in this repository.

## Architecture in one line

```
React (SSE) → BFF / gateway (authn) → Agent (agent loop) → MCP Server (tool authz) → Corporate API
```

Every layer runs in its own process and the boundaries are contracts, not imports.
The split is deliberately polyglot so coupling is impossible by construction.

| Service | Stack | Role |
|---|---|---|
| `apps/web` | React + TypeScript | Conversational UI with streaming |
| `apps/bff` | Node.js + TypeScript | Gateway, authentication, SSE, correlation id |
| `apps/agent` | Python + Strands Agents | Agent loop, tool calling, session memory |
| `apps/mcp-server` | Node.js + TypeScript | MCP Server (Streamable HTTP), tools, authorization |
| `apps/api-telecom` | Python + FastAPI | Corporate system of record (fictional data) |

## Security model

Three identities, never conflated:

| Identity | Carried by | Authorized where |
|---|---|---|
| End user | JWT with scopes and a customer binding | MCP Server |
| Agent | The user token it forwards — no privileged credential of its own | MCP Server |
| Tool | Workload key held by the MCP Server | Corporate API |

Tool discovery is identity aware: `tools/list` only returns what the caller may
call, so the model never sees a capability the user is not entitled to. Critical
rules — customer binding, resource ownership, write confirmation — live in code,
outside the prompt and outside the probabilistic decision of the model.

## Live demo

`https://sinal.brandaodeveloper.com.br` — MCP endpoint at `POST /mcp`, bearer token
required. Runs on k3s; the AWS target architecture is documented in `docs/DEPLOY.md`.

## Documentation

| Document | Content |
|---|---|
| `docs/ARCHITECTURE.md` | Decisions, boundaries and diagrams |
| `docs/SECURITY.md` | Identities, tool authorization, guardrails |
| `docs/OBSERVABILITY.md` | End-to-end tracing, metrics, logs |
| `docs/DEPLOY.md` | AWS strategy and the demo environment |
| `docs/RISKS.md` | Known risks and mitigations |
| `docs/adr/` | Architecture Decision Records |

## Development

Requirements: Node 20+, Python 3.12, `uv`, Docker.

```bash
cp .env.example .env
docker compose -f infra/docker/compose.yaml up -d
```

Secrets are never committed. `.env` is gitignored and the production target uses
AWS Secrets Manager with credentials obtained through an IAM role.

## Tests

| Suite | Command | Count |
|---|---|---|
| Corporate API | `cd apps/api-telecom && .venv/bin/python -m pytest` | 22 |
| MCP Server | `cd apps/mcp-server && npm test` | 50 |
| Agent | `cd apps/agent && .venv/bin/python -m pytest` | 28 |
| Gateway | `cd apps/bff && npm test` | 29 |
| Web | `cd apps/web && npm test` | 27 |

End-to-end without mocks, against a running stack:

```bash
apps/agent/.venv/bin/python infra/smoke/agent-e2e.py   # agent -> MCP -> API
node infra/smoke/full-chain.mjs                        # BFF -> agent -> MCP -> API
```
