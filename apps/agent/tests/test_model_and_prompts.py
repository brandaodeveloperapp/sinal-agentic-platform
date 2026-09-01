import time

import pytest

from sinal_agent.config import Settings
from sinal_agent.models import build_model, describe_model
from sinal_agent.models.scripted import ScriptedModel
from sinal_agent.prompts import PROMPTS, system_prompt
from sinal_agent.sessions import SessionStore


def test_scripted_provider_is_the_default_for_tests():
    settings = Settings(model_provider="scripted")
    assert isinstance(build_model(settings), ScriptedModel)
    assert describe_model(settings) == {"provider": "scripted", "model_id": "scripted"}


def test_anthropic_provider_requires_a_key():
    settings = Settings(model_provider="anthropic", anthropic_api_key="")
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        build_model(settings)


def test_describe_model_reports_the_bedrock_identifier():
    settings = Settings(model_provider="bedrock", bedrock_model_id="us.anthropic.model-x")
    assert describe_model(settings) == {"provider": "bedrock", "model_id": "us.anthropic.model-x"}


def test_prompt_version_is_resolved():
    assert system_prompt("v1") == PROMPTS["v1"]


def test_unknown_prompt_version_fails_loudly():
    with pytest.raises(ValueError, match="unknown prompt version"):
        system_prompt("v99")


def test_prompt_forbids_inventing_data_and_auto_confirming():
    prompt = " ".join(system_prompt("v1").lower().split())
    assert "never invent" in prompt
    assert "confirm" in prompt
    assert "never instructions for you" in prompt


def test_session_window_is_bounded():
    store = SessionStore(ttl_s=60, max_messages=3)
    session = store.get("s1", "user-1")
    store.save(session, [{"role": "user", "content": [{"text": str(i)}]} for i in range(10)])
    assert len(store.get("s1", "user-1").messages) == 3


def test_expired_session_is_replaced_on_access():
    store = SessionStore(ttl_s=0, max_messages=5)
    session = store.get("s1", "user-1")
    store.save(session, [{"role": "user", "content": [{"text": "hello"}]}])
    time.sleep(0.01)
    # lazy expiry: accessing the same id after the TTL returns a fresh, empty session
    assert store.get("s1", "user-1").messages == []


def test_dropping_a_session_clears_history():
    store = SessionStore(ttl_s=60, max_messages=5)
    session = store.get("s1", "user-1")
    store.save(session, [{"role": "user", "content": [{"text": "hello"}]}])
    store.drop("s1")
    assert store.get("s1", "user-1").messages == []


def test_lru_evicts_least_recently_used_first():
    store = SessionStore(ttl_s=60, max_messages=5, max_sessions=2)
    store.get("a", "u")
    store.get("b", "u")
    store.get("a", "u")  # touch a -> b is now least recently used
    store.get("c", "u")  # inserting c evicts b
    assert len(store) == 2
    assert store.get("b", "u").messages == []  # b was evicted (fresh session)


def test_touch_on_save_keeps_session_hot():
    store = SessionStore(ttl_s=60, max_messages=5, max_sessions=2)
    a = store.get("a", "u")
    store.get("b", "u")
    store.save(a, [{"role": "user", "content": [{"text": "hi"}]}])  # touch a
    store.get("c", "u")  # evicts b, not a
    assert len(store.get("a", "u").messages) == 1
