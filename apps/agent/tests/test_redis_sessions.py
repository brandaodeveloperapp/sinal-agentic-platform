from sinal_agent.redis_sessions import RedisSessionStore
from sinal_agent.sessions import Session


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def get(self, key: str):
        return self.store.get(key)

    def set(self, key: str, value: str, px: int | None = None):
        self.store[key] = value

    def delete(self, key: str):
        self.store.pop(key, None)


def test_round_trips_history_through_redis():
    store = RedisSessionStore(FakeRedis(), ttl_s=60, max_messages=5)
    session = store.get("s1", "user-1")
    assert session.messages == []
    store.save(session, [{"role": "user", "content": [{"text": "hi"}]}])
    again = store.get("s1", "user-1")
    assert len(again.messages) == 1


def test_windows_the_history():
    store = RedisSessionStore(FakeRedis(), ttl_s=60, max_messages=3)
    session = store.get("s1", "user-1")
    store.save(session, [{"role": "user", "content": [{"text": str(i)}]} for i in range(10)])
    assert len(store.get("s1", "user-1").messages) == 3


def test_never_returns_another_subjects_history():
    redis = FakeRedis()
    store = RedisSessionStore(redis, ttl_s=60, max_messages=5)
    session = store.get("shared-id", "user-1")
    store.save(session, [{"role": "user", "content": [{"text": "secret"}]}])
    # a different subject reusing the same session id gets a fresh, empty session
    other = store.get("shared-id", "user-2")
    assert other.messages == []


def test_drop_removes_the_session():
    redis = FakeRedis()
    store = RedisSessionStore(redis, ttl_s=60, max_messages=5)
    session = store.get("s1", "user-1")
    store.save(session, [{"role": "user", "content": [{"text": "hi"}]}])
    store.drop("s1")
    assert store.get("s1", "user-1").messages == []


def test_builder_falls_back_to_memory_without_redis_url():
    from sinal_agent.config import Settings
    from sinal_agent.main import _build_sessions
    from sinal_agent.sessions import SessionStore

    store = _build_sessions(Settings(redis_url=""))
    assert isinstance(store, SessionStore)


def _mk_session() -> Session:
    return Session(session_id="s", subject="u")
