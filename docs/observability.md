# Production observability and operating controls

The API exposes bounded Prometheus metrics, structured request logs, and optional sampled OTLP traces. Monitoring is an optional private Compose profile; it is not required to serve requests. The defaults preserve the measured SQL pools, thread reserves, and 250ms admission queue documented in [production capacity](production-capacity.md).

## Enable monitoring

1. Set a unique `EDGELAB_GRAFANA_ADMIN_PASSWORD` of at least 12 characters. There is no default password. Grafana validates it when the optional service starts; changing it later does not rotate an existing persisted administrator automatically.
2. Create a dedicated login on each monitored PostgreSQL server using an administrator. For example, in an interactive `psql` session: `CREATE ROLE edgelab_monitor LOGIN; GRANT pg_monitor TO edgelab_monitor;`, then `\password edgelab_monitor`. Set the matching `EDGELAB_MONITOR_DATABASE_USER`/`PASSWORD`. This grants monitoring access, not application-table ownership. Use an isolated monitoring role and private connections.
3. Exporter URIs automatically follow `POSTGRES_DB` and the bundled writers when blank. Set `EDGELAB_POSTGRES_EXPORTER_URI` / `EDGELAB_TIMESCALE_EXPORTER_URI` for custom remote stores. The efficient overlay monitors its single `postgres` writer and intentionally omits the unused Timescale exporter; DNS discovery does not create a false down alert for that disabled service. Username/password are separate from URI, so special characters do not corrupt the connection string.
4. Run `docker compose --profile observability up -d --build`. For a new efficient install, include `-f docker-compose.yml -f docker-compose.efficient.yml`. Existing database migrations remain explicit; this is not a data-storage conversion.
5. Reach Grafana at `http://127.0.0.1:3000`, Prometheus at `http://127.0.0.1:9090`, and check targets and local alerts. Remote operators should use an authenticated tunnel/private network. Nginx returns 404 for `/api/observability/metrics`; API/collector ports must remain private. `benchmark` remains a compatible profile.

Grafana includes service selection, request rate/latency/errors, admission use/rejections/waits, SQL pool use/timeouts, Redis hit/miss/error rates, interrupted responses and trace export results. Prometheus discovers each API replica via private DNS; each replica aggregates its own Gunicorn workers.

## What the metrics measure

Request duration and in-flight gauges cover the complete ASGI call, including response streaming and dependency cleanup. This is server wall time, not browser/network latency. Health, readiness, and scrape requests do not inflate traffic metrics. A failed stream can retain its already-sent HTTP status; `edgelab_http_interrupted_total` identifies incomplete or failed calls independently.

Methods have a finite allowlist. Routes use registered templates; unknown requests and rejections before routing use `unmatched`. Metrics contain no account IDs, raw URL paths, request IDs, IPs or query strings. Histograms have bounded configurable bucket counts. SQL gauges show each finite pool's active and maximum connections across live workers. Read-model Redis error counters include failed reads/publications/invalidations; they do not represent every Redis consumer or certify cache health by themselves.

Gunicorn creates a private `PROMETHEUS_MULTIPROC_DIR` before worker imports. Dead workers retire live gauges while completed counters/histograms persist until the master stops. Master shutdown removes its own generated directory; startup never reuses a prior master's counters. Standalone single-process Uvicorn uses an in-memory registry. Multi-worker launches must use `backend/scripts/start_api.sh` and its Gunicorn hooks, or provision the equivalent isolated directory and hooks. Never share this directory between replicas. Counter/histogram files remain for exited workers until the master restarts; unbounded worker recycling is unsuitable for a long-lived master.

## Configurable runtime bounds

All variables are listed in [`.env.example`](../.env.example) and forwarded to Python containers. Invalid numeric values, NaN, infinities, and incompatible trace batch sizes fail startup with the variable name.

