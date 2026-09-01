"""Support ticket endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status

from sinal_api.domain import store
from sinal_api.domain.models import Ticket, TicketCreateRequest
from sinal_api.faults import apply_fault
from sinal_api.security import require_workload_credential

router = APIRouter(prefix="/v1", tags=["support"])


@router.get(
    "/customers/{customer_id}/tickets",
    summary="List support tickets for a customer",
    response_model=list[Ticket],
)
async def list_tickets(
    customer_id: str,
    _fault: None = Depends(apply_fault),
    _caller: str = Depends(require_workload_credential),
) -> list[Ticket]:
    if store.get_customer(customer_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"customer {customer_id} not found")
    return store.list_tickets(customer_id)


@router.post(
    "/tickets",
    summary="Open a support ticket",
    response_model=Ticket,
    status_code=status.HTTP_201_CREATED,
)
async def create_ticket(
    payload: TicketCreateRequest,
    _fault: None = Depends(apply_fault),
    caller: str = Depends(require_workload_credential),
) -> Ticket:
    if store.get_customer(payload.customer_id) is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"customer {payload.customer_id} not found"
        )
    return store.create_ticket(payload, opened_by=caller)
