# EdgeLab backend

FastAPI in [`app/`](app/) implements the product API: account access, datasets, replay, journals, broker integrations, analytics, settings, sharing and Quant. The Node service in [`auth/`](auth/) owns Better Auth sessions. The Express API in `index.js` is compatibility code, enabled separately through the `legacy-node-api` Compose profile.

Start with [setup and deployment](../docs/setup-and-deployment.md). See [architecture](../docs/architecture.md) for service boundaries, [API contracts](../docs/api-reference.md) for clients, [configuration](../docs/configuration.md) for runtime values, and [maintenance](../docs/maintenance.md) for migrations, upgrades and release checks.

## Storage and deployment choices

| Runtime | Account database | Candle database | Authentication |
| --- | --- | --- | --- |
| Native Python, no database override | PostgreSQL at `127.0.0.1:5432`, constructed from `POSTGRES_*` | Same database unless overridden | Legacy EdgeLab sessions by default |
| `docker-compose.personal.yml` | Personal SQLite volume | Separate SQLite file; CSV discovery | Fixed loopback-only local identity; no Google/Stripe |
| `docker-compose.local.yml` | Explicit SQLite file in `local-api-data` | Separate SQLite file in that volume | Better Auth SQLite plus loopback developer sign-in, beta mode |
| `docker-compose.yml` | PostgreSQL through `pgbouncer-postgres` | TimescaleDB through `pgbouncer-timescaledb` | Better Auth; SQLite by default, optional PostgreSQL |
| Base Compose plus `docker-compose.efficient.yml` | PostgreSQL through one pooler | Same PostgreSQL store | Same auth choices as base Compose |

The efficient overlay is a new-install option requiring Compose 2.24.4 or later. It preserves SQL candle imports, background services, worker sizing and historical coverage. Switching an existing split store requires an explicit candle-data migration; changing the host setting does not move data. Explicit `DATABASE_URL` or `EDGELAB_MARKET_DATA_DATABASE_URL` values take precedence over host settings, including the overlay.

Account records and imported candles remain owner-scoped. CSVs are the dataset discovery and fallback source. PostgreSQL import locks serialize writes for an owner/asset/timeframe; they do not turn each account's candles into a globally shared dataset. Redis holds disposable read models and admission counters. Authentication, subscription authority and encrypted credentials remain in their authoritative stores.

For the personal installation, use [personal setup](../docs/personal-self-hosting.md). It starts one Uvicorn process with proxy-header trust disabled; `app/personal_access.py` owns its request boundary.

## Native development

Use Python 3.12. From the repository root, create the environment and install application and development requirements:

```bash
rtk proxy python3.12 -m venv backend/.venv
rtk proxy backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
```

