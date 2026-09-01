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
    events = await collect(service, "hello")
    ready = events_of(events, "ready")[0]
    assert ready["tools"] == ["list_invoices", "list_plans", "open_support_ticket"]
    assert ready["prompt_version"] == "v1"
    assert ready["provider"] == "scripted"


async def test_end_user_token_is_forwarded_to_the_tool_layer(service, tool_provider_spy):
    await collect(service, "hello", token="customer-jwt")
    assert tool_provider_spy["token"] == "customer-jwt"
    assert tool_provider_spy["correlation_id"] == "corr-1"
    assert tool_provider_spy["session_id"] == "sess-123456"


async def test_invoice_question_calls_the_invoice_tool(service, calls):
    events = await collect(service, "I want to see my invoice")
    assert [call["tool"] for call in calls] == ["list_invoices"]
    assert events_of(events, "tool_call")[0]["name"] == "list_invoices"


async def test_streams_text_tokens_before_finishing(service):
    events = await collect(service, "I want to see my invoice")
    tokens = events_of(events, "token")
    assert tokens
    assert "".join(token["text"] for token in tokens) == "3 invoices, 1 overdue."


async def test_done_event_reports_usage_and_cost_inputs(service):
    events = await collect(service, "which plans do you have")
    done = events_of(events, "done")[0]
    assert done["tool_calls"] == 1
    assert done["usage"]["total_tokens"] > 0
    assert done["latency_ms"] >= 0
    assert done["model_id"] == "scripted"


async def test_write_tool_is_never_auto_confirmed(service, calls):
    await collect(service, "I want to open a ticket")
    ticket_calls = [call for call in calls if call["tool"] == "open_support_ticket"]
    assert ticket_calls
    assert all(call["confirmed"] is False for call in ticket_calls)


async def test_history_is_kept_between_turns(service):
    await collect(service, "which plans do you have")
    await collect(service, "and the invoice")
    session = service.sessions.get("sess-123456", "user-1")
    assert len(session.messages) >= 2


async def test_history_is_not_shared_between_subjects(service):
    await collect(service, "which plans do you have")
    await collect(service, "which plans do you have", subject="another-user")
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
            message="I want to see my invoice",
            token="t",
            session_id="sess-budget",
            subject="user-1",
            correlation_id="corr-2",
        ):
            collected.append(event)

    assert collected[-1]["event"] == "error"
    assert collected[-1]["data"]["code"] == "tool_budget_exceeded"


async def test_second_question_does_not_reuse_the_previous_tool_result(service, calls):
    await collect(service, "I want to see my invoice")
    events = await collect(service, "I want to open a ticket")

    tools_used = [call["tool"] for call in calls]
    assert tools_used == ["list_invoices", "open_support_ticket"]
    answer = "".join(event["data"]["text"] for event in events if event["event"] == "token")
    assert "confirmation_required" in answer


async def test_third_turn_still_routes_to_the_right_tool(service, calls):
    await collect(service, "I want to see my invoice")
    await collect(service, "which plans do you have")
    await collect(service, "I want to see my invoice")
    assert [call["tool"] for call in calls] == ["list_invoices", "list_plans", "list_invoices"]


async def test_route_event_names_the_specialist_and_its_tools(service):
    events = await collect(service, "I want to see my invoice")
    route = events_of(events, "route")[0]
    assert route["specialist"] == "billing"
    assert "list_invoices" in route["tools"]
    assert "open_support_ticket" not in route["tools"]


async def test_ready_still_reports_the_full_entitlement(service):
    events = await collect(service, "I want to see my invoice")
    ready = events_of(events, "ready")[0]
    assert set(ready["tools"]) == {"list_invoices", "list_plans", "open_support_ticket"}


async def test_ticket_turn_routes_to_technical_specialist(service):
    events = await collect(service, "I want to open a ticket")
    route = events_of(events, "route")[0]
    assert route["specialist"] == "technical"
    assert "open_support_ticket" in route["tools"]
