"""Fixed-origin Better Auth session introspection; never trust browser identity claims."""
import json
import re
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException

from app.config import settings

TOKEN_PREFIX = "ba:"
COOKIE_NAMES = frozenset({"edgelab.session_token", "__Secure-edgelab.session_token"})


def enabled():
    return getattr(settings, "auth_provider", "legacy") == "better-auth"


def readiness() -> bool:
    if not enabled() or len(getattr(settings, "auth_service_key", "")) < 32:
        return False
    base = getattr(settings, "better_auth_internal_url", "").rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        return False
    try:
        with build_opener(_NoRedirect()).open(Request(f"{base}/health", headers={"Accept": "application/json"}), timeout=2) as response:
            data = json.loads(response.read(4097))
        return isinstance(data, dict) and data.get("ready") is True and data.get("provider") == "better-auth" and data.get("google_enabled") is True
    except (OSError, ValueError):
        return False


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def session_cookie(raw: str | None) -> str:
    if not isinstance(raw, str) or len(raw) > 16384:
        raise HTTPException(401, "Better Auth session required")
    matches = []
    for part in raw.split(";"):
        name, separator, value = part.strip().partition("=")
        if name in COOKIE_NAMES and separator:
            if not value or len(value) > 4096 or re.search(r"[\s\r\n]", value):
                raise HTTPException(401, "Invalid Better Auth session")
            matches.append(f"{name}={value}")
    if len(matches) != 1:
        raise HTTPException(401, "Better Auth session required")
    return matches[0]


def request_session(*, token: str | None = None, cookie: str | None = None, sign_out: bool = False) -> dict:
    if not enabled():
        raise HTTPException(503, "Better Auth is not configured")
    base = getattr(settings, "better_auth_internal_url", "").rstrip("/")
    parsed = urlparse(base)
    key = getattr(settings, "auth_service_key", "")
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path or len(key) < 32:
        raise HTTPException(503, "Better Auth is not configured")
    headers = {"X-EdgeLab-Auth-Service-Key": key, "Accept": "application/json", "Content-Type": "application/json"}
    if token is not None:
        signed = token.removeprefix(TOKEN_PREFIX)
        if not signed or len(signed) > 4096 or "." not in signed or re.search(r"[\s\r\n]", signed):
            raise HTTPException(401, "Invalid Better Auth session")
        headers["Authorization"] = f"Bearer {signed}"
    else:
        headers["Cookie"] = session_cookie(cookie)
    request = Request(f"{base}/internal/{'sign-out' if sign_out else 'session'}", data=b"{}", headers=headers, method="POST")
    try:
        with build_opener(_NoRedirect()).open(request, timeout=5) as response:
            body = response.read(16385)
            if len(body) > 16384:
                raise ValueError("Oversized authentication response")
            result = json.loads(body)
    except HTTPError as exc:
        if exc.code in {401, 403}:
            raise HTTPException(exc.code, "Better Auth session expired or revoked") from None
        raise HTTPException(503, "Sign-in is temporarily unavailable") from None
    except (OSError, ValueError):
        raise HTTPException(503, "Sign-in is temporarily unavailable") from None
    if sign_out:
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise HTTPException(503, "Sign-out could not be confirmed")
        return result
    if not isinstance(result, dict) or result.get("email_verified") is not True or not isinstance(result.get("sub"), str) or re.fullmatch(r"[A-Za-z0-9_-]{1,255}", result["sub"]) is None:
        raise HTTPException(502, "Verified Google identity required")
    for field, maximum in (("email", 320), ("name", 160), ("session_id", 64), ("token", 4096)):
        if not isinstance(result.get(field), str) or not 0 < len(result[field]) <= maximum:
            raise HTTPException(502, "Invalid Better Auth identity")
    if "." not in result["token"] or re.search(r"[\s\r\n]", result["token"]):
        raise HTTPException(502, "Invalid Better Auth session")
    try:
        for field in ("created_at", "expires_at"):
            value = datetime.fromisoformat(result[field].replace("Z", "+00:00"))
            if value.tzinfo is None:
                raise ValueError("Missing session timezone")
            result[field] = value.astimezone(timezone.utc)
        now = datetime.now(timezone.utc)
        if result["created_at"] > now or result["expires_at"] <= now or result["created_at"] >= result["expires_at"]:
            raise ValueError("Invalid session lifetime")
    except (ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(401, "Better Auth session expired or invalid") from None
    return result
