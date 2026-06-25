# EdgeLab

Find your edge.

EdgeLab is a local trading research workspace built with FastAPI, Pandas, PostgreSQL, React, Tailwind, Zustand, Lucide icons, and Lightweight Charts.

The current pass focuses on manual bar replay: long/short orders, market/limit/stop entries, TP/SL brackets, risk-percent sizing, breakeven stops, partial exits, session metrics, strategy breakdowns, a calendar heatmap, and a trade review drawer.

## Run With Docker Compose

Docker Compose is the fastest end-to-end deployment path. It builds the React app, runs split `api` and `market-api` FastAPI services behind Nginx, runs the scheduled data populator, serves the static frontend through Nginx, and persists the backend PostgreSQL database in a named Docker volume.

```bash
cp .env.example .env
docker compose up --build
```

Use `docker-compose` in place of `docker compose` on hosts that provide only the standalone Compose binary.

Open `http://localhost:8080` by default. The root route now serves the EdgeLab marketing landing page, `/pricing` serves the pricing surface, `/auth/signin` handles Google-only beta sign-in and waitlist entry, `/auth/callback/google` resolves the Google OAuth callback, and the research workspace lives behind protected routing at `/app`. Change `FRONTEND_PORT`, `CORS_ORIGINS`, and the PostgreSQL settings in `.env` when another port or hostname is required. The frontend is compiled with `VITE_API_BASE_URL=/api` for the Nginx proxy, and the FastAPI database now defaults to the bundled PostgreSQL service through `POSTGRES_*`, `EDGELAB_POSTGRES_HOST`, and `EDGELAB_POSTGRES_CONNECT_PORT`. Set `DATABASE_URL` only when you need a full explicit override such as an external Postgres instance or a deliberate SQLite fallback. Nginx gzip-compresses text responses, gives Vite hashed assets a one-year browser cache, keeps `index.html` revalidated for deploy freshness, and returns 404 for missing `/assets/*` chunks instead of serving the SPA fallback. Nginx and FastAPI both cap request bodies at 25 MB by default, and app-data import/export is capped at 100,000 total rows.

Set `EDGELAB_API_TOKEN` to require a bearer token on non-user API routes. Set `EDGELAB_JWT_SECRET` as well, because beta sign-in and the protected workspace now use signed session JWTs for per-user row isolation. For the bundled frontend, set `VITE_API_BEARER_TOKEN` only when you also want the client to send the deploy token to non-user API routes.

Beta auth and waitlist use `EDGELAB_BETA_SEATS_TOTAL` on backend to decide who gets immediate access and who is queued. Manual beta access is disabled by default with `EDGELAB_BETA_MANUAL_ACCESS_ENABLED=0`, so cohort enrollment runs through Google OAuth only. In Docker/Jenkins, prefer `GOOGLE_CLIENT_SECRETS_FILE=/opt/edgelab/deployment/google-oauth-client.json`; API loads client ID and secret from that runtime-mounted JSON and exposes public client ID plus callback URI through `/api/auth/config` so frontend does not need build-time OAuth vars. If Google returns `redirect_uri_mismatch`, set `GOOGLE_REDIRECT_URI=https://edgelab.publicvm.com/auth/callback/google` in host `.env` and add exact same URI to Google Cloud Console authorized redirect URIs. Keep frontend fallback display vars `VITE_DEPLOYMENT_MODE`, `VITE_BETA_SEATS_TOTAL`, and `VITE_BETA_SEATS_TAKEN` aligned for Docker builds; live seat and waitlist counts are fetched from FastAPI beta auth APIs at runtime. First sign-in also provisions the default playbooks for that specific user only; playbooks, sessions, orders, trades, notes, dataset preferences, and app storage are all row-scoped by `user_id`.

Frontend image dependency installs use `NPM_CONFIG_REGISTRY`, which defaults to `https://registry.npmjs.org/` so Docker builds do not depend on workstation-specific npm mirrors.

