from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from hashlib import sha256
from secrets import token_hex
import json
import logging
from threading import Lock
from time import monotonic
from typing import TypeVar

from fastapi import HTTPException

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


# Production normally uses shared Redis; keep the per-worker fallback bounded.
MEMORY_CACHE_MAX_ENTRIES = 256
REDIS_CACHE_NAMESPACE = "edgelab:read-model:v1:"
REDIS_INVALIDATION_BATCH_SIZE = 256

# Expiring random generations cannot reset to an earlier value after expiry.
REDIS_LOAD_GENERATION = """
local generation = redis.call('GET', KEYS[1])
if generation then return generation end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return ARGV[1]
"""
REDIS_PUBLISH_IF_CURRENT = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1
"""


@dataclass
class PendingLoad:
    lock: Lock = field(default_factory=Lock)
    users: int = 0
    version: int = 0


class MemoryReadModelCache:
    def __init__(self, *, max_entries: int = MEMORY_CACHE_MAX_ENTRIES) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be positive")
        self._max_entries = max_entries
        self._entries: OrderedDict[str, CacheEntry] = OrderedDict()
        self._loads_by_key: dict[str, PendingLoad] = {}
        self._next_expiry_sweep = 0.0
        self._lock = Lock()

    def _fresh_entry(self, key: str, now: float) -> CacheEntry | None:
        entry = self._entries.get(key)
        if entry is not None:
            if entry.expires_at > now:
                self._entries.move_to_end(key)
                return entry
            self._entries.pop(key)
        return None

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

        with self._lock:
            entry = self._fresh_entry(key, monotonic())
            if entry is not None:
                return entry.value  # type: ignore[return-value]
            pending = self._loads_by_key.setdefault(key, PendingLoad())
            pending.users += 1

        try:
            with pending.lock:
                with self._lock:
                    entry = self._fresh_entry(key, monotonic())
                    if entry is not None:
                        return entry.value  # type: ignore[return-value]
                    version = pending.version

                value = loader()
                with self._lock:
                    # A write/clear during loading must not republish stale data.
                    if pending.version == version:
                        now = monotonic()
                        if now >= self._next_expiry_sweep:
                            for expired in [
                                name for name, item in self._entries.items()
                                if item.expires_at <= now
                            ]:
                                self._entries.pop(expired)
                            self._next_expiry_sweep = now + 1.0
                        self._entries[key] = CacheEntry(value, now + ttl_seconds)
                        self._entries.move_to_end(key)
                        while len(self._entries) > self._max_entries:
                            self._entries.popitem(last=False)
                return value
        finally:
            with self._lock:
                pending.users -= 1
                if pending.users == 0:
                    self._loads_by_key.pop(key)

    def invalidate_key(self, key: str) -> None:
        with self._lock:
            self._entries.pop(key, None)
            pending = self._loads_by_key.get(key)
            if pending is not None:
                pending.version += 1

    def invalidate_prefix(self, prefix: str) -> None:
        with self._lock:
            for key in [key for key in self._entries if key.startswith(prefix)]:
                self._entries.pop(key)
            for key, pending in self._loads_by_key.items():
                if key.startswith(prefix):
                    pending.version += 1

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            for pending in self._loads_by_key.values():
                pending.version += 1


class RedisReadModelCache:
    def __init__(self, client) -> None:
        self._client = client
        self._last_failure_log_at = float("-inf")
        self._failure_log_lock = Lock()

    def _report_failure(self) -> None:
        with self._failure_log_lock:
            now = monotonic()
            if now - self._last_failure_log_at >= 30:
                logger.warning("Redis read-model cache unavailable; using uncached reads")
                self._last_failure_log_at = now

    def get_or_load(
        self,
        key: str,
        ttl_seconds: int,
        loader: Callable[[], T],
        *,
        serializer: Callable[[T], str] | None = None,
        deserializer: Callable[[str], T] | None = None,
    ) -> T:
        if ttl_seconds <= 0 or self._client is None:
            return loader()

        cache_key = f"{REDIS_CACHE_NAMESPACE}data:{key}"
        generation_key = f"{REDIS_CACHE_NAMESPACE}generation:{key}"
        try:
            raw = self._client.get(cache_key)
            generation = None if raw is not None else self._client.eval(
                REDIS_LOAD_GENERATION, 1, generation_key, token_hex(16), max(60, ttl_seconds),
            )
        except redis.exceptions.RedisError:
            self._report_failure()
            return loader()
        if raw is not None:
            payload = raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
            if deserializer is not None:
                return deserializer(payload)
            return json.loads(payload)

        value = loader()
        payload = serializer(value) if serializer is not None else json.dumps(value)
        # The read and publication comparison is atomic with respect to invalidation.
        try:
            self._client.eval(
                REDIS_PUBLISH_IF_CURRENT, 2, generation_key, cache_key,
                generation, payload, ttl_seconds,
            )
        except redis.exceptions.RedisError:
            self._report_failure()
        return value

    def _remove_keys(self, keys) -> None:
        # UNLINK frees payloads off the Redis request thread; keep each command bounded.
        if self._client is None:
            return
        try:
            remove = getattr(self._client, "unlink", self._client.delete)
            batch = []
            for key in keys:
                batch.append(key)
                if len(batch) == REDIS_INVALIDATION_BATCH_SIZE:
                    remove(*batch)
                    batch.clear()
            if batch:
                remove(*batch)
        except redis.exceptions.RedisError:
            self._report_failure()
            # A missed shared invalidation must not report a completed write.
            raise HTTPException(503, "Cache synchronization unavailable. Try again shortly.",
                                headers={"Retry-After": "1", "Cache-Control": "no-store"}) from None

    def invalidate_key(self, key: str) -> None:
        self._remove_keys([
            f"{REDIS_CACHE_NAMESPACE}generation:{key}",
            f"{REDIS_CACHE_NAMESPACE}data:{key}",
        ])

    def invalidate_prefix(self, prefix: str) -> None:
        if self._client is None:
            return
        # Retire admitted loaders first, then remove their previously published data.
        # Both scans are bounded; a loader admitted after the write reads fresh storage.
        self._remove_keys(self._client.scan_iter(match=f"{REDIS_CACHE_NAMESPACE}generation:{prefix}*"))
        self._remove_keys(self._client.scan_iter(match=f"{REDIS_CACHE_NAMESPACE}data:{prefix}*"))

    def clear(self) -> None:
        self.invalidate_prefix("")


def build_read_model_cache_backend(redis_url: str):
    if not redis_url:
        return MemoryReadModelCache()
    if redis is None:
        logger.warning("Redis cache requested but redis package missing; using uncached reads")
        return RedisReadModelCache(None)
    try:
        client = redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        )
        return RedisReadModelCache(client)
    except Exception:
        logger.warning("Redis read-model cache unavailable; using uncached reads")
        return RedisReadModelCache(None)


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
        storage_scope: str = "edgelab",
        backend=None,
    ) -> None:
        self.bootstrap_shell_ttl_seconds = bootstrap_shell_ttl_seconds
        self.dataset_catalog_ttl_seconds = dataset_catalog_ttl_seconds
        self._cache = backend or build_read_model_cache_backend(redis_url)
        self._shared_scope = (
            sha256(storage_scope.encode("utf-8")).hexdigest()
            if isinstance(self._cache, RedisReadModelCache) else None
        )

    def user_scope(self, user_id: int, *, local_identity: object) -> str:
        # Redis keys/invalidation must agree across API workers; local fixture
        # services can still have independent stores with the same user IDs.
        scope = self._shared_scope if self._shared_scope is not None else str(id(local_identity))
        return f"{scope}:{user_id}"

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
        self._cache.invalidate_key(f"dataset-catalog:{user_scope}")

    def invalidate_user(self, bootstrap_scope: object, dataset_scope: object | None = None) -> None:
        self.invalidate_bootstrap_shell(bootstrap_scope)
        self.invalidate_dataset_catalog(dataset_scope if dataset_scope is not None else bootstrap_scope)

    def clear(self) -> None:
        self._cache.clear()
