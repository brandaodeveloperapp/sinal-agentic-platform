# sinal-agent

Conversational agent in Python built on **Strands Agents**. It runs the agent loop,
discovers tools on the MCP Server and streams the answer over SSE.

## Identity: the agent holds no credential of its own

The agent forwards the **end user token** to the MCP Server. It has no privileged
data credential, so there is no path where the agent sees more than the signed-in
user sees.

```
user (JWT) → BFF → agent (forwards the JWT) → MCP (authorizes) → API (workload credential)
```

Three distinct identities: the user (JWT), the agent (workload talking to MCP) and
the tool (workload key talking to the corporate API).

## The model provider is configuration

| `MODEL_PROVIDER` | Use |
|---|---|
| `scripted` | Tests and evaluations. Deterministic, no network, no key. |
| `anthropic` | Local development with `ANTHROPIC_API_KEY`. |
| `bedrock` | Production. Credentials through an IAM role, `BEDROCK_MODEL_ID`. |

Switching provider or model version changes no code. That is what makes a model
rollback an environment variable change.

## Versioned prompt

The prompt lives in `prompts.py` under an explicit version (`PROMPT_VERSION`).
Change the prompt, bump the version, run the evaluation suite against it, and roll
back by pointing the variable at the previous version — no image rebuild.

## Cost control

- `MAX_TOKENS_PER_REQUEST` caps generation.
- `MAX_TOOL_CALLS_PER_TURN` cuts the loop if the model keeps calling tools. The cut
  is deterministic, outside the model decision.
- `MAX_HISTORY_MESSAGES` bounds the context resent on every turn.
- The `done` event returns per-turn `usage` with input and output tokens.

## Streaming

`POST /v1/chat/stream` answers SSE with four events:

| Event | Payload |
|---|---|
| `ready` | visible tools, prompt version, model |
| `tool_call` | name and id of each tool invoked |
| `token` | text fragment |
| `done` | latency, tool calls, `stop_reason`, `usage` |

## Run

```bash
uv venv --python 3.12
uv pip install -e .
uv pip install --group dev
.venv/bin/uvicorn sinal_agent.main:app --port 8083 --reload
```

## Tests

```bash
.venv/bin/python -m pytest
```

26 tests: agent loop, identity forwarding, tool budget, session memory, provider
selection, prompt versioning and the SSE layer (including a failure that leaks no
internal detail).

End-to-end against a real MCP and API: `python infra/smoke/agent-e2e.py`.
