from __future__ import annotations

from dataclasses import dataclass
import logging
from math import ceil
from threading import Lock
from time import monotonic

from fastapi import HTTPException

try:
    import redis
except Exception:  # pragma: no cover - optional dependency
    redis = None


logger = logging.getLogger(__name__)
RATE_LIMIT_SCRIPT = """
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if current == 1 or ttl < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {current, ttl}
"""


def _unavailable() -> HTTPException:
    return HTTPException(503, "Request admission unavailable. Try again shortly.",
                         headers={"Retry-After": "1", "Cache-Control": "no-store"})


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    retry_after_seconds: int = 0


class MemoryRateLimiter:
    def __init__(self) -> None:
        self._entries: dict[str, tuple[int, float]] = {}
        self._lock = Lock()

    def consume(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        if limit <= 0 or window_seconds <= 0:
            return RateLimitDecision(allowed=True)

        now = monotonic()
        with self._lock:
            count, reset_at = self._entries.get(key, (0, now + window_seconds))
            if now >= reset_at:
                count = 0
                reset_at = now + window_seconds
            count += 1
            self._entries[key] = (count, reset_at)
            if count <= limit:
                return RateLimitDecision(allowed=True)
            return RateLimitDecision(
                allowed=False,
                retry_after_seconds=max(1, ceil(reset_at - now)),
            )


class RedisRateLimiter:
    def __init__(self, client) -> None:
        self._client = client

    def consume(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        if limit <= 0 or window_seconds <= 0:
            return RateLimitDecision(allowed=True)

        try:
            reply = self._client.eval(RATE_LIMIT_SCRIPT, 1, key, window_seconds)
            if (not isinstance(reply, (list, tuple)) or len(reply) != 2
                    or type(reply[0]) is not int or reply[0] < 1
                    or type(reply[1]) is not int or not 0 <= reply[1] <= window_seconds):
                raise ValueError("Invalid rate-limit reply")
            current, ttl = reply
        except Exception:
            raise _unavailable() from None
        if current <= limit:
            return RateLimitDecision(allowed=True)
        return RateLimitDecision(allowed=False, retry_after_seconds=max(1, ttl))


class UnavailableRateLimiter:
    def consume(self, key: str, *, limit: int, window_seconds: int) -> RateLimitDecision:
        if limit <= 0 or window_seconds <= 0:
            return RateLimitDecision(allowed=True)
        raise _unavailable()


def build_rate_limiter(redis_url: str):
    if not redis_url:
        return MemoryRateLimiter()
    if redis is None:
        logger.warning("Redis rate limiter requested but redis package missing")
        return UnavailableRateLimiter()
    try:
        client = redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        )
        return RedisRateLimiter(client)
    except Exception:
        logger.warning("Redis rate limiter unavailable")
        return UnavailableRateLimiter()
