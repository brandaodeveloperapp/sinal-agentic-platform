# Observability

The goal is to answer, for any single conversation, "what did the platform do and what
did it cost" — from the click in the browser to the corporate API and back — without
guessing.

## One id across the whole chain

A `correlation_id` is created at the edge (or accepted from the client if it matches a
safe charset) and travels as a header through every hop: BFF → agent → MCP → API. A
`session_id` rides alongside it. Both are attached to every structured log line in every
service, so a single request can be reconstructed across four processes and two
languages by filtering on one value.

The browser sends `x-correlation-id`; the BFF echoes it back on the response and
forwards it onward; the smoke test asserts the same id appears at the agent and in the
response header (`correlation id survives the whole chain`).

## Structured logs

Every service logs JSON — pino in the Node services, python-json-logger in the Python
ones — with a shared shape:

```json
{
  "timestamp": "...",
  "level": "info",
  "service": "sinal-mcp-server",
  "environment": "hom",
  "correlation_id": "…",
  "session_id": "…",
  "tool": "list_invoices",
  "outcome": "success",
  "latency_ms": 42
}
```

Secrets and tokens are never logged; the Node logger redacts `authorization` and
key-like fields, and auth failures log only the reason string, never the token.

## What is traced per layer

| Layer | Emits |
|---|---|
| Web | the turn it started, the tools it was offered, the per-turn cost it received |
| BFF | login outcome, rate-limit decisions, the SSE proxy lifecycle, correlation id |
| Agent | turn start/end, available tools, tool-call count, `stop_reason`, token usage, model id and prompt version |
| MCP | every tool call with outcome, error code, actor, channel and latency |
| API | every HTTP request with method, path, status and latency |

The agent attaches trace attributes (`session.id`, `user.id`, `correlation.id`,
`prompt.version`) to the Strands loop, so a trace carries the identity, the prompt
version and the model that produced it.

## Cost is a first-class signal

The `done` event of every turn carries `usage` (input, output and total tokens) plus
latency and `stop_reason`. That number is:

- shown to the user under each answer,
- logged with the turn,
- and available to a dashboard as the per-request cost of the model.

Because the agent also enforces a token ceiling and a tool-call ceiling per turn, the
cost of a runaway or injected conversation is bounded, and the ceiling being hit is
itself a logged event.

## On AWS

The same JSON logs land in **CloudWatch Logs** (one log group per service, declared in
`infra/terraform`). Distributed tracing is emitted via **OpenTelemetry**; in production
an **ADOT Collector** sidecar ships spans, and the `trace_id` lines up with the
`correlation_id` carried in the logs. Metrics of interest — latency, tokens, tool
failures, retries, timeouts, rate-limit hits — are CloudWatch metrics derived from the
structured fields above.

## How you would investigate an incident

1. Take the `correlation_id` from the user's failed turn (it is in the response header
   and the UI's error path).
2. Filter every service's log group on it — you now have the full path of that one
   request across the four services in order.
3. The failing hop shows its `outcome`, `error_code` and `latency_ms`; the tool call
   that failed shows which tool and why, without any secret or customer detail.
4. The turn's `usage` and `stop_reason` tell you whether it was a cost, a timeout, an
   authorization denial or an upstream fault.
