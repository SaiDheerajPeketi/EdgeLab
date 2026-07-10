# EdgeLab Docker Infrastructure

## Overview
The `docker` directory contains the infrastructure configuration for the EdgeLab Docker Compose deployment. It includes the Nginx reverse proxy configuration, connection pooling via PgBouncer, and an extensive observability stack.

## Responsibilities
- **Routing & Proxying**: Nginx acts as the single entry point, routing requests to the frontend static files and backend FastAPI services (`api` and `market-api`).
- **Connection Pooling**: PgBouncer sits in front of PostgreSQL and TimescaleDB to manage database connection limits effectively for the transactional and market-data workloads.
- **Observability**: Prometheus, Grafana, Loki, and Tempo gather and visualize metrics, logs, and distributed traces.

## Architecture / How it fits into the system
When EdgeLab is launched via `docker-compose up`, these configuration files define how the containers interact:
- `nginx.conf` maps `/api/market-data/*` and `/api/datasets/*` to the `market-api` container, while mapping all other `/api/*` traffic to the primary `api` container. It also serves compiled React assets.
- `pgbouncer` runs a custom entrypoint script to point pool connections at either the `postgres` or `timescaledb` containers dynamically based on environment variables.
- The `benchmark` Docker Compose profile spins up the entire observability stack alongside the application, pre-configuring Grafana dashboards and datasources via YAML files.

## Directory Structure (brief)
- `nginx.conf` - Main Nginx configuration file for the proxy and static asset delivery.
- `/pgbouncer/` - Dockerfile and custom entrypoint script (`entrypoint.sh`) for the PgBouncer service.
- `/observability/`
  - `prometheus.yml` - Prometheus scraping configuration.
  - `loki-config.yml`, `promtail.yml` - Log aggregation configuration.
  - `tempo.yml` - Distributed tracing receiver configuration.
  - `/grafana/` - Pre-configured datasources and starter dashboards.
  - `/postgres/` - Initialization scripts (e.g., enabling `pg_stat_statements`).

## Configuration
> ⚠️ Note: Variables are injected from the root `docker-compose.yml`.

| Environment Variable | Purpose |
| --- | --- |
| `EDGELAB_PGBOUNCER_TARGET_HOST` | Target database container (e.g., `postgres` or `timescaledb`) |
| `EDGELAB_PGBOUNCER_LISTEN_PORT` | Port PgBouncer listens on internally |
| `EDGELAB_PGBOUNCER_MAX_CLIENT_CONN` | Max client connections PgBouncer will accept |
| `EDGELAB_GRAFANA_ADMIN_USER` | Admin username for Grafana |
| `EDGELAB_GRAFANA_ADMIN_PASSWORD` | Admin password for Grafana |

## Dependencies
- **Nginx** (Base image from `frontend/Dockerfile` runtime stage)
- **PgBouncer** (Alpine based)
- **Prometheus / Grafana / Loki / Promtail / Tempo**
- **TimescaleDB / PostgreSQL**

## Local Development
To test changes to Nginx or PgBouncer, a full rebuild of the Compose stack is recommended:
```bash
docker compose up --build
```
For observability testing, launch the benchmark profile:
```bash
docker compose --profile benchmark up -d
```
