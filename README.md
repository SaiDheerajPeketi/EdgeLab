# EdgeLab

EdgeLab is a local-first trading workspace for market replay, charting, trade journaling, and performance review. It combines a React client with a FastAPI backend and can run as a small SQLite installation or as a multi-service PostgreSQL/TimescaleDB stack.

## What is here

- Live and historical charts, multi-pane layouts, indicators, drawings, and order-flow views.
- Manual replay with market, limit, and stop orders, risk controls, partial exits, and session reports.
- A trade journal with accounts, imports, broker synchronization, notes, reviews, and analytics.
- Dataset discovery and scheduled market-data population for forex and crypto.
- Optional Redis caching, background analytics, telemetry, and a legacy Node API.

## Quick start

The smallest supported installation needs only Docker:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

Open <http://localhost:8080>. This mode uses a single FastAPI container, SQLite, local developer sign-in, and the CSV files under `datasets/`. Application data lives in a Docker volume and survives normal container restarts.

Add datasets beneath `datasets/`, then refresh the catalog from the application. Generated market data is intentionally not committed.

## Development

Use Node.js 20 or newer and Python 3.12:

```bash
npm install
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
EDGELAB_DEV_AUTH_BYPASS=1 EDGELAB_JWT_SECRET=local-dev-secret npm run dev
```

The frontend runs at <http://127.0.0.1:5173>, FastAPI at <http://127.0.0.1:8000>, and the optional compatibility API at <http://127.0.0.1:3001>.

## Verification

```bash
npm run build
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
npm test
docker compose config
docker compose -f docker-compose.local.yml config
```

## Repository map

| Path | Purpose |
| --- | --- |
| `frontend/` | React/Vite application |
| `backend/app/` | FastAPI application and services |
| `backend/alembic/` | Database migrations |
| `datasets/` | Local CSV dataset root; contents are ignored |
| `docker/` | Nginx, PgBouncer, and observability configuration |
| `e2e/` | Playwright tests and their reviewed visual baselines |
| `benchmark/` | k6 capacity tests |
| `scripts/` | Development and UI-quality tooling |

## Documentation

- [Setup and deployment](docs/setup-and-deployment.md)
- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [API guide](docs/api-reference.md)
- [Backend development](backend/README.md)
- [Frontend development](frontend/README.md)
- [Deployment utilities](deployment/README.md)

Machine-readable UI inventories and certification records under `docs/` are test inputs. Keep them in sync with UI changes; they are not end-user documentation.
