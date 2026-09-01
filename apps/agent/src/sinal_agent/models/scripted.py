"""Deterministic model provider.

It exists for two reasons: running the test suite and the evaluations without
depending on a credential or on the network, and giving prompt and tool regression
tests a reproducible baseline.
"""

import json
import re
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import Any, TypeVar

from strands.models.model import Model

T = TypeVar("T")


@dataclass
class ScriptedRule:
    """Maps a pattern in the user message to the tool expected for it."""

    pattern: str
    tool_name: str
    tool_input: dict[str, Any] = field(default_factory=dict)


DEFAULT_RULES: list[ScriptedRule] = [
    ScriptedRule(r"\b(invoice|bill|billing|charge)", "list_invoices"),
    ScriptedRule(r"\b(usage|data|internet|gb)\b", "get_line_usage", {"msisdn": "5511970001001"}),
    ScriptedRule(r"\b(plan|plans|package)\b", "list_plans"),
    ScriptedRule(
        r"\b(ticket|complaint|open)\b",
        "open_support_ticket",
        {"category": "billing", "summary": "Customer reports a mismatch on the invoice"},
    ),
    ScriptedRule(r"\b(line|lines|number)\b", "list_customer_lines"),
]

FALLBACK_TEXT = "I can help with plans, usage, invoices and support tickets. What do you need?"


class ScriptedModel(Model):
    """Model that picks a tool by rule and echoes the tool result without an LLM."""

    def __init__(
        self,
        rules: list[ScriptedRule] | None = None,
        config: dict[str, Any] | None = None,
    ) -> None:
        self.rules = rules if rules is not None else DEFAULT_RULES
        self._config: dict[str, Any] = config or {"model_id": "scripted", "max_tokens": 4096}

    def update_config(self, **model_config: Any) -> None:
        self._config.update(model_config)

    def get_config(self) -> dict[str, Any]:
        return self._config

    async def structured_output(
        self, output_model: type[T], prompt: Any, system_prompt: str | None = None, **kwargs: Any
    ) -> AsyncGenerator[dict[str, Any], None]:
        yield {"output": output_model()}

    async def stream(
        self,
        messages: list[dict[str, Any]],
        tool_specs: list[dict[str, Any]] | None = None,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[dict[str, Any], None]:
        tool_results = _collect_tool_results(messages)
        available = {spec["name"] for spec in (tool_specs or [])}

        if tool_results:
            async for event in self._emit_text(_summarize(tool_results)):
                yield event
            return

        rule = self._match(_last_user_text(messages))
        if rule is None or rule.tool_name not in available:
            async for event in self._emit_text(FALLBACK_TEXT):
                yield event
            return

        async for event in self._emit_tool_use(rule):
            yield event

    def _match(self, text: str) -> ScriptedRule | None:
        lowered = text.lower()
        for rule in self.rules:
            if re.search(rule.pattern, lowered):
                return rule
        return None

    async def _emit_text(self, text: str) -> AsyncGenerator[dict[str, Any], None]:
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockStart": {"contentBlockIndex": 0, "start": {}}}
        for chunk in _chunks(text):
            yield {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": chunk}}}
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "end_turn"}}
        yield _usage_event(len(text))

    async def _emit_tool_use(self, rule: ScriptedRule) -> AsyncGenerator[dict[str, Any], None]:
        payload = json.dumps(rule.tool_input)
        yield {"messageStart": {"role": "assistant"}}
        yield {
            "contentBlockStart": {
                "contentBlockIndex": 0,
                "start": {
                    "toolUse": {"name": rule.tool_name, "toolUseId": f"scripted-{rule.tool_name}"}
                },
            }
        }
        yield {
            "contentBlockDelta": {"contentBlockIndex": 0, "delta": {"toolUse": {"input": payload}}}
        }
        yield {"contentBlockStop": {"contentBlockIndex": 0}}
        yield {"messageStop": {"stopReason": "tool_use"}}
        yield _usage_event(len(payload))


def _usage_event(output_size: int) -> dict[str, Any]:
    output_tokens = max(1, output_size // 4)
    return {
        "metadata": {
            "usage": {
                "inputTokens": 120,
                "outputTokens": output_tokens,
                "totalTokens": 120 + output_tokens,
            },
            "metrics": {"latencyMs": 1},
        }
    }


def _chunks(text: str, size: int = 24) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)] or [""]


def _last_user_text(messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        parts = [block.get("text", "") for block in message.get("content", []) if "text" in block]
        if parts:
            return " ".join(parts)
    return ""


def _collect_tool_results(messages: list[dict[str, Any]]) -> list[str]:
    results: list[str] = []
    for message in messages:
        for block in message.get("content", []):
            tool_result = block.get("toolResult")
            if not tool_result:
                continue
            for part in tool_result.get("content", []):
                if "text" in part:
                    results.append(part["text"])
    return results


def _summarize(tool_results: list[str]) -> str:
    readable = [item for item in tool_results if not item.strip().startswith("{")]
    return readable[-1] if readable else tool_results[-1][:280]
