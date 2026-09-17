# Configuration

`.env.example` is the complete, executable template for Docker Compose. Copy it to `.env`, then replace development defaults and secrets before using the full stack.

```bash
cp .env.example .env
```

The settings below are the ones most people need to understand. Less common tuning controls are documented inline in `.env.example`.

## Storage and datasets

| Variable | Meaning | Local default |
| --- | --- | --- |
| `DATABASE_URL` | Application database URL | SQLite when unset outside full Compose |
| `EDGELAB_MARKET_DATA_DATABASE_URL` | Candle database URL | falls back to the application database |
| `EDGELAB_DATASETS_ROOT` | Host dataset directory | `./datasets` |
| `EDGELAB_CSV_PATH` | Optional legacy single-file dataset | unset |
| `EDGELAB_MARKET_DATA_IMPORT_ENABLED` | Import discovered CSV candles into the market-data database | `1` |
| `EDGELAB_DATASET_AUTO_DISCOVERY_ENABLED` | Scan the filesystem automatically | `1` in the local stack, `0` in the full stack |

The local Compose file stores both SQLite databases in `local-api-data`. The full stack uses `postgres-data`, `timescaledb-data`, and `api-data` volumes.

## Authentication and secrets

| Variable | Meaning |
| --- | --- |
| `EDGELAB_JWT_SECRET` | Signs EdgeLab user sessions |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Direct Google OAuth credentials |
| `GOOGLE_CLIENT_SECRETS_FILE` | Alternative OAuth JSON file mounted into the API |
| `EDGELAB_PUBLIC_ORIGIN` | Public browser origin used for callbacks |
| `GOOGLE_REDIRECT_URI` | Explicit callback override |
| `EDGELAB_DEV_AUTH_BYPASS` | Loopback-only development sign-in |
| `EDGELAB_SECRET_VAULT_KEYS` | JSON map of key IDs to URL-safe base64 AES keys |
| `EDGELAB_SECRET_VAULT_ACTIVE_KEY_ID` | Key used for newly stored integration secrets |

Production startup fails if the vault keyring is missing or invalid. Never commit `.env`, OAuth JSON, or generated keys.

## Services and performance

| Variable | Meaning | Default |
| --- | --- | --- |
| `EDGELAB_API_WORKERS` | API worker count; blank enables automatic sizing | blank |
| `EDGELAB_REDIS_URL` | Shared cache and rate-limit store | blank outside full Compose |
| `EDGELAB_ANALYTICS_INTERVAL_SECONDS` | Summary refresh cadence | `60` |
| `EDGELAB_DATA_POPULATOR_INTERVAL_SECONDS` | Dataset update cadence | `3600` |
| `EDGELAB_MAX_REQUEST_BODY_BYTES` | Request-size limit | `26214400` |
| `EDGELAB_MAX_APP_DATA_ROWS` | Import/export row limit | `100000` |

The populator symbol lists, backfill window, derived timeframes, batching, and provider timeouts are all configurable in `.env.example`.

## UI rollout controls

`EDGELAB_UI_KILL_SWITCH=1` places every route group in compatibility mode. The individual `EDGELAB_UI_SHELL_V2`, `EDGELAB_UI_JOURNAL_V2`, `EDGELAB_UI_SETTINGS_V2`, `EDGELAB_UI_CHART_V2`, and `EDGELAB_UI_PUBLIC_V2` flags control smaller groups. `EDGELAB_UI_REVISION` is an operator-visible label. Invalid values fail closed.

## Frontend build values

`VITE_API_BASE_URL`, `VITE_API_BEARER_TOKEN`, `VITE_DEPLOYMENT_MODE`, `VITE_BETA_SEATS_TOTAL`, and `VITE_BETA_SEATS_TAKEN` are compiled into the frontend. Changing them requires a rebuild.

## Quant provider

Set `EDGELAB_EXTERNAL_AI_BASE_URL` and `EDGELAB_EXTERNAL_AI_MODEL` to enable the OpenAI-compatible Quant adapter. Its provider key is stored through the encrypted integration-secret API, not in `.env`. `EDGELAB_QUANT_CAPTURE_ROOT` controls where chart captures are retained; Compose defaults it to the persistent API data volume.

## Observability

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to enable trace export. Production samples 10% of traces by default through `EDGELAB_OTEL_TRACE_SAMPLE_RATIO`; increase it temporarily for incident diagnosis instead of paying full-time export and storage costs. Logging is controlled by `EDGELAB_OBSERVABILITY_LOG_LEVEL` and `EDGELAB_OBSERVABILITY_JSON_LOGS`. The full `benchmark` profile supplies the bundled Prometheus, Grafana, Loki, and Tempo stack.
