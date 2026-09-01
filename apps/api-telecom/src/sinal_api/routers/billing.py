"""Invoice endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from sinal_api.domain import store
from sinal_api.domain.models import Invoice, InvoiceStatus
from sinal_api.faults import apply_fault
from sinal_api.security import require_workload_credential

router = APIRouter(prefix="/v1", tags=["billing"])


@router.get(
    "/customers/{customer_id}/invoices",
    summary="List invoices for a customer",
    response_model=list[Invoice],
)
async def list_invoices(
    customer_id: str,
    status_filter: InvoiceStatus | None = Query(default=None, alias="status"),
    _fault: None = Depends(apply_fault),
    _caller: str = Depends(require_workload_credential),
) -> list[Invoice]:
    if store.get_customer(customer_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"customer {customer_id} not found")
    return store.list_invoices(customer_id, status_filter)


@router.get("/invoices/{invoice_id}", summary="Get one invoice", response_model=Invoice)
async def get_invoice(
    invoice_id: str,
    _fault: None = Depends(apply_fault),
    _caller: str = Depends(require_workload_credential),
) -> Invoice:
    invoice = store.get_invoice(invoice_id)
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"invoice {invoice_id} not found")
    return invoice
