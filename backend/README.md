# EdgeLab Backend

## Overview
The EdgeLab backend contains the primary application logic, database migrations, and a legacy Node.js API. It handles market data ingestion, transactional trade journaling, user authentication, and performance analytics.

## Responsibilities
- **API Services**: Provide REST and WebSocket endpoints for the frontend SPA (`api` and `market-api`).
- **Data Population**: Periodically fetch, parse, and ingest dataset CSVs and external provider data (e.g., Binance, Dukascopy) via `data-populator`.
- **Analytics Processing**: Compute denormalized strategy and session summaries via `analytics-worker`.
- **Legacy API**: Support older endpoints for backward compatibility via the optional `legacy-node-api` profile.
- **Database Management**: Manage schema upgrades via Alembic and interact with PostgreSQL/TimescaleDB or a SQLite fallback.

## Architecture / How it fits into the system
The backend is the core engine of EdgeLab.
- It is fronted by Nginx (in a standard Docker Compose setup) which routes `/api/*` to the FastAPI servers.
- It connects to `pgbouncer-postgres` for transactional data and `pgbouncer-timescaledb` for market data reads/writes.
- It shares short-lived read models and rate limiting via a Redis cache.
- Telemetry (metrics, logs, traces) is emitted to the observability stack (Prometheus, Loki, Tempo) natively via OpenTelemetry.

## Directory Structure (brief)
- `/alembic/` - Database migration definitions and env.py
- `/app/` - The modern Python/FastAPI backend
  - `/app/api/` - FastAPI routing and endpoint definitions
  - `/app/services/` - Core business logic (backtester, datasets, analytics)
  - `data_populator.py` - Background worker script for syncing datasets
  - `analytics_worker.py` - Background worker script for computing summaries
  - `main.py` - FastAPI application entry point
- `/routes/` - Express routing for the legacy Node API
- `/scripts/` - Assorted Python utility scripts (e.g., migrations)
- `/tests/` - Pytest suites
- `index.js`, `db.js` - Legacy Node.js API (miniExpress/SQLite)

## Configuration
> ⚠️ Note: Many variables are defined in the root `.env` or `docker-compose.yml`. Below are the backend-specific variables read by `app/config.py`.

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | Explicit primary database connection string | `""` |
| `EDGELAB_POSTGRES_HOST` | Hostname for the Postgres DB or PgBouncer | `"127.0.0.1"` |
| `EDGELAB_POSTGRES_CONNECT_PORT` | Port for the Postgres DB or PgBouncer | `"5432"` |
| `EDGELAB_MARKET_DATA_DATABASE_URL`| Connection string for TimescaleDB | (Falls back to `DATABASE_URL`) |
| `EDGELAB_CSV_PATH` | Explicit legacy single-file replay path | `None` |
| `EDGELAB_DATASETS_ROOT` | Path to the directory containing dataset CSVs | `../datasets` |
| `EDGELAB_API_TOKEN` | Bearer token required for non-user routes | `""` |
| `EDGELAB_JWT_SECRET` | Secret key for signing session JWTs | `""` |
| `GOOGLE_CLIENT_ID` | OAuth2 Client ID for beta sign-in | `""` |
| `GOOGLE_CLIENT_SECRET` | OAuth2 Client Secret for beta sign-in | `""` |
| `EDGELAB_BETA_SEATS_TOTAL` | Total number of beta seats allowed | `500` |
| `EDGELAB_BETA_MANUAL_ACCESS_ENABLED`| Enable manual beta access without OAuth | `0` (False) |
| `EDGELAB_DEV_AUTH_BYPASS` | Enable loopback-only local development sign-in | `0` (False) |
| `EDGELAB_UI_REVISION` | Operator label exposed with the active UI rollout | `v2` |
| `EDGELAB_UI_KILL_SWITCH` | Put every route group in compatibility mode | `0` (False) |
| `EDGELAB_UI_SHELL_V2` | Enable the shared v2 application shell | `1` (True) |
| `EDGELAB_UI_JOURNAL_V2` | Enable v2 Journal and report routes after the shell | `1` (True) |
| `EDGELAB_UI_SETTINGS_V2` | Enable v2 settings routes after the shell | `1` (True) |
| `EDGELAB_UI_CHART_V2` | Enable v2 chart, live, replay, and shared-workspace routes after the shell | `1` (True) |
| `EDGELAB_UI_PUBLIC_V2` | Enable v2 public and authentication routes | `1` (True) |
| `EDGELAB_CACHE_MARKET_DATA` | Enable in-memory market data caching | `1` (True) |
| `EDGELAB_MARKET_DATA_IMPORT_ENABLED`| Auto-import timeframes to DB | `1` (True) |
| `EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS` | How often the populator runs | `3600` |
| `EDGELAB_MAX_REQUEST_BODY_BYTES` | Maximum allowed request body size | `26214400` (25MB) |
| `EDGELAB_REDIS_URL` | Redis connection string for rate limiting/caching | `""` |

