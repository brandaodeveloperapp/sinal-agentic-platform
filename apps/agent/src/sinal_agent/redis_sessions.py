"""Redis-backed short-term session memory.

Same contract as the in-memory ``SessionStore``, so the service does not care which
one it is handed. With more than one agent replica the conversation history has to be
shared, and Redis is where it lives. It is deliberately still short-term: the key
carries the message window and expires with a TTL; no long-term memory is kept, and
customer data still comes from a tool at question time, never from here.

A synchronous Redis client is used on purpose — a turn already makes blocking calls to
the MCP server — so the store keeps the same synchronous interface and needs no async
ripple through the service or the tests.
"""

import json
from typing import Any, Protocol

from sinal_agent.sessions import Session


class RedisLike(Protocol):
    def get(self, key: str) -> Any: ...
    def set(self, key: str, value: str, px: int | None = ...) -> Any: ...
    def delete(self, key: str) -> Any: ...


class RedisSessionStore:
    """Session history stored in Redis under a TTL, keyed by session id."""

    def __init__(
        self,
        redis: RedisLike,
        ttl_s: int,
        max_messages: int,
        prefix: str = "sinal:session",
    ) -> None:
        self.redis = redis
        self.ttl_s = ttl_s
        self.max_messages = max_messages
        self.prefix = prefix

    def _key(self, session_id: str) -> str:
        return f"{self.prefix}:{session_id}"

    def get(self, session_id: str, subject: str) -> Session:
        raw = self.redis.get(self._key(session_id))
        if raw is not None:
            data = json.loads(raw)
            # A session id is only ever handed back to the subject that owns it; if the
            # stored subject differs, treat it as a fresh session rather than leaking.
            if data.get("subject") == subject:
                return Session(
                    session_id=session_id,
                    subject=subject,
                    messages=data.get("messages", []),
                )
        return Session(session_id=session_id, subject=subject)

    def save(self, session: Session, messages: list[dict[str, Any]]) -> None:
        session.messages = messages[-self.max_messages :]
        payload = json.dumps({"subject": session.subject, "messages": session.messages})
        self.redis.set(self._key(session.session_id), payload, px=self.ttl_s * 1000)

    def drop(self, session_id: str) -> None:
        self.redis.delete(self._key(session_id))
