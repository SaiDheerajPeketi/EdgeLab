# Frontend

Vite React dashboard using Tailwind, Zustand, Lucide icons, and Lightweight Charts. The marketing landing page and pricing page are React Router routes (`/`, `/pricing`), staged auth lives at `/auth/signin` and `/auth/callback/google`, and the trading workspace lives behind protected routing under `/app`.

## Design System

EdgeLab ships a tokenized dark design system (Phase 1):

- **Fonts** — Syne Variable (display/headings), Inter Variable (body), JetBrains Mono (data/numbers), bundled at build time via `@fontsource-variable/*` and `@fontsource/jetbrains-mono` (no runtime Google Fonts fetch).
- **Tokens** — `--bg-base/surface/surface-2/border`, `--accent-primary` (electric cyan) + dim/glow, `--profit/--loss/--neutral/--warning`, text scale, 8pt spacing, radius, easing/duration. All defined on `:root` in `src/styles.css`.
- **Tailwind** — `edgelab.*` color scale + `font-display/body/data/mono` map to those tokens. Legacy `ink`/`signal` tokens are kept for back-compat.
- **Typography utilities** — `.text-display`, `.text-heading`, `.text-body`, `.text-data`, `.text-mono`.
- **Motion** — animations use `transform`/`opacity` only and honor `prefers-reduced-motion: reduce`.

## Setup

```bash
cd frontend
npm install
npm run dev
```

### Deployment mode

`VITE_DEPLOYMENT_MODE` (`beta` | `production`) drives the landing + pricing UI. `beta` (default) renders a single free Beta card with a seat counter (`VITE_BETA_SEATS_TOTAL`, `VITE_BETA_SEATS_TAKEN`); `production` renders the Starter / Pro / Trader+ tiers. See `.env.example`.

Current auth pass is beta-backed and Google-only: `/auth/signin` fetches runtime config from `/api/auth/config`, including Google client ID and callback URI, builds authorize URL in-browser, and `/auth/callback/google` exchanges OAuth code with backend. Manual email beta access is disabled by default and can be reopened only with `EDGELAB_BETA_MANUAL_ACCESS_ENABLED=1`. If Google shows `redirect_uri_mismatch`, backend `GOOGLE_REDIRECT_URI` must exactly match one Google Console authorized redirect URI. Landing, pricing, and auth surfaces fetch live beta seat + waitlist counts from `/api/auth/beta/status`; `VITE_BETA_*` values remain fallback display defaults for builds where API is unavailable.

The dev server proxies `/api` to `http://127.0.0.1:8000`. Set a custom API base URL when needed:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000/api npm run dev
```

When the backend is started with `EDGELAB_API_TOKEN`, build or run the frontend with a matching `VITE_API_BEARER_TOKEN` for non-user routes. Authenticated workspace routes prefer the stored beta session JWT and send it automatically after sign-in.

The workspace subscribes to `/api/datasets/stream` over WebSocket while the tab is open, so dataset ranges written by the scheduled populator update in the UI without a manual browser refresh. Initial load no longer creates a replay session automatically; users create sessions from the session gateway.

## Docker

The frontend container is built by `frontend/Dockerfile`. It compiles the Vite app with:

```bash
VITE_API_BASE_URL=/api
VITE_API_BEARER_TOKEN=
```

Google OAuth no longer needs a build-time frontend env var. The backend exposes the public client ID through `/api/auth/config`, which is sourced from `GOOGLE_CLIENT_SECRETS_FILE` or the backend `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars at runtime.

The Docker build pins npm 11 before running `npm ci` from the frontend directory so `frontend/package-lock.json` resolves platform-specific Vite/Rollup optional packages for the Linux container without the npm 10 optional-dependency exit-handler bug. It defaults `NPM_CONFIG_REGISTRY` to `https://registry.npmjs.org/`; override that build arg only when the deployment host can resolve the selected registry mirror.

The final image serves `frontend/dist` with Nginx. The Nginx config lives at `docker/nginx.conf`, proxies auth/session/journal APIs to the `api` service, proxies market-data, dataset, and live-feed APIs to the `market-api` service, upgrades `/api/datasets/stream` and `/api/live/angelone/stream` WebSocket connections, gzip-compresses text responses, caches hashed `/assets/*` files for one year, keeps the SPA document revalidated, and returns 404 for missing chunk assets. It also allows the deployed app to connect to the Binance live REST/WebSocket endpoints used by the watchlist. The root Compose stack now runs PostgreSQL by default alongside split `api` / `market-api` services and `data-populator`, so the browser-facing deployment path matches the production database stack and future service boundary even on a single VM.

Use the repository root Compose file for end-to-end deployment:

```bash
docker compose up --build
```

Use `docker-compose` instead when the host provides only the standalone Compose binary.

For staging-style load checks against the browser-facing stack, the root Compose file also exposes a `benchmark` profile. It keeps the same frontend/API runtime path and adds Redis, TimescaleDB, MinIO, and a `benchmark-k6` runner so you can load-test through the same Nginx entrypoint without changing the current single-VM deploy shape.
