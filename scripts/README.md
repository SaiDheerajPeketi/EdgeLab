# Repository scripts

The scripts in this directory fall into three groups.

## Development

- `dev.js` starts FastAPI, Vite, and the compatibility Node API, reusing healthy services that are already running.
- `purge-vite-cache.js` removes stale generated Vite configuration and cache files after builds.
- `audit-dependencies.sh` runs the Python and npm dependency audits.
- `pine-engine.mjs` verifies the pinned PineTS source map and reviewed local source overrides, then resolves them into the isolated worker without modifying the installed package. `npm --prefix frontend run check:pine-engine` runs the integrity check; the frontend build runs it automatically. See [engine source notes](../frontend/vendor/pinets/README.md).

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

## Pine community catalog

`node scripts/refresh-pine-catalog.mjs` fetches the latest `master` commit from `everget/tradingview-pinescript-indicators` and preserves the selected 21 original scripts, their full GPL-3.0 licence and immutable provenance under `frontend/public/catalog/pine/everget/`. To pin a revision, use `node scripts/refresh-pine-catalog.mjs --commit FULL_GIT_SHA` with a complete lowercase 40-character commit hash.

The command validates original author/licence headers, UTF-8 bytes, Pine versions, SHA-256 and Git blob identities. It appends a new revision and index entry atomically; existing revisions are verified without overwriting them. A concurrent process receives a busy error. If a process crashes, inspect its `.refresh.lock` and confirm that it has stopped before removing the lock and retrying.

Review refreshed sources and licence changes, run the repository checks, and rebuild the frontend before distribution. The editor's **Reload catalog** reads the latest packaged revision; it does not fetch directly from GitHub or update a saved script. Importing opens an unsaved copy with pinned provenance. Source edits, saved history and chart instances retain their own source and upstream base until the user explicitly chooses another revision. These are community implementations, not TradingView-owned built-in sources. Four v6 originals have experimental execution, with unsupported output reported by the runtime.

The 17 legacy originals have separately reviewed Pine v5 copies under `frontend/public/catalog/pine/migrations/v1/`. The bundled `frontend/src/lib/pineCatalogMigrations.json` pins their bytes, hashes, target version and exact original revision/hash/blob/version. **Import migrated draft** verifies the unchanged original first, then the derivative. A refresh does not regenerate or silently pair these copies with new originals. To support a new revision, review and test a new derivative, retain the previous immutable migration assets and compiled pins, and append the new pins in a separate code iteration. Old saved copies keep their reviewed migration identity through this maintenance. Keep GPL-3.0 author/licence notices and document semantic conversions alongside each migration. Run the native calculation, provenance and browser suites before distribution. Original imports/downloads remain verbatim.
