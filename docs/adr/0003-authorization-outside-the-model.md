# ADR-0003 — Authorization outside the model

**Status:** accepted

## Context

A language model is probabilistic. Any rule expressed only as a prompt instruction can
be talked around, especially under prompt injection.

## Decision

Authorization lives in code in the MCP server, never in the prompt: tool discovery is
filtered by the caller's scopes, every call is re-checked, the customer id is bound from
the token (not a model argument), ownership is re-verified on resource tools, and writes
require an explicit confirmation. The agent forwards the user's own token, so a call is
always bounded by what that user may do.

## Consequences

- Prompt injection cannot escalate authority; the worst it does is waste a turn.
- The prompt is advisory; correctness does not depend on the model obeying it.
- Cost: the write confirmation is still a model-set flag today; a server-issued nonce is
  the tracked next step.
