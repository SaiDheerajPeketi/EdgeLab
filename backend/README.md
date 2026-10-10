# EdgeLab backend

The primary backend is the FastAPI application in `app/`. It owns authentication, datasets, replay sessions, journaling, broker integrations, analytics, shared workspaces, and application storage. `index.js` and `routes/` contain the compatibility Node API; it is not part of the default deployment.

`PATCH /api/journal/settings` merges validated capture defaults into the authenticated owner's `edgelab/live-journal.v1` application-storage item. It preserves existing records and unrelated settings, uses a conditional update to retry concurrent changes, and returns the complete acknowledged item. Review note templates continue to use `edgelab/notebook-template.v1` through the application-storage API.

`GET /api/settings/chart` reads the owned chart preset and active-name items together. `PATCH /api/settings/chart` validates partial edits to nine display/palette controls, merges them into `Settings default`, and activates it in one transaction. It retains raw preset order, hidden settings, and unknown metadata; a missing target clones the active preset. Conditional updates retry concurrent writes and roll back both items together. Corrupt preset structures return 409 without replacing stored data. Candle body aliases stay synchronized; independent border/wick colors remain unchanged.

`PATCH /api/settings/preferences` merges only the submitted density or diagnostic-sharing preference into owned `edgelab/settings-center.v1` storage. It preserves other fields, supplies defaults only when creating the item, and retries concurrent changes before returning the acknowledged item.

`GET /api/app-data/export` produces a version 1 account-data bundle. `POST /api/app-data/import` requires explicit `app`, `version`, and `tables` fields and replaces all 23 supported tables atomically; omitted tables become empty. Restore IDs are preserved, with strict ID/reference validation and ownership checks before deletion. References to retained broker accounts must belong to the authenticated owner. Authentication, integration-vault, broker, and AI service tables, CSV files, and candle data are excluded. Derived dashboard/session summaries are cleared, and imported database-candle flags are reset until the CSV data is rebuilt. Failed inserts roll back replacement without logging imported values. Clients must quiesce pending storage writes and discard pre-import browser mirrors before rehydrating restored settings.

Dataset WebSocket updates read the committed catalog without scanning folders, creating settings, or changing replay readiness. HTTP catalog/bootstrap/replay requests retain discovery behavior, and explicit refresh scans and commits synchronously before returning. The current browser coordinates these requests with replacement and uses server receipts when Web Locks and secure UUIDs are available. Fencing for older clients or other devices remains pending.

The API now provides durable per-account operation receipts for opt-in clients. Reserve a UUID with `POST /api/app-data/operations/{id}/reserve` before sending its method/path request with `X-EdgeLab-Operation-Id`. The server claims each reservation once before invoking the handler. `POST /api/app-data/operations/{id}/recover` atomically cancels an unstarted request, including one whose reservation response was lost; its canceled tombstone rejects delayed sends. Running requests remain uncertain until the handler and any response background work finish. Cancellation or a server crash does not turn a running request into a completed one. Completed means work has ended, including HTTP errors; it does not mean the mutation succeeded. Successful import receipts retain only completion time and table counts, never imported rows. Receipt creation/recovery share a limit of 600 calls per account per configured rate-limit window and return `Cache-Control: no-store`.

Receipts and cancellation tombstones are outside portable exports/imports and remain durable without time-based expiry. Alembic revision `20261007_0015` and SQLite compatibility migration 8 create their table. Existing clients without the header keep their current behavior. The browser verifies terminal receipts and recovers interrupted import generations without replaying requests; both Storage interfaces share completion checks, staged transfer state and reload controls. Fencing for other clients/devices and scheduled catalog writers and receipt lifecycle management remain pending.

## Run it locally

From the repository root:

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
PYTHONPATH=backend backend/.venv/bin/python -m alembic -c backend/alembic.ini upgrade head
EDGELAB_DEV_AUTH_BYPASS=1 EDGELAB_JWT_SECRET=local-dev-secret \
  PYTHONPATH=backend backend/.venv/bin/python -m uvicorn app.main:app --reload
