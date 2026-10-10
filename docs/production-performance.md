# Production performance audit — 10 October 2026

This iteration inspected chart conversion, caching, dataset polling, analytics, frontend loading, chart/feed scheduling and Compose/Nginx. These isolated synthetic measurements describe individual paths on a developer machine, not production capacity.

| Workload | Before | After |
| --- | --- | --- |
| Read cache: 20,000 unique 4 KiB payloads | 20,000 entries/locks; 93,603,410 bytes retained | 256 entries, zero idle locks; 1,173,288 bytes |
| 300-candle conversion, 20 samples | 6.170 ms mean | 1.305 ms; identical outputs |
| 5,000-candle conversion, 20 samples | 102.692 ms mean | 19.899 ms; identical outputs |
| 5,000-trade summary, 20 paired samples | 64.937 ms mean | 17.817 ms; identical outputs |
| 5,000-trade curves, 20 paired samples | 61.809 ms mean | 24.711 ms; identical outputs |
| 5,000-trade full metrics, 20 paired samples | 103.734 ms mean | 39.604 ms; identical outputs |

## Implemented changes

Memory read caching has a 256-entry LRU limit, expiry cleanup and locks retained only by active callers. Writes fence in-flight publications. Redis caches use a dedicated namespace and stable hashed storage/user scopes so workers share hits and invalidations. Random expiring generations plus atomic Lua publication fence stale loaders after writes. Bounded 256-key UNLINK batches preserve unrelated billing/rate-limit keys. The market-service registry retains at most 128 recent services; active requests survive eviction and source changes remain checked.

SQL and CSV candles now use tuples instead of one pandas Series per bar, preserving timestamps, timezones, OHLCV and nullable indicator warmup. Metrics select eleven required fields instead of full ORM trade objects, notes, screenshots and order settings. Summary drawdown uses scalar accumulation without allocating an unused curve. User/session filters and complete chronological statistics remain intact, with full-result parity tests. Idle dataset status reads do not allocate refresh-history records; acquired refresh-lock behavior is preserved.

FVG calculation is skipped without a visible gap study, and render/hit-test passes reuse timestamp coordinate lookups. Half-candle boundaries interpolate real integer coordinates to preserve placement through pan/zoom. Study readouts stay bounded while every installed study remains accessible.

## Existing efficiencies verified

Public/workspace/chart/editor/quant/3D modules remain lazy; Pine executes in an isolated worker with bounded live queues. Hero and 3D work pause offscreen/hidden. Chart engines mount progressively, and Journal lists use bounded DOM windows.

Nginx already compresses responses, caches versioned assets and reuses upstream connections. Compose keeps telemetry behind optional profiles, defaults to at most two API workers (one for SQLite), uses PgBouncer and disables filesystem auto-discovery for production datasets. Ordinary chart SQL uses indexed bounded windows.

A temporary 20,000-candle SQLite store returned 300 bars at 4.51 ms mean/4.81 ms P95. Bootstrap with 200 assets, six timeframes, 200 sessions/trades produced a 4,958-byte shell versus a 551,054-byte full payload; warm shell requests reused the cache. Existing frontend bundle/route budgets pass without increases.

Metrics still compute chronological statistics over selected trades because drawdown, streaks and returns require their order. No results are truncated. Auth, revocation, subscription and paid-export checks remain uncached.

## Reproduce and limits

From the repository root:

- `PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_hot_paths.py`
- Add `--compare-cache-source /absolute/path/to/baseline_read_models.py`; extract the baseline from commit `01dc982`.
- `PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_market_data_storage.py --iterations 10`
- `PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_metrics_profiles.py --iterations 10`
- `PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_bootstrap_profiles.py --iterations 10`
- `npm run build`, then `npm run check:ui-performance`

The scripts use temporary synthetic stores. The market-storage benchmark now supplies both current metadata and candle session factories. Never seed a customer database for a benchmark.

This environment has no usable Docker Compose plugin/daemon or Redis server. PostgreSQL/TimescaleDB/Redis Lua execution and the k6 capacity sweep were not exercised. Redis race tests use a command-contract model; the container/load harness in [benchmark/README.md](../benchmark/README.md) remains the deployment verification path. These measurements establish no concurrent-user or whole-application throughput claim.

A later isolated Docker/PostgreSQL/Redis verification is recorded in [production capacity and deployment](production-capacity.md). The earlier microbenchmarks and their limits above remain historical measurements.
