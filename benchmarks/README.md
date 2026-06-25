# Benchmarks

## Session Summary Microbenchmark

Compare the legacy filesystem-filtered summary path against the indexed catalog query on a seeded temporary workload:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_session_summaries.py --sessions 20000 --iterations 25
```

This script does not require Docker. It seeds a temporary SQLite database, injects stale sessions, and reports mean/p95 latency plus the speedup factor for the indexed query path.

## Single-VM and Split-Service Load Test

Exercise the frontend, `/api/health`, `/api/ready`, and optionally authenticated `/api/bootstrap` and `/api/backtests/summaries` endpoints against either:

- the current single-VM reverse proxy: `http://127.0.0.1:8080`
- a future split deployment with separate frontend/API load balancers

Run it with defaults for the current single-VM Compose stack:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/load_test_services.py --requests 200 --concurrency 20
```

Include a beta session JWT to cover authenticated latency:

```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/load_test_services.py \
  --frontend-url http://127.0.0.1:8080 \
  --api-url http://127.0.0.1:8080/api \
  --auth-token "$EDGELAB_BETA_JWT" \
  --requests 500 \
  --concurrency 50
```

Point it at future multi-service endpoints by overriding `--frontend-url` and `--api-url`.
