# Repository scripts

The scripts in this directory fall into three groups.

## Development

- `dev.js` starts FastAPI, Vite, and the compatibility Node API, reusing healthy services that are already running.
- `purge-vite-cache.js` removes stale generated Vite configuration and cache files after builds.
- `audit-dependencies.sh` runs the Python and npm dependency audits.

## UI contracts

- `check-ui-surface-inventory.mjs` validates the route, panel, and overlay inventory.
- `check-ui-release.mjs` checks rollout coverage and release evidence.
- `check-ui-accessibility-certification.mjs` validates accessibility certification records.
- `check-ui-route-accessibility-sweep.mjs` validates route-sweep evidence.
- `check-ui-performance.mjs` enforces UI performance budgets.
- `check-ui-motion.mjs` checks motion inventory and reduced-motion coverage.
- `run-ui-accessibility-certification.mjs` runs the bounded Playwright accessibility certification.

Use the package scripts instead of invoking these files directly:

```bash
npm run quality:ui
npm run check:ui-inventory
npm run check:ui-certification
npm run test:ui-certification:runtime
```

The JSON and Markdown records under `docs/` are inputs to these checks. Update them only alongside the corresponding UI behavior and tests.
