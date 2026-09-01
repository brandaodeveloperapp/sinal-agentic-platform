# ADR-0004 — A deterministic model as the evaluation baseline

**Status:** accepted

## Context

Evaluations and CI must be reproducible and must not require an API key or network. A
real model is neither deterministic nor free.

## Decision

Ship a `scripted` model provider that picks a tool by rule and echoes the tool result
without an LLM. It is the default in tests and evaluations; `anthropic` and `bedrock`
run the identical contracts against a real model.

## Consequences

- The golden suite and the whole test matrix run offline and reproducibly in CI.
- The suite grades on structure (which tool, grounded answer, forbidden strings, cost),
  so it is stable across prompt and model changes — the same gate covers all three.
- Cost: the scripted model must be kept in step with the tools it stands in for; a bug
  there was caught by the browser run and is now regression-tested.
