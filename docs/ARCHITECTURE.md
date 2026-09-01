# Architecture

Sinal is a conversational support platform for the fictional carrier Onda Telecom. A
customer asks a question in natural language; an agent answers it by calling corporate
capabilities exposed as **tools over MCP**, and never by touching the business systems
directly.

## The one rule everything follows

> The agent may only do, for a given user, what that user is allowed to do — and the
> proof of that lives in code, outside the prompt and outside the probabilistic
> decision of the model.

Every design choice below serves that rule.

## Four layers, four processes, four languages

```
React (SSE) → BFF / gateway → Agent (agent loop) → MCP Server → Corporate API
   TS            Node/TS          Python/Strands      Node/TS      Python/FastAPI
```

The split is deliberately polyglot. Because each layer is a separate process reached
over HTTP, coupling between them is impossible by construction — the agent cannot
reach into the API's data, the API cannot see the model, the browser cannot skip the
gateway. That is the honest answer to "how did you separate agent, tool, MCP and API":
they are separated because they cannot be joined.

| Layer | Stack | Responsibility | Does NOT |
|---|---|---|---|
| Web | React + TS | render the conversation, stream tokens | hold any secret; decide anything |
| BFF | Node + TS | authenticate the user, exchange tokens, rate limit, proxy SSE | know the tools or the data |
| Agent | Python + Strands | run the agent loop, pick tools, stream | hold a data credential of its own |
| MCP Server | Node + TS | expose tools, authorize every call | invent policy; the API does |
| Corporate API | Python + FastAPI | be the system of record | make authorization decisions |

## Request flow on AWS

![Sinal on AWS — one request end to end](diagrams/aws-request-flow.svg)

The blue path is a request travelling in; the green dashed path is the answer
streaming back over SSE. Each hop only accepts traffic from the hop in front of it —
enforced by a security group per tier in `infra/terraform`, mirroring the k3s
NetworkPolicy in the demo.

## The three identities

This is the heart of the security model and the reason the platform is "not just a
chatbot": there are three distinct identities, and they are never conflated.

![Two tokens, two keys — the exchange](diagrams/token-exchange.svg)

| Identity | Carried by | Verified where |
|---|---|---|
| **User** | session JWT (aud `sinal-bff`) | the BFF |
| **Agent** | the downstream JWT it forwards (aud `sinal-mcp`) — no privileged credential of its own | the agent and the MCP server |
| **Tool** | workload key | the corporate API |

The BFF mints the downstream token per request, re-resolving the user's current scopes
from the directory, so a privilege change takes effect immediately and a stolen
session token cannot reach the MCP server (wrong audience, wrong key, minutes to live).

## How a tool call is authorized

1. **Discovery is filtered by identity.** `tools/list` returns only the tools whose
   scopes the caller's token holds. The model never sees a capability the user cannot
   use, so there is nothing for it to "try".
2. **Every call is re-checked.** `authorizeToolCall` revalidates scope at invocation.
   Guessing a tool name is not enough.
3. **Customer binding is deterministic.** The `customer_id` comes from the token, not
   from a model-produced argument. Reaching another customer requires the `customer:any`
   scope (an attendant grant) and is denied before the API is touched.
4. **Public knowledge is retrieved, not invented.** How-to and policy questions go to
   `search_knowledge_base`, a scope-gated RAG tool that retrieves passages from a vector
   store by cosine similarity (with MMR), so the answer is grounded in a document.
5. **Writes need confirmation.** `open_support_ticket` returns `confirmation_required`
   and performs no side effect until it is called again with `confirmed=true`.

## Streaming

The answer is streamed end to end. The model emits tokens; the agent turns the Strands
event loop into named SSE events (`ready`, `route`, `tool_call`, `token`, `done`); the BFF
forwards those frames without buffering; the browser assembles them. The first token
reaches the user before the turn finishes.

## Model provider is configuration

The agent's model provider is chosen by environment variable — `scripted` for tests
and evaluations (deterministic, no key), `anthropic` for local development, `bedrock`
for production (credentials via IAM role). Switching provider or model version, or
rolling a model back, changes no code.

## Decisions of record

The non-obvious choices are captured as ADRs in `docs/adr/`:

- [ADR-0001](adr/0001-polyglot-boundaries.md) — polyglot services as a security boundary
- [ADR-0002](adr/0002-two-token-exchange.md) — the two-token inbound/outbound split
- [ADR-0003](adr/0003-authorization-outside-the-model.md) — authorization outside the model
- [ADR-0004](adr/0004-scripted-model-baseline.md) — a deterministic model as the eval baseline
- [ADR-0005](adr/0005-k3s-demo-aws-target.md) — k3s for the demo, AWS as the production target
- [ADR-0006](adr/0006-rag-embedder-seam.md) — retrieval with a pluggable embedder
- [ADR-0007](adr/0007-a2a-triage-specialists.md) — agent-to-agent triage and specialists

See also `SECURITY.md`, `OBSERVABILITY.md`, `DEPLOY.md` and `RISKS.md`.
