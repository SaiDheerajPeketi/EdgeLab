# Backend

FastAPI service for CSV ingestion, session-based bar replay, live-like manual order execution, journaling, and performance metrics.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python -m uvicorn app.main:app --reload
```

Install audit tooling with:

```bash
pip install -r backend/requirements-dev.txt
```

Startup and seed commands do not create default user accounts, strategies, or playbooks.

The app scans dataset CSV folders from `../datasets` by default. Override it with:

```bash
export EDGELAB_DATASETS_ROOT=/absolute/path/to/datasets
```

Market data is cached in memory by default for smooth replay. Disable it with:

```bash
export EDGELAB_CACHE_MARKET_DATA=0
```

The default backend path now targets PostgreSQL. Override it directly with:

```bash
export DATABASE_URL=postgresql+psycopg://edgelab:edgelab@127.0.0.1:5432/edgelab
```

Run migrations explicitly before local backend startup:

```bash
cd backend
alembic upgrade head
```

Benchmark the session-summary path without Docker by seeding a temporary SQLite workload and comparing the legacy filesystem filter against the indexed catalog query:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_session_summaries.py --sessions 20000 --iterations 25
```

Compare the full bootstrap payload against the lighter shell bootstrap used for the first paint with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_bootstrap_profiles.py --assets 200 --sessions 200 --trades 200 --iterations 20
```

Compare the lighter metrics summary payload against the heavier curves payload and the combined legacy metrics response with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_metrics_profiles.py --sessions 50 --trades-per-session 100 --iterations 20
```

Seed authenticated benchmark users into the configured database and print beta-session JWTs for k6 runs with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/seed_benchmark_data.py --reset > /tmp/edgelab-benchmark-seed.json
```

Verify a copied SQLite export against a target database before Postgres cutover with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/migrate_sqlite_to_database.py \
  --source-sqlite-path /absolute/path/to/trade_journal_v2.db \
  --target-database-url postgresql+psycopg://edgelab:edgelab@127.0.0.1:5432/edgelab \
  --reset-target
```

Import dataset CSV candles into DB-backed `market_candles` storage with:

```bash
npm run market-data:import -- \
  --database-url postgresql+psycopg://edgelab:edgelab@127.0.0.1:5432/edgelab \
  --user-id 1 \
  --csv-path /absolute/path/to/datasets/EUR_USD/EURUSD_M1.csv
```

When a timeframe is imported, `GET /api/market-data/bars` and `GET /api/market-data/meta` can serve it from DB even if the CSV disappears later, and dataset catalog refresh keeps that imported timeframe row instead of pruning it. Non-imported datasets still fall back to CSV.

Default runtime now also sets `EDGELAB_MARKET_DATA_IMPORT_ENABLED=1`, so explicit dataset catalog refreshes automatically import changed CSV timeframes into `market_candles`. Set it to `0` only when you need metadata-only scans while debugging migration behavior.

The root Compose file also exposes a `benchmark` profile that starts Redis, TimescaleDB, MinIO, and the `benchmark-k6` runner alongside the current API/frontend stack:

```bash
docker compose --profile benchmark up -d postgres api frontend redis timescaledb minio
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=replace-with-seeded-token \
  benchmark-k6 run /benchmark/k6/bootstrap.js
```

Additional bundled k6 scenarios cover `bootstrap-shell`, `backtests-summaries`, `backtests-summaries-cursor`, `trades-page`, `trades-page-cursor`, `metrics-summary`, `metrics-curves`, `market-data-meta`, and `market-data-bars`.

The API also keeps short-lived in-process read-model caches for `/api/bootstrap-shell` and `/api/datasets`. Tune them with:

```bash
export EDGELAB_BOOTSTRAP_SHELL_CACHE_TTL_SECONDS=3
export EDGELAB_DATASET_CATALOG_CACHE_TTL_SECONDS=5
```

The denormalized backtest session summary read model is also refreshed continuously by the default worker loop. Tune that cadence with:

```bash
export EDGELAB_ANALYTICS_INTERVAL_SECONDS=60
```

Rebuild all user session-summary rows on demand with:

```bash
npm run analytics:refresh-session-summaries
```

That command now refreshes both `backtest_session_summaries` and `user_dashboard_summaries`. Prefer:

```bash
npm run analytics:refresh-read-models
```

Load-test the live frontend/API entrypoints against the current single-VM proxy or future split-service URLs with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/load_test_services.py --requests 200 --concurrency 20
```

Add `--session-id` when you want `market-data/meta`, `market-data/bars`, `metrics`, or trade-page runs pinned to one replay session:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/load_test_services.py \
  --auth-token your-beta-session-jwt \
  --session-id 123 \
  --bars-limit 300
```

Or set the Postgres pieces instead of a full URL:

```bash
export POSTGRES_DB=edgelab
export POSTGRES_USER=edgelab
export POSTGRES_PASSWORD=edgelab
export EDGELAB_POSTGRES_HOST=127.0.0.1
export EDGELAB_POSTGRES_CONNECT_PORT=5432
```

