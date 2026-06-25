from app.services.read_models import ReadModelCacheService


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
