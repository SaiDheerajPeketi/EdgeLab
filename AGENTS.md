# EdgeLab Agent Guide

## Scope

These instructions apply to the whole repository.

## Runtime Shape

- The primary backend is the FastAPI app in `backend/app`.
- The primary frontend is the Vite React app in `frontend`.
- The legacy Node API in `backend/index.js` is kept for compatibility and is exposed only through the optional `legacy-node-api` Docker Compose profile.
- The default deploy path is Docker Compose with FastAPI behind Nginx-served static frontend assets.

## Files That Must Stay In Sync

When changing deployment, environment variables, API routing, build commands, or persistent data paths, update all relevant files in the same change:

- `docker-compose.yml`
- `.env.example`
- `.dockerignore`
- `backend/Dockerfile`
- `backend/Dockerfile.node` when the legacy Node API is affected
- `frontend/Dockerfile`
- `docker/nginx.conf`
- `README.md`
- `backend/README.md`
- `frontend/README.md`
- `AGENTS.md` when maintenance rules change

When changing Python dependencies, update `backend/requirements.txt` and confirm the backend Dockerfile still installs cleanly.

When changing frontend dependencies or build behavior, update `frontend/package.json`, `package-lock.json`, and confirm `frontend/Dockerfile` still builds the production bundle.

When changing API prefixes or proxy behavior, update `docker/nginx.conf`, frontend `VITE_API_BASE_URL` guidance, and the Docker Compose service health assumptions.

## Deployment Assumptions

- The Docker Compose frontend publishes Nginx on `${FRONTEND_PORT:-8080}`.
- The frontend image is built with `VITE_API_BASE_URL=/api`.
- Nginx proxies `/api/*` to the FastAPI service at `api:8000`.
- FastAPI stores its SQLite database at `/var/lib/edgelab/trade_journal_v2.db` in the `api-data` named volume.
- The default Compose deployment is dataset-root driven.
- Dataset folders are mounted read-only at `/datasets` for the API.
- The scheduled `data-populator` service mounts `/datasets` read-write, runs as `${EDGELAB_DATA_POPULATOR_USER:-0:0}`, updates M1 dataset CSVs, and derives configured higher-timeframe CSVs from M1 data.
- The data populator maintains `.edgelab-data-populator-manifest.json` under the dataset root for local resume metadata.
- The legacy single-file replay path is optional and should only be enabled with an explicit `EDGELAB_CSV_PATH`.

## Required Verification

Run these checks before committing code or deployment changes:

```bash
npm run build
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
npm test
```

Run Graphify after code changes so the code graph stays current:

```bash
graphify update .
```

If Docker is available, also run:

```bash
docker compose config
docker compose build
```

If Docker is unavailable in the current environment, state that limitation in the handoff and still run the non-Docker checks.

## Git Hygiene

- Do not commit local data files, SQLite databases, virtualenvs, generated build output, or the large `EURUSD_M1.csv`.
- Keep user-owned uncommitted changes separate from agent changes unless the task explicitly requires modifying those files.
- Commit each complete feature or maintenance iteration separately.
