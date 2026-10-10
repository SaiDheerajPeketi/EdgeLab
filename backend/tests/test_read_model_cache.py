from concurrent.futures import ThreadPoolExecutor
from fnmatch import fnmatch
from threading import Barrier, Event, RLock

import pytest

from app.services import read_models
from app.services.read_models import MemoryReadModelCache, ReadModelCacheService, RedisReadModelCache


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.lock = RLock()

    def eval(self, script, numkeys, *args):
        with self.lock:
            if script == read_models.REDIS_LOAD_GENERATION:
                key, token, ttl = args
                if key not in self.values:
                    self.set(key, token, ex=ttl)
                return self.values[key]
            if script == read_models.REDIS_PUBLISH_IF_CURRENT:
                generation_key, data_key, token, payload, ttl = args
                if self.values.get(generation_key) != token:
                    return 0
                self.set(data_key, payload, ex=ttl)
                return 1
            raise AssertionError("Unexpected Lua script")

    def get(self, key: str):
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.values[key] = value

    def scan_iter(self, match: str):
        keys = [key for key in self.values if fnmatch(key, match)]
        for key in keys:
            yield key

    def delete(self, *keys: str) -> None:
        for key in keys:
            self.values.pop(key, None)


def test_bootstrap_shell_cache_reuses_loader_until_invalidated():
    cache = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60,
        dataset_catalog_ttl_seconds=60,
    )
    calls = 0

    def load():
        nonlocal calls
        calls += 1
        return {"calls": calls}

    first = cache.get_bootstrap_shell(7, 50, load)
    second = cache.get_bootstrap_shell(7, 50, load)
    cache.invalidate_bootstrap_shell(7)
    third = cache.get_bootstrap_shell(7, 50, load)

    assert first == {"calls": 1}
    assert second == {"calls": 1}
    assert third == {"calls": 2}
    assert calls == 2


def test_dataset_catalog_cache_is_user_scoped():
    cache = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60,
        dataset_catalog_ttl_seconds=60,
    )
    calls = 0

    def load():
        nonlocal calls
        calls += 1
        return {"calls": calls}

    first = cache.get_dataset_catalog(1, load)
    second = cache.get_dataset_catalog(1, load)
    third = cache.get_dataset_catalog(2, load)

    assert first == {"calls": 1}
    assert second == {"calls": 1}
    assert third == {"calls": 2}
    assert calls == 2


def test_redis_cache_backend_shares_bootstrap_shell_across_service_instances():
    backend = RedisReadModelCache(FakeRedis())
    first_cache = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60,
        dataset_catalog_ttl_seconds=60,
        backend=backend,
    )
    second_cache = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60,
        dataset_catalog_ttl_seconds=60,
        backend=backend,
    )
    calls = 0

    def load():
        nonlocal calls
        calls += 1
        return {"calls": calls}

    first = first_cache.get_bootstrap_shell(7, 50, load)
    second = second_cache.get_bootstrap_shell(7, 50, load)

    assert first == {"calls": 1}
    assert second == {"calls": 1}
    assert calls == 1


def test_redis_cache_backend_invalidation_clears_shared_dataset_catalog():
    backend = RedisReadModelCache(FakeRedis())
    first_cache = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60,
        dataset_catalog_ttl_seconds=60,
        backend=backend,
    )
    second_cache = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60,
        dataset_catalog_ttl_seconds=60,
        backend=backend,
    )
    calls = 0

    def load():
        nonlocal calls
        calls += 1
        return {"calls": calls}

    assert first_cache.get_dataset_catalog(9, load) == {"calls": 1}
    second_cache.invalidate_dataset_catalog(9)
    assert first_cache.get_dataset_catalog(9, load) == {"calls": 2}
    assert calls == 2


def test_memory_cache_bounds_payloads_and_retires_idle_load_locks():
    cache = MemoryReadModelCache(max_entries=3)
    for key in range(50):
        cache.get_or_load(str(key), 60, lambda key=key: key)
    assert list(cache._entries) == ["47", "48", "49"]
    assert not cache._loads_by_key
    # A hit refreshes recency without running a loader.
    assert cache.get_or_load("47", 60, lambda: pytest.fail("cache miss")) == 47
    cache.get_or_load("50", 60, lambda: 50)
    assert list(cache._entries) == ["49", "47", "50"]


def test_memory_cache_sweeps_expired_other_keys(monkeypatch):
    now = 100.0
    monkeypatch.setattr(read_models, "monotonic", lambda: now)
    cache = MemoryReadModelCache()
    cache.get_or_load("short", 1, lambda: "expired")
    cache.get_or_load("long", 60, lambda: "retained")
    now += 2
    cache.get_or_load("new", 60, lambda: "new")
    assert list(cache._entries) == ["long", "new"]


def test_memory_cache_concurrent_misses_share_one_load_and_retire_lock():
    cache = MemoryReadModelCache()
    started, release = Event(), Event()
    callers = Barrier(8)
    calls = 0

    def load():
        nonlocal calls
        calls += 1
        started.set()
        assert release.wait(5)
        return {"calls": calls}

    def get():
        callers.wait(5)
        return cache.get_or_load("shared", 60, load)

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(get) for _ in range(8)]
        assert started.wait(5)
        release.set()
        assert [future.result(5) for future in futures] == [{"calls": 1}] * 8
    assert calls == 1
    assert not cache._loads_by_key


