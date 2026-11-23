# Repository Scripts

Maintenance and verification scripts for EdgeLab.

## Development & Build

- **`dev.js`**: Development orchestrator that starts FastAPI, Vite, and Better Auth concurrently for native development.
- **`purge-vite-cache.js`**: Clears the Vite development dependency cache. Stop Vite, then run `node scripts/purge-vite-cache.js`.
- **`pine-engine.mjs`**: Verifies the pinned PineTS source map and reviewed local source overrides, then prepares them for the isolated worker.
- **`source-release.mjs`**: Generates and verifies the reproducible source archive for public release builds.
- **`check-docs.mjs`**: Validates local Markdown links, anchors, and fenced code blocks without external network dependencies. Run with `npm run check:docs`.

## UI Quality & Contracts

- **`check-ui-surface-inventory.mjs`**: Validates the route, panel, and overlay inventory against tracked specifications.
- **`check-ui-release.mjs`**: Validates rollout coverage and release matrix definitions.
- **`check-ui-accessibility-certification.mjs`**: Verifies accessibility certification records.
- **`check-ui-route-accessibility-sweep.mjs`**: Verifies route-sweep accessibility evidence.
- **`check-ui-performance.mjs`**: Measures bundle sizes and performance against budgets in [`docs/ui-performance-budgets.json`](../docs/ui-performance-budgets.json).
- **`check-ui-motion.mjs`**: Audits animation and reduced-motion compliance.
- **`run-ui-accessibility-certification.mjs`**: Executes runtime Playwright accessibility audits.

Run all quality checks together:
```bash
npm run quality:ui
```

## Pine Community Catalog

- **`refresh-pine-catalog.mjs`**: Preserves and verifies the community Pine script indicator catalog under `frontend/public/catalog/pine/`. Validates licenses, headers, and SHA-256 checksums.
