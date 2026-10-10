# Setup and deployment

Run commands from the repository root. Use [configuration](configuration.md) and `.env.example` for settings, [architecture](architecture.md) for service ownership, and [maintenance](maintenance.md) for release, backup and recovery procedures.

## Choose a deployment

| Choice | Intended use | Persistent stores |
| --- | --- | --- |
| `docker-compose.personal.yml` | Personal local workspace without Google/Stripe | Independent SQLite volume, private keys and downloaded CSVs |
| `docker-compose.local.yml` | Single-user installation on a loopback address | SQLite application/candle databases and a separate SQLite auth volume |
| `docker-compose.yml` | Default production service split | PostgreSQL application data, TimescaleDB candles, SQLite auth by default, dataset files |
| Base Compose plus `docker-compose.efficient.yml` | New production installation using one indexed PostgreSQL store | Application data and candles on the same PostgreSQL server; auth remains separate |
| Native `npm run dev` | Editing and previewing the application | Local development databases and datasets |
| `legacy-node-api` profile | Compatibility testing of the old Node API | Separate legacy volumes |
| `benchmark` profile / load scripts | Isolated workload measurements | Disposable benchmark fixtures; never customer data |

The efficient overlay requires Docker Compose **2.24.4 or newer** for `!override`. It preserves the API service split and background workers while omitting the second database/pooler. It does not move existing candle data: migrating a split installation requires a reviewed copy/import, verification and rollback plan before changing database URLs. An explicit database URL takes precedence over host defaults; review those settings when selecting the overlay.

For personal use with local exports and real history downloads, follow [personal self-hosting](personal-self-hosting.md). The following local installation retains the beta access policy.

## Single-user Docker installation

Requirements: Docker Engine or Docker Desktop with Compose v2. Keep production environment settings separate from this local installation.

```bash
EDGELAB_ENVIRONMENT=development docker compose -f docker-compose.local.yml up --build -d --wait
```

Open <http://localhost:8080>. Three services start: `auth`, `api` and `frontend`. The browser and API explicitly select beta mode; the API enables the loopback-only developer sign-in. The frontend port is bound to loopback. Set `FRONTEND_PORT` or `EDGELAB_DATASETS_ROOT` before startup to choose another port or dataset directory.

```bash
docker compose -f docker-compose.local.yml logs -f
docker compose -f docker-compose.local.yml stop
docker compose -f docker-compose.local.yml start
```

Normal `down` preserves both local data volumes. `down --volumes` deletes application and auth data. Back up both volumes and the dataset directory; stop writers before copying SQLite files so the database and any WAL files form a consistent snapshot. See [maintenance](maintenance.md) before upgrading or restoring.

## Native development

Use Node.js **22.13+**, npm and Python 3.12. The Better Auth workspace requires Node 22.13 or newer. Install a C/C++ toolchain if a dependency needs compilation.

```bash
npm ci
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements-dev.txt
DATABASE_URL=sqlite:///./backend/edgelab-local.db PYTHONPATH=backend \
  backend/.venv/bin/python -m alembic -c backend/alembic.ini upgrade head
DATABASE_URL=sqlite:///./backend/edgelab-local.db \
  EDGELAB_ENVIRONMENT=development EDGELAB_AUTH_PROVIDER=legacy \
  EDGELAB_DEPLOYMENT_MODE=beta VITE_DEPLOYMENT_MODE=beta EDGELAB_DEV_AUTH_BYPASS=1 \
  EDGELAB_JWT_SECRET=replace-with-a-private-local-development-secret npm run dev
```

This example deliberately selects a disposable SQLite file and migrates it before launch. For PostgreSQL, configure a reachable database and migrate with that same URL first. The launcher reads process environment, does not load `.env` automatically, and does not enable API auto-reload. Existing compatible services retain their original environment until restarted.

The launcher starts FastAPI on 8000, Vite on 5173 and the compatibility Node API on 3001, reusing compatible healthy backend services. It starts Better Auth on 3002 only when `EDGELAB_AUTH_PROVIDER=better-auth` is set; configure its secrets and public origin for that path. Native development otherwise defaults to legacy auth. These preview ports and developer settings are not a production deployment.