The Compose setup stores dataset CSVs in `./datasets` unless `EDGELAB_DATASETS_ROOT` is changed in `.env`. The repository tracks `datasets/.gitkeep` so the default host bind directory exists, while generated CSVs and the local manifest stay ignored by Git. PostgreSQL data persists in the `postgres-data` named volume and is also bound to `127.0.0.1:${EDGELAB_POSTGRES_PORT:-5432}` so local tools and bare-metal backend runs can use the same default database stack. The API mounts the dataset folder read-only at `/datasets`; the `data-populator` service mounts the same folder read-write, updates M1 CSVs for configured forex and crypto majors, derives higher-timeframe CSVs from those M1 candles, and now also uses the same Postgres connection settings so refreshed files sync dataset-catalog rows and DB-backed `market_candles` without waiting for an API-side refresh. The API also mounts `./deployment` read-only at `/opt/edgelab/deployment` so Jenkins-hosted secrets such as `google-oauth-client.json` survive rebuilds without entering the image. The populator defaults to `EDGELAB_DATA_POPULATOR_USER=0:0` so it can create directories in Linux host bind mounts; set that to a specific `UID:GID` when the host dataset folder is owned by another deploy user. `/api/health` validates the API process and database, while `/api/ready` reports the scanned dataset root and discovered asset/timeframe counts. `EDGELAB_CSV_PATH` remains available only for the legacy single-file replay path outside the default Compose deployment.

Dataset refresh now defaults `EDGELAB_MARKET_DATA_IMPORT_ENABLED=1`, so explicit catalog refreshes import changed timeframe CSVs into DB-backed `market_candles` automatically. Leave it enabled for the new default stack; set it to `0` only when you need metadata-only catalog scans during migration debugging.
Dataset catalog refreshes now also trust `.edgelab-data-populator-manifest.json` first when it exists, so writer-produced rows/timestamps/file signatures can refresh catalog state without reopening each CSV for metadata reads.
The bundled single-VM and split-service container defaults now also set `EDGELAB_DATASET_AUTO_DISCOVERY_ENABLED=0`, so normal dataset list/bootstrap/runtime reads stay on stored DB catalog metadata instead of rescanning the filesystem on request paths. Use explicit dataset refresh when you need to ingest manually dropped CSV folders immediately.

API startup now runs `alembic upgrade head` before launching Gunicorn with Uvicorn workers, so the default single-VM Docker/Jenkins path and a later multi-service deployment path share the same migration workflow and a stateless multi-worker API runtime. Set `EDGELAB_API_WORKERS` only when you need to override the default worker sizing; otherwise the container auto-sizes itself to `2 x vCPU` for PostgreSQL and falls back to `1` worker for SQLite compatibility. The default Compose stack now also starts an `analytics-worker` container that refreshes denormalized session-summary rows on a fixed cadence controlled by `EDGELAB_ANALYTICS_INTERVAL_SECONDS`. For a split architecture, keep the same application containers and either point `EDGELAB_POSTGRES_HOST` / `EDGELAB_POSTGRES_CONNECT_PORT` at your external PostgreSQL instance or set a full `DATABASE_URL` override.

