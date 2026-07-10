# Configuration Reference

This document consolidates all environment variables and configuration settings used across the EdgeLab codebase. These variables are typically defined in `.env` and consumed by `docker-compose.yml` or the application code directly.

## General & Backend

| Environment Variable | Purpose | Default / Example |
| --- | --- | --- |
| `DATABASE_URL` | Explicit PostgreSQL/SQLite connection string | (Derived from POSTGRES_*) |
| `EDGELAB_POSTGRES_HOST` | Hostname for the Postgres DB or PgBouncer | `127.0.0.1` / `pgbouncer-postgres` |
| `EDGELAB_POSTGRES_CONNECT_PORT` | Port for the Postgres DB or PgBouncer | `5432` / `6432` |
| `EDGELAB_MARKET_DATA_DATABASE_URL`| Connection string for TimescaleDB | (Falls back to `DATABASE_URL`) |
| `EDGELAB_CSV_PATH` | Explicit legacy single-file replay path | `None` |
| `EDGELAB_DATASETS_ROOT` | Path to the directory containing dataset CSVs | `/datasets` |
| `EDGELAB_API_TOKEN` | Bearer token required for non-user routes | `""` |
| `EDGELAB_JWT_SECRET` | Secret key for signing session JWTs | `""` |
| `EDGELAB_API_WORKERS` | Number of Uvicorn workers (blank=auto) | `""` |
| `EDGELAB_API_TIMEOUT_SECONDS` | Timeout for FastAPI workers | `120` |
| `EDGELAB_RUN_MIGRATIONS` | Whether to run Alembic migrations on boot | `1` |
| `EDGELAB_REDIS_URL` | Redis connection string for caching/rate limiting | `redis://redis:6379/0` |
| `EDGELAB_MAX_REQUEST_BODY_BYTES` | Maximum allowed HTTP request body size | `26214400` (25MB) |
| `EDGELAB_MAX_APP_DATA_ROWS` | Maximum rows allowed during JSON app-data import | `100000` |

## Beta Authentication (Google OAuth)

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID for beta sign-in | `""` |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret for beta sign-in | `""` |
| `GOOGLE_CLIENT_SECRETS_FILE` | Path to JSON file containing Google credentials | `/opt/edgelab/deployment/google-oauth-client.json` |
| `GOOGLE_REDIRECT_URI` | The authorized callback URI | (Derived from `EDGELAB_PUBLIC_ORIGIN`) |
| `EDGELAB_PUBLIC_ORIGIN` | Public domain of the application (e.g. https://edgelab.co.in) | `""` |
| `EDGELAB_BETA_SEATS_TOTAL` | Total number of beta seats allowed | `500` |
| `EDGELAB_BETA_MANUAL_ACCESS_ENABLED`| Allow users to bypass Google OAuth manually | `0` |

## Data Populator

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `EDGELAB_DATA_POPULATOR_USER` | Host UID:GID for the populator container | `0:0` |
| `EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS` | Time between backfill synchronization loops | `3600` |
| `EDGELAB_DATA_POPULATOR_BACKFILL_MODE` | Backfill strategy (`max` or `lookback`) | `max` |
| `EDGELAB_DATA_POPULATOR_LOOKBACK_DAYS` | Days to look back if mode is `lookback` | `30` |
| `EDGELAB_DATA_POPULATOR_DERIVED_TIMEFRAMES`| Comma-separated timeframes to generate from M1 | `M5,M15,M30,H1,H4,Daily` |
| `EDGELAB_DATA_POPULATOR_FOREX_SYMBOLS` | Comma-separated Forex pairs to fetch | `EUR/USD,GBP/USD...` |
| `EDGELAB_DATA_POPULATOR_CRYPTO_SYMBOLS` | Comma-separated Crypto pairs to fetch | `BTCUSDT,ETHUSDT...` |
| `EDGELAB_DATA_POPULATOR_FOREX_START_DATE` | Default start date for Forex max backfill | `2003-01-01` |
| `EDGELAB_DATA_POPULATOR_CRYPTO_START_DATE` | Default start date for Crypto max backfill | `2017-08-17` |

## Observability & Telemetry

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `EDGELAB_OBSERVABILITY_LOG_LEVEL`| Python logging level (e.g., INFO, DEBUG) | `INFO` |
| `EDGELAB_OBSERVABILITY_JSON_LOGS`| Whether to output logs in JSON format | `1` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Destination for OTLP traces (e.g., Tempo) | `""` |
| `OTEL_SERVICE_NAME` | OpenTelemetry Service Name | (Varies by container) |
| `EDGELAB_OTEL_TRACE_SAMPLE_RATIO`| Percentage of traces to sample (0.0 to 1.0) | `1.0` |

## Frontend Config (Build Time)

These variables are consumed by the Vite build process.

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Base path for frontend API calls | `/api` |
| `VITE_API_BEARER_TOKEN` | Hardcoded bearer token for frontend requests (rarely used) | `""` |
| `VITE_DEPLOYMENT_MODE` | Controls UI Layout (`beta` vs `public`) | `beta` |
| `VITE_BETA_SEATS_TOTAL` | Static display of total seats (hydrated by backend later) | `500` |

## PgBouncer & Database Containers

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `POSTGRES_DB` | Name of the primary database | `edgelab` |
| `POSTGRES_USER` | Postgres Username | `edgelab` |
| `POSTGRES_PASSWORD` | Postgres Password | `edgelab` |
| `EDGELAB_PGBOUNCER_MAX_CLIENT_CONN` | Max allowed connections to PgBouncer | `400` |
| `EDGELAB_PGBOUNCER_DEFAULT_POOL_SIZE` | Default PgBouncer pool size per user/db | `25` |
| `EDGELAB_PGBOUNCER_SERVER_IDLE_TIMEOUT_SECONDS` | When to disconnect idle server connections | `600` |
