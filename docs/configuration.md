# Configuration reference

[`.env.example`](../.env.example) is the checked-in Compose template. Copy it to `.env` and replace development credentials before exposing a deployment:

```bash
rtk proxy cp .env.example .env
```

Compose reads that file for interpolation; native Python/Node processes read their process environment. Copying the file alone does not configure a native process. Settings are read at process startup, so restart the affected service after changing runtime values. Browser `VITE_*` values require a rebuild. See [setup](setup-and-deployment.md), [architecture](architecture.md), [maintenance](maintenance.md), and [observability](observability.md).

Defaults below distinguish native code from Compose overrides. Numeric bounds are startup-validated for the SQL/admission, telemetry and read-model-cache controls listed here; do not assume every older application setting has the same validation policy.

## Database selection

| Variable | Native default / precedence | Deployment meaning |
| --- | --- | --- |
| `DATABASE_URL` | Explicit URL wins; otherwise PostgreSQL is constructed from the fields below | Application/account SQL store |
| `POSTGRES_DB` / `POSTGRES_USER` | `edgelab` / `edgelab` | Bundled database/role; use private credentials |
| `POSTGRES_PASSWORD` | Development fallback only | Server-side password; replace before deployment |
| `EDGELAB_POSTGRES_HOST` | `127.0.0.1` | Compose selects `pgbouncer-postgres` |
| `EDGELAB_POSTGRES_CONNECT_PORT` | `5432` | Compose connects to the pooler's `6432`; distinct from a host-published port |
| `EDGELAB_MARKET_DATA_DATABASE_URL` | Explicit URL wins | Optional independent candle SQL store |
| `EDGELAB_MARKET_DATA_POSTGRES_HOST` / `EDGELAB_MARKET_DATA_POSTGRES_PORT` | No host means application URL; with a host, port defaults to `6432` | Base Compose selects the Timescale pooler; efficient overlay selects the application pooler |

Native development defaults to **PostgreSQL**, not SQLite. Select SQLite explicitly with a URL such as `sqlite:///./backend/edgelab-local.db`; use the same environment for Alembic and API startup. Leave the market URL/host unset to reuse that store, or set an explicit second SQLite URL. `docker-compose.local.yml` supplies both SQLite URLs in its `local-api-data` volume.

Base Compose retains `postgres-data`, `timescaledb-data`, `api-data` and `auth-data`. The efficient overlay uses one PostgreSQL writer/pooler and keeps SQL imports and full historical ingestion enabled; it does not automatically migrate an existing Timescale store. It requires Compose 2.24.4+ for `!override`. Explicit full URLs override the overlay's host changes. Identical application/market URLs reuse one engine, and candle imports use the caller's transaction; distinct URLs create separate per-worker connection budgets.

Constructed PostgreSQL URLs escape credential characters. When supplying a full URL, URL-encode credentials yourself; native Python expects a SQLAlchemy driver such as `postgresql+psycopg`, whereas Better Auth expects `postgres://` or `postgresql://`. Back up each authoritative store before changing URLs or schema versions.

## Authentication and account access

| Variable | Native default / meaning |
| --- | --- |
| `EDGELAB_AUTH_PROVIDER` | `legacy`; allowed `legacy` or `better-auth`; Compose selects Better Auth |
| `EDGELAB_ENVIRONMENT` | `development`; Compose production security requires a valid integration vault |
| `EDGELAB_DEPLOYMENT_MODE` |  `production`; `beta` enables capped approved access; `personal` requires the separate loopback-only configuration |
| `EDGELAB_PUBLIC_ORIGIN` | Exact browser origin, no trailing path; production HTTPS |
| `CORS_ORIGINS` | Comma-separated exact browser origins; native defaults are local development ports |
| `EDGELAB_JWT_SECRET` | Private legacy session signing secret |
| `EDGELAB_BETTER_AUTH_INTERNAL_URL` | Native `http://127.0.0.1:3002`; Compose fixes the internal auth service address |
| `BETTER_AUTH_URL` | Auth public origin; Compose derives it from the public browser origin |
| `BETTER_AUTH_SECRET` / `EDGELAB_AUTH_SERVICE_KEY` | Distinct random values, at least 32 characters; share exact values across auth/API replicas |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Server-side OAuth credentials; per-field environment values override the credentials file |
| `GOOGLE_CLIENT_SECRETS_FILE` | Protected JSON file; `web`, `installed` or direct credential object |
| `GOOGLE_REDIRECT_URI` | Legacy flow override; Better Auth uses its fixed public callback path |
| `EDGELAB_DEV_AUTH_BYPASS` | `0`; needs beta mode, local origins and a loopback request |
| `EDGELAB_BETA_MANUAL_ACCESS_ENABLED` | `0`; manual sign-in is beta-only |
| `EDGELAB_BETA_SEATS_TOTAL` | `500`; effective beta cap is clamped to 1..500 |
| `EDGELAB_API_TOKEN` | Optional static token for explicitly protected operational dependencies; not a user session |

