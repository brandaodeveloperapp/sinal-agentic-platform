"""Short-term memory per session.

Holds only the current conversation history, with a window and an expiry. There is
deliberately no long-term memory here: any customer data comes from a tool at the
moment of the question, never from a cache inside the agent.
"""

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Session:
    session_id: str
    subject: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    updated_at: float = field(default_factory=time.monotonic)


class SessionStore:
    """In-memory store with a bounded history window and a TTL."""

    def __init__(self, ttl_s: int, max_messages: int, max_sessions: int = 5000) -> None:
        self.ttl_s = ttl_s
        self.max_messages = max_messages
        self.max_sessions = max_sessions
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str, subject: str) -> Session:
        self._evict_expired()
        session = self._sessions.get(session_id)
        if session is None or session.subject != subject:
            session = Session(session_id=session_id, subject=subject)
            self._sessions[session_id] = session
            self._enforce_cap()
        return session

    def _enforce_cap(self) -> None:
        while len(self._sessions) > self.max_sessions:
            oldest = min(self._sessions.values(), key=lambda s: s.updated_at)
            del self._sessions[oldest.session_id]

    def save(self, session: Session, messages: list[dict[str, Any]]) -> None:
        session.messages = messages[-self.max_messages :]
        session.updated_at = time.monotonic()

    def drop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _evict_expired(self) -> None:
        now = time.monotonic()
        expired = [key for key, s in self._sessions.items() if now - s.updated_at > self.ttl_s]
        for key in expired:
            del self._sessions[key]

    def __len__(self) -> int:
        return len(self._sessions)
