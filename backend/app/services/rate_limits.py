from __future__ import annotations

from dataclasses import dataclass
import logging
from math import ceil
from threading import Lock
from time import monotonic

try:
    import redis
except Exception:  # pragma: no cover - optional dependency
    redis = None


logger = logging.getLogger(__name__)


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

        current = int(self._client.incr(key))
        if current == 1:
            self._client.expire(key, window_seconds)
        if current <= limit:
            return RateLimitDecision(allowed=True)
        ttl = int(self._client.ttl(key))
        return RateLimitDecision(allowed=False, retry_after_seconds=max(1, ttl))


def build_rate_limiter(redis_url: str):
    if not redis_url:
        return MemoryRateLimiter()
    if redis is None:
        logger.warning("Redis rate limiter requested but redis package missing; using memory limiter")
        return MemoryRateLimiter()
    try:
        client = redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        )
        client.ping()
        return RedisRateLimiter(client)
    except Exception:
        logger.warning("Redis rate limiter unavailable at %s; using memory limiter", redis_url, exc_info=True)
        return MemoryRateLimiter()
