"""Verified-owner billing admission before database or provider work.

Redis shares fixed-window quotas across processes. An unconfigured Redis uses
bounded process memory. Concurrency slots are always local to this process.
"""
from contextlib import contextmanager
from math import ceil, isfinite
from threading import Lock
from time import monotonic

from app.services.rate_limits import RateLimitDecision, redis

BILLING_STATUS_LIMIT = 30
BILLING_ACTION_LIMIT = 6
BILLING_GLOBAL_LIMIT = 600
BILLING_WINDOW_SECONDS = 60
BILLING_MAX_CONCURRENT = 8
BILLING_OWNER_MAX_CONCURRENT = 2
BILLING_GLOBAL_KEY = "rate-limit:{billing}:global:v1"
_FAMILIES = frozenset(("status", "actions"))
_MAX_SAFE_INTEGER = 9_007_199_254_740_991

# Read and validate both counters before any mutation. A rejected owner does
# not consume global capacity or create a key. Missing expiries are repaired
# without resetting retained counts; existing expiries are never refreshed.
BILLING_ADMISSION_SCRIPT = """
local window = tonumber(ARGV[3])
local limits = {tonumber(ARGV[1]), tonumber(ARGV[2])}
local counts, ttls, present = {}, {}, {}
for i = 1, 2 do
    local raw = redis.call('GET', KEYS[i])
    local ttl = redis.call('PTTL', KEYS[i])
    if not raw or ttl == -2 then
        counts[i], ttls[i], present[i] = 0, window, false
    else
        local current = tonumber(raw)
        if type(raw) ~= 'string' or not string.match(raw, '^%d+$')
            or (#raw > 1 and string.sub(raw, 1, 1) == '0')
            or not current or current < 0 or current > 9007199254740991
            or current ~= math.floor(current) then
            return redis.error_reply('INVALID_BILLING_QUOTA')
        end
        if ttl < -1 or ttl > window then
            return redis.error_reply('INVALID_BILLING_QUOTA_EXPIRY')
        end
        counts[i], ttls[i], present[i] = current, ttl, true
    end
end
-- An existing expiry at this millisecond is not extended by a denial.
for i = 1, 2 do
    if present[i] and ttls[i] == 0 then return {0, 1} end
end
for i = 1, 2 do
    if present[i] and ttls[i] == -1 then
        if redis.call('PEXPIRE', KEYS[i], window) ~= 1 then
            return redis.error_reply('INVALID_BILLING_QUOTA_EXPIRY')
        end
        ttls[i] = window
    end
end
local retry = 0
for i = 1, 2 do
    if counts[i] >= limits[i] then retry = math.max(retry, ttls[i]) end
end
if retry > 0 then return {0, retry} end
for i = 1, 2 do
    if present[i] then redis.call('INCR', KEYS[i])
    else redis.call('SET', KEYS[i], 1, 'PX', window) end
end
return {1, math.min(ttls[1], ttls[2])}
"""


class BillingRateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds
        super().__init__("Billing admission quota exceeded")


class BillingRateLimiterUnavailable(Exception):
    pass


