"""Bound Google exchange admission before external I/O or account mutation.

The quota has one fixed key, never a caller-controlled identity. Redis shares
it across workers; an explicitly unconfigured Redis uses one process counter.
"""
from contextlib import contextmanager
from math import ceil
from threading import BoundedSemaphore, Lock
from time import monotonic

from app.services.rate_limits import RateLimitDecision, redis

GOOGLE_EXCHANGE_LIMIT = 120
GOOGLE_EXCHANGE_WINDOW_SECONDS = 60
GOOGLE_EXCHANGE_MAX_CONCURRENT = 8
GOOGLE_EXCHANGE_KEY = "rate-limit:auth:google-exchange:global:v1"

# Redis executes counter admission and expiry together. Repair a missing expiry
# without resetting a retained count; denied attempts never extend the window.
GOOGLE_EXCHANGE_SCRIPT = """
local count = redis.call('GET', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if not count or ttl == -2 then
    redis.call('SET', KEYS[1], 1, 'PX', ARGV[2])
    return {1, tonumber(ARGV[2])}
end
local current = tonumber(count)
if not current or current < 0 or current ~= math.floor(current) then
    return redis.error_reply('INVALID_AUTH_QUOTA')
end
if ttl <= 0 then
    if redis.call('PEXPIRE', KEYS[1], ARGV[2]) ~= 1 then
        return redis.error_reply('INVALID_AUTH_QUOTA_EXPIRY')
    end
    ttl = tonumber(ARGV[2])
end
if current >= tonumber(ARGV[1]) then return {0, ttl} end
redis.call('INCR', KEYS[1])
return {1, ttl}
"""


class AuthRateLimiterUnavailable(Exception):
    pass


class AuthRateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds


class GoogleExchangeLimiter:
    def __init__(self, *, client=None, clock=monotonic, limit=GOOGLE_EXCHANGE_LIMIT,
                 window_seconds=GOOGLE_EXCHANGE_WINDOW_SECONDS,
                 max_concurrent=GOOGLE_EXCHANGE_MAX_CONCURRENT):
        for value in (limit, window_seconds, max_concurrent):
            if type(value) is not int or value <= 0:
                raise ValueError("Google admission limits must be positive whole numbers")
        self._client, self._clock = client, clock
        self._limit, self._window_seconds = limit, window_seconds
        self._count, self._reset_at = 0, 0.0
        self._lock = Lock()
        self._slots = BoundedSemaphore(max_concurrent)

    def consume(self) -> RateLimitDecision:
        if self._client is not None:
            try:
                reply = self._client.eval(GOOGLE_EXCHANGE_SCRIPT, 1, GOOGLE_EXCHANGE_KEY,
                                          self._limit, self._window_seconds * 1000)
                if (not isinstance(reply, (list, tuple)) or len(reply) != 2
                        or type(reply[0]) is not int or reply[0] not in (0, 1)
                        or type(reply[1]) is not int or not 0 < reply[1] <= self._window_seconds * 1000):
                    raise ValueError("Invalid auth admission reply")
                return RateLimitDecision(allowed=reply[0] == 1,
                                         retry_after_seconds=0 if reply[0] else max(1, ceil(reply[1] / 1000)))
            except Exception as exc:
                raise AuthRateLimiterUnavailable() from exc
        with self._lock:
            now = self._clock()
            if now >= self._reset_at:
                self._count, self._reset_at = 0, now + self._window_seconds
            if self._count >= self._limit:
                return RateLimitDecision(False, max(1, ceil(self._reset_at - now)))
            self._count += 1
            return RateLimitDecision(True)

    @contextmanager
    def admit(self):
        if not self._slots.acquire(blocking=False):
            raise AuthRateLimitExceeded(1)
        try:
            decision = self.consume()
            if not decision.allowed:
                raise AuthRateLimitExceeded(decision.retry_after_seconds)
            yield
        finally:
            self._slots.release()


class _UnavailableRedis:
    def eval(self, *args):
        raise AuthRateLimiterUnavailable()


def build_google_exchange_limiter(redis_url: str) -> GoogleExchangeLimiter:
    if not redis_url:
        return GoogleExchangeLimiter()
    try:
        if redis is None:
            raise AuthRateLimiterUnavailable()
        client = redis.from_url(redis_url, decode_responses=True,
                                socket_connect_timeout=0.25, socket_timeout=0.25)
    except Exception:
        client = _UnavailableRedis()
    return GoogleExchangeLimiter(client=client)