To launch an individual service, use `npm run dev:python`, `dev:frontend`, `dev:backend` or `dev:auth` with the required environment. Put CSV datasets beneath `datasets/`; dataset contents are ignored by Git. See [repository scripts](../scripts/README.md).

## Production installation

Copy the template, then configure it before starting services:

```bash
cp .env.example .env
docker compose config --quiet
docker compose up --build -d --wait
```

Replace database, JWT, Better Auth signing and internal service-key defaults. Production startup also requires the vault keyring and active key ID. Configure the HTTPS public origin, allowed CORS origins and Google OAuth credentials/callbacks. For production workspace access, configure live Stripe billing and verified active subscriptions. Keep `EDGELAB_DEPLOYMENT_MODE` and build-time `VITE_DEPLOYMENT_MODE` aligned; both default to `production`. Data exports require an active live paid subscription in production and beta. The separate personal installation has its own loopback-only local export policy. Keep the developer bypass disabled.

For a **new efficient installation**, use the same file selection for every lifecycle command:

```bash
docker compose -f docker-compose.yml -f docker-compose.efficient.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.efficient.yml up --build -d --wait
```

The default stack starts auth, PostgreSQL, TimescaleDB, two PgBouncer services, Redis, both FastAPI roles, data population, analytics and the frontend. Four Python roles share `EDGELAB_BACKEND_IMAGE`; build API, auth and browser inputs from the same checkout so the distributed source offer matches the release. Changing browser build variables requires rebuilding the frontend.

The frontend publishes `FRONTEND_PORT` (8080 by default) on all host interfaces. Place it behind the configured HTTPS ingress and host firewall. Databases and Redis publish loopback ports; API/auth services remain internal. Persistent data is held in named volumes and the host dataset directory. Optional PostgreSQL-backed auth is configured with `BETTER_AUTH_DATABASE_URL`; changing it does not migrate an existing SQLite auth store automatically.

Use `/api/health` and `/api/ready` through the frontend to verify application health/readiness after startup. Compose startup checks do not validate public DNS, HTTPS, Google callbacks, billing or a recovery procedure.

## Optional services

Enable private monitoring after configuring its dedicated credentials:

```bash
docker compose --profile observability up -d --build
```

Include the efficient overlay in that command when applicable. Follow [observability](observability.md) for private access, monitoring roles, retention and optional sampled traces. Starting the monitoring profile does not enable OTLP export by itself. The `benchmark` profile includes monitoring plus MinIO and the k6 runner; use [load testing](../benchmark/README.md) on an isolated stack. It is not needed for normal application startup.

The `legacy-node-api` profile adds the old Node service on `LEGACY_API_PORT` (3001 by default). It does not replace FastAPI or change the frontend's API routing.

## Upgrade, rollback and recovery

Before an upgrade, record the source revision, image identifiers, Compose file/profile selection and deployed settings. Take restorable database backups, the auth store, API persistent files, datasets and the required vault keys/secrets. Protect these backups and test restoration in isolation. Copying a running PostgreSQL data directory is not a database backup.

Build the release from one checkout, plan any schema/data migration and allow a maintenance window. Main `api` runs Alembic migrations at startup; `market-api` skips them. Reverting images does not reverse schema changes. Rollback requires a compatible schema or a tested restore of the prior data, secrets and images. Never remove named volumes as an upgrade step. See [maintenance](maintenance.md) for the operational checklist.

The historical [Jenkinsfile](../Jenkinsfile) hard-resets a live checkout, stops the stack and prunes Docker resources before deployment. It does not implement a rolling release, readiness gate, backup or automatic rollback, and its explicit build list omits the auth image. Review/adapt it before relying on it for a production release; see [deployment utilities](../deployment/README.md).

These Compose files describe a single-host installation. Additional containers or separate API roles do not provide independent-zone redundancy. Use [architecture](architecture.md) and [production capacity](production-capacity.md) for the measured limits and requirements for a separately tested redundant deployment.
