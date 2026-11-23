# Docker Environment

EdgeLab provides a self-contained local development environment powered by Docker Compose.

## Optional performance data stack

`docker-compose.local.yml` is the smallest contributor setup and uses SQLite.
For PostgreSQL, TimescaleDB, Redis, and PgBouncer, layer the optional
`docker-compose.performance.yml` file over it:

```bash
docker compose -f docker-compose.local.yml -f docker-compose.performance.yml up -d --build
```

The overlay keeps PostgreSQL, TimescaleDB, PgBouncer, and Redis on loopback-only
host ports. The API connects through its internal poolers: PostgreSQL stores
transactional data, TimescaleDB stores market candles, and Redis provides
disposable shared cache and admission state. It is for development and
single-host testing; configure credentials, backup, TLS, and resource limits
before any public deployment. See the [Performance Data Stack guide](../docs/performance-data-stack.md)
for service ownership, configuration, capacity guidance, and troubleshooting.

## Services

The local configuration (`docker-compose.local.yml`) runs three containerized services:

1. **`frontend`**: Nginx web server hosting the compiled React application, reverse proxying `/api` requests to backend services.
2. **`api`**: Python FastAPI backend running SQLite for market data and application state.
3. **`auth`**: Better Auth service providing authentication endpoints and session management.

## Usage

### Start All Services

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Access the application in your browser at [http://localhost:8080](http://localhost:8080).

### View Logs

```bash
docker compose -f docker-compose.local.yml logs -f
```

### Stop Services

```bash
docker compose -f docker-compose.local.yml down
```

### Reset Data Volumes

```bash
docker compose -f docker-compose.local.yml down -v
```

## Configuration

Configuration values can be customized via `.env` (copy from `.env.example`).
The local setup defaults to loopback-bound ports (`127.0.0.1:8080`) and SQLite database storage in named Docker volumes.
