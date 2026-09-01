import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("API_KEYS", "test-key")
os.environ.setdefault("LATENCY_FLOOR_MS", "0")
os.environ.setdefault("LATENCY_CEILING_MS", "0")

from sinal_api.main import app  # noqa: E402

AUTH = {"x-api-key": "test-key", "x-acting-user": "tester"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth() -> dict[str, str]:
    return dict(AUTH)
