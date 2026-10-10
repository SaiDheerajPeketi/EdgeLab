# EdgeLab

EdgeLab is a trading workspace for live charts, historical replay, journaling, performance review, and editable indicators. The browser is React/Vite; the primary API is FastAPI. Production Compose uses PostgreSQL, Redis, Better Auth, and background workers behind Nginx. The smaller local Compose installation explicitly uses SQLite.

Start with [setup](docs/setup-and-deployment.md), read the [architecture](docs/architecture.md), and use the [documentation index](docs/README.md) to find a topic. Contributors should read [CONTRIBUTING.md](CONTRIBUTING.md); coding agents should also read [AGENTS.md](AGENTS.md).

## Local preview

The self-contained local installation needs Docker Compose:

```bash
EDGELAB_ENVIRONMENT=development docker compose -f docker-compose.local.yml up -d --build
```

Open <http://localhost:8080>. Its three services are `frontend`, `api`, and `auth`. It selects beta mode, local developer sign-in, separate application/market SQLite files, and persistent named volumes. This is a development installation, not a public production configuration. Add CSV datasets below `datasets/`; they are not committed.

For native development, install Node.js 22.13+ and Python 3.12, then follow the [explicit native environment](docs/setup-and-deployment.md#native-development). Vite normally listens on <http://127.0.0.1:5173> and FastAPI on <http://127.0.0.1:8000>. `npm run dev` reuses existing compatible servers and does not load `.env` automatically or enable API auto-reload. An unset `DATABASE_URL` selects PostgreSQL, not SQLite.

Use the [disposable demo helper](backend/README.md#disposable-local-demo-data) for populated UI inspection. Keep demo ports, database, and browser identity separate from the normal workspace. Synthetic data and developer identities do not grant paid access.

## Production deployment

| Configuration | Storage and purpose |
| --- | --- |
| `docker-compose.yml` | Application PostgreSQL and market TimescaleDB, two poolers, Redis, auth, APIs, ingestion and analytics |
| Base + `docker-compose.efficient.yml` | New-install option: one PostgreSQL writer/pooler with indexed candle history; Compose 2.24.4+ |
| `docker-compose.local.yml` | Explicit development/beta SQLite installation |
| `--profile observability` | Optional private metrics, dashboards, logs, traces and SQL exporters |
| `--profile benchmark` | Monitoring plus capacity-test infrastructure; not a launch requirement |
| `--profile legacy-node-api` | Compatibility Node API; not the primary product backend |

For a new efficient installation:

```bash
docker compose -f docker-compose.yml -f docker-compose.efficient.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.efficient.yml up -d --build
```

Configure unique secrets, Google OAuth, HTTPS/public origin, billing, dataset mounts and backups first. Changing an existing storage topology requires a deliberate data migration; the overlay does not move data. See [deployment](docs/setup-and-deployment.md), [configuration](docs/configuration.md), [upgrade and rollback](docs/maintenance.md), and [measured capacity](docs/production-capacity.md). A Compose restart policy does not provide independent-zone redundancy.

Fingerprint-addressed browser assets can use a CDN. Authentication, tenant APIs, streams, exports and observability must stay private or uncached as appropriate. Deploy the browser and APIs from the same reviewed checkout.

## Identity and access

Better Auth owns Google OAuth and revocable signed sessions in production Compose. FastAPI introspects its fixed private service endpoint, binds the verified Google subject to the existing numeric application account, and enforces tenant and subscription policies. Auth sessions have their own store: local SQLite by default, or a dedicated PostgreSQL schema for shared auth replicas.

Production workspace access requires verified Google identity and a current live paid subscription. Beta mode has separate approval/seat rules. **Exports require verified active live paid access in both modes.** Stripe test subscriptions, marketing variants and developer bypasses cannot grant exports. Billing management remains reachable without workspace access. Credentials and matching Stripe price IDs must be configured before live checkout is available.

`/?variant=beta` and `/pricing?variant=beta` select the retained marketing presentation only. Keep `VITE_DEPLOYMENT_MODE` aligned with `EDGELAB_DEPLOYMENT_MODE`; the server owns authorization. Details are in [backend auth/billing](backend/README.md) and [architecture](docs/architecture.md).

## Charts and Pine

The chart workspace includes studies, drawings, multi-pane layouts, order-flow views, replay controls and editable scripts. EdgeLab's original DSL and the experimental native Pine v5/v6 path are distinct engines. Native Pine supports custom inputs, historical strategy tests, and persistent received-update execution on supported Binance live contexts. This does not establish complete TradingView compatibility or identical fills, calendars, pixels or provider ticks.

The community catalog preserves original source, license, commit and hash records alongside reviewed derivatives and immutable revisions. Original implementations of familiar indicator formulas are not redistributed TradingView built-in source. See [frontend feature reference](docs/frontend-feature-reference.md), [reviewed Pine engine](frontend/vendor/pinets/README.md), and [catalog maintenance](scripts/README.md#pine-community-catalog).

## Verification and maintenance

```bash
npm ci
npm run check:docs
npm run build
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
npm test
sh scripts/audit-dependencies.sh
```

Real Redis/PostgreSQL/auth-storage gates need isolated fixture URLs; otherwise those tests can skip. UI, provider, deployment, recovery and capacity checks are separate tiers. Use [maintenance](docs/maintenance.md#validation-tiers) for the required change-to-check mapping. [Observability](docs/observability.md) documents bounded metrics, safe logs/traces, private monitoring and measured resource cost.

The tracked post-commit hook is opt-in per clone: `rtk git config --local core.hooksPath .githooks`. It automatically pushes commits without force, and preserves detached commits on a separate branch. Use `CODEX_AUTO_PUSH=0` for an intentional local-only commit. Read the [Git workflow](CONTRIBUTING.md#git-workflow) before enabling it.

## Repository map

| Path | Responsibility |
| --- | --- |
| `frontend/src/` | Routes, workspace UI, chart/runtime adapters, browser state and workers |
| `backend/app/` | API composition, schemas, auth, tenant models and domain services |
| `backend/auth/` | Better Auth client-facing and private service boundary |
| `backend/alembic/` | Application database migration history |
| `backend/scripts/` | Import, migration, demo and performance utilities |
| `docker/` | Nginx, PgBouncer and private monitoring configuration |
| `datasets/` | Ignored portable market CSV inputs |
| `e2e/` | Playwright interaction/accessibility/visual gates |
| `benchmark/`, `benchmarks/` | Different documented benchmark workflows |
| `scripts/` | Development, source-offer, catalog and quality tooling |
| `docs/` | Architecture, contracts, operating guides and recorded evidence |

## License and source offer

Original EdgeLab code and the reviewed PineTS integration use AGPL-3.0-only. Read [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), and [SECURITY.md](SECURITY.md). Pine-enabled builds generate `/source/` with matching application/build inputs and checksums, then verify them after compilation. Preserve the engine integrity manifest and complete source offer when upgrading or distributing. Credentials, customer data, datasets, internal planning documents, Git history and generated bundles must never enter that archive.
