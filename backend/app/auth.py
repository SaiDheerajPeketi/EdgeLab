import base64
import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from secrets import compare_digest

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import BetaSession, BetaUser, utcnow
from app.services import access_policy


JWT_ALGORITHM = "HS256"
JWT_ISSUER = "edgelab"


@dataclass(frozen=True)
class AuthenticatedUser:
    id: int
    email: str
    name: str
    provider: str
    approved: bool
    beta_position: int | None
    session_id: str
    session_created_at: datetime
    session_expires_at: datetime
    access_expires_at: datetime | None = None


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


def require_auth(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    token = bearer_token(authorization)
    if not token:
        raise _auth_error()
    return authenticate_token(db, token)


def require_workspace(
    current_user: AuthenticatedUser = Depends(require_auth),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    access_policy.require_workspace_user(db, current_user.id, settings)
    return current_user


def _verified_google_user(user):
    return user is not None and user.provider == "google" and isinstance(user.google_subject, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,255}", user.google_subject) is not None


def require_billing_identity(
    current_user: AuthenticatedUser = Depends(require_auth),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    if not _verified_google_user(db.get(BetaUser, current_user.id, populate_existing=True)):
        raise HTTPException(status_code=403, detail="Verified Google sign-in required for billing")
    return current_user


def require_subscription(
    current_user: AuthenticatedUser = Depends(require_billing_identity),
    db: Session = Depends(get_db),
) -> AuthenticatedUser:
    require_billing_identity(current_user, db)
    access = access_policy.access_snapshot(db, current_user.id, settings, paid_only=True)
    db.commit()
    if not access["workspace_access"]:
        raise HTTPException(status_code=403, detail="Data export requires an active subscription")
    return current_user


def create_session_token(user_id: int, session_id: str, expires_at: datetime) -> str:
    claims = {
        "sub": str(int(user_id)),
        "sid": session_id,
        "iss": JWT_ISSUER,
        "iat": int(utcnow().timestamp()),
        "exp": int(_normalize_datetime(expires_at).timestamp()),
    }
    return _encode_jwt(claims)


def authenticate_token(db: Session, token: str) -> AuthenticatedUser:
    claims = _decode_jwt(token)
    user_id = claims["user_id"]
    session_id = claims["session_id"]

    session = db.scalar(
        select(BetaSession).where(
            BetaSession.id == session_id,
            BetaSession.user_id == user_id,
        )
    )
    if session is None:
        raise _auth_error()

    expires_at = _normalize_datetime(session.expires_at)
    if expires_at <= utcnow():
        db.delete(session)
        db.commit()
        raise _auth_error()

    user = db.scalar(select(BetaUser).where(BetaUser.id == user_id))
    if user is None:
        raise _auth_error()
    if access_policy.deployment_mode(settings) == "production" and not _verified_google_user(user):
        raise _auth_error()

    return AuthenticatedUser(
        id=user.id,
        email=user.email,
        name=user.name,
        provider="google" if user.provider == "google" else "email",
        approved=user.status == "APPROVED",
        beta_position=user.beta_position,
        session_id=session.id,
        session_created_at=session.created_at,
        session_expires_at=min(expires_at, datetime.fromtimestamp(claims["expires_at"], timezone.utc)),
    )


def _normalize_datetime(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _jwt_secret() -> str:
    secret = settings.jwt_secret.strip()
    if not secret:
        raise HTTPException(status_code=503, detail="JWT auth is not configured")
    return secret


def _auth_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Valid beta session required",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _encode_jwt(payload: dict[str, object]) -> str:
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    encoded_header = _b64url_encode(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    encoded_payload = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    signature = hmac.new(
        _jwt_secret().encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f"{encoded_header}.{encoded_payload}.{_b64url_encode(signature)}"


def _decode_jwt(token: str) -> dict[str, object]:
    parts = token.split(".")
    if len(parts) != 3:
        raise _auth_error()

    encoded_header, encoded_payload, encoded_signature = parts
    try:
        header = json.loads(_b64url_decode(encoded_header))
        payload = json.loads(_b64url_decode(encoded_payload))
    except (ValueError, json.JSONDecodeError):
        raise _auth_error() from None

    if not isinstance(header, dict) or not isinstance(payload, dict):
        raise _auth_error()
    if header.get("alg") != JWT_ALGORITHM or payload.get("iss") != JWT_ISSUER:
        raise _auth_error()

    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    expected_signature = hmac.new(
        _jwt_secret().encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    if not compare_digest(encoded_signature, _b64url_encode(expected_signature)):
        raise _auth_error()

    try:
        user_id = int(str(payload.get("sub") or "").strip())
        session_id = str(payload.get("sid") or "").strip()
        expires_at = int(payload.get("exp"))
    except (TypeError, ValueError):
        raise _auth_error() from None

    if user_id <= 0 or not session_id:
        raise _auth_error()
    if expires_at <= int(utcnow().timestamp()):
        raise _auth_error()

    return {
        "user_id": user_id,
        "session_id": session_id,
        "expires_at": expires_at,
    }


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))
