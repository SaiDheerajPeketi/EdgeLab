# Benchmark

This directory holds the repeatable load and latency harness for the current EdgeLab stack.

The goal is incremental measurement:

- keep the existing single-VM Docker Compose flow working
- stand up the future infra primitives with the `benchmark` profile
- seed realistic authenticated workloads
- run the same HTTP benchmarks after each architecture step

## Services

The root `docker-compose.yml` now exposes an optional `benchmark` profile with:

- `timescaledb`
- `redis`
- `minio`
- `benchmark-k6`

Those services do not replace the current request path yet. They exist so benchmark and migration work can start before the full split into `app-api` and `market-api`.

## Seed Benchmark Data

Seed approved users, dataset catalog rows, replay sessions, trades, and beta session JWTs into the configured database:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/seed_benchmark_data.py --reset > /tmp/edgelab-benchmark-seed.json
```

The command prints auth tokens for the seeded users. Use one of those tokens for authenticated load tests.

Required env:

- `DATABASE_URL`
- `EDGELAB_JWT_SECRET`

Optional sizing flags:

- `--users`
- `--assets`
- `--timeframes`
- `--sessions-per-user`
- `--trades-per-session`

## Run The Benchmark Profile

Bring up the current app stack plus benchmark infra:

```bash
docker compose --profile benchmark up -d postgres api frontend redis timescaledb minio
```

Run a k6 benchmark from the bundled `benchmark-k6` service:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/bootstrap.js
```

Bootstrap shell benchmark:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/bootstrap-shell.js
```

Session summary pagination benchmark:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/backtests-summaries.js
```

Session summary cursor traversal benchmark:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/backtests-summaries-cursor.js
```

Trade page benchmark:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/trades-page.js
```

Trade page cursor traversal benchmark:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/trades-page-cursor.js
```

Metrics summary benchmark:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/metrics-summary.js
```

Metrics curves benchmark:

```bash
docker compose --profile benchmark run --rm \
  -e EDGELAB_API_BASE_URL=http://frontend/api \
  -e EDGELAB_AUTH_TOKEN=your-seeded-token \
  benchmark-k6 run /benchmark/k6/metrics-curves.js
```

When you want session-scoped curves or trade-page runs, use `latest_backtest_session_id` or one of `sample_backtest_session_ids` from seed output and pass it as `EDGELAB_SESSION_ID`.

## Existing Python Micro-Benchmarks

The repo still keeps the fast local Python benchmarks for isolated before/after comparisons:

- `backend/scripts/benchmark_session_summaries.py`
- `backend/scripts/benchmark_bootstrap_profiles.py`
- `backend/scripts/load_test_services.py`

Use those for quick iteration and the k6 harness for repeatable HTTP-level measurements through the deployed stack.
