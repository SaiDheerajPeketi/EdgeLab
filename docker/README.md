# Docker infrastructure

Deployment choices and lifecycle commands are documented in [setup and deployment](../docs/setup-and-deployment.md). Service ownership is described in [architecture](../docs/architecture.md); upgrades and data recovery belong in [maintenance](../docs/maintenance.md).

## Compose choices

| Files / profile | Behavior |
| --- | --- |
| `docker-compose.personal.yml` | Separate loopback-only project: personal identity/exports, SQLite API and Binance history downloader |
| `docker-compose.local.yml` | Loopback frontend, one SQLite FastAPI service and a separate Better Auth service; developer beta access |
| `docker-compose.yml` | Default split PostgreSQL/TimescaleDB stores, two poolers, Redis, auth, two API roles, ingestion, analytics and frontend |
| Base plus `docker-compose.efficient.yml` | New-install option: both data stores on one indexed PostgreSQL server, one pooler, same API roles/workers |
| `observability` | Optional private Prometheus, Grafana, Loki, Alloy, Tempo, guarded Docker log access and database exporters |
| `benchmark` | Monitoring plus MinIO and a k6 runner for isolated tests |
| `legacy-node-api` | Optional compatibility Node API with separate volumes |

The efficient overlay needs Compose 2.24.4+ for `!override`; it excludes the unused Timescale exporter from normal monitoring. It does not migrate a split installation's candles or change auth storage. Use the same Compose files on every lifecycle operation and verify explicit database URL overrides.

Nginx routes `/api/better-auth/*` to auth, dataset/market-data routes to `market-api`, and other product API routes to `api`. Local Compose aliases its one API as `market-api`. Both production API roles use the same FastAPI image; only main `api` runs Alembic migrations. API, auth and browser builds must come from the same checkout for the matching source offer.

Monitoring ports bind to loopback. The public Nginx route blocks `/api/observability/metrics`; collectors use private API connections. Metrics are enabled by default, while traces require an explicit collector endpoint. Follow [observability](../docs/observability.md) for credentials, access, retention and configurable cost controls.

## Files

| Path | Purpose |
| --- | --- |
| `nginx.personal.conf.template`, `start-personal-api.sh` | Personal proxy key injection and Uvicorn startup with forwarded-header trust disabled |
| `nginx.conf` | SPA hosting, API/auth proxy rules, WebSocket forwarding and public security headers |
| `pgbouncer/` | PgBouncer image and generated runtime configuration |
| `observability/` | Metrics, dashboards, alerts, log collection/guard, traces and database initialization |

## Review deployment changes

```bash
docker compose -f docker-compose.local.yml config --quiet
docker compose config --quiet
docker compose -f docker-compose.yml -f docker-compose.efficient.yml --profile observability config --quiet
docker compose build
```

Configuration validation does not test migrations, backups, public authentication or failover. These are single-host templates; no automatic high availability is configured. Required secrets and environment controls are in [configuration](../docs/configuration.md) and `.env.example`.
