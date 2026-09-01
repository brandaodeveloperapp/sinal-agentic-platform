import contextlib
import os
from collections.abc import Iterator
from typing import Any

import pytest
from strands import tool

os.environ.setdefault("MODEL_PROVIDER", "scripted")
os.environ.setdefault("LOG_LEVEL", "critical")

from sinal_agent.config import Settings  # noqa: E402
from sinal_agent.service import AgentService  # noqa: E402
from sinal_agent.sessions import SessionStore  # noqa: E402

CALLS: list[dict[str, Any]] = []


@tool
def list_invoices() -> str:
    """Lista as faturas do cliente autenticado."""
    CALLS.append({"tool": "list_invoices"})
    return "3 faturas, 1 em atraso."


@tool
def list_plans() -> str:
    """Lista os planos comercializados."""
    CALLS.append({"tool": "list_plans"})
    return "Onda Pos 50GB por R$ 99,90."


@tool
def open_support_ticket(category: str, summary: str, confirmed: bool = False) -> str:
    """Abre um chamado de suporte apos confirmacao do cliente."""
    CALLS.append({"tool": "open_support_ticket", "confirmed": confirmed})
    if not confirmed:
        return "confirmation_required: confirme com o cliente antes de abrir."
    return "Chamado TCK-4701 aberto."


FAKE_TOOLS = [list_invoices, list_plans, open_support_ticket]


@pytest.fixture(autouse=True)
def _reset_calls() -> Iterator[None]:
    CALLS.clear()
    yield
    CALLS.clear()


@pytest.fixture
def calls() -> list[dict[str, Any]]:
    return CALLS


@pytest.fixture
def settings() -> Settings:
    return Settings(
        model_provider="scripted",
        environment="dev",
        log_level="critical",
        max_tool_calls_per_turn=6,
        session_ttl_s=60,
        max_history_messages=10,
    )


@pytest.fixture
def tool_provider_spy() -> dict[str, Any]:
    return {}


@pytest.fixture
def service(settings: Settings, tool_provider_spy: dict[str, Any]) -> AgentService:
    @contextlib.contextmanager
    def provider(token: str, correlation_id: str, session_id: str) -> Iterator[list[Any]]:
        tool_provider_spy.update(
            {"token": token, "correlation_id": correlation_id, "session_id": session_id}
        )
        yield list(FAKE_TOOLS)

    return AgentService(
        settings=settings,
        sessions=SessionStore(settings.session_ttl_s, settings.max_history_messages),
        tool_provider=provider,
    )


async def collect(service: AgentService, message: str, **overrides: Any) -> list[dict[str, Any]]:
    params = {
        "message": message,
        "token": "token-do-usuario",
        "session_id": "sess-123456",
        "subject": "user-1",
        "correlation_id": "corr-1",
    }
    params.update(overrides)
    return [event async for event in service.stream_turn(**params)]
