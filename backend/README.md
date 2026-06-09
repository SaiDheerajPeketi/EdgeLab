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

Seed default playbooks from the repository root with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/seed.py
```

The app scans dataset CSV folders from `../datasets` by default. Override it with:

```bash
export EDGELAB_DATASETS_ROOT=/absolute/path/to/datasets
```

Market data is cached in memory by default for smooth replay. Disable it with:

```bash
export EDGELAB_CACHE_MARKET_DATA=0
```

The SQLite database defaults to `backend/trade_journal_v2.db`. Override it with:

```bash
export DATABASE_URL=sqlite:////absolute/path/to/trade_journal_v2.db
```

Startup runs versioned SQLite migrations after creating missing tables. Applied migrations are recorded in the `schema_migrations` table.

Set an API bearer token for protected mutation and app-data routes with:

```bash
export EDGELAB_API_TOKEN=change-me
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

## Docker

The backend container is built by `backend/Dockerfile` and normally runs through the repository root `docker-compose.yml`.
It uses the `python:3.12-slim` base image so the pinned scientific dependencies install from binary wheels during image builds.

Container defaults:

- `EDGELAB_DATASETS_ROOT=/datasets`
- `EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS=3600`
- `EDGELAB_DATA_POPULATOR_BACKFILL_MODE=max`
- `EDGELAB_DATA_POPULATOR_LOOKBACK_DAYS=30`
- `EDGELAB_DATA_POPULATOR_DERIVED_TIMEFRAMES=M5,M15,M30,H1,H4,Daily`
- `EDGELAB_DATA_POPULATOR_FOREX_SYMBOLS=EUR/USD,GBP/USD,USD/JPY,USD/CHF,AUD/USD,USD/CAD,NZD/USD`
- `EDGELAB_DATA_POPULATOR_FOREX_START_DATE=2003-01-01`
- `EDGELAB_DATA_POPULATOR_CRYPTO_SYMBOLS=BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT,DOGEUSDT`
- `EDGELAB_DATA_POPULATOR_CRYPTO_START_DATE=2017-08-17`
- `EDGELAB_API_TOKEN=`
- `EDGELAB_MAX_APP_DATA_ROWS=100000`
- `EDGELAB_MAX_REQUEST_BODY_BYTES=26214400`
- `DATABASE_URL=sqlite:////var/lib/edgelab/trade_journal_v2.db`

The Compose file mounts the dataset root read-only for the API and read-write for the `data-populator` worker, then persists the SQLite database in the `api-data` named volume. The dataset root bind mount must point to an existing directory. `/api/health` validates the API process and SQLite connectivity; `/api/ready` reports the scanned dataset root and discovered asset/timeframe counts.

Run the scheduled data populator directly from the repository root with:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m app.data_populator
```

It pulls one-minute candles for the configured forex majors through Dukascopy and crypto majors through Binance, writes `*_M1.csv` files under `EDGELAB_DATASETS_ROOT`, derives configured higher-timeframe CSVs from the M1 candles, and refreshes the dataset catalog after each cycle. New dataset roots default to max backfill mode; switch `EDGELAB_DATA_POPULATOR_BACKFILL_MODE` to `lookback` when you want bounded recent history based on `EDGELAB_DATA_POPULATOR_LOOKBACK_DAYS`.

## Main APIs

- `POST /api/backtests` creates a replay session.
- `GET /api/backtests/latest` returns the latest session or creates one.
- `POST /api/backtests/{id}/advance` steps forward.
- `POST /api/backtests/{id}/jump` jumps by offset or timestamp.
- `POST /api/backtests/{id}/orders` places market, limit, or stop orders.
- `PATCH /api/backtests/{id}/orders/{order_id}` amends pending orders.
- `DELETE /api/backtests/{id}/orders/{order_id}` cancels pending orders.
- `GET /api/metrics?session_id=...` returns session analytics.
