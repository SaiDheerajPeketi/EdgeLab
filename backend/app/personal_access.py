"""Loopback-only admission and the fixed identity for personal deployments."""
from ipaddress import ip_address
from secrets import compare_digest
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


PERSONAL_EMAIL = "developer@localhost.edgelab"
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
PERSONAL_PROXY_HEADER = "x-edgelab-personal-key"
# Readiness exposes dataset metadata and must stay behind normal admission.
HEALTH_PATHS = frozenset({"/api/health"})


def is_loopback_origin(origin: str) -> bool:
    if not isinstance(origin, str) or any(char.isspace() for char in origin):
        return False
    try:
        parsed = urlsplit(origin)
        parsed.port
        return (parsed.scheme in {"http", "https"} and parsed.hostname in LOOPBACK_HOSTS
                and parsed.username is None and parsed.password is None
                and parsed.path in {"", "/"} and not parsed.query and not parsed.fragment)
    except ValueError:
        return False


def validate_personal_settings(source_settings) -> None:
    if getattr(source_settings, "deployment_mode", "production") != "personal":
        return
    if source_settings.environment != "development":
        raise ValueError("Personal deployment requires EDGELAB_ENVIRONMENT=development")
    if not is_loopback_origin(source_settings.public_origin):
        raise ValueError("Personal deployment requires a loopback EDGELAB_PUBLIC_ORIGIN")
    if not source_settings.cors_origins or not all(is_loopback_origin(origin) for origin in source_settings.cors_origins):
        raise ValueError("Personal deployment requires exclusively loopback CORS_ORIGINS")
    if len(getattr(source_settings, "personal_proxy_secret", "")) < 32:
        raise ValueError("Personal deployment requires EDGELAB_PERSONAL_PROXY_SECRET of at least 32 characters")


def is_personal_identity(user) -> bool:
    return (user is not None and user.email == PERSONAL_EMAIL and user.provider == "email"
            and user.google_subject is None)


def personal_request_allowed(scope: Scope, source_settings, *, health_probe: bool = False) -> bool:
    headers = Headers(scope=scope)
    hosts = headers.getlist("host")
    if (len(hosts) != 1 or any(char in hosts[0] for char in "/\\?#@")
            or not is_loopback_origin(f"http://{hosts[0]}")):
        return False
    peer = scope.get("client")
    try:
        if peer and ip_address(peer[0]).is_loopback:
            return True
    except ValueError:
        pass
    if health_probe and scope["type"] == "http" and scope.get("method") == "GET" and scope.get("path") in HEALTH_PATHS:
        return True
    keys = headers.getlist(PERSONAL_PROXY_HEADER)
    expected = getattr(source_settings, "personal_proxy_secret", "")
    return (len(expected) >= 32 and len(keys) == 1
            and compare_digest(keys[0].encode("utf-8"), expected.encode("utf-8")))


class PersonalAccessMiddleware:
    """Inspect the actual socket peer; forwarded headers never admit requests."""

    def __init__(self, app: ASGIApp, source_settings) -> None:
        self.app = app
        self.settings = source_settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (self.settings.deployment_mode != "personal" or scope["type"] not in {"http", "websocket"}
                or personal_request_allowed(scope, self.settings, health_probe=True)):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4403})
            return
        response = JSONResponse(status_code=403, content={"detail": "Personal deployment requires local access"},
                                headers={"Cache-Control": "private, no-store"})
        await response(scope, receive, send)
