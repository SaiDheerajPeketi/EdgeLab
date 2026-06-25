from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import json
import logging
from threading import Lock
from time import monotonic
from typing import TypeVar

try:
    import redis
except Exception:  # pragma: no cover - optional dependency
    redis = None


T = TypeVar("T")
logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    value: object
    expires_at: float


class MemoryReadModelCache:
    def __init__(self) -> None:
        self._entries: dict[str, CacheEntry] = {}
        self._locks_by_key: dict[str, Lock] = {}
        self._lock = Lock()

    def get_or_load(
        self,
        key: str,
        ttl_seconds: int,
        loader: Callable[[], T],
        *,
        serializer: Callable[[T], str] | None = None,
        deserializer: Callable[[str], T] | None = None,
    ) -> T:
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


class RedisReadModelCache:
    def __init__(self, client) -> None:
        self._client = client

    def get_or_load(
        self,
        key: str,
        ttl_seconds: int,
        loader: Callable[[], T],
        *,
        serializer: Callable[[T], str] | None = None,
        deserializer: Callable[[str], T] | None = None,
    ) -> T:
        if ttl_seconds <= 0:
            return loader()

        raw = self._client.get(key)
        if raw is not None:
            payload = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
            if deserializer is not None:
                return deserializer(payload)
            return json.loads(payload)

        value = loader()
        payload = serializer(value) if serializer is not None else json.dumps(value)
        self._client.set(key, payload, ex=ttl_seconds)
        return value

    def invalidate_prefix(self, prefix: str) -> None:
        keys = list(self._client.scan_iter(match=f"{prefix}*"))
        if keys:
            self._client.delete(*keys)

    def clear(self) -> None:
        keys = list(self._client.scan_iter(match="*"))
        if keys:
            self._client.delete(*keys)


def build_read_model_cache_backend(redis_url: str):
    if not redis_url:
        return MemoryReadModelCache()
    if redis is None:
        logger.warning("Redis cache requested but redis package missing; using memory cache")
        return MemoryReadModelCache()
    try:
        client = redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        )
        client.ping()
        return RedisReadModelCache(client)
    except Exception:
        logger.warning("Redis cache unavailable at %s; using memory cache", redis_url, exc_info=True)
        return MemoryReadModelCache()


def serialize_cached_value(value: object) -> str:
    if hasattr(value, "model_dump_json"):
        return value.model_dump_json()
    return json.dumps(value)


def deserialize_cached_value(payload: str, model_cls: type[T] | None = None) -> T:
    if model_cls is not None and hasattr(model_cls, "model_validate_json"):
        return model_cls.model_validate_json(payload)
    return json.loads(payload)


class ReadModelCacheService:
    def __init__(
        self,
        *,
        bootstrap_shell_ttl_seconds: int,
        dataset_catalog_ttl_seconds: int,
        redis_url: str = "",
        backend=None,
    ) -> None:
        self.bootstrap_shell_ttl_seconds = bootstrap_shell_ttl_seconds
        self.dataset_catalog_ttl_seconds = dataset_catalog_ttl_seconds
        self._cache = backend or build_read_model_cache_backend(redis_url)

    def get_bootstrap_shell(
        self,
        user_scope: object,
        limit: int,
        loader: Callable[[], T],
        *,
        model_cls: type[T] | None = None,
    ) -> T:
        return self._cache.get_or_load(
            f"bootstrap-shell:{user_scope}:{limit}",
            self.bootstrap_shell_ttl_seconds,
            loader,
            serializer=serialize_cached_value,
            deserializer=lambda payload: deserialize_cached_value(payload, model_cls),
        )

    def get_dataset_catalog(
        self,
        user_scope: object,
        loader: Callable[[], T],
        *,
        model_cls: type[T] | None = None,
    ) -> T:
        return self._cache.get_or_load(
            f"dataset-catalog:{user_scope}",
            self.dataset_catalog_ttl_seconds,
            loader,
            serializer=serialize_cached_value,
            deserializer=lambda payload: deserialize_cached_value(payload, model_cls),
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