class BillingAdmissionLimiter:
    def __init__(self, *, client=None, clock=monotonic,
                 global_limit=BILLING_GLOBAL_LIMIT, status_limit=BILLING_STATUS_LIMIT,
                 action_limit=BILLING_ACTION_LIMIT, window_seconds=BILLING_WINDOW_SECONDS,
                 max_concurrent=BILLING_MAX_CONCURRENT,
                 owner_max_concurrent=BILLING_OWNER_MAX_CONCURRENT,
                 max_owner_entries=None):
        values = (global_limit, status_limit, action_limit, window_seconds,
                  max_concurrent, owner_max_concurrent)
        if any(type(value) is not int or not 0 < value <= _MAX_SAFE_INTEGER for value in values):
            raise ValueError("Billing admission limits must be positive whole numbers")
        if window_seconds * 1000 > _MAX_SAFE_INTEGER:
            raise ValueError("Billing expiry exceeds exact Redis numeric precision")
        if max_owner_entries is None:
            max_owner_entries = 2 * global_limit
        if (type(max_owner_entries) is not int or not 0 < max_owner_entries <= 2 * global_limit):
            raise ValueError("Billing owner quota capacity must be between one and twice the global limit")
        self._client, self._clock = client, clock
        self._global_limit, self._window_seconds = global_limit, window_seconds
        self._family_limits = {"status": status_limit, "actions": action_limit}
        self._max_concurrent, self._owner_max_concurrent = max_concurrent, owner_max_concurrent
        self._max_owner_entries = max_owner_entries
        self._lock = Lock()
        self._in_flight, self._owner_in_flight = 0, {}
        self._global_count, self._global_reset_at = 0, 0.0
        self._owner_quotas = {}

    @staticmethod
    def _validate(owner_id, family):
        if type(owner_id) is not int or not 0 < owner_id <= 9_223_372_036_854_775_807:
            raise ValueError("Billing admission requires a positive database owner ID")
        if type(family) is not str or family not in _FAMILIES:
            raise ValueError("Unknown billing admission family")

    def _consume(self, owner_id: int, family: str) -> RateLimitDecision:
        if self._client is not None:
            try:
                reply = self._client.eval(
                    BILLING_ADMISSION_SCRIPT, 2, BILLING_GLOBAL_KEY,
                    f"rate-limit:{{billing}}:owner:{owner_id}:{family}:v1",
                    self._global_limit, self._family_limits[family], self._window_seconds * 1000,
                )
                if (not isinstance(reply, (list, tuple)) or len(reply) != 2
                        or type(reply[0]) is not int or reply[0] not in (0, 1)
                        or type(reply[1]) is not int or not 0 < reply[1] <= self._window_seconds * 1000):
                    raise ValueError("Invalid billing admission reply")
                return RateLimitDecision(reply[0] == 1,
                                         0 if reply[0] else max(1, ceil(reply[1] / 1000)))
            except Exception as exc:
                raise BillingRateLimiterUnavailable() from exc
        with self._lock:
            now = self._clock()
            if not isinstance(now, (int, float)) or isinstance(now, bool) or not isfinite(now):
                raise BillingRateLimiterUnavailable()
            self._owner_quotas = {key: quota for key, quota in self._owner_quotas.items() if quota[1] > now}
            global_count, global_reset_at = self._global_count, self._global_reset_at
            if now >= global_reset_at:
                global_count, global_reset_at = 0, now + self._window_seconds
            key = (owner_id, family)
            count, reset_at = self._owner_quotas.get(key, (0, now + self._window_seconds))
            retry = max(
                global_reset_at - now if global_count >= self._global_limit else 0,
                reset_at - now if count >= self._family_limits[family] else 0,
            )
            if retry > 0:
                return RateLimitDecision(False, max(1, ceil(retry)))
            if key not in self._owner_quotas and len(self._owner_quotas) >= self._max_owner_entries:
                return RateLimitDecision(False, max(1, ceil(min(q[1] for q in self._owner_quotas.values()) - now)))
            self._global_count, self._global_reset_at = global_count + 1, global_reset_at
            self._owner_quotas[key] = (count + 1, reset_at)
            return RateLimitDecision(True)

    @contextmanager
    def admit(self, owner_id: int, family: str):
        self._validate(owner_id, family)
        with self._lock:
            if (self._in_flight >= self._max_concurrent
                    or self._owner_in_flight.get(owner_id, 0) >= self._owner_max_concurrent):
                raise BillingRateLimitExceeded(1)
            self._in_flight += 1
            self._owner_in_flight[owner_id] = self._owner_in_flight.get(owner_id, 0) + 1
        try:
            decision = self._consume(owner_id, family)
            if not decision.allowed:
                raise BillingRateLimitExceeded(decision.retry_after_seconds)
            yield
        finally:
            with self._lock:
                self._in_flight -= 1
                remaining = self._owner_in_flight[owner_id] - 1
                if remaining:
                    self._owner_in_flight[owner_id] = remaining
                else:
                    del self._owner_in_flight[owner_id]


class _UnavailableRedis:
    def eval(self, *args):
        raise BillingRateLimiterUnavailable()


def build_billing_admission_limiter(redis_url: str) -> BillingAdmissionLimiter:
    if not redis_url:
        return BillingAdmissionLimiter()
    try:
        if redis is None:
            raise BillingRateLimiterUnavailable()
        client = redis.from_url(redis_url, decode_responses=True,
                                socket_connect_timeout=0.25, socket_timeout=0.25)
    except Exception:
        client = _UnavailableRedis()
    return BillingAdmissionLimiter(client=client)
