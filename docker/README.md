# Docker infrastructure

EdgeLab ships two Compose files.

## Single-user stack

`docker-compose.local.yml` runs two containers:

- `api`: FastAPI with SQLite and local developer sign-in.
- `frontend`: the built React application served by Nginx.

The API database files live in a named volume. The host dataset directory is mounted read-only at `/datasets`.

## Full stack

`docker-compose.yml` runs PostgreSQL, TimescaleDB, two PgBouncer instances, Redis, two FastAPI service roles, the data populator, the analytics worker, and the Nginx frontend.

Nginx sends dataset and market-data requests to `market-api` and other API requests to `api`. Both roles use `backend/Dockerfile`; only the main API runs migrations.

Optional profiles:

- `benchmark`: Prometheus, Grafana, Loki, Promtail, Tempo, database exporters, MinIO, and k6.
- `legacy-node-api`: the compatibility Node/SQLite API.

## Files

| Path | Purpose |
| --- | --- |
| `nginx.conf` | SPA hosting, API proxy rules, and WebSocket forwarding |
| `pgbouncer/` | PgBouncer image and generated runtime configuration |
| `observability/` | Prometheus, Grafana, Loki, Promtail, Tempo, and database setup |

## Validate changes

```bash
docker compose -f docker-compose.local.yml config
docker compose config
docker compose build
```

Deployment variables and required secrets are described in [configuration](../docs/configuration.md).