Register `<public-origin>/api/better-auth/callback/google` with Google. Missing credentials report Google unavailable. Keep API `EDGELAB_DEPLOYMENT_MODE` and browser `VITE_DEPLOYMENT_MODE` aligned. Production workspace use and exports require verified live subscription authority; beta approval permits workspace use but does not bypass live-paid exports. Developer sign-in and sandbox purchases confer no live entitlement.

Better Auth storage controls:

| Variable | Default | Constraint / purpose |
| --- | --- | --- |
| `BETTER_AUTH_DATABASE_URL` | Unset | SQLite when absent; optional **direct PostgreSQL writer**, not a transaction pooler/read replica |
| `BETTER_AUTH_DATABASE_PATH` | `backend/data/better-auth.db` natively | Compose stores SQLite in its isolated `auth-data` volume |
| `BETTER_AUTH_DATABASE_SCHEMA` | `edgelab_auth` | Dedicated lowercase schema, up to 63 characters; excludes public/system schemas |
| `BETTER_AUTH_DATABASE_POOL_MAX` | `5` | Integer 1..100, per auth replica |
| `BETTER_AUTH_DATABASE_TIMEOUT_MS` | `10000` | Integer 1..120,000; PostgreSQL statement deadline |
| `BETTER_AUTH_DATABASE_MIGRATION_TIMEOUT_MS` | `60000` | Integer 1..600,000; migration statements/lock wait |
| `EDGELAB_AUTH_STOP_GRACE_PERIOD` | `45s` in Compose | Must exceed the auth service's 30-second drain deadline |

The auth URL accepts only PostgreSQL schemes and supported TLS parameters, without arbitrary connection overrides. Remote connections should use `sslmode=verify-full` and the appropriate trusted root; TLS verification is not disabled. The adapter schema-qualifies tables instead of using session `search_path`. Migrations require schema/table creation permission and serialize on a direct transaction connection. Acquisition/connect waits are bounded to two seconds; the health probe has a one-second query timeout. All replicas need the same store/schema, secrets, Google configuration and public origin. Changing from SQLite neither copies its users nor preserves sessions automatically.

Personal deployment also requires `EDGELAB_ENVIRONMENT=development`, loopback `EDGELAB_PUBLIC_ORIGIN` and CORS origins, and a private `EDGELAB_PERSONAL_PROXY_SECRET` of at least 32 characters. The personal helper creates and preserves signing/encryption/proxy keys outside tracked source; its Nginx overwrites the private proxy header. See [personal configuration and feeds](personal-self-hosting.md). Public production/beta authorization remains unchanged.

## Billing and secret vault

| Variable | Meaning |
| --- | --- |
| `EDGELAB_BILLING_ENABLED` | `0` by default; enable only after provider configuration |
| `EDGELAB_STRIPE_MODE` | `test` or `live`; default `test` |
| `STRIPE_SECRET_KEY` | Matching `sk_test_`/`sk_live_` or restricted `rk_test_`/`rk_live_`; anonymous `rkcs_` is test-only |
| `STRIPE_WEBHOOK_SECRET` | Signed webhook secret for the selected endpoint/mode |
| `STRIPE_PRO_MONTHLY_PRICE_ID` / `STRIPE_PRO_ANNUAL_PRICE_ID` | Provider-validated recurring USD 2,900/29,000 cents, monthly/yearly interval count one, no trial |
| `EDGELAB_SECRET_VAULT_KEYS` | JSON key-ID map of URL-safe base64 32-byte encryption keys |
| `EDGELAB_SECRET_VAULT_ACTIVE_KEY_ID` | Key for newly encrypted integration credentials |