SQLite remains available as an explicit fallback:

```bash
export DATABASE_URL=sqlite:////absolute/path/to/trade_journal_v2.db
```

Set an API bearer token for protected mutation and app-data routes with:

```bash
export EDGELAB_API_TOKEN=change-me
```

Set the JWT signing secret required for beta sessions and authenticated workspace routes with:

```bash
export EDGELAB_JWT_SECRET=change-me
```

Enable real Google OAuth exchange with direct env vars:

```bash
export GOOGLE_CLIENT_ID=your-google-client-id
export GOOGLE_CLIENT_SECRET=your-google-client-secret
```

For Docker/Jenkins, prefer mounting the Google client JSON and pointing the backend at it:

```bash
export GOOGLE_CLIENT_SECRETS_FILE=/opt/edgelab/deployment/google-oauth-client.json
```

Pin callback URI when Google OAuth must match deployed domain exactly:

```bash
export GOOGLE_REDIRECT_URI=https://edgelab.publicvm.com/auth/callback/google
```

Or set public origin and let backend derive callback URI:

```bash
export EDGELAB_PUBLIC_ORIGIN=https://edgelab.publicvm.com
```

For the legacy single-file replay path, set an explicit CSV:

```bash
export EDGELAB_CSV_PATH=/absolute/path/to/EURUSD_M1.csv
```

FastAPI rejects HTTP request bodies larger than 25 MB by default. Override it with:

```bash
export EDGELAB_MAX_REQUEST_BODY_BYTES=26214400
```

App-data import/export is capped at 100,000 total rows by default. Override it with:

```bash
export EDGELAB_MAX_APP_DATA_ROWS=100000
```

Beta seat access and waitlist are capped server-side. Override seat count with:

```bash
export EDGELAB_BETA_SEATS_TOTAL=500
```

Manual beta enrollment is disabled by default so all cohort users enter through Google OAuth. Re-enable only for local debugging:

```bash
export EDGELAB_BETA_MANUAL_ACCESS_ENABLED=1
```

## Docker

The backend container is built by `backend/Dockerfile` and normally runs through the repository root `docker-compose.yml`.
It uses the `python:3.12-slim` base image so the pinned scientific dependencies install from binary wheels during image builds.

Container defaults:

- `EDGELAB_DATASETS_ROOT=/datasets`
- `EDGELAB_DATA_POPULATOR_USER=0:0`
- `EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS=3600`
- `EDGELAB_DATA_POPULATOR_BACKFILL_MODE=max`
- `EDGELAB_DATA_POPULATOR_LOOKBACK_DAYS=30`
- `EDGELAB_DATA_POPULATOR_DERIVED_TIMEFRAMES=M5,M15,M30,H1,H4,Daily`
- `EDGELAB_DATA_POPULATOR_FOREX_SYMBOLS=EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,USD/CAD,NZD/USD`
- `EDGELAB_DATA_POPULATOR_FOREX_START_DATE=2003-01-01`
- `EDGELAB_DATA_POPULATOR_CRYPTO_SYMBOLS=BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,DOGEUSDT`
- `EDGELAB_DATA_POPULATOR_CRYPTO_START_DATE=2017-08-17`
- `EDGELAB_API_TOKEN=`
- `EDGELAB_API_WORKERS=` (auto-sizes to `2 x vCPU` workers for PostgreSQL and `1` worker for SQLite when unset)
- `EDGELAB_API_TIMEOUT_SECONDS=120`
- `EDGELAB_API_GRACEFUL_TIMEOUT_SECONDS=30`
- `EDGELAB_API_KEEPALIVE_SECONDS=5`
- `EDGELAB_JWT_SECRET=`
- `EDGELAB_MAX_APP_DATA_ROWS=100000`
- `EDGELAB_MAX_REQUEST_BODY_BYTES=26214400`
- `POSTGRES_DB=edgelab`
- `POSTGRES_USER=edgelab`
- `POSTGRES_PASSWORD=edgelab`
- `EDGELAB_POSTGRES_HOST=postgres`
- `EDGELAB_POSTGRES_CONNECT_PORT=5432`
- `DATABASE_URL=` (optional full override only)

