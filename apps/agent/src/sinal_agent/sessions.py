"""Short-term memory per session.

Holds only the current conversation history, with a window and an expiry. There is
deliberately no long-term memory here: any customer data comes from a tool at the
moment of the question, never from a cache inside the agent.

The store is an O(1) LRU: an OrderedDict keeps insertion/recency order, so eviction on
cap is a single popitem and expiry is checked lazily on access rather than by scanning
every entry on every request. At horizontal scale this moves to Redis; the interface
here is what a Redis-backed store would implement.
"""

import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Session:
    session_id: str
    subject: str
    messages: list[dict[str, Any]] = field(default_factory=list)
    updated_at: float = field(default_factory=time.monotonic)


class SessionStore:
    """In-memory LRU store with a bounded history window and a TTL."""

    def __init__(self, ttl_s: int, max_messages: int, max_sessions: int = 5000) -> None:
        self.ttl_s = ttl_s
        self.max_messages = max_messages
        self.max_sessions = max_sessions
        self._sessions: OrderedDict[str, Session] = OrderedDict()

    def get(self, session_id: str, subject: str) -> Session:
        session = self._sessions.get(session_id)
        if session is not None and self._expired(session):
            del self._sessions[session_id]
            session = None
        if session is None or session.subject != subject:
            session = Session(session_id=session_id, subject=subject)
            self._sessions[session_id] = session
            self._enforce_cap()
        else:
            self._sessions.move_to_end(session_id)
        return session

    def save(self, session: Session, messages: list[dict[str, Any]]) -> None:
        session.messages = messages[-self.max_messages :]
        session.updated_at = time.monotonic()
        self._sessions.move_to_end(session.session_id)

    def drop(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _expired(self, session: Session) -> bool:
        return time.monotonic() - session.updated_at > self.ttl_s

    def _enforce_cap(self) -> None:
        while len(self._sessions) > self.max_sessions:
            self._sessions.popitem(last=False)

    def __len__(self) -> int:
        return len(self._sessions)
