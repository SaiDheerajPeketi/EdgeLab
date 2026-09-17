# EdgeLab backend

The primary backend is the FastAPI application in `app/`. It owns authentication, datasets, replay sessions, journaling, broker integrations, analytics, shared workspaces, and application storage. `index.js` and `routes/` contain the compatibility Node API; it is not part of the default deployment.

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
