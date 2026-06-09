# EdgeLab

Find your edge.

EdgeLab is a local trading research workspace built with FastAPI, Pandas, QuantStats, SQLite, React, Tailwind, Zustand, Lucide icons, and Lightweight Charts.

The current pass focuses on manual bar replay: long/short orders, market/limit/stop entries, TP/SL brackets, risk-percent sizing, breakeven stops, partial exits, session metrics, strategy breakdowns, a calendar heatmap, and a trade review drawer.

## Run With Docker Compose

Docker Compose is the fastest end-to-end deployment path. It builds the FastAPI backend, builds the React app, serves the static frontend through Nginx, proxies `/api` to FastAPI, and persists the backend SQLite database in a named Docker volume.

```bash
cp .env.example .env
docker compose up --build
```

Use `docker-compose` in place of `docker compose` on hosts that provide only the standalone Compose binary.

Open `http://localhost:8080` by default. Change `FRONTEND_PORT` and `CORS_ORIGINS` in `.env` when another port or hostname is required. The frontend is compiled with `VITE_API_BASE_URL=/api` for the Nginx proxy, and the FastAPI database defaults to the `api-data` volume through `DATABASE_URL`. Nginx and FastAPI both cap request bodies at 25 MB by default, and app-data import/export is capped at 100,000 total rows.

Set `EDGELAB_API_TOKEN` to require a bearer token on protected API routes. For the bundled frontend, set `VITE_API_BEARER_TOKEN` to the same value at build time.

Frontend image dependency installs use `NPM_CONFIG_REGISTRY`, which defaults to `https://registry.npmjs.org/` so Docker builds do not depend on workstation-specific npm mirrors.

The Compose setup expects a real replay CSV file at `./EURUSD_M1.csv` unless `EDGELAB_CSV_PATH` is changed in `.env`. Compose is configured not to auto-create this bind path. `/api/health` validates the API process and database, while `/api/ready` also validates the CSV header for deployment diagnostics. Missing or malformed market data is reported as an actionable API error instead of a generic backtest failure. Optional preprocessed datasets can be mounted by setting `EDGELAB_DATASETS_ROOT`.

Useful Docker commands:

```bash
docker compose ps
docker compose logs -f api
docker compose down
docker compose down --volumes
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
PYTHONPATH=. python -m uvicorn app.main:app --reload
```

## Run The Frontend

```bash
cd frontend
npm install
npm run dev
```

The backend reads `EURUSD_M1.csv` from the repository root by default.

The upgraded backend uses `backend/trade_journal_v2.db` by default. Local DB files, build output, `node_modules`, virtualenvs, generated Python caches, and the large CSV are ignored by Git.

Seed default playbooks after installing backend dependencies with:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/seed.py
```

## Deployment Files

- `docker-compose.yml` defines the deployable service graph.
- `backend/Dockerfile` builds the primary FastAPI API image.
- `frontend/Dockerfile` builds the Vite app and serves it with Nginx.
- `docker/nginx.conf` proxies `/api` to FastAPI and serves the SPA fallback.
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
