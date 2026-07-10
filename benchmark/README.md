# EdgeLab Benchmark Harness

## Overview
The `benchmark` directory contains a repeatable load and latency testing harness powered by k6. It validates the performance of the full EdgeLab stack (including PostgreSQL, Redis, and FastAPI) under authenticated, synthetic user workloads.

## Responsibilities
- **Load Testing**: Executes k6 scripts against various read and write endpoints to ensure the application meets latency (e.g., p95 < 750ms) and throughput requirements.
- **Capacity Planning**: Provides an End-to-End (E2E) capacity sweep to find the degradation point of a live deployment.
- **Observability Integration**: Deploys an extensive observability stack (via Docker Compose profile) to collect detailed traces, logs, and query fingerprints during runs.

## Architecture / How it fits into the system
- A dedicated `docker-compose.yml` profile (`benchmark`) provisions MinIO, Loki, Tempo, Prometheus, Grafana, db-exporters, and the `benchmark-k6` runner itself.
- Tests target the Nginx frontend proxy or directly the FastAPI backend.
- A Python seeding script initializes a temporary dataset with authenticated users, sessions, and trades to provide a realistic testing surface.

## Directory Structure
- `k6/` - Individual k6 Javascript test scenarios (e.g., `bootstrap.js`, `trades-page.js`).
- `run-capacity-sweep.sh` - Shell script to execute incremental VU (Virtual User) steps against production URLs.
- `README.md` - Execution instructions.

## Configuration
> ⚠️ Note: Environment variables control test parameters.

| Environment Variable | Purpose | Default |
| --- | --- | --- |
| `EDGELAB_API_BASE_URL` | Target base URL for the API | `http://frontend/api` |
| `EDGELAB_AUTH_TOKEN` | A valid seeded JWT token | `""` |
| `EDGELAB_SESSION_ID` | A valid seeded session ID for scoped tests | `""` |
| `EDGELAB_CAPACITY_VUS_STEPS` | Space separated string of VU steps for capacity sweep | `5 10 25 50 75 100 150 200 300` |
| `K6_DURATION` | Duration per step | `3m` |

## Dependencies
- **k6**: Load testing engine.
- **Python (Seed Script)**: Requires the main backend dependencies to seed the database directly via SQLAlchemy.
- **Docker Compose**: Required to spin up the observability harness.

## Local Development
Seed benchmark data and extract a token:
```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/seed_benchmark_data.py --reset
```

Run a specific k6 test against the local benchmark stack:
```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/bootstrap.js
```
