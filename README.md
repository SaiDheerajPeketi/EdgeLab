# EdgeLab

**EdgeLab** is a modern, modular trading workspace designed for market analysis, historical replay, trade journaling, performance review, and custom indicator execution.

Built with a **React + Vite** frontend, a high-performance **FastAPI** backend, and a sandboxed **Pine Script** runtime engine.

---

## Features

- **Interactive Multi-Pane Charts**: Advanced charting powered by lightweight-charts with custom drawing tools, overlays, and technical studies.
- **Sandboxed Pine Script Engine**: Native execution of Pine Script v5/v6 indicators and strategies in an isolated sandbox environment.
- **Market Data & Historical Replay**: Backtest strategies and replay historical market candles across multiple timeframes.
- **Trade Journaling & Analytics**: Comprehensive trading journal with performance metrics, tag-based categorization, and interactive review drawers.
- **Developer-Friendly Setup**: Zero-configuration local startup using Docker Compose and SQLite.

---

## Architecture

See the [system architecture diagram and service-ownership guide](docs/architecture.md#1-system-shape) for the browser, API, authentication, database, cache, market-data, and background-worker boundaries. It also explains the difference between the lightweight SQLite setup and the optional PostgreSQL/TimescaleDB/Redis performance stack.

---

## Documentation

Start with the [documentation index](docs/README.md), or use the guides below:

- **Architecture & product**: [Architecture](docs/architecture.md), [Glossary](docs/glossary.md), and [Frontend Feature Reference](docs/frontend-feature-reference.md).
- **Setup & operations**: [Setup & Deployment](docs/setup-and-deployment.md), [Performance Data Stack](docs/performance-data-stack.md), [Configuration](docs/configuration.md), [API Reference](docs/api-reference.md), and [Maintenance](docs/maintenance.md).
- **Quality**: [UI Quality Contract](docs/ui-quality-contract.md) and [UI Surface Inventory](docs/ui-surface-inventory.md).

---

## Quick Start

### Option 1: Docker Compose (Recommended)

Run the full EdgeLab stack (Frontend, API, and Auth) locally with Docker Compose:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

- **Frontend**: `http://localhost:8080`
- **FastAPI Backend**: `http://localhost:8080/api`
- **Auth Service**: `http://localhost:8080/api/better-auth`

To stop the containers:
```bash
docker compose -f docker-compose.local.yml down
```

---

### Option 2: Native Development

#### 1. Prerequisites
- **Node.js** 22.13.0+
- **Python** 3.12+

#### 2. Install Dependencies
```bash
# Install root and frontend npm dependencies
npm ci

# Set up Python virtual environment
python -m venv backend/.venv
# Windows:
.\backend\.venv\Scripts\activate
# Linux/macOS:
source backend/.venv/bin/activate

pip install -r backend/requirements.txt
pip install -r backend/requirements-dev.txt
```

#### 3. Configure Environment
```bash
cp .env.example .env
```

#### 4. Launch Services
```bash
npm run dev
```

This starts:
- Frontend dev server on `http://127.0.0.1:5173`
- FastAPI backend on `http://127.0.0.1:8000`
- Auth service on `http://127.0.0.1:3002`

---

## Optional Performance Data Stack

The default local stack deliberately uses SQLite so contributors can get started quickly. For larger datasets, concurrent API work, or production-like development, EdgeLab includes an opt-in data-services overlay:

- **PostgreSQL** stores transactional application data.
- **TimescaleDB** stores and indexes time-series market candles as a hypertable.
- **PgBouncer** pools application and candle-database connections independently.
- **Redis** provides disposable shared read-model caching and distributed rate-limit/admission counters; it is not a durable account or market-data store.

Start the application with the overlay:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.performance.yml up -d --build
```

Database and Redis ports remain bound to `127.0.0.1`. The API uses the internal PgBouncer services, writes application data to PostgreSQL, writes candles to TimescaleDB, and uses Redis at `redis://redis:6379/0`. Persistent SQL data is stored in named Docker volumes. Use `docker-compose.local.yml` alone when SQLite is sufficient.

---

## Market Datasets

To get started with historical replay and chart analysis, market CSV files should be placed inside the `datasets/` directory.

- **Sample Dataset (Google Drive)**: You can download sample historical datasets from [Google Drive](https://drive.google.com/drive/folders/1sZrVhKQVX0CO2jK-WOqBNkektTN4b-XC?usp=sharing).
- **Setup**: Download the folders or files from the link and place them under `datasets/` (e.g. `datasets/BTC_USDT/BTCUSDT_Daily.csv`). EdgeLab will automatically detect and index them in the catalog.

---

## Verification & Testing

Run the test suite across the project:

```bash
# Documentation and link checks
npm run check:docs

# Frontend compilation
npm run build

# Python API tests
PYTHONPATH=backend pytest backend/tests

# Node test runner
npm test
```

---

## Repository Structure

```
├── frontend/             # React, Vite, TailwindCSS, Chart components & UI
│   └── vendor/pinets/    # Sandboxed Pine Script runtime engine
├── backend/              # FastAPI application, database schemas & services
│   ├── app/              # API routes, models, analytics & market logic
│   ├── alembic/          # Database migrations
│   └── auth/             # Better Auth service
├── docker/               # Local Nginx reverse proxy configuration
│   └── pgbouncer/        # Connection-pooler image and generated configuration
├── docs/                 # Architecture and setup documentation
├── datasets/             # Local market CSV datasets
└── scripts/              # Development and verification utilities
```

---

## License & Contributing

- **License**: EdgeLab is licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (AGPL-3.0-only). You may use, modify, and distribute it, including commercially, provided you meet the AGPL's corresponding-source and network-interaction obligations.
- **Contributing**: We welcome community contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and note that all contributors must accept the [Contributor License Agreement (CLA)](CLA.md). The CLA gives the Project Owner rights in accepted EdgeLab contributions, but it does not override third-party licenses such as PineTS.
- **Security**: For vulnerability reporting, see [SECURITY.md](SECURITY.md).
- **Third-Party Notices**: See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details on third-party libraries and components.
