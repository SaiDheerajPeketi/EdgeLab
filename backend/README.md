# EdgeLab backend

The primary backend is the FastAPI application in `app/`. It owns authentication, datasets, replay sessions, journaling, broker integrations, analytics, shared workspaces, and application storage. `index.js` and `routes/` contain the compatibility Node API; it is not part of the default deployment.

`PATCH /api/journal/settings` merges validated capture defaults into the authenticated owner's `edgelab/live-journal.v1` application-storage item. It preserves existing records and unrelated settings, uses a conditional update to retry concurrent changes, and returns the complete acknowledged item. Review note templates continue to use `edgelab/notebook-template.v1` through the application-storage API.

`GET /api/settings/chart` reads the owned chart preset and active-name items together. `PATCH /api/settings/chart` validates partial edits to nine display/palette controls, merges them into `Settings default`, and activates it in one transaction. It retains raw preset order, hidden settings, and unknown metadata; a missing target clones the active preset. Conditional updates retry concurrent writes and roll back both items together. Corrupt preset structures return 409 without replacing stored data. Candle body aliases stay synchronized; independent border/wick colors remain unchanged.

`PATCH /api/settings/preferences` merges only the submitted density or diagnostic-sharing preference into owned `edgelab/settings-center.v1` storage. It preserves other fields, supplies defaults only when creating the item, and retries concurrent changes before returning the acknowledged item.

`GET /api/app-data/export` produces a version 1 account-data bundle. `POST /api/app-data/import` requires explicit `app`, `version`, and `tables` fields and replaces all 23 supported tables atomically; omitted tables become empty. Restore IDs are preserved, with strict ID/reference validation and ownership checks before deletion. References to retained broker accounts must belong to the authenticated owner. Authentication, integration-vault, broker, and AI service tables, CSV files, and candle data are excluded. Derived dashboard/session summaries are cleared, and imported database-candle flags are reset until the CSV data is rebuilt. Failed inserts roll back replacement without logging imported values. Clients must quiesce pending storage writes and discard pre-import browser mirrors before rehydrating restored settings.

Dataset WebSocket updates read the committed catalog without scanning folders, creating settings, or changing replay readiness. HTTP catalog/bootstrap/replay requests retain discovery behavior, and explicit refresh scans and commits synchronously before returning. The current browser coordinates these requests with replacement. Server operation receipts and fencing for older clients or other devices remain pending.

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