For PostgreSQL, configure the connection environment described in [configuration](../docs/configuration.md#database-selection), then run Alembic before starting Uvicorn. Native startup no longer selects SQLite implicitly.

For an explicit, disposable SQLite development API, use the same database selection for migration and startup:

```bash
rtk proxy env DATABASE_URL=sqlite:///./backend/edgelab-local.db PYTHONPATH=backend \
  backend/.venv/bin/python -m alembic -c backend/alembic.ini upgrade head
rtk proxy env DATABASE_URL=sqlite:///./backend/edgelab-local.db PYTHONPATH=backend \
  EDGELAB_ENVIRONMENT=development EDGELAB_AUTH_PROVIDER=legacy \
  EDGELAB_DEPLOYMENT_MODE=beta EDGELAB_DEV_AUTH_BYPASS=1 \
  EDGELAB_JWT_SECRET=replace-with-a-private-local-development-secret \
  backend/.venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1
```

Use a fresh private JWT secret and align the browser's `VITE_DEPLOYMENT_MODE=beta`. Developer sign-in additionally requires a loopback request and local CORS/public-origin configuration. It creates no verified Google identity or paid entitlement. Production mode is the API default and disables manual/developer sign-in.

The direct API serves `/api`; schemas are available at <http://127.0.0.1:8000/docs> and `/openapi.json`. The public Nginx frontend proxies `/api/*`, so those root-level documentation URLs should be accessed directly or through an authorized private tunnel.

## Disposable local demo data

For isolated UI sample data, [`scripts/local_preview_data.py`](scripts/local_preview_data.py) creates a fresh directory containing synthetic datasets, a SQLite account and a `preview.json` run configuration:

```bash
rtk proxy env PYTHONPATH=backend backend/.venv/bin/python \
  backend/scripts/local_preview_data.py --directory /tmp/edgelab-demo-new
```

The destination must not exist. Follow its emitted configuration on separate API/frontend ports; the demo creates no broker order, Stripe customer or subscription. Paid exports keep their normal authorization checks.

## Code ownership

| Path | Responsibility |
| --- | --- |
| [`app/main.py`](app/main.py) | ASGI startup, request admission, body limits, private-cache headers and error handling |
| [`app/api/routes.py`](app/api/routes.py), [`app/api/billing.py`](app/api/billing.py) | HTTP/WebSocket contracts and dependencies |
| [`app/auth.py`](app/auth.py), [`app/services/access_policy.py`](app/services/access_policy.py) | Verified identity and workspace/export authority |
| [`app/services/`](app/services/) | Domain operations, transaction boundaries, owner checks and read models |
| [`app/models.py`](app/models.py), [`app/schemas.py`](app/schemas.py) | SQL records and request/response validation |
| [`app/db.py`](app/db.py), [`app/market_data_db.py`](app/market_data_db.py) | Account/candle engines and sessions |
| [`app/config.py`](app/config.py), [`app/observability.py`](app/observability.py) | Runtime settings, logging, metrics and sanitized tracing |
| [`alembic/`](alembic/) | Versioned database migrations |
| [`app/data_populator.py`](app/data_populator.py), [`app/analytics_worker.py`](app/analytics_worker.py) | Dataset ingestion and summary refresh |
| [`scripts/start_api.sh`](scripts/start_api.sh), [`scripts/gunicorn_config.py`](scripts/gunicorn_config.py) | Container migration, worker and shutdown lifecycle |
| [`auth/auth.mjs`](auth/auth.mjs), [`auth/server.mjs`](auth/server.mjs) | Better Auth initialization, migrations and restricted public/internal API |
| [`tests/`](tests/) | Python and backend contract regressions |

When both SQL URLs match, the candle service reuses the application engine and candle imports use the caller's transaction. This preserves visibility of freshly flushed account/asset rows and avoids doubling a worker's SQL pool. A separate candle URL creates an independent store; include both stores in backups and migration plans.

## Authentication and access

Compose selects Better Auth 1.7.7; Node 22.13+ is required for its SQLite adapter. Native Python selects `EDGELAB_AUTH_PROVIDER=legacy` unless explicitly configured otherwise. Existing verified legacy JWT sessions remain supported.

Better Auth's public surface exposes Google redirect sign-in/callback, session inspection and sign-out. Native OAuth state/PKCE and a per-attempt nonce bind Google's verified ID token. Cookie caching is disabled, bearers require signatures, account linking is disabled, and the service does not expose password signup, direct ID-token sign-in or user-update routes.

Configure the exact public HTTPS origin, Google credentials, a fixed internal auth URL and distinct `BETTER_AUTH_SECRET`/`EDGELAB_AUTH_SERVICE_KEY` values of at least 32 characters. Register `<public-origin>/api/better-auth/callback/google`. The API's exchange requires the exact Origin and forwards a single allowlisted session cookie to the fixed internal service. It returns an EdgeLab `ba:` bearer tied to the verified Google account. Authenticated requests and stream rechecks introspect that session; revocation or service failure cannot fall back to a legacy identity. Sign-out confirms database deletion before reporting success.

SQLite auth uses the separate `auth-data` volume. For shared replicas, set `BETTER_AUTH_DATABASE_URL` to a **direct PostgreSQL writer** with a dedicated schema, shared signing/service keys, Google configuration and public origin. Startup serializes migrations on the same direct connection; health queries the session table. A transaction pooler or read replica is unsuitable for this path. Switching stores neither imports existing SQLite accounts nor preserves their sessions automatically. See [auth configuration](../docs/configuration.md#authentication-and-account-access).

Identity and workspace authority are separate. Production enrollment is public, but workspace use requires a verified live paid subscription with a fresh provider lease. Explicit beta mode uses capped approved seats. Account/session recovery and billing have narrower identity-only paths. Data exports require a verified Google identity and live active subscription in production and beta. The separate personal mode grants workspace/export access only to its fixed local identity, with session expiry and loopback/proxy admission. Test purchases and developer accounts do not satisfy those gates.

## Billing and integration secrets

Billing is opt-in. Configure Stripe mode, server key, signed webhook and the fixed monthly/annual price IDs; the API validates provider facts and never trusts a browser-supplied amount/customer/return URL. Checkout redirects do not grant access. Durable event deduplication and account-locked provider reconciliation handle unordered deliveries; failed refreshes never extend the five-minute access lease. Test/live records stay separate. See [billing API](../docs/api-reference.md#billing) and [sandbox verification](../docs/stripe-sandbox.md).

Integration credentials are encrypted at rest. Production requires `EDGELAB_SECRET_VAULT_KEYS` and `EDGELAB_SECRET_VAULT_ACTIVE_KEY_ID`. Retain old keys until stored secrets are rotated. OAuth files, vault keys, Stripe keys and auth/database credentials belong only in protected server configuration, never browser build values or matching source downloads.

## Runtime and upgrades

Container startup runs Alembic with bounded retries, initializes the candle schema before forking, and creates a private metrics directory for each Gunicorn master. Auto-sizing uses one SQLite worker or up to two PostgreSQL workers per API service. Each finite PostgreSQL engine defaults to five persistent plus ten overflow connections; admission also reserves actual AnyIO worker-thread capacity for validation and dependency cleanup. Its finite FIFO queue waits asynchronously. Full queues, exhausted probes and SQL checkout timeouts produce retryable private 503 responses.

All API responses forbid browser/shared-CDN caching. Redis cache failures may recompute read models; configured quota-store failures remain closed. Do not change Redis `noeviction` to evict admission counters as a cache optimization. Dataset ingestion and analytics remain separate jobs; PostgreSQL analytics uses singleton sweep admission and bounded per-account transactions. See [observability](../docs/observability.md), [capacity evidence](../docs/production-capacity.md), and [maintenance](../docs/maintenance.md) before changing pools, worker counts or deployment topology.

Production dependencies belong in `requirements.txt`; test/audit tooling belongs in `requirements-dev.txt`. Auth dependency changes must update its package manifest, root lockfile and Docker inputs together. Preserve the pinned SDK/exporter lifecycle tests when upgrading OpenTelemetry, and real PostgreSQL/Better Auth migration/revocation tests when upgrading database adapters.

Run release checks from the repository root when resources are available:

```bash
rtk proxy env PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
rtk proxy npm test
rtk proxy npm run build
rtk proxy graphify update .
```

Docker configuration/build checks and backup/restore verification are described in [maintenance](../docs/maintenance.md). Document unavailable checks rather than implying they passed.

## Matching source and account exports

The browser build regenerates and verifies `/source/` from the same checkout as the API image, with checksums and reviewed Pine sources. Its allowlist excludes credentials, datasets, personal records, private plans and Git history. Rebuild browser/API images together after application changes. This application-source offer is separate from paid account-data exports; import replacement and recovery contracts are documented in [API reference](../docs/api-reference.md#account-data-transfer).
