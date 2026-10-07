# Setup and deployment

## Choose a mode

- Use `docker-compose.local.yml` for one person on one machine. It is the shortest path and stores data in SQLite.
- Use native development when editing the frontend or backend.
- Use `docker-compose.yml` when you need the production service split, PostgreSQL, TimescaleDB, Redis, workers, or observability.

## Single-user Docker installation

Requirements: Docker Engine or Docker Desktop with Compose v2.

```bash
docker compose -f docker-compose.local.yml up --build -d
```

Open <http://localhost:8080>. The web port is bound to loopback, and sign-in uses the loopback-only development bypass. Set `FRONTEND_PORT` to choose another port and `EDGELAB_DATASETS_ROOT` to mount a different dataset directory.

Useful lifecycle commands:

```bash
docker compose -f docker-compose.local.yml logs -f
docker compose -f docker-compose.local.yml down
docker compose -f docker-compose.local.yml cp api:/var/lib/edgelab ./edgelab-local-backup
```

Normal `down` operations keep the `edgelab-local_local-api-data` volume. Adding `--volumes` permanently deletes the SQLite data.

## Native development

Requirements: Node.js 20+, npm, Python 3.12, and a C/C++ toolchain if a Python dependency needs compilation.

```bash
npm install
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
EDGELAB_DEV_AUTH_BYPASS=1 EDGELAB_JWT_SECRET=local-dev-secret npm run dev
```

This starts FastAPI on port 8000, Vite on 5173, and the compatibility Node API on 3001. Place CSV datasets beneath `datasets/`; the folder contents are ignored by Git.

To run only one service:

```bash
npm run dev:python
npm run dev:frontend
npm run dev:backend
```

## Full Compose stack

Copy the template and review every security-sensitive value:

```bash
cp .env.example .env
docker compose up --build -d
```

At minimum, replace `POSTGRES_PASSWORD` and `EDGELAB_JWT_SECRET`. A production environment also requires `EDGELAB_SECRET_VAULT_KEYS` and `EDGELAB_SECRET_VAULT_ACTIVE_KEY_ID`, verified Google sign-in, and configured live Stripe subscriptions for workspace access. `EDGELAB_DEPLOYMENT_MODE` and browser build `VITE_DEPLOYMENT_MODE` both default to `production`; set both to `beta` for the optional capped beta workspace. Data exports require an active live paid subscription in either mode. Local Compose selects beta explicitly.

The full stack exposes the frontend on `FRONTEND_PORT` (8080 by default). PostgreSQL, TimescaleDB, Redis, PgBouncer, the API services, the data populator, and the analytics worker start by default.

The four Python services share `EDGELAB_BACKEND_IMAGE` (default `edgelab-backend:local`), so a clean Compose build produces the backend once and reuses it. Set a registry tag when a deployment pipeline pushes or pulls a prebuilt image.

Add the benchmark profile for the bundled monitoring stack and k6 service:

```bash
docker compose --profile benchmark up --build -d
```

Use the legacy API only for compatibility testing:

```bash
docker compose --profile legacy-node-api up --build -d
```

## Production notes

The checked-in `Jenkinsfile` deploys the full Compose stack into an existing checkout. It fetches the requested revision, rebuilds the application services, and preserves named volumes.

Before exposing EdgeLab publicly:

- use unique database, JWT, Grafana, and vault secrets;
- configure `EDGELAB_PUBLIC_ORIGIN`, CORS, and the Google callback URI;
- leave `EDGELAB_DEV_AUTH_BYPASS=0`;
- use HTTPS for the public origin and any NinjaTrader connector;
- back up PostgreSQL, TimescaleDB, the API data volume, and the dataset directory;
- test `docker compose config` and the application health endpoints.

See [deployment utilities](../deployment/README.md) for the host-capture and OAuth upload scripts.
