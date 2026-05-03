# Backend

FastAPI service for CSV ingestion, session-based bar replay, live-like manual order execution, journaling, and performance metrics.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The app reads `../EURUSD_M1.csv` by default. Override it with:

```bash
export TRADEZELLA_CSV_PATH=/absolute/path/to/EURUSD_M1.csv
```

Market data is cached in memory by default for smooth replay. Disable it with:

```bash
export TRADEZELLA_CACHE_MARKET_DATA=0
```

## Main APIs

- `POST /api/backtests` creates a replay session.
- `GET /api/backtests/latest` returns the latest session or creates one.
- `POST /api/backtests/{id}/advance` steps forward.
- `POST /api/backtests/{id}/jump` jumps by offset or timestamp.
- `POST /api/backtests/{id}/orders` places market, limit, or stop orders.
- `PATCH /api/backtests/{id}/orders/{order_id}` amends pending orders.
- `DELETE /api/backtests/{id}/orders/{order_id}` cancels pending orders.
- `GET /api/metrics?session_id=...` returns session analytics.
