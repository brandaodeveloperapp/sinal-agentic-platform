# ADR-0002 — Two-token inbound/outbound exchange

**Status:** accepted

## Context

The user authenticates at the edge, but the agent and MCP server must also trust the
identity behind a call. Reusing one token everywhere means a token stolen from the
browser reaches the tools directly.

## Decision

The BFF issues a **session token** (audience `sinal-bff`, gateway secret, 30 min) and
exchanges it per request for a **downstream token** (audience `sinal-mcp`, resource
secret, 5 min), re-resolving the user's current scopes from the directory at exchange.

## Consequences

- A session token cannot be replayed against the MCP server — wrong audience, wrong key.
- A leaked downstream token expires in minutes; a privilege change takes effect on the
  next request rather than living out the session.
- Cost: two secrets to manage and keep distinct; the config guard enforces they differ.
