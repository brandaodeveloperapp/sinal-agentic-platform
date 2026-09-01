# ADR-0001 — Polyglot services as a security boundary

**Status:** accepted

## Context

The case asks how agent, tool, MCP and API are separated. A monolith, or even a single
language with shared modules, makes that separation a matter of discipline — one import
away from being violated.

## Decision

Each layer is a separate process in a different runtime: React/TS web, Node/TS gateway,
Python/Strands agent, Node/TS MCP server, Python/FastAPI corporate API. They talk only
over HTTP contracts.

## Consequences

- Coupling is impossible by construction; the boundary is physical, not conventional.
- The job requires TS, Node, Python and React — the split exercises all of them honestly.
- Cost: more moving parts to run and deploy. Mitigated by one compose file and one k8s
  namespace, and it is exactly the shape ECS Fargate expects.
