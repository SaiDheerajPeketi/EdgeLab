# EdgeLab

> *Find your edge.*

EdgeLab is a local trading research workspace built with FastAPI, Pandas, PostgreSQL, React, Tailwind, Zustand, Lucide icons, and Lightweight Charts.

The platform focuses on manual bar replay, providing tools for long/short orders, market/limit/stop entries, TP/SL brackets, risk-percent sizing, breakeven stops, partial exits, session metrics, strategy breakdowns, a calendar heatmap, and a trade review drawer.

## Documentation Overview

The documentation for EdgeLab has been modularized. Please refer to the specific guides below:

### High-Level Concepts & Architecture
- [**System Architecture**](docs/architecture.md) - Learn how the frontend, FastAPI services, PostgreSQL, TimescaleDB, and background workers communicate.
- [**Glossary**](docs/glossary.md) - A cheat-sheet mapping trading domain concepts (Playbooks, Timeframes, Replay Candles) to EdgeLab's business logic.

### Setup & Operations
- [**Setup and Deployment**](docs/setup-and-deployment.md) - Instructions for running EdgeLab locally via Node/Python, via Docker Compose, and deploying to Jenkins.
- [**Configuration Reference**](docs/configuration.md) - Exhaustive list of `.env` configurations (OAuth, database URLs, Beta access logic, Populator tuning).
- [**Deployment Scripts**](deployment/README.md) - Details on capturing remote instance state and injecting secrets securely.

### Development References
- [**API Reference**](docs/api-reference.md) - REST API routes for authentication, datasets, market data, and backtesting.
- [**Backend Service**](backend/README.md) - Details on the FastAPI and Node APIs, database schema, and migration workflows.
- [**Frontend SPA**](frontend/README.md) - Overview of the React/Vite client, Zustand stores, and UI component stack.
- [**Docker & Infrastructure**](docker/README.md) - Overview of the Nginx proxy, PgBouncer pooling, and observability containers.
- [**Scripts & Tooling**](scripts/README.md) - Local development orchestrators and dependency auditing.

### Performance & Testing
- [**Benchmarks**](benchmark/README.md) - The k6 load testing harness and e2e capacity sweep documentation.
- [**Python Micro-Benchmarks**](benchmarks/README.md) - Local Python load testing and query read-model validation tools.

---

## Quick Start (Docker Compose)

For a lightweight single-user installation, run the local Compose file. It starts only the frontend and one FastAPI container, uses SQLite instead of PostgreSQL, and does not require Redis:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

Open [http://localhost:8080](http://localhost:8080). Application state is stored in the `edgelab-local_local-api-data` Docker volume and datasets remain in `./datasets`, so both survive restarts and `docker compose down`. See [Setup and Deployment](docs/setup-and-deployment.md#lightweight-single-user-deployment) for backup and removal commands.

The full Docker Compose stack is the production-shaped option. It stands up the React frontend, Nginx, FastAPI services, PostgreSQL, TimescaleDB, and Redis.

```bash
cp .env.example .env
docker compose up --build
```
> The application will be available at [http://localhost:8080](http://localhost:8080).

## Verification

To ensure your local environment is sound, run the following test suites:

```bash
# Backend Python tests
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests

# Frontend Vite build & tests
cd frontend
npm run build
npm test

# Docker configuration check
docker compose config
```
