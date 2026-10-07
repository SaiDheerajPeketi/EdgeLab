# EdgeLab

EdgeLab is a local-first trading workspace for market replay, charting, trade journaling, and performance review. It combines a React client with a FastAPI backend and can run as a small SQLite installation or as a multi-service PostgreSQL/TimescaleDB stack.

The native Pine engine foundation uses PineTS 0.11.0 under AGPL-3.0-only; EdgeLab's original code uses the same licence. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). Distribution or service deployments of Pine-enabled builds must offer complete matching application source, including changes and build scripts. Native chart/editor integration is still pending; the current editor continues to use EdgeLab DSL.

## What is here

- Live and historical charts, multi-pane layouts, indicators, drawings, and order-flow views.
- Manual replay with market, limit, and stop orders, risk controls, partial exits, and session reports.
- A trade journal with accounts, imports, broker synchronization, notes, reviews, and analytics.
- Dataset discovery and scheduled market-data population for forex and crypto.
- Optional Redis caching, background analytics, telemetry, and a legacy Node API.

Journal settings support capture defaults and reusable note templates in both the modern and compatibility interfaces. Defaults merge into existing journal data, and successful saves require a server acknowledgment; private drafts and pending saves survive interface changes.

Chart and Appearance settings expose nine staged display/palette controls in both interfaces. Apply preserves hidden options and other presets while saving and activating `Settings default` atomically for the next workspace load. Density saves independently after server confirmation; Appearance reset affects density only.

Account and Privacy settings share current-session revocation and confirmed diagnostic-sharing preferences across both interfaces. Global shows actual interface/browser regional values; AI availability comes from the account’s server model catalog, with explicit offline-fixture and failure states.

## Quick start

The smallest supported installation needs only Docker:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

Open <http://localhost:8080>. This mode uses a single FastAPI container, SQLite, local developer sign-in, and the CSV files under `datasets/`. Application data lives in a Docker volume and survives normal container restarts.

Production images keep test-only Python packages out of the runtime, precompress browser assets during the build, and reuse one backend image across the API and worker services.

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
sh scripts/audit-dependencies.sh
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
- [Security policy](SECURITY.md)

Machine-readable UI inventories and certification records under `docs/` are test inputs. Keep them in sync with UI changes; they are not end-user documentation.