@pytest.mark.parametrize("operation", ["invalidate_key", "invalidate_prefix", "clear"])
def test_memory_invalidation_during_load_does_not_restore_stale_value(operation):
    cache = MemoryReadModelCache()
    started, release = Event(), Event()

    def load():
        started.set()
        assert release.wait(5)
        return "stale"

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(cache.get_or_load, "shared", 60, load)
        assert started.wait(5)
        if operation == "clear":
            cache.clear()
        else:
            getattr(cache, operation)("shared")
        release.set()
        assert future.result(5) == "stale"
    assert cache.get_or_load("shared", 60, lambda: "fresh") == "fresh"
    assert not cache._loads_by_key


def test_memory_failed_load_does_not_retain_lock():
    cache = MemoryReadModelCache()
    with pytest.raises(ValueError):
        cache.get_or_load("failed", 60, lambda: int("invalid"))
    assert not cache._loads_by_key
    assert cache.get_or_load("failed", 60, lambda: "recovered") == "recovered"


@pytest.mark.parametrize("backend_factory", [MemoryReadModelCache, lambda: RedisReadModelCache(FakeRedis())])
def test_catalog_invalidation_does_not_evict_another_user_with_shared_prefix(backend_factory):
    cache = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60,
        dataset_catalog_ttl_seconds=60,
        backend=backend_factory(),
    )
    cache.get_dataset_catalog(1, lambda: "first")
    cache.get_dataset_catalog(10, lambda: "second")
    cache.invalidate_dataset_catalog(1)
    assert cache.get_dataset_catalog(10, lambda: pytest.fail("cross-user eviction")) == "second"
    assert cache.get_dataset_catalog(1, lambda: "fresh") == "fresh"


def test_redis_clear_preserves_other_services_and_bounds_delete_commands():
    class BatchRedis(FakeRedis):
        def __init__(self):
            super().__init__()
            self.batches = []

        def unlink(self, *keys):
            self.batches.append(len(keys))
            self.delete(*keys)

    client = BatchRedis()
    client.values["edgelab:billing:quota:owner:1"] = "keep"
    client.values["another-app:cache"] = "keep"
    cache = RedisReadModelCache(client)
    for key in range(600):
        cache.get_or_load(str(key), 60, lambda: "discard")
    cache.clear()
    assert client.values == {
        "edgelab:billing:quota:owner:1": "keep",
        "another-app:cache": "keep",
    }
    assert client.batches == [256, 256, 88, 256, 256, 88]


def test_shared_scope_reuses_cache_and_invalidations_across_workers():
    client = FakeRedis()
    first = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60, dataset_catalog_ttl_seconds=60,
        storage_scope="postgresql://same-storage", backend=RedisReadModelCache(client),
    )
    second = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60, dataset_catalog_ttl_seconds=60,
        storage_scope="postgresql://same-storage", backend=RedisReadModelCache(client),
    )
    first_scope = first.user_scope(7, local_identity=object())
    second_scope = second.user_scope(7, local_identity=object())
    assert first_scope == second_scope
    first.get_bootstrap_shell(first_scope, 50, lambda: "cached")
    assert second.get_bootstrap_shell(second_scope, 50, lambda: pytest.fail("worker cache miss")) == "cached"
    second.invalidate_bootstrap_shell(second_scope)
    assert first.get_bootstrap_shell(first_scope, 50, lambda: "updated") == "updated"
    other = ReadModelCacheService(
        bootstrap_shell_ttl_seconds=60, dataset_catalog_ttl_seconds=60,
        storage_scope="postgresql://another-storage", backend=RedisReadModelCache(client),
    )
    assert other.user_scope(7, local_identity=object()) != first_scope
    assert "postgresql" not in first_scope


def test_memory_scope_keeps_independent_local_stores_isolated():
    cache = ReadModelCacheService(bootstrap_shell_ttl_seconds=60, dataset_catalog_ttl_seconds=60)
    first, second = object(), object()
    assert cache.user_scope(7, local_identity=first) != cache.user_scope(7, local_identity=second)


@pytest.mark.parametrize("operation", ["invalidate_key", "invalidate_prefix", "clear"])
def test_redis_invalidation_fences_admitted_loader_publication(operation):
    client = FakeRedis()
    loader_worker = RedisReadModelCache(client)
    writer_worker = RedisReadModelCache(client)
    started, release = Event(), Event()

    def load():
        started.set()
        assert release.wait(5)
        return "before-write"

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(loader_worker.get_or_load, "user:7", 60, load)
        assert started.wait(5)
        if operation == "clear":
            writer_worker.clear()
        else:
            getattr(writer_worker, operation)("user:7")
        release.set()
        assert future.result(5) == "before-write"
    assert loader_worker.get_or_load("user:7", 60, lambda: "after-write") == "after-write"
    assert writer_worker.get_or_load("user:7", 60, lambda: pytest.fail("cache miss")) == "after-write"


def test_redis_expired_generation_cannot_admit_an_old_loader():
    client = FakeRedis()
    old_worker = RedisReadModelCache(client)
    started, release = Event(), Event()

    def old_load():
        started.set()
        assert release.wait(5)
        return "old"

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(old_worker.get_or_load, "same", 60, old_load)
        assert started.wait(5)
        client.values.pop(f"{read_models.REDIS_CACHE_NAMESPACE}generation:same")
        # Admission after generation expiry gets a new unpredictable token.
        assert RedisReadModelCache(client).get_or_load("same", 60, lambda: "new") == "new"
        release.set()
        assert future.result(5) == "old"
    assert old_worker.get_or_load("same", 60, lambda: pytest.fail("stale publication")) == "new"
