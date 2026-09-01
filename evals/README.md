# sinal-evals

Golden-set evaluation and regression gate for the agent. This is how a change to a
**prompt, a tool or the model** is tested: not by eyeballing one answer, but by
running a suite of behavioural contracts and comparing against a blessed baseline.

## Why it is stable across prompt and model changes

Each case grades on structural facts, never on wording:

- **which tool** the agent reached (`expect_tools` / `forbid_tools`)
- whether the answer is **grounded** in the tool output (`must_contain`)
- whether anything **forbidden** leaked (`forbid_substrings`)
- whether the turn stayed inside its **cost ceiling** (`max_tool_calls`, `max_total_tokens`)

A prompt rewrite that keeps behaviour keeps the score. A rewrite that breaks routing,
grounding, authorization or cost shows up as a failed case — that is the regression
signal.

## The suite

`golden/telecom_support.yaml` — 14 cases across six categories:

| Category | What it pins |
|---|---|
| tool_routing | the right capability is chosen for each question, and none for small talk |
| grounding | figures in the answer come from the tool, not invented |
| authorization | a scope-limited persona cannot reach billing, but still sees the catalogue |
| human_in_the_loop | a ticket is never opened without confirmation |
| safety | injection in the user message and injection stored in a ticket are both neutralized |
| cost | the turn stays under its tool-call and token ceilings |

Personas carry scopes and a customer binding, so authorization is part of the grade:
the same suite proves a subscriber and a scope-limited caller behave differently.

## Run

```bash
uv venv --python 3.12 && uv pip install -e . && uv pip install --group dev
python -m sinal_evals.cli run     # scorecard
python -m sinal_evals.cli bless   # save the current result as the baseline
python -m sinal_evals.cli gate    # fail if any blessed case regressed
```

`gate` is what CI runs: it fails the build if a case that used to pass now fails, or
if the overall pass rate drops below the baseline. Prompt and model are configuration
(`PROMPT_VERSION`, `MODEL_PROVIDER`), so the same gate covers a prompt edit, a tool
change and a model swap.

## Baseline

`baselines/telecom_support.json` is the blessed result (14/14). Re-bless deliberately
when you add cases or intend a behaviour change; never to paper over a regression.

## Model under test

The suite runs against the deterministic `scripted` provider, so it needs no API key
and is reproducible in CI. Pointing `MODEL_PROVIDER` at `anthropic` or `bedrock` runs
the identical contracts against a real model.
