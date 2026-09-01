"""Inbound service authentication for the corporate API.

The corporate API trusts a workload credential, never an end-user token. User
identity is carried separately so the caller can be audited without the API
making authorization decisions on the agent's behalf.
"""

from fastapi import Header, HTTPException, status

from sinal_api.config import get_settings

API_KEY_HEADER = "x-api-key"
ACTING_USER_HEADER = "x-acting-user"


async def require_workload_credential(
    x_api_key: str | None = Header(default=None, alias=API_KEY_HEADER),
    x_acting_user: str | None = Header(default=None, alias=ACTING_USER_HEADER),
) -> str:
    """Validate the calling workload and return the audited acting user."""
    settings = get_settings()
    if not x_api_key or x_api_key not in settings.allowed_api_keys:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing workload credential",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return x_acting_user or "unknown"
