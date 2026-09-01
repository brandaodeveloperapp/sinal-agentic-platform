"""Agent orchestration: builds the loop, connects to MCP and emits streaming events."""

import contextlib
import logging
import time
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from typing import Any

from strands import Agent

from sinal_agent.config import Settings
from sinal_agent.models import build_model, describe_model
from sinal_agent.observability import CORRELATION_HEADER, SESSION_HEADER
from sinal_agent.prompts import system_prompt
from sinal_agent.sessions import SessionStore
from sinal_agent.specialists import triage

logger = logging.getLogger("sinal.agent")

ToolProvider = Callable[[str, str, str], "contextlib.AbstractContextManager[list[Any]]"]


@dataclass
class TurnBudget:
    """Per-turn cost ceiling, enforced outside the model decision."""

    max_tool_calls: int
    max_tokens: int

    def exceeded_tool_calls(self, used: int) -> bool:
        return used > self.max_tool_calls


class BudgetExceededError(RuntimeError):
    """Turn aborted for exceeding the tool call ceiling."""


@contextlib.contextmanager
def mcp_tool_provider(
    settings: Settings, token: str, correlation_id: str, session_id: str
) -> Iterator[list[Any]]:
    """Open an MCP session carrying the end user identity.

    The agent holds no data credential of its own: it forwards the token of whoever
    is talking. Authorization happens in the MCP Server, which only returns the tools
    allowed for that identity.
    """
    from strands.tools.mcp import MCPClient

    client = MCPClient(
        url=settings.mcp_server_url,
        headers={
            "authorization": f"Bearer {token}",
            CORRELATION_HEADER: correlation_id,
            SESSION_HEADER: session_id,
        },
        startup_timeout=settings.mcp_startup_timeout_s,
    )
    with client:
        yield client.list_tools_sync()


class AgentService:
    """Run one conversation turn and translate the agent loop into events."""

    def __init__(
        self,
        settings: Settings,
        sessions: SessionStore,
        tool_provider: ToolProvider | None = None,
    ) -> None:
        self.settings = settings
        self.sessions = sessions
        self.model = build_model(settings)
        self.model_info = describe_model(settings)
        self.instructions = system_prompt(settings.prompt_version)
        self._tool_provider = tool_provider or (
            lambda token, correlation_id, session_id: mcp_tool_provider(
                settings, token, correlation_id, session_id
            )
        )

    async def stream_turn(
        self,
        *,
        message: str,
        token: str,
        session_id: str,
        subject: str,
        correlation_id: str,
    ) -> AsyncIterator[dict[str, Any]]:
        started = time.perf_counter()
        session = self.sessions.get(session_id, subject)
        budget = TurnBudget(
            max_tool_calls=self.settings.max_tool_calls_per_turn,
            max_tokens=self.settings.max_tokens_per_request,
        )
        tool_calls = 0
        announced: set[str] = set()

        with self._tool_provider(token, correlation_id, session_id) as tools:
            tool_names = [getattr(tool, "tool_name", str(tool)) for tool in tools]

            # Triage routes the turn to a specialist configured with a focused prompt and
            # a subset of the tools the caller is entitled to. `ready` reports the full
            # entitlement; `route` reports the specialist and the tools it will use.
            specialist = triage(message)
            specialist_tool_names = specialist.allowed(tool_names)
            specialist_tools = [
                tool
                for tool in tools
                if getattr(tool, "tool_name", str(tool)) in specialist_tool_names
            ]

            logger.info(
                "turn_started",
                extra={
                    "available_tools": tool_names,
                    "specialist": specialist.name,
                    "specialist_tools": specialist_tool_names,
                    "prompt_version": self.settings.prompt_version,
                    **self.model_info,
                },
            )
            yield {
                "event": "ready",
                "data": {
                    "tools": tool_names,
                    "prompt_version": self.settings.prompt_version,
                    **self.model_info,
                },
            }
            yield {
                "event": "route",
                "data": {"specialist": specialist.name, "tools": specialist_tool_names},
            }

            agent = Agent(
                model=self.model,
                tools=specialist_tools,
                system_prompt=f"{self.instructions}\n\n{specialist.instructions}",
                messages=list(session.messages),
                callback_handler=None,
                trace_attributes={
                    "session.id": session_id,
                    "user.id": subject,
                    "correlation.id": correlation_id,
                    "prompt.version": self.settings.prompt_version,
                    "specialist": specialist.name,
                },
            )

            usage: dict[str, Any] = {}
            stop_reason = "end_turn"

            async for event in agent.stream_async(message):
                text = event.get("data")
                if text:
                    yield {"event": "token", "data": {"text": text}}

                current_tool = event.get("current_tool_use") or {}
                tool_use_id = current_tool.get("toolUseId") or (
                    f"pos-{len(announced)}" if current_tool.get("name") else None
                )
                if tool_use_id and tool_use_id not in announced:
                    announced.add(tool_use_id)
                    tool_calls += 1
                    if budget.exceeded_tool_calls(tool_calls):
                        logger.warning(
                            "tool_budget_exceeded",
                            extra={"tool_calls": tool_calls, "limit": budget.max_tool_calls},
                        )
                        yield {
                            "event": "error",
                            "data": {
                                "code": "tool_budget_exceeded",
                                "message": "Tool call limit reached for this turn.",
                            },
                        }
                        raise BudgetExceededError(tool_use_id)
                    yield {
                        "event": "tool_call",
                        "data": {"name": current_tool.get("name"), "id": tool_use_id},
                    }

                result = event.get("result")
                if result is not None:
                    usage = _extract_usage(result)
                    stop_reason = getattr(result, "stop_reason", stop_reason)

            self.sessions.save(session, list(agent.messages))

        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        logger.info(
            "turn_completed",
            extra={
                "latency_ms": elapsed_ms,
                "tool_calls": tool_calls,
                "stop_reason": stop_reason,
                **self.model_info,
                **{f"usage_{k}": v for k, v in usage.items()},
            },
        )
        yield {
            "event": "done",
            "data": {
                "latency_ms": elapsed_ms,
                "tool_calls": tool_calls,
                "stop_reason": stop_reason,
                "usage": usage,
                **self.model_info,
            },
        }


def _extract_usage(result: Any) -> dict[str, Any]:
    metrics = getattr(result, "metrics", None)
    usage = getattr(metrics, "accumulated_usage", None) if metrics else None
    if not usage:
        return {}
    return {
        "input_tokens": usage.get("inputTokens", 0),
        "output_tokens": usage.get("outputTokens", 0),
        "total_tokens": usage.get("totalTokens", 0),
    }
