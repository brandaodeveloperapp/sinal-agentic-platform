# Security findings

Tracks findings from the red-team passes over this repository. Each entry is a real,
code-anchored issue with a fix — not generic advice.

## Live harness

`security/redteam/attack.mjs` runs 24 attacks against the running stack.
Result: **24/24 refused**. See `security/redteam/README.md`.

## Static audit

Three static red-team passes reviewed the code in parallel:

1. Auth and token layer (BFF + MCP + corporate API credential)
2. MCP tool-authorization layer
3. Gateway, streaming proxy, agent loop and web client

Confirmed findings and their fixes are recorded below.

### Findings

_(populated from the static passes; only code-anchored, confirmed items are kept)_