| Control | Default | Accepted range / meaning |
| --- | --- | --- |
| `EDGELAB_HTTP_REQUEST_LIMIT` | 0 | 0 automatic; positive values lower the safe cap, up to 10,000 |
| `EDGELAB_HTTP_QUEUE_WAIT_SECONDS` | 0.25 | 0..5; 0 rejects immediately; more wait adds latency |
| `EDGELAB_HTTP_QUEUE_DEPTH` | 0 | 0 automatic active-cap size; explicit 1..1,024 |
| `EDGELAB_HTTP_PROBE_BUDGET` | 2 | 0..32, limited by SQL/thread headroom |
| `EDGELAB_HTTP_VALIDATION_THREAD_RESERVE` | 8 | 1..256 maximum adaptive reserve; capped at 20% of actual tokens |
| `EDGELAB_HTTP_SQL_CHECKOUT_MULTIPLIER` | 2 | 1..8, still bounded by actual thread headroom |
| `EDGELAB_DB_POOL_SIZE` / `MAX_OVERFLOW` | 5 / 10 | 1..1,000 / 0..1,000 per engine and worker; stay within pooler/server budgets |
| `EDGELAB_DB_POOL_TIMEOUT_SECONDS` | 5 | 0.1..60 |
| `EDGELAB_DB_CONNECT_TIMEOUT_SECONDS` | 10 | Integer 1..120 |
| `EDGELAB_DB_POOL_RECYCLE_SECONDS` | 1800 | Integer 1..86,400 |
| `EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS` | 60 | 0..300 |
| `EDGELAB_MEMORY_CACHE_MAX_ENTRIES` | 256 | Integer 1..10,000 per worker |
| `EDGELAB_REDIS_INVALIDATION_BATCH_SIZE` | 256 | Integer 1..1,000 |
| `EDGELAB_REDIS_CACHE_TIMEOUT_SECONDS` | 0.25 | 0.01..5 for cache connect and socket operations |
| `EDGELAB_CACHE_FAILURE_LOG_INTERVAL_SECONDS` | 30 | 1..3,600; counters still record every failure |
| `EDGELAB_METRICS_ENABLED` | 1 | Boolean; 0 disables recording and the scrape endpoint |
| `EDGELAB_HTTP_LATENCY_BUCKETS` | 5ms..10s | 1..24 strictly ascending, finite positive seconds |
| `EDGELAB_HTTP_LOG_SAMPLE_RATIO` | 0.1 | 0..1 success logging; errors and slow requests remain logged |
| `EDGELAB_HTTP_SLOW_REQUEST_SECONDS` | 1 | 0.001..3,600 |
| `EDGELAB_OTEL_TRACE_SAMPLE_RATIO` | 0.1 | 0..1; remote sampled parents cannot override the ratio |
| `EDGELAB_OTEL_MAX_QUEUE_SIZE` / `MAX_BATCH_SIZE` | 2048 / 512 | 1..65,536 / 1..4,096; batch cannot exceed queue |
| `EDGELAB_OTEL_SCHEDULE_DELAY_MS` | 5000 | Integer 100..60,000 |
| `EDGELAB_OTEL_EXPORT_TIMEOUT_SECONDS` | 5 | 0.1..30, HTTP attempt timeout; DNS resolution remains OS-managed |
| `EDGELAB_OTEL_SHUTDOWN_TIMEOUT_SECONDS` | 5 | 0.1..15 bounded processor drain wait; keep below process/container drain windows |
| `EDGELAB_MIGRATION_MAX_ATTEMPTS` / `RETRY_SECONDS` | 12 / 5 | Positive attempts / nonnegative retry interval |

Worker counts, process timeouts, cache TTLs, Redis memory, pooler budgets, analytics/ingestion cadence, ports, and image overrides retain their existing environment controls. Enlarge resource budgets only after measuring representative survivor load and latency; these knobs do not create extra hardware capacity.

## Privacy, cost, and retention

API request logs retain bounded correlation IDs, registered route templates, status and duration. Incoming IDs must match a 128-character safe allowlist; invalid IDs are regenerated. Raw paths, query strings, client addresses and duplicate server access logs are excluded. JSON and text exception logs keep exception types and stack locations, excluding exception messages that can include SQL values. Nginx access logs omit request URLs, addresses and referrers, while preserving upstream status/time. Its raw error sink is restricted to critical events; ordinary proxy failures remain visible in structured status logs without OAuth callback query data. Other application log statements still require normal review before adding user-controlled or secret-bearing fields.

OTLP export strips URLs, SQL statements, arbitrary attributes, exception messages/stack contents and status descriptions. Route, method, database operation, timing and causal trace IDs remain. SQL comments are disabled. Use `OTEL_EXPORTER_OTLP_HEADERS` for collector authentication; endpoints cannot contain embedded credentials or queries. The sanitized pipeline rejects externally initialized/conflicting SDK providers. Do not auto-instrument this launch with a second exporter.

Export runs on a bounded background queue. Each batch gets one HTTP attempt, without SDK retry loops or collector response-body logging. Collector outages drop traces and increment failure counters; requests do not wait for export. Shutdown waits for its configured drain budget, then stops exporting queued batches. Increase sampling briefly for diagnosis; queue overflow remains visible in SDK warnings.

