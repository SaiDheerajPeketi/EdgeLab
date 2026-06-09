# Frontend

Vite React dashboard using Tailwind, Zustand, Lucide icons, and Lightweight Charts.

## Setup

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8000`. Set a custom API base URL when needed:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000/api npm run dev
```

When the backend is started with `EDGELAB_API_TOKEN`, build or run the frontend with a matching `VITE_API_BEARER_TOKEN`.

## Docker

The frontend container is built by `frontend/Dockerfile`. It compiles the Vite app with:

```bash
VITE_API_BASE_URL=/api
VITE_API_BEARER_TOKEN=
```

The Docker build pins npm 11 before running `npm ci` from the frontend directory so `frontend/package-lock.json` resolves platform-specific Vite/Rollup optional packages for the Linux container without the npm 10 optional-dependency exit-handler bug. It defaults `NPM_CONFIG_REGISTRY` to `https://registry.npmjs.org/`; override that build arg only when the deployment host can resolve the selected registry mirror.

The final image serves `frontend/dist` with Nginx. The Nginx config lives at `docker/nginx.conf` and proxies `/api` to the FastAPI service in Docker Compose.

Use the repository root Compose file for end-to-end deployment:

```bash
docker compose up --build
```

Use `docker-compose` instead when the host provides only the standalone Compose binary.
