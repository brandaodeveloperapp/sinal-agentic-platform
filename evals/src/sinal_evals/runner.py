"""Run a golden suite against the agent and score each case as a contract.

Each case is graded on structural facts, not on wording: which tool the agent
reached, whether the answer is grounded in the tool output, whether a forbidden
tool or string appeared, and whether the turn stayed inside its cost ceiling. That
makes the score stable across prompt rewrites and model swaps — a passing suite
means behaviour was preserved, a regression means it was not.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

from sinal_agent.config import Settings
from sinal_agent.service import AgentService
from sinal_agent.sessions import SessionStore

from sinal_evals.model import Case, CaseResult, Persona, Suite, SuiteResult


class EvalToolProvider:
    """Serves the MCP tools filtered by a persona's scopes, without a live server.

    The evaluation must exercise the same identity-aware tool set the MCP server
    would expose, so it filters the real tool policy by the persona's scopes and
    backs each tool with the deterministic fixture below.
    """

    def __init__(self, persona: Persona) -> None:
        self.persona = persona
        self.calls: list[str] = []

    @contextlib.contextmanager
    def __call__(self, _token: str, _correlation_id: str, _session_id: str) -> Iterator[list[Any]]:
        from sinal_evals.tools import build_tools

        yield build_tools(self.persona, self.calls)


def _grade(case: Case, result: CaseResult) -> None:
    used = result.tools_used
    text = result.answer.lower()

    for tool in case.expect_tools:
        if tool not in used:
            result.failures.append(f"expected tool {tool!r} was not called (got {used})")
    for tool in case.forbid_tools:
        if tool in used:
            result.failures.append(f"forbidden tool {tool!r} was called")
    for needle in case.must_contain:
        if needle.lower() not in text:
            result.failures.append(f"answer missing required substring {needle!r}")
    for needle in case.forbid_substrings:
        if needle.lower() in text:
            result.failures.append(f"answer contains forbidden substring {needle!r}")
    if case.max_tool_calls is not None and len(used) > case.max_tool_calls:
        result.failures.append(f"used {len(used)} tool calls, ceiling is {case.max_tool_calls}")
    if case.max_total_tokens is not None and result.total_tokens > case.max_total_tokens:
        result.failures.append(
            f"used {result.total_tokens} tokens, ceiling is {case.max_total_tokens}"
        )
    result.passed = not result.failures


async def run_case(suite: Suite, case: Case) -> CaseResult:
    persona = suite.personas[case.persona]
    provider = EvalToolProvider(persona)
    service = AgentService(
        settings=Settings(model_provider="scripted", environment="dev", log_level="critical"),
        sessions=SessionStore(ttl_s=60, max_messages=10),
        tool_provider=provider,
    )

    result = CaseResult(case_id=case.id, category=case.category, passed=False)
    async for event in service.stream_turn(
        message=case.input,
        token="eval-token",
        session_id=f"eval-{case.id}",
        subject=persona.subject,
        correlation_id=f"eval-{case.id}",
    ):
        if event["event"] == "tool_call":
            result.tools_used.append(event["data"]["name"])
        elif event["event"] == "token":
            result.answer += event["data"]["text"]
        elif event["event"] == "done":
            result.total_tokens = int(event["data"].get("usage", {}).get("total_tokens", 0))

    _grade(case, result)
    return result


async def run_suite(suite: Suite) -> SuiteResult:
    results = [await run_case(suite, case) for case in suite.cases]
    return SuiteResult(suite=suite.suite, results=results)
