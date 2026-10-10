"""Cache outages stay optional; security admission and invalidation stay strict."""
import os
from uuid import uuid4

from fastapi import HTTPException
import pytest
import redis

from app.services import rate_limits, read_models
from app.services.auth_rate_limits import AuthRateLimiterUnavailable, GoogleExchangeLimiter
from app.services.billing_rate_limits import BillingAdmissionLimiter, BillingRateLimiterUnavailable
from tests.test_read_model_cache import FakeRedis


class FaultRedis(FakeRedis):
    failure = None
    error = redis.exceptions.ConnectionError

    def get(self, key):
        if self.failure == "get":
            raise self.error("Private transport details")
        return super().get(key)

    def eval(self, script, numkeys, *args):
        phase = "generation" if script == read_models.REDIS_LOAD_GENERATION else "publication"
        if self.failure == phase:
            raise self.error("Private cache details")
        return super().eval(script, numkeys, *args)

    def delete(self, *keys):
        if self.failure == "invalidation":
            raise self.error("Private transport details")
        return super().delete(*keys)


@pytest.mark.parametrize("phase", ["get", "generation", "publication"])
@pytest.mark.parametrize("error", [redis.exceptions.ConnectionError, redis.exceptions.OutOfMemoryError])
def test_cache_fault_returns_fresh_data_without_publishing_and_recovers(phase, error):
    client = FaultRedis()
    cache = read_models.RedisReadModelCache(client)
    client.failure, client.error = phase, error
    assert cache.get_or_load("owner", 60, lambda: "first") == "first"
    assert cache.get_or_load("owner", 60, lambda: "second") == "second"
    assert f"{read_models.REDIS_CACHE_NAMESPACE}data:owner" not in client.values
    client.failure = None
    assert cache.get_or_load("owner", 60, lambda: "recovered") == "recovered"
    assert cache.get_or_load("owner", 60, lambda: pytest.fail("Recovered cache missed")) == "recovered"


def test_cache_does_not_retry_or_swallow_loader_failures():
    cache = read_models.RedisReadModelCache(FakeRedis())
    calls = []

    def loader():
        calls.append(True)
        raise redis.exceptions.ConnectionError("Loader admission failed")

    with pytest.raises(redis.exceptions.ConnectionError, match="Loader admission failed"):
        cache.get_or_load("owner", 60, loader)
    assert calls == [True]


@pytest.mark.parametrize("operation", ["invalidate_key", "invalidate_prefix", "clear"])
def test_unconfirmed_invalidation_is_retryable_and_sanitized(operation):
    client = FaultRedis()
    cache = read_models.RedisReadModelCache(client)
    cache.get_or_load("owner", 60, lambda: "cached")
    client.failure = "invalidation"
    with pytest.raises(HTTPException) as error:
        getattr(cache, operation)(*(() if operation == "clear" else ("owner",)))
    assert error.value.status_code == 503
    assert error.value.headers["Retry-After"] == "1"
    assert "Private" not in error.value.detail


def test_configured_cache_keeps_redis_client_without_startup_ping(monkeypatch):
    client = FaultRedis()
    client.failure = "get"
    monkeypatch.setattr(read_models.redis, "from_url", lambda *_args, **_kwargs: client)
    cache = read_models.build_read_model_cache_backend("redis://fixture")
    assert isinstance(cache, read_models.RedisReadModelCache)
    assert cache.get_or_load("owner", 60, lambda: "offline") == "offline"
    client.failure = None
    assert cache.get_or_load("owner", 60, lambda: "online") == "online"


def test_invalid_cache_configuration_remains_uncached(monkeypatch):
    def invalid(*_args, **_kwargs):
        raise ValueError("Private URL")

    monkeypatch.setattr(read_models.redis, "from_url", invalid)
    cache = read_models.build_read_model_cache_backend("invalid")
    assert cache.get_or_load("owner", 60, lambda: "first") == "first"
    assert cache.get_or_load("owner", 60, lambda: "second") == "second"
    cache.clear()