Prometheus retains at most `EDGELAB_PROMETHEUS_RETENTION_TIME` (7d) and `EDGELAB_PROMETHEUS_RETENTION_SIZE` (2GB), with TSDB head/WAL overhead beyond the retention size. Loki keeps 168h by default, subject to compactor deletion delay; Tempo keeps 24h with asynchronous compaction. Persistent local volumes preserve monitoring history and Grafana state. Filesystem Loki/Tempo retention is time-based, not a strict disk quota: monitor free disk, reserve space, and use managed/object storage for larger deployments. Container JSON logs rotate at 10MB × 3 files by default. Sampling, intervals, ingestion/query limits, alert thresholds and collector retry limits can be tuned in `docker/observability` configuration files; image and retention overrides are environment-controlled.

Alloy replaces unsupported Promtail. It discovers this Compose project's application services only. The isolated Docker API guard permits narrowly scoped read endpoints, filters discovery, and synthesizes only the non-TTY/running metadata required by this collector; real inspect never exposes container environment secrets. Archive/export/exec/write APIs are denied. The collector is a trusted log reader: with another container's known ID, a compromised collector could request its logs. Use a dedicated deployment host and do not mix unrelated sensitive workloads on this Docker daemon. The socket is mounted only in the guard, never in Alloy.

## Alerts and incident checks

Prometheus evaluates target/discovery loss, SQL exporter connectivity, sustained server errors/latency, admission rejections, pool saturation, Redis failures, trace failures, dropped logs and failed alert evaluation. Rules and thresholds live in `docker/observability/alerts.yml`; dashboards and scrape/collector limits are editable configuration. Alerts appear locally in Prometheus. No email, chat, paging receiver, or external notification destination is configured.

Check target discovery before trusting empty graphs. For overload, inspect admission queue and SQL use; preserve validation/probe reserves. For Redis errors, check memory, private connectivity and invalidation failures before restarting. For failed telemetry, inspect collector availability and disk without changing application authorization. Monitoring is useful evidence, not a replacement for backup recovery, regional/network probes, or independent-zone failover testing.

## Verification — 10 October 2026

The isolated release checkout passed 1,430 Python tests and 2,283 JavaScript tests, the production frontend/source-offer build, all production Compose image builds, and Graphify. Four focused deployment safety tests and both default/efficient Compose configurations passed with `observability` and `benchmark` enabled. Nginx, HAProxy, Alloy and Prometheus binary configuration checks passed. Live monitoring checks covered authenticated Grafana data sources, project-scoped logs, unsafe Docker API rejection, dedicated SQL monitoring roles, real OTLP trace delivery and query/value redaction. The final monitoring configuration had eight healthy scrape targets, twelve healthy rules, and two connected fixture SQL exporters.

A completed 60-second hold used 25 distinct test identities, 150 seeded accounts, and the established ten-endpoint workload. Seven core services shared four CPUs in the existing eight-CPU, approximately 9.7 GiB local Docker guest. All eight monitoring services ran outside that application CPU set on the same guest. Metrics were enabled, OTLP export was disabled, and the benchmark used warning-level application logging; this measures the metrics-enabled operating profile, not the cost of full trace sampling or verbose logs.

| Measurement | Completed hold |
| --- | --- |
| Successful requests / errors | 12,137 / 0 |
| Successful throughput | 202.26 requests/second |
| Aggregate p95 / p99 latency | 59.12 / 114.02 ms |
| Core mean CPU / peak working memory | 2.36 cores / 1.33 GiB |
| Monitoring mean CPU / peak working memory | 0.036 cores / 1.14 GiB |
| Combined aligned peak working memory | 2.47 GiB |

Throughput was 0.32% below the earlier 202.92 requests/second four-CPU result in [production capacity](production-capacity.md). These single holds have different durations and do not establish statistical equivalence or cloud/server capacity. Monitoring memory includes local collectors and dashboards; longer retention, more replicas, additional workloads and remote network latency require separate sizing. No timeouts, application errors, OOM events or container restart deltas occurred during the completed hold.

The metrics-disabled comparison and live Gunicorn worker replacement check were deferred when the owner temporarily stopped the test VM to release resources for another project. Automated multiprocess aggregation/dead-worker cleanup tests passed. No cloud deployment, external alert receiver or failover certification is implied. Local fixtures and private results remain preserved; restore the fixture API's default metrics-on setting and its original CPU sets before resuming runtime verification.
