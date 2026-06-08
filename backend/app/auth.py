from secrets import compare_digest

from fastapi import Header, HTTPException

from app.config import settings


def configured_api_token() -> str:
    return settings.api_token.strip()


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def api_token_is_valid(token: str | None) -> bool:
    expected = configured_api_token()
    if not expected:
        return True
    return bool(token) and compare_digest(token, expected)


def require_api_token(authorization: str | None = Header(default=None)) -> None:
    if api_token_is_valid(bearer_token(authorization)):
        return
    raise HTTPException(
        status_code=401,
        detail="Valid API token required",
        headers={"WWW-Authenticate": "Bearer"},
    )
