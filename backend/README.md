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

The app reads `../EURUSD_M1.csv` by default. Override it with:

```bash
export EDGELAB_CSV_PATH=/absolute/path/to/EURUSD_M1.csv
```

Market data is cached in memory by default for smooth replay. Disable it with:

```bash
export EDGELAB_CACHE_MARKET_DATA=0
```

The SQLite database defaults to `backend/trade_journal_v2.db`. Override it with:

```bash
export DATABASE_URL=sqlite:////absolute/path/to/trade_journal_v2.db
```

The dataset catalog root defaults to `../datasets`. Override it with:

```bash
export EDGELAB_DATASETS_ROOT=/absolute/path/to/datasets
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

Container defaults:

- `EDGELAB_CSV_PATH=/data/EURUSD_M1.csv`
- `EDGELAB_DATASETS_ROOT=/datasets`
- `EDGELAB_MAX_APP_DATA_ROWS=100000`
- `EDGELAB_MAX_REQUEST_BODY_BYTES=26214400`
- `DATABASE_URL=sqlite:////var/lib/edgelab/trade_journal_v2.db`

The Compose file mounts the CSV and datasets read-only and persists the SQLite database in the `api-data` named volume.

## Main APIs

- `POST /api/backtests` creates a replay session.
- `GET /api/backtests/latest` returns the latest session or creates one.
- `POST /api/backtests/{id}/advance` steps forward.
- `POST /api/backtests/{id}/jump` jumps by offset or timestamp.
- `POST /api/backtests/{id}/orders` places market, limit, or stop orders.
- `PATCH /api/backtests/{id}/orders/{order_id}` amends pending orders.
- `DELETE /api/backtests/{id}/orders/{order_id}` cancels pending orders.
- `GET /api/metrics?session_id=...` returns session analytics.
