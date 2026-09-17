# EdgeLab frontend

The frontend is a React 18 and Vite application. It provides the public site, authentication flow, chart and replay workspaces, journal, reports, order flow, Quant assistant, settings, and shared-workspace views.

## Run it

Install the root workspace dependencies, then start the frontend:

```bash
npm install
npm run dev:frontend
```

Vite listens on <http://127.0.0.1:5173> and proxies `/api` to FastAPI on port 8000. For the complete local development stack, use `npm run dev` from the repository root.

## Layout

| Path | Purpose |
| --- | --- |
| `src/pages/` | Public, legal, auth, and shared-workspace pages |
| `src/routes/` | Browser routes and protected-route handling |
| `src/components/` | Workspace surfaces and reusable UI |
| `src/lib/` | API clients and domain helpers |
| `src/store/` | Replay and workspace state |
| `src/workers/` | Browser workers for indicator execution |
| `public/vendor/` | Vendored browser assets required at runtime |

Workspace URLs are stable and deep-linkable. The main groups are `/app/live`, `/app/replay`, `/app/order-flow`, `/app/quant`, `/app/journal/*`, `/app/reports`, and `/app/settings/*`.

## Build-time configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | API prefix used by the browser | `/api` |
| `VITE_API_BEARER_TOKEN` | Optional token for protected non-user routes | empty |
| `VITE_DEPLOYMENT_MODE` | `beta` or `production` marketing mode | `beta` |
| `VITE_BETA_SEATS_TOTAL` | Fallback beta capacity shown before API hydration | `500` |
| `VITE_BETA_SEATS_TAKEN` | Fallback occupied-seat count | `0` |

These values are compiled into the bundle. Rebuild the frontend after changing them.

## Checks

From the repository root:

```bash
npm run build
npm run quality:ui
npm run test:ui
```

`test:ui` is the full Playwright suite and is much slower than the build and contract checks. Update visual snapshots only after reviewing the changed images.