@pytest.mark.parametrize("reply", [None, [0, 10], [1, -1], [1, 61], [True, 10]])
def test_general_limiter_rejects_malformed_admission(reply):
    class Client:
        def eval(self, *_args):
            return reply

    with pytest.raises(HTTPException) as error:
        rate_limits.RedisRateLimiter(Client()).consume("owner", limit=1, window_seconds=60)
    assert error.value.status_code == 503
    assert error.value.headers["Retry-After"] == "1"


def test_configured_general_limiter_outage_has_no_memory_fallback(monkeypatch):
    class Client:
        fail = True

        def eval(self, *_args):
            if self.fail:
                raise redis.exceptions.ConnectionError("Private transport")
            return [2, 59]

    client = Client()
    monkeypatch.setattr(rate_limits.redis, "from_url", lambda *_args, **_kwargs: client)
    limiter = rate_limits.build_rate_limiter("redis://fixture")
    with pytest.raises(HTTPException) as error:
        limiter.consume("owner", limit=1, window_seconds=60)
    assert error.value.status_code == 503
    assert "Private" not in error.value.detail
    client.fail = False
    assert limiter.consume("owner", limit=1, window_seconds=60).allowed is False


@pytest.fixture
def real_redis():
    url = os.getenv("EDGELAB_TEST_REDIS_URL")
    if not url:
        pytest.skip("Set EDGELAB_TEST_REDIS_URL for real Redis Lua/error checks")
    client = redis.from_url(url, decode_responses=True, socket_timeout=1, socket_connect_timeout=1)
    client.ping()
    yield client
    client.close()


@pytest.mark.parametrize("phase", ["generation", "publication"])
def test_real_redis_oom_reply_is_cache_only_and_recovers(real_redis, phase):
    key = f"cache209:{uuid4().hex}"

    class Client:
        failure = phase
        get = real_redis.get
        delete = real_redis.delete
        unlink = real_redis.unlink

        def eval(self, script, numkeys, *args):
            boundary = "generation" if script == read_models.REDIS_LOAD_GENERATION else "publication"
            if self.failure == boundary:
                # A real Redis wire OOM response, without changing server limits.
                return real_redis.eval("return redis.error_reply('OOM isolated cache fixture')", 0)
            return real_redis.eval(script, numkeys, *args)

    client = Client()
    cache = read_models.RedisReadModelCache(client)
    try:
        assert cache.get_or_load(key, 60, lambda: "fresh") == "fresh"
        assert real_redis.get(f"{read_models.REDIS_CACHE_NAMESPACE}data:{key}") is None
        client.failure = None
        assert cache.get_or_load(key, 60, lambda: "recovered") == "recovered"
        assert cache.get_or_load(key, 60, lambda: pytest.fail("Missing Redis hit")) == "recovered"
    finally:
        cache.invalidate_key(key)


def test_real_redis_admission_is_atomic_and_oom_never_bypasses_quotas(real_redis):
    key = f"rate-limit:cache209:{uuid4().hex}"
    try:
        limiter = rate_limits.RedisRateLimiter(real_redis)
        assert limiter.consume(key, limit=1, window_seconds=60).allowed
        assert real_redis.ttl(key) > 0
        assert not limiter.consume(key, limit=1, window_seconds=60).allowed
        real_redis.persist(key)
        assert not limiter.consume(key, limit=1, window_seconds=60).allowed
        assert real_redis.ttl(key) > 0

        class OOMClient:
            def eval(self, *_args):
                return real_redis.eval("return redis.error_reply('OOM isolated quota fixture')", 0)

        with pytest.raises(HTTPException) as error:
            rate_limits.RedisRateLimiter(OOMClient()).consume(key, limit=1, window_seconds=60)
        assert error.value.status_code == 503
        with pytest.raises(AuthRateLimiterUnavailable):
            GoogleExchangeLimiter(client=OOMClient()).consume()
        with pytest.raises(BillingRateLimiterUnavailable):
            with BillingAdmissionLimiter(client=OOMClient()).admit(1, "status"):
                pytest.fail("Billing OOM admitted work")
    finally:
        real_redis.delete(key)