```

FastAPI serves the API below `/api`. With the server running directly, interactive OpenAPI documentation is available at <http://127.0.0.1:8000/docs>.

`GET /api/journal/trades/{trade_id}` restores a canonical trade review directly, including notes, tags, screenshots, and executions. It requires authentication and returns 404 for missing trades or trades owned by another user.

By default, local development uses SQLite and `datasets/`. Set `DATABASE_URL` and `EDGELAB_MARKET_DATA_DATABASE_URL` to use separate transactional and market-data databases. The full Compose stack supplies PostgreSQL, TimescaleDB, PgBouncer, and Redis automatically.

## Layout

| Path | Purpose |
| --- | --- |
| `app/api/routes.py` | HTTP and WebSocket routes |
| `app/services/` | Replay, datasets, journal, broker, and analytics logic |
| `app/models.py` | SQLAlchemy models |
| `app/schemas.py` | API request and response models |
| `alembic/` | Database migrations |
| `scripts/` | Imports, refresh jobs, and benchmarks |
| `tests/` | Python and Node-based backend tests |

## Better Auth

The default Compose stack runs the real Better Auth 1.7.7 Node service in `auth/`, with durable SQLite sessions in the separate `auth-data` volume. Node 22.13+ is required for its built-in SQLite adapter. Startup runs Better Auth's migrations and schema validation before reporting health. Session cookie caching is disabled and the bearer plugin requires a valid signature. A small provider plugin uses native state to bind a per-attempt nonce and verifies Google's RS256 ID-token signature, issuer, audience and age before profile mapping. The launch HTTP surface exposes Google redirect sign-in/callback, current session and sign-out only; direct ID-token sign-in, password signup, account linking and user updates are disabled at the service boundary.

Configure `EDGELAB_AUTH_PROVIDER=better-auth`, the fixed `EDGELAB_BETTER_AUTH_INTERNAL_URL`, distinct random `BETTER_AUTH_SECRET`/`EDGELAB_AUTH_SERVICE_KEY` values of at least 32 characters, and the exact public HTTPS origin. `BETTER_AUTH_URL` selects the auth service's public origin; Compose derives it from `EDGELAB_PUBLIC_ORIGIN`. Supply Google client ID/secret or `GOOGLE_CLIENT_SECRETS_FILE` (`web`, `installed`, or direct JSON format); environment values take precedence per field. Compose mounts `deployment/` read-only into the auth service and API. Register `<public-origin>/api/better-auth/callback/google` in Google Cloud. Absent credentials are reported unavailable by `/api/auth/config`.

`POST /api/auth/better-auth/exchange` requires the exact configured Origin and forwards only one allowlisted signed session cookie to the fixed internal service. The distinct service key protects introspection and revocation; redirects are refused and bearer/cookie ambiguity fails closed. The bridge returns a `ba:` bearer and the existing account metadata. Every authenticated HTTP/stream check introspects that genuine session, reads the Google subject from Better Auth's server-owned account table and resolves the existing numeric account. Remote revocation/service failure does not fall back to a legacy session. `DELETE /api/auth/session` revokes that real Better Auth session. Subscriptions and exports retain verified-Google and live-paid checks.

Existing verified JWT sessions remain valid. New direct development processes default to `EDGELAB_AUTH_PROVIDER=legacy` for compatibility; opting into Better Auth requires the service and credentials. Local Compose uses beta, isolated local auth secrets and loopback developer sign-in. That bypass does not produce a Google identity or paid entitlement. Tests exercise real Better Auth cookies, signed bearers, persistence/revocation, Google state/PKCE/replay and the FastAPI bridge with owned Google certificate/token transport; an external Google account/deployment check is still required once credentials are configured.

## Google exchange admission

Both the legacy `/api/auth/google/exchange` and Better Auth `/api/auth/better-auth/exchange` use the API exchange admission described below. The Better Auth proxy paths also retain the socket-address Nginx limit.

`POST /api/auth/google/exchange` reserves admission before contacting Google: 120 requests per 60 seconds across API processes using the configured `EDGELAB_REDIS_URL`, with atomic expiry, or one bounded process-local counter when that URL is unset. Budget exhaustion returns 429 with the remaining-window `Retry-After`; configured Redis errors return 503 with `Retry-After: 5` instead of falling back to an independent counter. Each process admits at most eight simultaneous exchanges; a full process returns 429 with `Retry-After: 1` without waiting for a slot. Requests do not use user-controlled forwarded headers as admission keys.

The production Nginx proxy separately limits the exact exchange path by `$binary_remote_addr` to 10 requests per minute with a burst of three, returning JSON 429 and `Retry-After: 6`. NAT clients and clients behind an additional proxy share its socket-address budget. Direct API development runs bypass this edge limit but retain API admission. Compose starts APIs only after Redis responds to its health check. No new configuration variables or dependency changes are required.

## Stripe billing

Billing is disabled by default. Set `EDGELAB_BILLING_ENABLED=1`, `EDGELAB_STRIPE_MODE=test`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`, and `STRIPE_PRO_ANNUAL_PRICE_ID` on the API. Create active recurring USD prices for EdgeLab Pro at 2900 cents monthly and 29000 cents annually, with interval count 1 and no trial. The service validates provider price facts and mode instead of trusting client amounts or IDs. Use `EDGELAB_PUBLIC_ORIGIN` for fixed checkout and portal return URLs; production requires HTTPS. These credentials never belong in browser build variables.

