"""HTTP entrypoint for the agent, streaming over Server-Sent Events."""

import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from sinal_agent import __version__
from sinal_agent.auth import TokenError, verify_bearer
from sinal_agent.config import get_settings
from sinal_agent.models import describe_model
from sinal_agent.observability import (
    CORRELATION_HEADER,
    CORRELATION_ID,
    SESSION_ID,
    configure_logging,
    new_correlation_id,
)
from sinal_agent.service import AgentService, BudgetExceededError
from sinal_agent.sessions import SessionStore

logger = logging.getLogger("sinal.agent.http")


def _build_sessions(settings):
    """Redis-backed sessions when a URL is set, so history is shared across replicas;
    the in-memory LRU otherwise (correct for a single replica, the local default)."""
    if settings.redis_url:
        import redis as redis_lib

        from sinal_agent.redis_sessions import RedisSessionStore

        client = redis_lib.Redis.from_url(settings.redis_url, decode_responses=True)
        logger.info("sessions_backend", extra={"store": "redis"})
        return RedisSessionStore(
            client, settings.session_ttl_s, settings.max_history_messages
        )
    logger.info("sessions_backend", extra={"store": "memory"})
    return SessionStore(settings.session_ttl_s, settings.max_history_messages)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: str = Field(min_length=6, max_length=128)


def create_app(service: AgentService | None = None) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configure_logging(settings.service_name, settings.environment, settings.log_level)
        logger.info("agent_started", extra={"version": __version__, **describe_model(settings)})
        yield
        logger.info("agent_stopped")

    app = FastAPI(title="Sinal Agent", version=__version__, lifespan=lifespan)
    app.state.service = service or AgentService(
        settings=settings,
        sessions=_build_sessions(settings),
    )

    @app.get("/health", tags=["ops"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/v1/diagnostics", tags=["ops"])
    async def diagnostics(authorization: str | None = Header(default=None)) -> dict[str, object]:
        try:
            verify_bearer(authorization, settings)
        except TokenError as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication required"
            ) from error
        return {
            "prompt_version": settings.prompt_version,
            "max_tool_calls_per_turn": settings.max_tool_calls_per_turn,
            "max_tokens_per_request": settings.max_tokens_per_request,
            **describe_model(settings),
        }

    @app.post("/v1/chat/stream", tags=["chat"])
    async def chat_stream(
        payload: ChatRequest,
        request: Request,
        authorization: str | None = Header(default=None),
        x_correlation_id: str | None = Header(default=None, alias=CORRELATION_HEADER),
    ) -> EventSourceResponse:
        try:
            caller = verify_bearer(authorization, settings)
        except TokenError as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="a valid end user bearer token is required",
            ) from error

        correlation_id = x_correlation_id or new_correlation_id()
        CORRELATION_ID.set(correlation_id)
        SESSION_ID.set(payload.session_id)
        token = authorization.removeprefix("Bearer ").strip()
        agent_service: AgentService = request.app.state.service

        async def publish() -> AsyncIterator[dict[str, str]]:
            try:
                async for event in agent_service.stream_turn(
                    message=payload.message,
                    token=token,
                    session_id=payload.session_id,
                    subject=caller.subject,
                    correlation_id=correlation_id,
                ):
                    yield {"event": event["event"], "data": json.dumps(event["data"])}
            except BudgetExceededError:
                yield {"event": "done", "data": json.dumps({"stop_reason": "budget_exceeded"})}
            except Exception as error:
                logger.exception("turn_failed", extra={"reason": type(error).__name__})
                yield {
                    "event": "error",
                    "data": json.dumps(
                        {
                            "code": "agent_failure",
                            "message": "The request could not be completed right now.",
                        }
                    ),
                }
                yield {"event": "done", "data": json.dumps({"stop_reason": "error"})}

        return EventSourceResponse(publish(), headers={CORRELATION_HEADER: correlation_id})

    return app


app = create_app()
