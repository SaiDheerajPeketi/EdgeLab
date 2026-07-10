# Setup and Deployment

This document outlines the workflows for developing locally and deploying EdgeLab to production.

## Local Development (Without Docker)

For rapid iteration, you can run the backend and frontend separately without spinning up the entire Docker stack. 

### 1. Database Setup
You will need a database to store EdgeLab data. EdgeLab defaults to looking for PostgreSQL, but can fallback to a local SQLite file for development if `DATABASE_URL` is set to a SQLite path (e.g., `sqlite:///./trade_journal.db`).

### 2. Backend Setup
The backend requires Python 3.10+.
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Run migrations to initialize the schema
alembic upgrade head

# Start the FastAPI server
PYTHONPATH=. python -m uvicorn app.main:app --reload
```

### 3. Frontend Setup
The frontend requires Node.js 18+.
```bash
cd frontend
npm install

# Start the Vite dev server
npm run dev
```
The Vite configuration automatically proxies `/api` requests to `localhost:8000`.

### Alternative: The Orchestrator Script
Instead of running these in separate terminals, use the provided orchestrator from the project root:
```bash
node scripts/dev.js
```
This script will boot up the Python API, the Legacy Node API, and the Vite frontend concurrently.

---

## Local Development (With Docker Compose)

The easiest way to get an environment identical to production is to run the Docker Compose stack.

```bash
cp .env.example .env
# Edit .env to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET if you want auth to work
docker compose up --build
```
This boots:
- Postgres
- TimescaleDB
- Redis
- PgBouncers
- Nginx (Frontend static + Proxy)
- FastAPI (api + market-api)
- Background workers

---

## Production Deployment (Jenkins CI/CD)

The primary production deployment strategy uses Jenkins to build and execute `docker-compose up` on a remote Ubuntu instance.

### Deployment Workflow
1. Code is merged to the main branch.
2. The `Jenkinsfile` defines the CI/CD pipeline which pulls the latest code.
3. The pipeline stops the active containers, prunes dangling images, and rebuilds the `frontend` and `backend` images.
4. The pipeline restarts the Compose stack.

### Managing OAuth Secrets on the Host
EdgeLab relies on Google OAuth for beta access, but we do not commit the client secrets to version control.
Instead, a local script pushes the secret JSON to the remote host:
```bash
bash deployment/push-google-oauth-secret.sh
```
This places the file at `/opt/edgelab/deployment/google-oauth-client.json` on the host, which `docker-compose.yml` mounts directly into the FastAPI containers at runtime.

### Data Persistence
Docker named volumes (`postgres-data`, `timescaledb-data`, `api-data`) are used to persist database state across Jenkins deployments. The CI/CD script deliberately skips pruning volumes to avoid wiping user data.