`GET /api/billing/catalog` reports configured availability. Authenticated `POST /api/billing/checkout` accepts only `{ "plan": "pro", "cadence": "monthly" }` or annual cadence; `POST /api/billing/portal` accepts no customer ID or return URL. `GET /api/billing/status` reconciles the account's current provider subscriptions. Returning to `/pricing?billing=success` does not grant access. Register the raw signed webhook at `/api/billing/webhook` for the pinned Stripe API version `2026-09-30.endive`. Delivery IDs are deduplicated durably; provider state is reconciled under an account lock instead of applying unordered event snapshots. Test and live customers remain separate, and test purchases do not grant production workspace access.

Verified-owner billing admission precedes billing database locks and Stripe requests. Fixed 60-second windows allow 30 status/stale-lease refreshes per owner, six combined checkout/portal attempts per owner, and 600 total admissions. Owner refusals do not spend the global quota. `EDGELAB_REDIS_URL` shares quotas across API processes using one atomic Redis operation; unset Redis uses bounded process memory. Configured Redis construction/runtime failure returns 503 with `Retry-After: 5`, without an independent local fallback. Concurrency is process-local: eight total operations and two per owner; busy slots return 429 with `Retry-After: 1`. Quota refusals return 429 with the remaining window in `Retry-After`, plus `Cache-Control: no-store`.

Route slots cover provider work and transaction commit/rollback, including checkout's persisted idempotency attempt. Direct stale-access refreshes share the status quota and cover their provider work, while the caller owns its outer transaction. Fresh verified leases require no refresh admission. A denied or unavailable stale refresh cannot extend the lease, and workspace/paid exports remain denied. Public catalog cache hits consume no authenticated quota; one cold provider refresh per process runs at a time. Competing cold reads receive 503 with `Retry-After: 1`, without caching the busy response. Signed, durably deduplicated Stripe webhooks retain their separate verification path.

Billing records are outside portable workspace exports/imports and do not alter beta approval or licensed market-data entitlements. Alembic revision `20261007_0016` creates the additive billing tables; `20261007_0017` adds the unique Google subject without replacing existing accounts. Live activation requires an eligible merchant account, live credentials and price IDs, the configured HTTPS origin, registered webhook delivery, and an actual purchase/cancellation check. The browser checkout integration is implemented; live provider activation remains unverified. Refund handling must coordinate the refund with subscription cancellation; refunds are not inferred from a checkout redirect.