## Public API / Interfaces
The FastAPI app provides a variety of routes mounted under `/api/`. (See `/docs/api-reference.md` for a full list). Key domains include:
- `GET /api/health` - Liveness probe
- `GET /api/ready` - Readiness probe (checks dataset catalog)
- `/api/auth/*` - Google OAuth callback and session management
- `/api/datasets/*` - List available data and stream refresh status via WebSocket
- `/api/market-data/*` - Fetch historical bars/metadata for replay
- `/api/backtests/*` - Create, advance, and jump backtest sessions
- `/api/playbooks/*`, `/api/journals/*` - Manage trading configuration and journals
- `/api/integration-secrets/*` - Manage owner-scoped encrypted provider credentials
- `/api/broker-providers`, `/api/broker-connections/*` - Inspect broker capabilities and offline sync state
- `/api/metrics/*` - Compute equity curves and session summaries
- `GET /api/observability/metrics` - Prometheus metrics exposition

The Legacy API (Express) provides:
- `/api/instruments`, `/api/sessions`, `/api/trades`, `/api/analytics`, `/api/playbooks`, `/api/drawings`

## Dependencies
- **FastAPI / Uvicorn / Gunicorn**: Web framework and servers
- **SQLAlchemy / Alembic**: ORM and migrations
- **cryptography**: AES-GCM authenticated encryption for integration credentials
- **psycopg**: PostgreSQL adapter
- **pandas**: Data manipulation for backfill and metrics processing
- **opentelemetry-***: Tracing and metrics instrumentation
- **redis**: Distributed caching and rate-limiting
- **pytest**: Test suite execution

## Local Development
Setup the virtual environment and install dependencies:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
```

Run database migrations:
```bash
alembic upgrade head
```

Create a development-only vault key before using integration or broker-sync routes:
```bash
python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
export EDGELAB_ENVIRONMENT=development
export EDGELAB_SECRET_VAULT_ACTIVE_KEY_ID=local-v1
export EDGELAB_SECRET_VAULT_KEYS='{"local-v1":"PASTE_GENERATED_KEY_HERE"}'
```

Production sets `EDGELAB_ENVIRONMENT=production` and fails startup unless both vault variables are valid. To rotate keys, retain the prior key in `EDGELAB_SECRET_VAULT_KEYS`, add the new key, change the active key ID, restart, then call each credential's rotate endpoint. Remove an old key only after no metadata row references its key ID. `alembic upgrade head` creates the encrypted vault and broker sync tables; ciphertext cannot be migrated without the keyring.

The broker catalog includes the deterministic `offline-fixture`, direct Tradovate REST sync, and a NinjaTrader HTTPS sync connector. Tradovate accepts a vault-stored `access_token` and uses `https://live.tradovateapi.com/v1` by default; override its server-side endpoint with `EDGELAB_TRADOVATE_API_BASE_URL` for a compatible gateway. NinjaTrader accepts a vault-stored `api_key` and remains visibly unconfigured until `EDGELAB_NINJATRADER_API_BASE_URL` points to an HTTPS connector implementing `/accounts`, `/orders`, and `/fills`. Provider endpoints are server configuration, never browser input. Both adapters normalize accounts, orders, fills, correction revisions, incremental cursors, and health into the shared reconciliation pipeline.

Run the backend server manually (outside of Docker):
```bash
PYTHONPATH=. python -m uvicorn app.main:app --reload
```

Run tests:
```bash
PYTHONPATH=. python -m pytest tests
```

For a persistent single-user Docker deployment, run `docker compose -f docker-compose.local.yml up --build -d` from the repository root. This uses one FastAPI worker with SQLite files in a named Docker volume and leaves Redis, PostgreSQL, TimescaleDB, PgBouncer, and background workers out of the deployment.

To run the legacy Node.js API manually:
```bash
node index.js
```
