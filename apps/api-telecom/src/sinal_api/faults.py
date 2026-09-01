"""Deliberate fault injection used to exercise caller resilience.

Enabled outside production only. The MCP layer needs a reliable way to prove
timeout, retry and circuit-breaker behaviour without waiting for a real
upstream incident.
"""

import asyncio
import random

from fastapi import Header, HTTPException, status

from sinal_api.config import get_settings

FAULT_HEADER = "x-simulate-fault"

FAULT_TIMEOUT = "timeout"
FAULT_SERVER_ERROR = "server-error"
FAULT_RATE_LIMIT = "rate-limit"


async def apply_fault(
    x_simulate_fault: str | None = Header(default=None, alias=FAULT_HEADER),
) -> None:
    """Delay or fail the request when a fault is requested by the caller."""
    settings = get_settings()
    if settings.environment == "prd" or not x_simulate_fault:
        await _natural_latency(settings.latency_floor_ms, settings.latency_ceiling_ms)
        return

    if x_simulate_fault == FAULT_TIMEOUT:
        await asyncio.sleep(30)
        return
    if x_simulate_fault == FAULT_SERVER_ERROR:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="upstream billing core unavailable",
        )
    if x_simulate_fault == FAULT_RATE_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="rate limit exceeded",
            headers={"Retry-After": "2"},
        )

    await _natural_latency(settings.latency_floor_ms, settings.latency_ceiling_ms)


async def _natural_latency(floor_ms: int, ceiling_ms: int) -> None:
    delay_ms = random.uniform(floor_ms, ceiling_ms)  # noqa: S311
    await asyncio.sleep(delay_ms / 1000)