Beta workspace admission takes the enrollment lock before reading current approval, including protected requests, receipt admission, account metadata and stream rechecks. Production access and paid exports continue to require the live subscription policy.

Beta checkout requires current approved workspace access within the seat cap. The server checks eligibility before provider work and again after persisting the checkout attempt. Verified production buyers can start their first subscription, and billing status and account management remain available after workspace access is lost.

`EDGELAB_DEPLOYMENT_MODE=production` is the default. Google enrollment is public, and legacy beta approval does not grant production workspace access. Workspace HTTP routes require a live paid subscription before operation receipts are claimed; dataset/Angel WebSockets and Quant streams recheck access during delivery. Exact account metadata, receipt recovery, revocation, billing and sign-out routes retain authenticated access without a paid plan. Unknown modes fail closed. Explicit `beta` mode retains capped approved beta workspaces, but `GET /api/app-data/export` requires a live paid subscription in either mode and never claims a write receipt. Manual/development sign-in is disabled in production.

Production sessions and all billing/paid-export authority require a verified Google subject. An unbound legacy Google or manual/email account can first verify through Google when its exact normalized email is authoritative: verified Gmail or a valid hosted-domain claim returned by Google. That transaction preserves the user ID, workspace data and existing enrollment while revoking every older session; normal beta queue reconciliation still applies. Third-party addresses without Google email authority require separate mailbox verification before existing-account recovery; new Google accounts and already-bound subjects still work with those addresses. Email aliases are not merged. See [Google's ownership guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token). Manual beta sessions cannot manage live billing or export paid data.

Production access also requires a provider-verified snapshot less than five minutes old; expiry is never extended by a failed refresh. The status endpoint reconciles that snapshot, and the service exposes a refresh function for subsequent workspace enforcement. A missed webhook cannot leave a year-long cached entitlement permanently valid.

## Credentials and broker integrations

Integration credentials are encrypted at rest. Production startup requires a keyring and an active key:

```bash
python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
export EDGELAB_SECRET_VAULT_KEYS='{"local-v1":"PASTE_KEY_HERE"}'
export EDGELAB_SECRET_VAULT_ACTIVE_KEY_ID=local-v1
```

Keep old keys in the keyring until every stored credential has been rotated. Tradovate works against its standard REST endpoint unless `EDGELAB_TRADOVATE_API_BASE_URL` is set. NinjaTrader requires an HTTPS connector configured with `EDGELAB_NINJATRADER_API_BASE_URL`.

See [configuration](../docs/configuration.md) for the important runtime settings and `.env.example` for the complete Compose template.

## Tests

```bash
PYTHONPATH=backend backend/.venv/bin/python -m pytest backend/tests
npm test
```

The first command covers the FastAPI application and services. The second runs the repository's Node-based contract tests.

`requirements.txt` is production-only. Keep test and audit tooling in `requirements-dev.txt` so container installs remain small and fast.

## Matching application source

The browser build generates `/source/` with the matching frontend/backend application inputs, verified original Pine sources and reviewed overrides, build/run instructions and SHA-256 checksums. It verifies the offer after compilation. The public footer, settings and Pine editor link to the download. Generated offers stay out of Git and Docker build inputs; Docker regenerates them from the same checkout used to build both application images. Rebuild both images after changing either application. Credentials, personal records, datasets, internal plans and Git history are excluded. This application-source download does not grant access to paid user-data exports.

`POST /api/settings/chart/templates` accepts save, delete, and activate commands for the authenticated owner. The template list and selection commit in one transaction with conditional retries, preserving unrelated presets and unknown metadata. Malformed stored bundles require recovery, and activating a missing template is rejected.

`POST /api/settings/chart/presets` accepts authenticated drawing or Fibonacci save/delete commands. Strict preset validation and conditional transaction retries preserve unrelated presets, reject malformed stored collections, and enforce limits of 36 drawing or 24 Fibonacci presets without automatic eviction. Generic `PUT /api/app-storage/edgelab/{key}` rejects these two preset keys; explicit app-data import retains its replacement semantics.

### Disposable local demo data

For UI inspection, create an isolated preview with:

    rtk proxy env PYTHONPATH=backend backend/.venv/bin/python backend/scripts/local_preview_data.py --directory /tmp/edgelab-demo-new

The destination must not exist. The script creates only that directory, a fresh SQLite database, deep synthetic BTCUSDT/EURUSD/ES candle datasets, demo journal accounts/trades/notes, replay reviews, simulated replay orders and a position, local settings and synthetic offline BTCUSDT trades with derived Order Flow footprints. All sample trades carry a Demo data tag. It creates no subscription, Stripe customer or broker order. The emitted preview.json supplies the existing local beta/auth/data/UI environment settings; start a separate API using those values on port 8001 and a separate Vite development frontend on port 5174 with VITE_API_BASE_URL=http://localhost:8001/api and VITE_DEPLOYMENT_MODE=beta. Provide a fresh EDGELAB_JWT_SECRET for this disposable API.

Open http://localhost:5174/auth/signin?preview=demo and select Local development sign-in. The dev-only Demo data banner remains through that browser session. The exact disposable Demo data beta account's Live page animates its recorded synthetic replay candles and supports normal chart tools and indicators in historical mode. Open Replay to practice orders against the same owned datasets. No exchange or broker is connected; calendar and external integrations retain their real availability states. Keep the normal API/frontend ports untouched; discard the isolated directory when inspection is finished. Order Flow is a synthetic stored snapshot; its normal freshness checks still apply. Paid exports retain the normal subscription requirement.

## Production resource boundaries

Compose passes database credentials to every consumer and constructs escaped URLs from them. `DATABASE_URL` and `EDGELAB_MARKET_DATA_DATABASE_URL` remain explicit overrides; separate market host/port settings select the default market database. SQL engines use five persistent connections, up to ten overflow connections, a five-second pool wait and a ten-second PostgreSQL connect deadline by default; tune the `EDGELAB_DB_*` variables within the pooler budget. Before synchronous database work, PostgreSQL request admission is capped at actual pool capacity minus two reserved health slots per worker (13 requests with the default pool). EDGELAB_HTTP_REQUEST_LIMIT=0 selects this automatic cap; a positive value can only lower it. Admission and pool exhaustion return private HTTP 503/Retry-After, preventing a queue from occupying response-validation threads. API processes drain for 30 seconds within a 45-second container deadline. The main API migrates first and initializes candle tables before forking; dependent services wait for its health. All API responses forbid browser/CDN caching. Redis is bounded with noeviction and carries disposable cache/admission state; user records remain in SQL. The efficient overlay keeps SQL candle imports and historical coverage, consolidating databases on one PostgreSQL server. Background workers remain enabled; retain their measured CPU and memory headroom. See [capacity and operations](../docs/production-capacity.md).

## Shared authentication replicas

Set `BETTER_AUTH_DATABASE_URL` to a direct PostgreSQL writer and `BETTER_AUTH_DATABASE_SCHEMA` to an isolated schema (default `edgelab_auth`). The role needs schema/table creation during migrations. Remote connections use `sslmode=verify-full`, optionally `sslrootcert`; keep local plaintext connections on a private network. Transaction poolers and read replicas are unsuitable for auth initialization/read-after-write revocation. Pools default to five connections per replica, two-second acquisition/connect limits, ten-second statements and sixty-second migrations. Startup owns a PostgreSQL transaction advisory lock through migration planning/application, so concurrent cold replicas cannot race schema creation. Health probes query the session table and return private retryable 503 on failure. Shutdown drains for thirty seconds inside a forty-five-second Compose stop window.

Share the exact signing/service keys, Google configuration and public origin across replicas. Cookie caching remains disabled; verified Google identities and signed bearer checks are unchanged. Public logout retains native origin/CSRF checks; both public/internal logout explicitly delete and verify session revocation before confirming success. A failed deletion returns 503, so a user can retry. Existing SQLite auth data is never automatically copied/replaced; plan a migration or require re-login before switching stores.
