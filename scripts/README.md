# Repository scripts

Run package commands from the repository root. See [maintenance](../docs/maintenance.md) for release checks and [architecture](../docs/architecture.md) for code ownership.

## Personal installation

`personal.mjs` generates private local keys once and runs only the pinned personal Compose project. Use `npm run personal:start`, `personal:stop`, `personal:logs`, `personal:check` and `personal:feeds`. Stop preserves volumes and keys. [Personal setup](../docs/personal-self-hosting.md) documents real data coverage, optional own-key imports and backups.

## Development

- `dev.js` starts FastAPI, Vite and the compatibility Node API, reusing compatible healthy backends. It starts Better Auth only when `EDGELAB_AUTH_PROVIDER=better-auth` is set. Use [native setup](../docs/setup-and-deployment.md#native-development) for the preview environment; `dev:backend` is the legacy Node service.
- `purge-vite-cache.js` is an explicit dependency-cache maintenance utility. Stop Vite first, then run `node scripts/purge-vite-cache.js` from the repository root. Production builds preserve the development cache; the normal dev command already forces dependency optimization on startup.
- `audit-dependencies.sh` audits npm dependencies and Python runtime requirements; it does not cover all image/OS or Python development dependencies.
- `pine-engine.mjs` verifies the pinned PineTS source map and reviewed local source overrides, then resolves them into the isolated worker without modifying the installed package. `npm --prefix frontend run check:pine-engine` runs the integrity check; the frontend build runs it automatically. See [engine source notes](../frontend/vendor/pinets/README.md).

## Builds and verification

- `check-docs.mjs` validates maintained local Markdown links, anchors and fenced blocks without network access or runtime dependencies. Use `npm run check:docs`; the dedicated documentation workflow also runs its regression tests.

- `source-release.mjs` creates and verifies the matching source offer from its explicit allowlist. Frontend production builds run it automatically. Build API, auth and browser from one checkout; do not manually publish generated `frontend/public/source/` or add private artifacts to the allowlist.
- `npm ci` installs the root workspaces, including frontend and Better Auth. Use Node 22.13+ and Python 3.12 as described in [setup](../docs/setup-and-deployment.md).
- `npm run build`, `npm test` and the backend pytest suite are release checks. GitHub's UI workflow also runs Playwright/accessibility gates; the security workflow runs dependency audits. These workflows do not deploy or prove recovery/HA behavior.
- Database import/analytics commands and Python microbenchmarks live in `backend/scripts/`; use the root `market-data:*`, `analytics:*` and `bench:*` package scripts. Imports and analytics refreshes can write persistent stores; see [maintenance](../docs/maintenance.md) before applying them to a deployed database. HTTP stress tests require an isolated stack; see [load testing](../benchmark/README.md).

## UI contracts

- `check-ui-surface-inventory.mjs` validates the route, panel, and overlay inventory.
- `check-ui-release.mjs` checks rollout coverage and release evidence.
- `check-ui-accessibility-certification.mjs` validates accessibility certification records.
- `check-ui-route-accessibility-sweep.mjs` validates route-sweep evidence.
- `check-ui-performance.mjs` measures built dependency graphs and the deferred Pine worker against the separate raw/compressed limits in [`docs/ui-performance-budgets.json`](../docs/ui-performance-budgets.json). Update reviewed budgets with actual evidence; do not copy historical byte ceilings into operating instructions.
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

`node scripts/refresh-pine-catalog.mjs` fetches the latest `master` commit from `everget/tradingview-pinescript-indicators` and preserves the selected 29 original scripts, their full GPL-3.0 licence and immutable provenance under `frontend/public/catalog/pine/everget-v2/`. To pin a revision, use `node scripts/refresh-pine-catalog.mjs --commit FULL_GIT_SHA` with a complete lowercase 40-character commit hash. The original 21-script collection remains byte-for-byte intact under `everget/`; `--collection legacy-v1` explicitly maintains that collection. The default `expanded-v2` selection has its own complete allowlist, seed pins and immutable revision directories; neither selection rewrites the other archive.

The command validates original author/licence headers, UTF-8 bytes, Pine versions, SHA-256 and Git blob identities. It appends new immutable revisions and atomically selects the verified revision through the index’s `currentRevision` field. Pinning an older archived revision changes the selection without reordering archives or rewriting source bytes. Older indexes without the field retain their last-entry selection until their next successful refresh. Existing revisions are verified without overwriting them. A concurrent process receives a busy error. If a process crashes, inspect its `.refresh.lock` and confirm that it has stopped before removing the lock and retrying.

Review refreshed sources and licence changes, run the repository checks, and rebuild the frontend before distribution. The editor's **Reload catalog** reads the explicitly selected packaged revision; it does not fetch directly from GitHub or update a saved script. Importing opens an unsaved copy with pinned provenance. Source edits, saved history and chart instances retain their own source and upstream base until the user explicitly chooses another revision. These are community implementations, not TradingView-owned built-in sources. Four v6 originals have experimental execution, with unsupported output reported by the runtime.

The original 17 legacy originals retain their reviewed Pine v5 copies under `frontend/public/catalog/pine/migrations/v1/`. Eight additions have separately reviewed copies under `frontend/public/catalog/pine/migrations/v2/`. The bundled `frontend/src/lib/pineCatalogMigrations.json` pins their bytes, hashes, target version and exact original revision/hash/blob/version. **Import migrated draft** verifies the unchanged original first, then the derivative. A refresh does not regenerate or silently pair these copies with new originals. To support a new revision, review and test a new derivative, retain the previous immutable migration assets and compiled pins, and append the new pins in a separate code iteration. Old saved copies keep their reviewed migration identity through this maintenance. Keep GPL-3.0 author/licence notices and document semantic conversions alongside each migration. Run the native calculation, provenance and browser suites before distribution. Original imports/downloads remain verbatim.
