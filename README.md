# EdgeLab

Find your edge.

EdgeLab is a local trading research workspace built with FastAPI, Pandas, QuantStats, SQLite, React, Tailwind, Zustand, Lucide icons, and Lightweight Charts.

Legacy tag: TBS.

The current pass focuses on manual bar replay: long/short orders, market/limit/stop entries, TP/SL brackets, risk-percent sizing, breakeven stops, partial exits, session metrics, strategy breakdowns, a calendar heatmap, and a trade review drawer.

## Run The Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Run The Frontend

```bash
cd frontend
npm install
npm run dev
```

The backend reads `EURUSD_M1.csv` from the repository root by default.

The upgraded backend uses `backend/trade_journal_v2.db` by default. Local DB files, build output, `node_modules`, virtualenvs, generated Python caches, and the large CSV are ignored by Git.

## Verify

```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
cd frontend && npm run build
```
