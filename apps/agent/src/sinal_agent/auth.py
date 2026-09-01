"""Inbound token verification for the agent.

The agent holds no data credential of its own, but it must still verify the token
it is handed before it forwards it and before it trusts any identity in it. Without
this, anything that can reach the agent port gets an unauthenticated agent loop and
can name any subject. The signature, issuer, audience, expiry and algorithm are all
checked; the subject the agent acts on comes from the verified ``sub`` claim, never
from the request body.
"""

from dataclasses import dataclass

import jwt

from sinal_agent.config import Settings


class TokenError(Exception):
    """Raised when the presented token is missing or fails verification."""


@dataclass(frozen=True)
class VerifiedCaller:
    subject: str
    scopes: tuple[str, ...]
    customer_id: str | None


def verify_bearer(authorization: str | None, settings: Settings) -> VerifiedCaller:
    """Verify a Bearer token and return the caller identity it proves."""
    if not authorization or not authorization.startswith("Bearer "):
        raise TokenError("missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()

    try:
        claims = jwt.decode(
            token,
            settings.downstream_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise TokenError(f"token rejected: {error}") from error

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise TokenError("token has no usable subject")

    scope = claims.get("scope", "")
    scopes = tuple(s for s in scope.split(" ") if s) if isinstance(scope, str) else ()
    customer_id = claims.get("customer_id")
    if customer_id is not None and not isinstance(customer_id, str):
        customer_id = None

    return VerifiedCaller(subject=subject, scopes=scopes, customer_id=customer_id)
