# Setup and Deployment

EdgeLab supports two primary installation methods for local development and self-hosting:

1. **Docker Compose**: Containerized multi-service setup (Frontend, API, Auth)
2. **Native Development**: Local Node.js and Python environments for development

---

## 1. Docker Compose Installation

Docker Compose provides a complete, isolated local environment with zero manual database configuration.

### Prerequisites
- Docker Engine or Docker Desktop (with Docker Compose v2)

### Starting the Application

```bash
# 1. Clone the repository
git clone https://github.com/SaiDheerajPeketi/EdgeLab.git
cd EdgeLab

# 2. Configure environment (optional, defaults are provided)
cp .env.example .env

# 3. Start services
docker compose -f docker-compose.local.yml up -d --build
```

### Accessing Services

Once started, open [http://localhost:8080](http://localhost:8080) in your browser:
- **Frontend SPA**: `http://localhost:8080`
- **FastAPI API**: `http://localhost:8080/api`
- **Health Check**: `http://localhost:8080/api/health`
- **Auth Service**: `http://localhost:8080/api/better-auth`

### Managing Services

```bash
# Follow logs
docker compose -f docker-compose.local.yml logs -f

# Stop services
docker compose -f docker-compose.local.yml stop

# Start stopped services
docker compose -f docker-compose.local.yml start

# Tear down containers (keeps data volumes)
docker compose -f docker-compose.local.yml down

# Tear down containers and delete all data
docker compose -f docker-compose.local.yml down -v
```

---

## 2. Native Development Setup

For actively modifying frontend and backend code with hot-reloading:

### Prerequisites
- **Node.js**: 22.13.0 or later
- **Python**: 3.12 or later
- **npm**: 10 or later

### Step 1: Frontend & Root Dependencies
```bash
npm ci
```

### Step 2: Python Backend Environment
```bash
# Create virtual environment
python -m venv backend/.venv

# Activate virtual environment
# Windows (PowerShell):
.\backend\.venv\Scripts\Activate.ps1
# Linux / macOS:
source backend/.venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
pip install -r backend/requirements-dev.txt
```

### Step 3: Run Database Migrations
```bash
# From repository root (with virtual environment activated):
PYTHONPATH=backend alembic -c backend/alembic.ini upgrade head
```

### Step 4: Run Development Services

Start all services simultaneously:
```bash
npm run dev
```

This starts:
- **Frontend**: Vite dev server on `http://127.0.0.1:5173`
- **FastAPI Backend**: Uvicorn server on `http://127.0.0.1:8000`
- **Better Auth Service**: Node.js auth server on `http://127.0.0.1:3002`

You can also run services independently:
- `npm run dev:frontend` (Vite)
- `npm run dev:python` (FastAPI)
- `npm run dev:auth` (Better Auth)

---

## 3. Market Datasets

EdgeLab uses CSV files for market candle data and backtesting:
- Place CSV dataset files under the `datasets/` directory.
- For Docker Compose, the `./datasets` directory is automatically bind-mounted into the backend container at `/datasets`.
- Datasets are ignored by Git.

---

## 4. Verification

Run the verification suite to ensure everything is working:

```bash
# Documentation validation
npm run check:docs

# Frontend build check
npm run build

# Python backend tests
PYTHONPATH=backend pytest backend/tests

# Node test runner
npm test
```
