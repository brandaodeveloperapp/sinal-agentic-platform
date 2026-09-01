# Sinal — Agentic Platform

A conversational support platform for the fictional carrier **Onda Telecom**. A customer
asks a question in plain language; an agent answers it by calling corporate capabilities
exposed as **tools over MCP** — never by touching the business systems directly, and
never beyond what that customer is allowed to see.

> All data here is fictional. "Onda Telecom" does not exist and no real subscriber data
> is used anywhere in this repository.

![Sinal on AWS — one request end to end](docs/diagrams/aws-request-flow.svg)

## The idea in one line

> The agent may only do, for a given user, what that user is allowed to do — and the
> proof of that lives in code, outside the prompt and outside the probabilistic decision
> of the model.

Everything in this repo serves that rule. It is what makes this an agentic platform and
not a chatbot.

## Architecture

```
React (SSE) -> BFF / gateway -> Agent (agent loop) -> MCP Server -> Corporate API
   TS             Node/TS          Python/Strands       Node/TS      Python/FastAPI
```

Each layer is its own process in its own runtime, reached over HTTP, so coupling between
them is impossible by construction.

| Service | Stack | Role |
|---|---|---|
| [`apps/web`](apps/web) | React + TypeScript | WhatsApp-style chat, streams the answer |
| [`apps/bff`](apps/bff) | Node + TypeScript | gateway: authn, token exchange, rate limit, SSE proxy |
| [`apps/agent`](apps/agent) | Python + Strands Agents | agent loop, tool calling, session memory |
| [`apps/mcp-server`](apps/mcp-server) | Node + TypeScript | MCP Server (Streamable HTTP), tool authorization |
| [`apps/api-telecom`](apps/api-telecom) | Python + FastAPI | corporate system of record |

Three identities, never conflated — **user** (session JWT), **agent** (the downstream
token it forwards, no credential of its own), **tool** (workload key). A stolen session
token cannot be replayed against the MCP server: wrong audience, wrong key, minutes to
live.

![Two tokens, two keys](docs/diagrams/token-exchange.svg)

## Live demo

`https://sinal.brandaodeveloper.com.br` — MCP endpoint at `POST /mcp`, bearer required.
Runs on k3s; the AWS target is validated Terraform in [`infra/terraform`](infra/terraform)
with the parity mapped in [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Run it locally

Requirements: Node 20+, Python 3.12, `uv`, Docker.

```bash
cp .env.example .env
docker compose -f infra/docker/compose.yaml up -d --build
# web on :5173, gateway on :8080
```

Demo accounts (password `demo1234`): `marina`, `rafael` (subscribers), `agent-smith`
(support desk, holds `customer:any`). Sign in and ask about an invoice, data usage, a
plan or a ticket.

## Tests and gates

| Suite | Command | Count |
|---|---|---|
| Corporate API | `cd apps/api-telecom && .venv/bin/python -m pytest` | 25 |
| MCP Server | `cd apps/mcp-server && npm test` | 62 |
| Agent | `cd apps/agent && .venv/bin/python -m pytest` | 31 |
| Gateway | `cd apps/bff && npm test` | 37 |
| Web | `cd apps/web && npm test` | 33 |
| Evals | `cd evals && .venv/bin/python -m pytest` | 16 |

Beyond unit tests, three gates run in CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

- **Regression gate** — the golden suite (`evals/`) fails the build if a blessed case
  regresses or the pass rate drops. Covers a change in prompt, tool or model with one
  mechanism.
- **Live red team** — `security/redteam/attack.mjs` fires 24 real attacks at the booted
  stack and must refuse every one (**24/24**).
- **No-mock end to end** — `node infra/smoke/full-chain.mjs` runs BFF -> agent -> MCP ->
  API against the real stack (**14/14**).

```bash
node infra/smoke/full-chain.mjs              # BFF -> agent -> MCP -> API, no mocks
node security/redteam/attack.mjs             # live adversarial red team
cd evals && python -m sinal_evals.cli gate   # regression gate
```

## Documentation

| Document | What it answers |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the layers separate, the three identities, request flow |
| [docs/SECURITY.md](docs/SECURITY.md) | inbound/outbound auth, tool authorization, keeping rules out of the prompt |
| [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) | one correlation id across the chain, cost as a signal, CloudWatch/OTel |
| [docs/DEPLOY.md](docs/DEPLOY.md) | AWS topology, k3s<->AWS parity, rollback, cost, regression |
| [docs/RISKS.md](docs/RISKS.md) | the real risks and what holds each one down |
| [docs/adr/](docs/adr) | the five decisions of record |
| [security/FINDINGS.md](security/FINDINGS.md) | red-team findings and their fix status |

## Repository layout

```
apps/            web, bff, agent, mcp-server, api-telecom
packages/        shared OpenAPI contract
evals/           golden suite, runner, regression gate
security/        red-team harness and findings
infra/           docker compose, k8s manifests, terraform (AWS), smoke tests
docs/            architecture, security, observability, deploy, risks, ADRs, diagrams
```

Secrets are never committed. `.env` is gitignored; every service refuses to boot outside
`dev` while a secret still holds its development default, and the AWS target reads
secrets from Secrets Manager via an IAM role.
