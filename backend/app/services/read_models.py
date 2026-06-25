from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from time import monotonic
from typing import TypeVar


T = TypeVar("T")


@dataclass
class CacheEntry:
    value: object
    expires_at: float


class MemoryReadModelCache:
    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}
        self._locks_by_key: dict[str, Lock] = {}
        self._lock = Lock()

    def get_or_load(self, key: str, ttl_seconds: int, loader: Callable[[], T]) -> T:
        if ttl_seconds <= 0:
            return loader()

        now = monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and entry.expires_at > now:
                return entry.value  # type: ignore[return-value]
            key_lock = self._locks_by_key.setdefault(key, Lock())

        with key_lock:
            now = monotonic()
            with self._lock:
                entry = self._entries.get(key)
                if entry is not None and entry.expires_at > now:
                    return entry.value  # type: ignore[return-value]

            value = loader()
            with self._lock:
                self._entries[key] = CacheEntry(
                    value=value,
                    expires_at=monotonic() + ttl_seconds,
                )
            return value

    def invalidate_prefix(self, prefix: str) -> None:
        with self._lock:
            for key in [key for key in self._entries if key.startswith(prefix)]:
                self._entries.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


class ReadModelCacheService:
    def __init__(
        self,
        *,
        bootstrap_shell_ttl_seconds: int,
        dataset_catalog_ttl_seconds: int,
    ) -> None:
        self.bootstrap_shell_ttl_seconds = bootstrap_shell_ttl_seconds
        self.dataset_catalog_ttl_seconds = dataset_catalog_ttl_seconds
        self._cache = MemoryReadModelCache()

    def get_bootstrap_shell(
        self,
        user_scope: object,
        limit: int,
        loader: Callable[[], T],
    ) -> T:
        return self._cache.get_or_load(
            f"bootstrap-shell:{user_scope}:{limit}",
            self.bootstrap_shell_ttl_seconds,
            loader,
        )

    def get_dataset_catalog(self, user_scope: object, loader: Callable[[], T]) -> T:
        return self._cache.get_or_load(
            f"dataset-catalog:{user_scope}",
            self.dataset_catalog_ttl_seconds,
            loader,
        )

    def invalidate_bootstrap_shell(self, user_scope: object) -> None:
        self._cache.invalidate_prefix(f"bootstrap-shell:{user_scope}:")

    def invalidate_dataset_catalog(self, user_scope: object) -> None:
        self._cache.invalidate_prefix(f"dataset-catalog:{user_scope}")

    def invalidate_user(self, bootstrap_scope: object, dataset_scope: object | None = None) -> None:
        self.invalidate_bootstrap_shell(bootstrap_scope)
        self.invalidate_dataset_catalog(dataset_scope if dataset_scope is not None else bootstrap_scope)

    def clear(self) -> None:
        self._cache.clear()
