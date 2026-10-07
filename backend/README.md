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

## Stripe billing

Billing is disabled by default. Set `EDGELAB_BILLING_ENABLED=1`, `EDGELAB_STRIPE_MODE=test`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_MONTHLY_PRICE_ID`, and `STRIPE_PRO_ANNUAL_PRICE_ID` on the API. Create active recurring USD prices for EdgeLab Pro at 2900 cents monthly and 29000 cents annually, with interval count 1 and no trial. The service validates provider price facts and mode instead of trusting client amounts or IDs. Use `EDGELAB_PUBLIC_ORIGIN` for fixed checkout and portal return URLs; production requires HTTPS. These credentials never belong in browser build variables.

`GET /api/billing/catalog` reports configured availability. Authenticated `POST /api/billing/checkout` accepts only `{ "plan": "pro", "cadence": "monthly" }` or annual cadence; `POST /api/billing/portal` accepts no customer ID or return URL. `GET /api/billing/status` reconciles the account's current provider subscriptions. Returning to `/pricing?billing=success` does not grant access. Register the raw signed webhook at `/api/billing/webhook` for the pinned Stripe API version `2026-09-30.endive`. Delivery IDs are deduplicated durably; provider state is reconciled under an account lock instead of applying unordered event snapshots. Test and live customers remain separate, and test purchases do not grant production workspace access.

Billing records are outside portable workspace exports/imports and do not alter beta approval or licensed market-data entitlements. Alembic revision `20261007_0016` creates the additive tables. Public enrollment, workspace API enforcement, and browser checkout integration are separate launch steps; this core alone does not make the application a paid public service. Live activation requires an eligible merchant account, live credentials and price IDs, the configured HTTPS origin, registered webhook delivery, and an actual purchase/cancellation check. Refund handling must coordinate the refund with subscription cancellation; refunds are not inferred from a checkout redirect.

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
