import contextlib
from collections.abc import Iterator
from typing import Any

import pytest

from sinal_agent.config import Settings
from sinal_agent.service import AgentService, BudgetExceededError
from sinal_agent.sessions import SessionStore
from tests.conftest import FAKE_TOOLS, collect


def events_of(events: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [event["data"] for event in events if event["event"] == name]


async def test_turn_announces_available_tools(service):
    events = await collect(service, "oi")
    ready = events_of(events, "ready")[0]
    assert ready["tools"] == ["list_invoices", "list_plans", "open_support_ticket"]
    assert ready["prompt_version"] == "v1"
    assert ready["provider"] == "scripted"


async def test_end_user_token_is_forwarded_to_the_tool_layer(service, tool_provider_spy):
    await collect(service, "oi", token="jwt-do-cliente")
    assert tool_provider_spy["token"] == "jwt-do-cliente"
    assert tool_provider_spy["correlation_id"] == "corr-1"
    assert tool_provider_spy["session_id"] == "sess-123456"


async def test_invoice_question_calls_the_invoice_tool(service, calls):
    events = await collect(service, "quero ver minha fatura")
    assert [call["tool"] for call in calls] == ["list_invoices"]
    assert events_of(events, "tool_call")[0]["name"] == "list_invoices"


async def test_streams_text_tokens_before_finishing(service):
    events = await collect(service, "quero ver minha fatura")
    tokens = events_of(events, "token")
    assert tokens
    assert "".join(token["text"] for token in tokens) == "3 faturas, 1 em atraso."


async def test_done_event_reports_usage_and_cost_inputs(service):
    events = await collect(service, "quais os planos")
    done = events_of(events, "done")[0]
    assert done["tool_calls"] == 1
    assert done["usage"]["total_tokens"] > 0
    assert done["latency_ms"] >= 0
    assert done["model_id"] == "scripted"


async def test_write_tool_is_never_auto_confirmed(service, calls):
    await collect(service, "quero abrir um chamado")
    ticket_calls = [call for call in calls if call["tool"] == "open_support_ticket"]
    assert ticket_calls
    assert all(call["confirmed"] is False for call in ticket_calls)


async def test_history_is_kept_between_turns(service):
    await collect(service, "quais os planos")
    await collect(service, "e a fatura")
    session = service.sessions.get("sess-123456", "user-1")
    assert len(session.messages) >= 2


async def test_history_is_not_shared_between_subjects(service):
    await collect(service, "quais os planos")
    await collect(service, "quais os planos", subject="outro-usuario")
    session = service.sessions.get("sess-123456", "user-1")
    assert session.messages == []


async def test_tool_budget_stops_the_turn(settings, tool_provider_spy):
    @contextlib.contextmanager
    def provider(token: str, correlation_id: str, session_id: str) -> Iterator[list[Any]]:
        yield list(FAKE_TOOLS)

    limited = Settings(**{**settings.model_dump(), "max_tool_calls_per_turn": 0})
    service = AgentService(
        settings=limited,
        sessions=SessionStore(60, 10),
        tool_provider=provider,
    )

    collected: list[dict[str, Any]] = []
    with pytest.raises(BudgetExceededError):
        async for event in service.stream_turn(
            message="quero ver minha fatura",
            token="t",
            session_id="sess-budget",
            subject="user-1",
            correlation_id="corr-2",
        ):
            collected.append(event)

    assert collected[-1]["event"] == "error"
    assert collected[-1]["data"]["code"] == "tool_budget_exceeded"
