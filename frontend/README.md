# EdgeLab frontend

The React/Vite browser renders public pages and one persistent trading workspace. It uses React Router, Zustand, Lightweight Charts, themed controls, and isolated indicator workers. [Architecture](../docs/architecture.md) explains the boundaries; [feature reference](../docs/frontend-feature-reference.md) retains detailed calculation/execution caveats and browser regression pointers.

The separate [personal build](../docs/personal-self-hosting.md) selects `VITE_DEPLOYMENT_MODE=personal`, opens a local workspace instead of public pricing, and refreshes server session authority before personal exports. Production and beta retain paid export checks.

## Development

Use Node.js 22.13+ and install the root workspace with `npm ci`:

```bash
npm run dev:frontend
```

Vite normally listens on <http://127.0.0.1:5173>. It proxies `/api/better-auth` to port 3002 and other `/api` routes to FastAPI on 8000. For the complete launcher and explicit database/auth environment, see [setup](../docs/setup-and-deployment.md). A landing-only preview can run without the API; private data still needs it.

The dev command uses `--force` at startup. Builds preserve a running Vite dependency cache. Stop Vite before intentional `node scripts/purge-vite-cache.js` maintenance, then restart/reload; do not delete a live cache as a repair step.

## Find the owning code

| Path | Ownership |
| --- | --- |
| `src/main.tsx`, `src/routes/AppRoutes.tsx` | Preferences, lazy routes, auth refresh and presentation rollout |
| `src/App.tsx`, `src/components/EdgeLabWorkspace.tsx` | Workspace composition and navigation |
| `src/components/chart/`, `TradingChart.tsx` | Pane/feed ownership, runtime orchestration and chart rendering |
| `src/lib/api.ts`, `serverStorage.ts`, `appDataBarrier.ts` | Typed HTTP, account-owned acknowledged persistence and replacement coordination |
| `src/store/backtestStore.ts` | Replay/result windows, cursor synchronization and serialized owned mutations |
| `src/workers/`, `src/lib/pine*` | Indicator worker protocols, isolation and validated plot/object adapters |
| `vendor/pinets/`, `pineWorkerPlugin.ts` | Reviewed engine source/manifest and worker build |
| `src/components/marketing/` | Synthetic continuous preview, scoped motion and deferred 3D scene |
| `src/components/settings/`, `styles.css` | Settings and semantic theme/elevation/control tokens |

Public routes, account management and `/app/*` share one router. Workspace groups include Live, Replay, Journal, Reports, Quant and Settings. Compatibility presentation is an explicit rollout/recovery path, not an alternative auth policy.

## State and security contracts

Capture account/session/context before asynchronous work and check it before publishing results, saves, exports or chart updates. Use API helpers, the data barrier and `serverStorage`; local cache/draft state is not server acknowledgment. Replay writes serialize per account/session. Retire workers, pending adds and provider feeds when their owner changes, including a switch away and back.

Better Auth is selected by server configuration. Keep the owned one-use Google callback flow, fixed validated provider destination and same-origin cookie exchange; do not fall back silently after provider failure. The client session snapshot helps navigation, but FastAPI owns access. Account management stays reachable without workspace access. Test/developer/beta identities and checkout query strings cannot authorize paid exports.

All `VITE_*` values are public build inputs. They cannot safely contain Stripe keys, vault keys, auth service keys or private provider credentials. The optional legacy `VITE_API_BEARER_TOKEN` is visible in the bundle; it is not a replacement for user authorization or a confidential server token. Supported transient broker credentials must remain out of URLs/logs/shares; see [security](../SECURITY.md).

## Build inputs and source offer

| Variable | Meaning |
| --- | --- |
| `VITE_API_BASE_URL` | Same-origin API prefix, normally `/api` |
| `VITE_DEPLOYMENT_MODE` | Presentation mode (`production`, `beta`, `personal`) aligned with server `EDGELAB_DEPLOYMENT_MODE` |
| `VITE_BETA_SEATS_TOTAL`, `VITE_BETA_SEATS_TAKEN` | Presentation fallbacks; server owns admission |

Changing build inputs requires rebuilding. `npm run build` verifies the reviewed Pine engine, generates matching application source, runs TypeScript/Vite, then verifies the source offer again. Keep API/browser images on one checkout and update `scripts/source-release.mjs`/Docker build inputs when required runtime files change. Generated `public/source/` remains ignored and excludes secrets/customer data/internal plans.

PineTS remains experimental with explicit supported behavior. The opaque-frame/worker bridge, nonces, bounded schemas, cancellation and deadlines must survive upgrades; they are not a total-heap guarantee. Never directly evaluate user scripts in the parent window. See [engine source](vendor/pinets/README.md) and [upgrade guide](../docs/maintenance.md).

## UI and marketing contracts

Use semantic tokens and existing themed controls throughout dark/light/system workspace themes. Preserve chart plot space, viewport, selection, drafts, hover/pinned pane behavior and keyboard focus. Do not mix hardcoded dark backgrounds into theme-aware workflows. Follow [DESIGN.md](DESIGN.md), [PRODUCT.md](PRODUCT.md) and the [UI quality contract](../docs/ui-quality-contract.md).

Launch home/pricing is the default public presentation; `?variant=beta` retains the optional marketing variant. It does not select server authorization mode. Landing candles are synthetic continuous examples, not an external live market. Public motion must complete after triggers, respect focus/reduced motion, and stop when paused/offscreen as designed. Advertise implemented behavior, not internal plans or unverified testimonials.

## Validation

From the repository root:

```bash
npm run check:docs
npm run build
npm run quality:ui
npm run test:ui
```

Use relevant feature-specific Playwright and genuine-worker checks from the [feature reference](../docs/frontend-feature-reference.md); avoid substituting mocked arithmetic for actual engine/bridge/chart behavior. [Maintenance](../docs/maintenance.md#validation-tiers) explains full-suite, real-store, provider and release gates. Snapshot baselines and UI evidence change only after reviewing actual output.

## Deployment

Nginx serves precompressed production assets. Cache fingerprinted `/assets/*` at the CDN; bypass authentication, account APIs, streams and exports. HTML/source metadata must stay fresh and match the API deployment. Vite is a development server, not the production host. See [deployment](../docs/setup-and-deployment.md) and [private monitoring](../docs/observability.md).
