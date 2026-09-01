import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sinal_agent.main import create_app
from sinal_agent.service import BudgetExceededError


class ExplodingService:
    def __init__(self, error: Exception) -> None:
        self.error = error
        self.sessions = None

    async def stream_turn(self, **_: Any):
        yield {"event": "ready", "data": {"tools": []}}
        raise self.error


def parse_sse(body: str) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    name = None
    for line in body.splitlines():
        if line.startswith("event:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("data:") and name:
            events.append((name, json.loads(line.split(":", 1)[1].strip())))
    return events


@pytest.fixture
def client(service) -> TestClient:
    return TestClient(create_app(service))


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_diagnostics_exposes_prompt_and_model_without_secrets(client):
    body = client.get("/v1/diagnostics").json()
    assert body["prompt_version"] == "v1"
    assert body["provider"] == "scripted"
    assert "anthropic_api_key" not in body


def test_stream_requires_a_bearer_token(client):
    response = client.post(
        "/v1/chat/stream", json={"message": "hello", "session_id": "sess-000001"}
    )
    assert response.status_code == 401


def test_stream_rejects_a_non_bearer_authorization(client):
    response = client.post(
        "/v1/chat/stream",
        json={"message": "hello", "session_id": "sess-000001"},
        headers={"authorization": "Basic abc"},
    )
    assert response.status_code == 401


def test_stream_validates_the_payload(client):
    response = client.post(
        "/v1/chat/stream",
        json={"message": "", "session_id": "short"},
        headers={"authorization": "Bearer t"},
    )
    assert response.status_code == 422


def test_stream_emits_the_full_event_sequence(client):
    response = client.post(
        "/v1/chat/stream",
        json={"message": "I want to see my invoice", "session_id": "sess-000001"},
        headers={"authorization": "Bearer end-user-token", "x-correlation-id": "corr-http"},
    )
    assert response.status_code == 200
    assert response.headers["x-correlation-id"] == "corr-http"

    events = parse_sse(response.text)
    names = [name for name, _ in events]
    assert names[0] == "ready"
    assert "tool_call" in names
    assert "token" in names
    assert names[-1] == "done"

    text = "".join(data["text"] for name, data in events if name == "token")
    assert text == "3 invoices, 1 overdue."


def test_budget_error_closes_the_stream_cleanly():
    client = TestClient(create_app(ExplodingService(BudgetExceededError("limite"))))
    response = client.post(
        "/v1/chat/stream",
        json={"message": "hello", "session_id": "sess-000002"},
        headers={"authorization": "Bearer t"},
    )
    events = parse_sse(response.text)
    assert events[-1][0] == "done"
    assert events[-1][1]["stop_reason"] == "budget_exceeded"


def test_unexpected_failure_does_not_leak_details():
    client = TestClient(
        create_app(ExplodingService(RuntimeError("connection refused to 10.0.0.5")))
    )
    response = client.post(
        "/v1/chat/stream",
        json={"message": "hello", "session_id": "sess-000003"},
        headers={"authorization": "Bearer t"},
    )
    events = parse_sse(response.text)
    error = next(data for name, data in events if name == "error")
    assert error["code"] == "agent_failure"
    assert "10.0.0.5" not in json.dumps(events)