The scheduled populator defaults to every hour (`EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS=3600`). New dataset roots use `EDGELAB_DATA_POPULATOR_BACKFILL_MODE=max` by default, which starts from provider-specific start dates (`EDGELAB_DATA_POPULATOR_FOREX_START_DATE=2003-01-01`, `EDGELAB_DATA_POPULATOR_CRYPTO_START_DATE=2017-08-17`) and pulls until current data is reached. Binance bulk history is read from public monthly/daily archive ZIPs before falling back to REST for archive gaps and the live tail; monthly Binance archive downloads run in parallel. Dukascopy uses the chart JSONP feed with retrying requests and a small delay between paged calls. Long max backfills batch provider pages into a single large CSV write when possible, then derive higher timeframes once from the final M1 file to avoid repeated full-file reads and resamples. Set `EDGELAB_DATA_POPULATOR_BACKFILL_MODE=lookback` to seed only the last `EDGELAB_DATA_POPULATOR_LOOKBACK_DAYS`. The populator maintains the manifest under `EDGELAB_DATASETS_ROOT` and uses it to resume from local CSV ranges instead of repeatedly starting from the provider max date; in max mode it also scans existing M1 CSVs for internal missing minute ranges, ignores normal Forex weekend closures, and backfills unexpected holes before appending latest candles. Provider ranges that return no candles are recorded in the manifest so historical and internal gap backfills do not retry known-empty windows. If `EDGELAB_MARKET_DATA_IMPORT_ENABLED=1`, each successful write also refreshes dataset-catalog rows and imports changed timeframes into DB-backed `market_candles` immediately through the same Postgres settings used by `api` and `market-api`. Configure derived HTFs with `EDGELAB_DATA_POPULATOR_DERIVED_TIMEFRAMES` and symbols with `EDGELAB_DATA_POPULATOR_FOREX_SYMBOLS` / `EDGELAB_DATA_POPULATOR_CRYPTO_SYMBOLS`.

Useful Docker commands:

```bash
docker compose ps
docker compose logs -f postgres
docker compose logs -f api
docker compose logs -f analytics-worker
docker compose logs -f data-populator
find datasets -maxdepth 2 -type f
docker compose down
docker compose down --volumes
```

Bring up the benchmark profile when you want the current stack plus the future-scale support services available on one VM:

```bash
docker compose --profile benchmark up -d postgres api frontend redis timescaledb minio
```

The benchmark profile does not switch request paths to Redis, TimescaleDB, or MinIO yet. It keeps the current app behavior intact while exposing the data-tier components and the `benchmark-k6` runner needed for incremental load testing. Seed authenticated benchmark data with `npm run bench:seed`, then run the bundled k6 scripts from `benchmark/` for `bootstrap`, `bootstrap-shell`, `backtests-summaries`, `backtests-summaries-cursor`, `trades-page`, `trades-page-cursor`, `metrics-summary`, `metrics-curves`, `market-data-meta`, and `market-data-bars`.

For local storage-path latency comparisons, run `npm run bench:market-data-storage -- --rows 20000 --iterations 25`. It benchmarks cached CSV reads against DB-backed `market_candles` reads on same dataset shape so market-data migration wins stay measurable between commits.

The metrics API is also split now: `GET /api/metrics/summary` serves lightweight card-level aggregates and `GET /api/metrics/curves` serves the heavier equity/report payload. `GET /api/metrics` remains as the backward-compatible combined endpoint while the UI migrates.

Session summary reads now support cursor-first pagination at `GET /api/backtests/summaries?cursor=&limit=&status=` while keeping offset fallback for legacy callers.

Trade reads now also have an explicit page contract at `GET /api/trades/page?cursor=&offset=&limit=`. The legacy `GET /api/trades` list route stays available while the UI moves off full-list assumptions.

Market-data request paths can now prefer DB-backed candle storage when a dataset timeframe has been imported into `market_candles`. The default Compose/backend stack auto-imports changed dataset CSVs during explicit catalog refreshes. You can still import one dataset CSV manually into the active database with:

```bash
npm run market-data:import -- \
  --database-url postgresql+psycopg://edgelab:edgelab@127.0.0.1:5432/edgelab \
  --user-id 1 \
  --csv-path /absolute/path/to/datasets/EUR_USD/EURUSD_M1.csv
```

After that import, `/api/market-data/bars` and `/api/market-data/meta` can serve that timeframe from DB even if the original CSV is unavailable, and dataset catalog metadata now keeps that imported timeframe visible for replay instead of pruning it. Non-imported datasets still fall back to CSV.

You can also rebuild the analytics read models on demand with `npm run analytics:refresh-read-models` or the backward-compatible `npm run analytics:refresh-session-summaries`.

