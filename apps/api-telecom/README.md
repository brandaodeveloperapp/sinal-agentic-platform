# sinal-api-telecom

Corporate REST API of the fictional carrier Onda Telecom. It is the system of record
behind the MCP tools — the agent never calls it directly.

## Run

```bash
uv venv --python 3.12
uv pip install -e .
uv pip install --group dev
.venv/bin/uvicorn sinal_api.main:app --port 8081 --reload
```

Interactive docs at `http://localhost:8081/docs`.

## Authentication

The API accepts only a **workload credential** (`x-api-key`), never an end user
token. The user identity travels in `x-acting-user` for auditing only: the
authorization decision happens in the MCP layer, before the call is made.

## Fault injection

Outside production, the `x-simulate-fault` header forces the behaviours used by the
resilience tests of the MCP client:

| Value | Effect |
|---|---|
| `timeout` | Holds the response for 30s |
| `server-error` | Returns 502 |
| `rate-limit` | Returns 429 with `Retry-After` |

## Contract

`python scripts/export_openapi.py` regenerates
`packages/contracts/openapi/onda-telecom.openapi.json`, consumed by the contract
tests of the MCP Server.

## Tests

```bash
.venv/bin/python -m pytest
```
