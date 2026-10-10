# EdgeLab agent guide

These instructions apply to the whole repository. Read the [documentation index](docs/README.md), [architecture](docs/architecture.md) and [change map](docs/maintenance.md#change-map) as needed; source code and checked-in defaults settle conflicting descriptions.

## Working method

- Inspect the smallest relevant source/test set and choose the shortest correct implementation. Favor existing patterns and targeted changes over broad refactors.
- Prefix every shell command and every chained segment with `rtk`; use `rtk proxy` for commands without a dedicated wrapper. Prefer Graphify or compressed context when they reduce work without losing correctness.
- Preserve user-owned changes. Stage explicit task-owned paths, not the whole working tree. Never reset another contributor's files or clean unrelated services, Docker resources or worktrees.
- Comments explain invariants, ownership, units or non-obvious failure behavior. Do not narrate obvious code, copy environment defaults into comments or advertise internal plans in product copy.
- Validate changed Mermaid diagrams with an actual parser/renderer. The documentation fence/link check does not validate diagram syntax; raw semicolons in sequence messages delimit statements.
- Verify uncertain dependencies, schemas and behavior from source/tests. Report remaining limitations precisely. Commit each complete iteration separately after its required checks.

## Runtime and data ownership

- React/Vite in `frontend` is the browser; FastAPI in `backend/app` owns application behavior. Production `api` and `market-api` run the same Python package with proxy workload partitioning.
- Better Auth in `backend/auth` owns the Google/session protocol. Compose uses it by default; native development uses legacy auth unless explicitly enabled. Its Node runtime requires 22.13+ for the native SQLite implementation.
- The legacy Node API in `backend/index.js` is compatibility-only and optional through `legacy-node-api`.
- Base production Compose uses application PostgreSQL and separate Timescale candle storage through PgBouncer. `docker-compose.efficient.yml` shares indexed candle storage with application PostgreSQL for new installs; it is not a migration of existing market data. Its `!override` syntax requires Compose 2.24.4+.
- Local Compose explicitly uses beta/development mode and separate `/var/lib/edgelab/edgelab.db` and `/var/lib/edgelab/market_data.db` SQLite files in `local-api-data`. Native defaults select loopback PostgreSQL unless explicit URLs are supplied. The native launcher does not automatically load `.env`.
- Base Compose auth has its own `auth-data` SQLite volume; local Compose uses `local-auth-data`. Independent auth replicas require a deliberately configured direct PostgreSQL writer and dedicated schema, common signing/service keys and origin. Store switching requires a migration or re-login.
- Application SQL owns durable accounts, billing, preferences, trades, replay and jobs. Redis owns disposable bounded caches/admission; browser caches never establish identity, entitlement or server commit.
- APIs mount dataset folders read-only at `/datasets`. The optional data populator writes M1/derived CSVs and its `.edgelab-data-populator-manifest.json`, with `${EDGELAB_DATA_POPULATOR_USER:-0:0}` ownership. `EDGELAB_CSV_PATH` is an explicit optional legacy replay path.

## Contracts to preserve

- Keep API `EDGELAB_DEPLOYMENT_MODE` and browser `VITE_DEPLOYMENT_MODE` aligned. Production is the default; beta presentation and local bypass do not grant paid access. Exports require verified active **live** paid access in every mode.
- Keep tenant IDs and captured account/replay generations across asynchronous work. Preserve account-data operation receipts, acknowledged storage writes and stale-response barriers. Route guards and numeric IDs are not authorization.
- Better Auth introspection/revocation uses a fixed private service URL and distinct service key. Preserve native origin/CSRF checks and verify actual session deletion across replicas. Persisted secrets use the server keyring; supported transient browser broker credentials go only in authenticated first WebSocket messages, never URLs/logs/shares.
- Nginx serves `${FRONTEND_PORT:-8080}` with browser `VITE_API_BASE_URL=/api`; Better Auth routes reach `auth:3002`, market routes reach `market-api:8000`, and ordinary API routes reach `api:8000`. Preserve private/error `no-store` responses and CDN bypass for private/auth/stream/export traffic.
- Preserve socket-address Google exchange proxy admission, JSON 429, `Retry-After` and security headers. Configured Redis admission fails closed on Redis errors; only an unset URL permits bounded process-local fallback.
- Migrations and candle initialization precede API workers. `create_all` is not a migration of existing columns. Equal database URLs share an engine; pools, thread headroom and request queues stay bounded. Ingestion/analytics and auth migration advisory locks must span the actual shared transaction/pinned connection.
- Pine source/override hashes and worker sandbox/nonce/message schemas are release contracts. Do not patch installed upstream packages, fabricate provider candles, leak replay future bars or claim full TradingView equivalence from local tests.
- Observability aggregates all workers in a fresh private per-master directory, retires dead-worker live gauges and measures the full ASGI lifecycle. Preserve finite labels, redaction, bounded export queues, private monitor services and guarded Docker discovery. Never expose inspect environments or enable unsanitized trace providers.
- Capacity/HA claims require realistic distinct accounts, full-wall SLOs, generator headroom, explicit network exclusions and independent failure-domain/failover tests. Respect shared-machine resource coordination; do not restart another task's VM or run confounded load tests.

## Coupled files and upgrade discipline

Update applicable files together when changing deployment, configuration, routing, persistence or builds:

- `docker-compose.yml`, relevant overlays including efficient/local/observability, `.env.example`, `.dockerignore` and `docker/nginx.conf`;
- `backend/Dockerfile`, `frontend/Dockerfile`, `backend/auth/Dockerfile`, and `backend/Dockerfile.node` if legacy behavior changes;
- runtime settings, browser public settings, startup/migration scripts and the source-release allowlist;
- root/component READMEs, the canonical guide in `docs`, and this file when maintenance rules change.

Python runtime dependency changes update `backend/requirements.txt`; development tools use the development requirements. Frontend/auth dependency changes update their workspace manifests and root `package-lock.json`. Verify native modules and production images, not just installation. Keep Better Auth browser/server, OTel SDK/exporter/instrumentation, and Pine version/manifests/overrides coordinated. Use [maintenance](docs/maintenance.md) for expand/backfill/contract, backup, rollback and dependency checks. Record significant decisions under [docs/decisions](docs/decisions/README.md).

## Required verification

Before committing code or deployment changes run the full baseline, with `rtk` prefixes:

```bash
rtk npm run build
rtk proxy env PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
rtk npm test
rtk npm run check:docs
```

After code changes, refresh the graph:

```bash
rtk proxy graphify update .
```

When Docker is available, validate Compose configuration and build affected images; include changed overlays/profiles. Use the installed Compose implementation (`docker compose` or `docker-compose`) and an explicitly owned context. If Docker is unavailable, state that limitation and still run non-Docker checks. Documentation-only changes require the documentation check and focused validator tests; source comments remain code changes and use the baseline.

Real-store regressions require disposable `EDGELAB_TEST_REDIS_URL`, `EDGELAB_TEST_POSTGRES_URL` and direct-writer `EDGELAB_TEST_AUTH_POSTGRES_URL` fixtures. Default CI can skip those tests; report skips and do not treat that run as PostgreSQL/Redis/auth-replica certification. Add relevant browser, provider/sandbox, recovery, migration or multi-worker checks when a boundary changes. Follow [validation tiers](docs/maintenance.md#validation-tiers); a build alone does not certify UX, payments, HA or cloud capacity.

## Git and release hygiene

- Never commit credentials, local CSV datasets, SQLite databases, virtualenvs, generated bundles/source offers, private artifacts or the large `EURUSD_M1.csv`.
- Prefer `codex/` names for new branches. A configured `.githooks/post-commit` hook auto-pushes commits; it is clone configuration, not a guaranteed CI release. Verify the remote after committing. Use `CODEX_AUTO_PUSH=0` only for an intentionally local commit; never force-push to conceal a failed push.
- Build/test before interrupting service. Keep a restorable data backup, whole-image/source identity, health checks and a schema-aware rollback plan. The legacy Jenkins path has unsafe host-wide cleanup and is not the approved production release procedure.

## Matching source offers

Pine-enabled browser builds generate `scripts/source-release.mjs` output before compilation and verify it afterward. Maintain its explicit runtime/build input allowlist and matching Docker build context when adding required inputs. Keep `frontend/public/source/` generated and ignored; never include credentials, customer records, datasets, internal planning documents or Git history. Deploy API and browser images from the same reviewed checkout.
