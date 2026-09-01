"""Memoria de curto prazo por sessao.

Guarda apenas o historico da conversa corrente, com janela e expiracao. Nao ha
memoria de longo prazo aqui de proposito: qualquer dado de cliente vem da
ferramenta no momento da pergunta, nunca de um cache do agente.
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
    """Armazenamento em memoria com janela de historico e TTL."""

    def __init__(self, ttl_s: int, max_messages: int) -> None:
        self.ttl_s = ttl_s
        self.max_messages = max_messages
        self._sessions: dict[str, Session] = {}

    def get(self, session_id: str, subject: str) -> Session:
        self._evict_expired()
        session = self._sessions.get(session_id)
        if session is None or session.subject != subject:
            session = Session(session_id=session_id, subject=subject)
            self._sessions[session_id] = session
        return session

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
