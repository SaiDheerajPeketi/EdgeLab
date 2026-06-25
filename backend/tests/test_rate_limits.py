from app.services.rate_limits import MemoryRateLimiter


def test_memory_rate_limiter_allows_within_window_then_blocks():
    limiter = MemoryRateLimiter()

    assert limiter.consume("bars:user:1", limit=2, window_seconds=60).allowed is True
    assert limiter.consume("bars:user:1", limit=2, window_seconds=60).allowed is True
    blocked = limiter.consume("bars:user:1", limit=2, window_seconds=60)

    assert blocked.allowed is False
    assert blocked.retry_after_seconds >= 1


def test_memory_rate_limiter_is_key_scoped():
    limiter = MemoryRateLimiter()

    assert limiter.consume("bars:user:1", limit=1, window_seconds=60).allowed is True
    assert limiter.consume("bars:user:2", limit=1, window_seconds=60).allowed is True