Before PostgreSQL cutover, verify a copied SQLite export against the target database with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/migrate_sqlite_to_database.py \
  --source-sqlite-path /absolute/path/to/trade_journal_v2.db \
  --target-database-url postgresql+psycopg://edgelab:edgelab@127.0.0.1:5432/edgelab \
  --reset-target
```

The optional legacy Node API can be started with:

```bash
docker compose --profile legacy-node-api up --build
```

The legacy API profile uses `LEGACY_CORS_ORIGINS` and `LEGACY_API_MAX_BODY_BYTES` for origin allowlisting and request-size limits.

## Run The Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
PYTHONPATH=. python -m uvicorn app.main:app --reload
```

## Run The Frontend

```bash
cd frontend
npm install
npm run dev
```

The backend scans dataset CSV folders from `datasets` by default. Normal catalog reads auto-discover filesystem changes at most every 30 seconds; explicit dataset refreshes and dataset root changes still force an immediate scan. Set `EDGELAB_DATASETS_ROOT` to point at a different dataset root.
The open frontend subscribes to `/api/datasets/stream` over WebSocket, so CSV range changes from the populator appear without a browser refresh. Replay sessions are created only from the session builder or `POST /api/backtests`; startup does not create a default EURUSD/M1 session.
The API also keeps short-lived read-model caches for the initial shell bootstrap and dataset catalog responses. In Docker Compose, `api` and `market-api` now default those caches to the bundled Redis service through `EDGELAB_REDIS_URL=redis://redis:6379/0`, so cache hits are shared across workers and containers instead of being process-local only. Bare-metal runs can leave `EDGELAB_REDIS_URL` blank and fall back to in-process memory. Tune cache TTLs with `EDGELAB_BOOTSTRAP_SHELL_CACHE_TTL_SECONDS` and `EDGELAB_DATASET_CATALOG_CACHE_TTL_SECONDS`.
That same shared Redis tier now also rate-limits expensive authenticated routes. Default container limits are `EDGELAB_DATASET_REFRESH_RATE_LIMIT=6`, `EDGELAB_MARKET_DATA_META_RATE_LIMIT=240`, and `EDGELAB_MARKET_DATA_BARS_RATE_LIMIT=240` inside a `EDGELAB_RATE_LIMIT_WINDOW_SECONDS=60` window.

The default containerized stack uses PostgreSQL plus Alembic migrations. SQLite remains an explicit fallback only when `DATABASE_URL` is overridden to a SQLite path. Local DB files, build output, `node_modules`, virtualenvs, generated Python caches, and the large CSV are ignored by Git.
SQLite startup no longer drops existing tables on version mismatch; fresh SQLite files are still auto-created for local fallback use, while schema upgrades are expected to come through Alembic in the default containerized path.

Startup and seed commands do not create default user accounts, strategies, or playbooks.

## Deployment Files

- `docker-compose.yml` defines the deployable service graph, including the split `api` and `market-api` containers used in the single-VM default.
- `backend/alembic.ini` and `backend/alembic/versions/*` define the database migration path.
- `backend/Dockerfile` builds the primary FastAPI API image.
- `backend/app/data_populator.py` runs the scheduled dataset writer used by the Compose `data-populator` service.
- `frontend/Dockerfile` builds the Vite app and serves it with Nginx.
- `docker/nginx.conf` proxies auth/session/journal APIs to `api`, market-data and dataset routes to `market-api`, and serves the SPA fallback.
- `backend/Dockerfile.node` supports the optional legacy Node API profile.
- `.env.example` documents deploy-time settings.
- `.dockerignore` keeps local data and generated artifacts out of Docker build contexts.

## Verify

```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
npm run build
npm test
```

If Docker is available, also run:

```bash
docker compose config
docker compose build
```

Dependency audit checks require registry access:

```bash
pip install -r backend/requirements-dev.txt
sh scripts/audit-dependencies.sh
```
