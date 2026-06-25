from app.services.read_models import ReadModelCacheService, RedisReadModelCache


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    def get(self, key: str):
        return self.values.get(key)

    def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.values[key] = value

    def scan_iter(self, match: str):
        if match == "*":
            keys = list(self.values)
        else:
            prefix = match[:-1] if match.endswith("*") else match
            keys = [key for key in self.values if key.startswith(prefix)]
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