The Compose file mounts the dataset root read-only for the `api` and `market-api` services and read-write for the `data-populator` worker, then persists PostgreSQL in the `postgres-data` named volume. The PostgreSQL service is bound to `127.0.0.1:${EDGELAB_POSTGRES_PORT:-5432}` so bare-metal backend runs can reuse the same default database, while the containers themselves resolve Postgres through `EDGELAB_POSTGRES_HOST` and `EDGELAB_POSTGRES_CONNECT_PORT` instead of a hard-coded `DATABASE_URL`. The API containers run `alembic upgrade head` before starting Gunicorn with Uvicorn workers, which keeps the single-VM Docker/Jenkins path aligned with later multi-service deployments that point either the Postgres host vars or a full `DATABASE_URL` at an external database while also matching the stateless multi-worker runtime shape needed for scale-out. Nginx now routes auth/session/journal flows to `api` and market-data, dataset, and live-feed routes to `market-api`, so the single-VM stack already matches the future service split at the edge. The default Compose stack also starts an `analytics-worker` companion that periodically refreshes both `backtest_session_summaries` and `user_dashboard_summaries`, which keeps heavier session-list, bootstrap, and dashboard reads on precomputed paths without changing the frontend contract. When the resolved database URL points at SQLite, the startup script automatically drops back to a single worker so explicit SQLite fallback deployments still work. The default dataset root is the tracked `./datasets` directory; generated CSVs and the local manifest are ignored by Git. The API containers also mount `./deployment` read-only at `/opt/edgelab/deployment` so runtime OAuth secrets can be supplied by Jenkins or copied onto the host without entering the image build context. The populator defaults to `EDGELAB_DATA_POPULATOR_USER=0:0` so it can create folders in Linux host bind mounts; set that to a specific `UID:GID` when the host dataset folder is owned by another deploy user. `/api/health` validates the API process and database connectivity; `/api/ready` reports the scanned dataset root and discovered asset/timeframe counts.

When you enable the `benchmark` profile, Docker Compose also starts Redis, TimescaleDB, MinIO, and the `benchmark-k6` runner. Those services are for staged migration and load testing; the current request path still uses PostgreSQL plus dataset CSV metadata until later market-data cutover work lands.

SQLite fallback startup now auto-creates missing tables without destructive schema resets. Keep Alembic as the upgrade path for the default PostgreSQL deployment and for any SQLite database you care about preserving across schema changes.

Run the scheduled data populator directly from the repository root with:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m app.data_populator
```

It pulls one-minute candles for the configured forex majors through Dukascopy and crypto majors through Binance, writes `*_M1.csv` files under `EDGELAB_DATASETS_ROOT`, and derives configured higher-timeframe CSVs from the M1 candles. New dataset roots default to max backfill mode; Binance bulk history uses parallel monthly archive downloads plus public daily archive ZIPs before REST fallback, while Dukascopy uses retrying chart JSONP requests with a small delay between pages. Long historical backfills batch provider pages into a single large CSV write when possible and derive higher timeframes once from the final M1 file to avoid repeated full CSV and derived-timeframe rewrites while still logging progress through the `data-populator` service logs. Switch `EDGELAB_DATA_POPULATOR_BACKFILL_MODE` to `lookback` when you want bounded recent history based on `EDGELAB_DATA_POPULATOR_LOOKBACK_DAYS`. The worker stores `.edgelab-data-populator-manifest.json` in the dataset root with per-market CSV ranges and known empty provider ranges, and uses it on restart to avoid replaying completed or known-empty max backfill windows. In max mode it scans existing M1 files for internal missing minute ranges, ignores normal Forex weekend closures, and backfills unexpected holes before appending latest candles.

## Main APIs

- `POST /api/backtests` creates a replay session.
- `GET /api/backtests/latest` returns the latest usable replay session, or 404 when no replay session exists.
- `WS /api/datasets/stream` pushes dataset catalog changes to the frontend.
- `POST /api/backtests/{id}/advance` steps forward.
- `POST /api/backtests/{id}/jump` jumps by offset or timestamp.
- `POST /api/backtests/{id}/orders` places market, limit, or stop orders.
- `PATCH /api/backtests/{id}/orders/{order_id}` amends pending orders.
- `DELETE /api/backtests/{id}/orders/{order_id}` cancels pending orders.
- `GET /api/metrics?session_id=...` returns session analytics.
- `GET /api/metrics/summary?session_id=...` returns lightweight session aggregates for cards and quick refreshes.
- `GET /api/metrics/curves?session_id=...` returns the heavier equity/report payload used by charts and calendar panels.
- `GET /api/backtests/summaries?cursor=&limit=&status=` returns cursor-paginated session summaries with offset fallback for older clients.
- `GET /api/trades/page?cursor=&offset=&limit=&session_id=` returns paginated trades without forcing a full trade list read.
- `GET /api/auth/beta/status` returns live beta seat and waitlist counts.
- `GET /api/auth/config` returns runtime auth config for frontend, including public Google callback URI.
- `POST /api/auth/beta/access` issues beta access or waitlist sessions only when `EDGELAB_BETA_MANUAL_ACCESS_ENABLED=1`.
- `POST /api/auth/google/exchange` exchanges Google OAuth codes for beta sessions.
- `GET /api/auth/session` rehydrates stored beta sessions.
- `DELETE /api/auth/session` signs out beta sessions.

## Multi-User Isolation

- Tenant-scoped tables use `user_id` foreign keys and the API resolves ownership only from the authenticated beta session.
- Protected routes require the beta session JWT, which is signed with `EDGELAB_JWT_SECRET`.
- User accounts, strategies, and playbooks are created only from explicit user actions.
