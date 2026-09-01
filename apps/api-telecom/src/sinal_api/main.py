"""Application entrypoint for the Onda Telecom corporate API."""

import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from sinal_api import __version__
from sinal_api.config import get_settings
from sinal_api.observability import (
    CORRELATION_HEADER,
    CORRELATION_ID,
    SESSION_HEADER,
    SESSION_ID,
    configure_logging,
    new_correlation_id,
)
from sinal_api.routers import billing, catalog, customers, support

logger = logging.getLogger("sinal.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.service_name, settings.environment, settings.log_level)
    logger.info("api_started", extra={"version": __version__, "environment": settings.environment})
    yield
    logger.info("api_stopped")


app = FastAPI(
    title="Onda Telecom Corporate API",
    version=__version__,
    description=(
        "Fictional carrier API used as the system of record behind the Sinal agentic "
        "platform. All data is invented."
    ),
    lifespan=lifespan,
)


@app.middleware("http")
async def correlation_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    correlation_id = request.headers.get(CORRELATION_HEADER) or new_correlation_id()
    session_id = request.headers.get(SESSION_HEADER, "")
    CORRELATION_ID.set(correlation_id)
    SESSION_ID.set(session_id)

    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

    response.headers[CORRELATION_HEADER] = correlation_id
    logger.info(
        "http_request",
        extra={
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "latency_ms": elapsed_ms,
        },
    )
    return response


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "code": f"http_{exc.status_code}",
            "message": str(exc.detail),
            "correlation_id": CORRELATION_ID.get(),
        },
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "validation_error",
            "message": "request payload failed validation",
            "correlation_id": CORRELATION_ID.get(),
            "errors": exc.errors(),
        },
    )


@app.get("/health", tags=["ops"], summary="Liveness probe")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


app.include_router(catalog.router)
app.include_router(customers.router)
app.include_router(billing.router)
app.include_router(support.router)
