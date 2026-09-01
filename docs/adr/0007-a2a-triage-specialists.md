# ADR-0007 — Agent-to-agent triage and specialists

**Status:** accepted

## Context

The role calls for A2A and inter-agent communication. One agent holding every tool is
simpler but weaker: it mixes concerns and gives a prompt-injected turn the whole
toolset to abuse.

## Decision

A triage step classifies each request and delegates to a specialist configured with a
focused prompt and a subset of the tools the caller is entitled to (billing, technical,
knowledge, or a general fallback). The specialist runs the turn; which one handled it is
reported to the client in a `route` event and shown in the UI. The triage classifier is
deterministic here and is the seam where an LLM classifier plugs in.

## Consequences

- The A2A pattern is demonstrated: a coordinator delegating to specialists, visible end
  to end.
- It is least privilege at the agent layer: the billing specialist never receives the
  ticket-writing tool, so a prompt-injected billing turn cannot open a ticket — defense
  in depth on top of the MCP scope check.
- The specialist's tools are always intersected with the caller's entitlement, so
  routing can never widen access beyond what the token allows.
- Cost: triage adds a classification step; deterministic here, a cheap model call in
  production (the same model-routing seam used for cost control).
