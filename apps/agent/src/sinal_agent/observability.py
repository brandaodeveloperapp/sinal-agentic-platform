"""Log estruturado e propagacao de correlation-id."""

import logging
import sys
import uuid
from contextvars import ContextVar

from pythonjsonlogger import json as jsonlogger

CORRELATION_ID: ContextVar[str] = ContextVar("correlation_id", default="")
SESSION_ID: ContextVar[str] = ContextVar("session_id", default="")

CORRELATION_HEADER = "x-correlation-id"
SESSION_HEADER = "x-session-id"


class ContextFilter(logging.Filter):
    """Injeta identificadores de rastreio em cada registro."""

    def __init__(self, service_name: str, environment: str) -> None:
        super().__init__()
        self.service_name = service_name
        self.environment = environment

    def filter(self, record: logging.LogRecord) -> bool:
        record.service = self.service_name
        record.environment = self.environment
        record.correlation_id = CORRELATION_ID.get()
        record.session_id = SESSION_ID.get()
        return True


def configure_logging(service_name: str, environment: str, level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        jsonlogger.JsonFormatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            rename_fields={"asctime": "timestamp", "levelname": "level"},
            timestamp=True,
        )
    )
    handler.addFilter(ContextFilter(service_name, environment))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(getattr(logging, level.upper(), logging.INFO))


def new_correlation_id() -> str:
    return str(uuid.uuid4())