Use the exact public HTTPS origin for billing return URLs; local HTTP is accepted only for a loopback test origin. Provider objects must match the configured mode. Test billing cannot satisfy live workspace/export policy. Keep old vault keys until every stored credential using them is rotated. Credentials never belong in `VITE_*`, screenshots, logs, portable account bundles or matching source offers. See [billing contracts](api-reference.md#billing), [sandbox verification](stripe-sandbox.md), and [maintenance](maintenance.md) for activation and rotation.

## SQL pools and asynchronous admission

These settings apply per Python process/engine, so budget all API replicas and background jobs against PgBouncer and PostgreSQL capacity. Pool-size settings apply to non-SQLite engines; SQLite uses its driver's native lock timeout.

| Variable | Default | Accepted values |
| --- | --- | --- |
| `EDGELAB_DB_POOL_SIZE` | `5` | Integer 1..1,000 |
| `EDGELAB_DB_POOL_MAX_OVERFLOW` | `10` | Integer 0..1,000 |
| `EDGELAB_DB_POOL_TIMEOUT_SECONDS` | `5` | Finite 0.1..60 |
| `EDGELAB_DB_CONNECT_TIMEOUT_SECONDS` | `10` | Integer 1..120, PostgreSQL driver |
| `EDGELAB_DB_POOL_RECYCLE_SECONDS` | `1800` | Integer 1..86,400 |
| `EDGELAB_DB_SQLITE_LOCK_TIMEOUT_SECONDS` | `60` | Finite 0..300; native `busy_timeout` matches this deadline |
| `EDGELAB_HTTP_REQUEST_LIMIT` | `0` | Integer 0..10,000; automatic or a lower safe active cap |
| `EDGELAB_HTTP_QUEUE_WAIT_SECONDS` | `0.25` | Finite 0..5; zero rejects immediately |
| `EDGELAB_HTTP_QUEUE_DEPTH` | `0` | Integer 0..1,024; zero derives queue depth from active cap |
| `EDGELAB_HTTP_PROBE_BUDGET` | `2` | Integer 0..32; clamped by SQL/thread headroom |
| `EDGELAB_HTTP_VALIDATION_THREAD_RESERVE` | `8` | Integer 1..256; requested maximum adaptive cleanup/validation reserve |
| `EDGELAB_HTTP_SQL_CHECKOUT_MULTIPLIER` | `2` | Integer 1..8; actual thread headroom still limits admission |

Admission snapshots the actual AnyIO thread limiter and finite SQL pool. Default 15 SQL connections and 40 thread tokens permit 30 ordinary active requests plus two probes, leaving eight threads for response validation/cleanup. Small limiters reserve at least one thread where possible and reduce both budgets. A positive request limit can only lower the safe cap. SQLite automatic mode preserves its existing admission behavior; an explicit positive limit enables bounded admission where applicable.

Ordinary overflow waits in a finite FIFO event-loop queue without consuming worker threads. Increasing its wait/depth trades latency/memory for burst tolerance; it does not increase sustained database capacity. Health/readiness do not wait in the ordinary queue and reject immediately when their separate capacity is exhausted; a zero probe budget uses ordinary capacity with no wait. Streaming, errors and cancellation release slots. Saturation/checkout failure returns private 503 with retry guidance.

| Process / pooler control | Default |
| --- | --- |
| `EDGELAB_API_WORKERS` / `EDGELAB_MARKET_API_WORKERS` | Blank: up to two PostgreSQL workers per API service, one SQLite worker |
| `EDGELAB_API_TIMEOUT_SECONDS` / `EDGELAB_API_GRACEFUL_TIMEOUT_SECONDS` / `EDGELAB_API_KEEPALIVE_SECONDS` | `120` / `30` / `5` |
| `EDGELAB_API_STOP_GRACE_PERIOD` | Compose `45s` |
| `EDGELAB_RUN_MIGRATIONS` | `1` for main API; Compose secondary API skips Alembic |
| `EDGELAB_MIGRATION_MAX_ATTEMPTS` / `EDGELAB_MIGRATION_RETRY_SECONDS` | `12` positive attempts / `5` nonnegative seconds |
| `EDGELAB_PGBOUNCER_MAX_CLIENT_CONN` | `400` |
| `EDGELAB_PGBOUNCER_DEFAULT_POOL_SIZE` / `EDGELAB_PGBOUNCER_RESERVE_POOL_SIZE` | `25` / `5` per base pooler |
| `EDGELAB_EFFICIENT_PGBOUNCER_POOL_SIZE` / `EDGELAB_EFFICIENT_PGBOUNCER_RESERVE_POOL_SIZE` | `50` / `10` for the combined efficient pooler |
| `EDGELAB_PGBOUNCER_SERVER_IDLE_TIMEOUT_SECONDS` / `EDGELAB_PGBOUNCER_SERVER_CONNECT_TIMEOUT_SECONDS` | `600` / `15` |

The launcher migrates and initializes candle tables before forking. PostgreSQL driver preparation is disabled for the bundled transaction-pooling path. Pooler clients are not all server connections; compare aggregate worker pools and measured active transactions before changing server budgets. Preserve graceful deadlines and validation headroom. See [capacity evidence](production-capacity.md).

## Datasets, jobs and read-model cache

| Variable | Native default / meaning |
| --- | --- |
| `EDGELAB_DATASETS_ROOT` | Repository `datasets/`; Compose host bind mounted as `/datasets` |
| `EDGELAB_CSV_PATH` | Unset; optional legacy single-file path |
| `EDGELAB_MARKET_DATA_IMPORT_ENABLED` | `1`; SQL candle imports |
| `EDGELAB_DATASET_AUTO_DISCOVERY_ENABLED` | Native/local `1`, base production Compose `0` |
| `EDGELAB_CACHE_MARKET_DATA` | `1`; in-process market-data caching |
| `EDGELAB_ANALYTICS_INTERVAL_SECONDS` | `60`; summary sweep cadence |
| `EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS` | `3600`; dataset update cadence |
| `EDGELAB_DATA_POPULATOR_BACKFILL_MODE` | `max`; full configured historical coverage |
| `EDGELAB_DATA_POPULATOR_DERIVED_TIMEFRAMES` | `M5,M15,M30,H1,H4,Daily`, derived from M1 |
| `EDGELAB_DATA_POPULATOR_REQUEST_TIMEOUT_SECONDS` | `20` |
| `EDGELAB_MAX_REQUEST_BODY_BYTES` | `26214400` (25 MiB) |
| `EDGELAB_MAX_APP_DATA_ROWS` | `100000`; total supported transfer rows |
| `EDGELAB_REDIS_URL` | Unset natively; Compose provides the shared cache/quota store |
| `EDGELAB_BOOTSTRAP_SHELL_CACHE_TTL_SECONDS` / `EDGELAB_DATASET_CATALOG_CACHE_TTL_SECONDS` | `3` / `5` |
| `EDGELAB_RATE_LIMIT_WINDOW_SECONDS` | `60` |
| `EDGELAB_REDIS_MAXMEMORY` | Compose `256mb`, with `noeviction` |

Symbol lists, historical start dates, lookback mode, ingestion batch sizes and download concurrency are in [`.env.example`](../.env.example). The API mounts CSVs read-only; the scheduled populator writes CSVs and its resume manifest. Do not disable SQL imports or reduce historical coverage as an incidental cost change. Analytics serializes PostgreSQL sweeps and commits per account; filesystem writers and other-device imports still need deployment coordination.

| Validated cache control | Default | Range |
| --- | --- | --- |
| `EDGELAB_MEMORY_CACHE_MAX_ENTRIES` | `256` | Integer 1..10,000 per worker |
| `EDGELAB_REDIS_INVALIDATION_BATCH_SIZE` | `256` | Integer 1..1,000 |
| `EDGELAB_REDIS_CACHE_TIMEOUT_SECONDS` | `0.25` | Finite 0.01..5 |
| `EDGELAB_CACHE_FAILURE_LOG_INTERVAL_SECONDS` | `30` | Finite 1..3,600; metrics still count every failure |

Redis read-model cache outages/OOM permit recomputation; configured rate-limit, Google-exchange and billing quotas fail closed with 503. With Redis unset, quota counters become process-local and do not enforce a cross-replica budget. Authorization/revocation/payment checks are not read-model cache entries. Preserve `noeviction` so cache pressure cannot silently evict quota keys; monitor memory and cache errors.

## Observability

Metrics are enabled by default; optional traces require `OTEL_EXPORTER_OTLP_ENDPOINT`. Read [observability](observability.md) for private monitoring setup, metrics meanings, retention and alerts.

| Variable | Default | Constraint / purpose |
| --- | --- | --- |
| `EDGELAB_METRICS_ENABLED` | `1` | Boolean; zero disables recording and scrape endpoint |
| `EDGELAB_METRICS_BASE_DIR` | `/tmp` | Container launcher creates a private child directory per Gunicorn master |
| `EDGELAB_HTTP_LATENCY_BUCKETS` | `0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10` | 1..24 strictly increasing finite positive seconds |
| `EDGELAB_HTTP_LOG_SAMPLE_RATIO` | `0.1` | Finite 0..1 for successes; errors/slow requests remain logged |
| `EDGELAB_HTTP_SLOW_REQUEST_SECONDS` | `1` | Finite 0.001..3,600 |
| `EDGELAB_OBSERVABILITY_LOG_LEVEL` / `EDGELAB_OBSERVABILITY_JSON_LOGS` | `INFO` / `1` | Application log level and structured format |
| `OTEL_SERVICE_NAME` / `OTEL_SERVICE_NAMESPACE` | Service-specific name / `edgelab` | Stable low-cardinality service identity |
| `EDGELAB_OTEL_ENVIRONMENT` | `production` | Deployment label |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Unset | HTTP(S) collector endpoint, no embedded credentials/query/fragment |
| `OTEL_EXPORTER_OTLP_HEADERS` | Unset | Protected collector authentication headers |
| `EDGELAB_OTEL_TRACE_SAMPLE_RATIO` | `0.1` | Finite 0..1; remote sampled parents cannot override it |
| `EDGELAB_OTEL_MAX_QUEUE_SIZE` / `EDGELAB_OTEL_MAX_BATCH_SIZE` | `2048` / `512` | Integer 1..65,536 / 1..4,096; batch must not exceed queue |
| `EDGELAB_OTEL_SCHEDULE_DELAY_MS` | `5000` | Integer 100..60,000 |
| `EDGELAB_OTEL_EXPORT_TIMEOUT_SECONDS` | `5` | Finite 0.1..30 per HTTP attempt; OS DNS handling remains separate |
| `EDGELAB_OTEL_SHUTDOWN_TIMEOUT_SECONDS` | `5` | Finite 0.1..15; keep below process/container drain deadlines |

Request duration/in-flight gauges cover the full ASGI call, including body streaming and dependency cleanup. Labels use finite methods and registered route templates, not raw paths, queries, account IDs or IPs. Logs retain safe correlation IDs; exception formatting omits sensitive messages/bound SQL values. OTLP strips URL/SQL/event/status payloads, vendor trace state and non-allowlisted resource attributes while retaining causal IDs/timing. It exports each batch once without redirect/retry/body logging; bounded shutdown drops remaining queued batches.

Do not share/reuse `PROMETHEUS_MULTIPROC_DIR` across replicas or masters. The launcher and Gunicorn hooks initialize it before client imports, retire dead-worker live gauges and remove the master's private directory. Native single-process Uvicorn uses an in-memory registry. Do not add an external auto-initialized OpenTelemetry provider alongside the EdgeLab-owned sanitizer.

The private `observability` profile (also available through `benchmark`) supplies Prometheus, Grafana, Loki, Tempo, Alloy and SQL exporters. Configure separate monitoring credentials first. Public Nginx blocks the API scrape; collector/API ports must remain private. Retention/image/log-rotation overrides and their disk-cost limits are documented in [observability](observability.md). No external paging destination is configured.

## Browser, UI and external providers

`VITE_API_BASE_URL` is `/api` in Compose and can be a direct local API URL in native development. `VITE_DEPLOYMENT_MODE`, beta seat display values and rollout build flags are public compiled inputs. Changing them requires rebuilding the browser. Never compile credentials into `VITE_API_BEARER_TOKEN`; that compatibility input cannot provide private user authority.

Runtime `EDGELAB_UI_KILL_SWITCH`, per-group `EDGELAB_UI_SHELL_V2`, `EDGELAB_UI_JOURNAL_V2`, `EDGELAB_UI_SETTINGS_V2`, `EDGELAB_UI_CHART_V2`, `EDGELAB_UI_PUBLIC_V2`, and `EDGELAB_UI_REVISION` are reported by `/api/ui/rollout`; invalid policy values fail closed. See the [UI quality contract](ui-quality-contract.md).

`EDGELAB_EXTERNAL_AI_BASE_URL` and `EDGELAB_EXTERNAL_AI_MODEL` select the OpenAI-compatible Quant adapter. Provider keys are saved through encrypted integration storage. `EDGELAB_QUANT_CAPTURE_ROOT` selects retained chart captures; Compose uses persistent API storage. Broker endpoint overrides include `EDGELAB_TRADOVATE_API_BASE_URL` and `EDGELAB_NINJATRADER_API_BASE_URL`; production connectors require HTTPS.
