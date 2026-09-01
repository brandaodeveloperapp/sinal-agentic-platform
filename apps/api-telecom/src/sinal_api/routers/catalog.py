"""Plan catalogue endpoints."""

from fastapi import APIRouter, Depends

from sinal_api.domain import store
from sinal_api.domain.models import Plan
from sinal_api.faults import apply_fault
from sinal_api.security import require_workload_credential

router = APIRouter(prefix="/v1/plans", tags=["catalog"])


@router.get("", summary="List available plans", response_model=list[Plan])
async def list_plans(
    _fault: None = Depends(apply_fault),
    _caller: str = Depends(require_workload_credential),
) -> list[Plan]:
    return store.list_plans()
