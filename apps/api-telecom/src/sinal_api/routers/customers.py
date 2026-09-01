"""Customer, line and usage endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status

from sinal_api.domain import store
from sinal_api.domain.models import Customer, Line, UsageWindow
from sinal_api.faults import apply_fault
from sinal_api.security import require_workload_credential

router = APIRouter(prefix="/v1", tags=["customers"])


@router.get("/customers/{customer_id}", summary="Get a customer", response_model=Customer)
async def get_customer(
    customer_id: str,
    _fault: None = Depends(apply_fault),
    _caller: str = Depends(require_workload_credential),
) -> Customer:
    customer = store.get_customer(customer_id)
    if customer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"customer {customer_id} not found")
    return customer


@router.get(
    "/customers/{customer_id}/lines",
    summary="List the lines owned by a customer",
    response_model=list[Line],
)
async def list_lines(
    customer_id: str,
    _fault: None = Depends(apply_fault),
    _caller: str = Depends(require_workload_credential),
) -> list[Line]:
    if store.get_customer(customer_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"customer {customer_id} not found")
    return store.list_lines(customer_id)


@router.get(
    "/lines/{msisdn}/usage",
    summary="Get the current cycle usage for a line",
    response_model=UsageWindow,
)
async def get_usage(
    msisdn: str,
    _fault: None = Depends(apply_fault),
    _caller: str = Depends(require_workload_credential),
) -> UsageWindow:
    usage = store.get_usage(msisdn)
    if usage is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"line {msisdn} not found")
    return usage
