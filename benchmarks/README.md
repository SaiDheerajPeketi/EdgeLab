# EdgeLab Python Benchmarks

## Overview
The `benchmarks` directory contains isolated, fast local Python scripts used for micro-benchmarking specific code paths and architectures before and after code changes.

## Responsibilities
- **Read-Model Validation**: Compares query execution times between legacy filtered queries and the newer indexed query paths (e.g., session summaries).
- **Payload Sizing**: Compares full bootstrap payloads against lightweight "shell" bootstrap endpoints for first-paint optimization.
- **Service-Level Load Testing**: Runs concurrent HTTP requests directly against single-VM or split-service setups using `asyncio` and `aiohttp`.

## Architecture / How it fits into the system
Unlike the robust `benchmark/` harness (which uses k6 and Docker), these scripts are designed to run locally in the Python environment, completely bypassing the network stack for database queries when needed, or firing rapid synthetic HTTP traffic without the overhead of containerized runner deployment.

## Directory Structure
- These scripts technically reside in `backend/scripts/` but this documentation serves to group their conceptual usage.
- `benchmark_session_summaries.py` - Seeds temporary SQLite and tests indexed queries.
- `benchmark_bootstrap_profiles.py` - Compares `/api/bootstrap` vs `/api/bootstrap-shell`.
- `load_test_services.py` - Exercises the live HTTP API under concurrency.

## Configuration
Arguments are passed directly to the Python scripts via the CLI.

| CLI Argument | Purpose |
| --- | --- |
| `--sessions`, `--assets` | Controls the size of the seeded temporary dataset |
| `--iterations` | How many times to execute the function being timed |
| `--requests` | Number of HTTP requests for the load tester |
| `--concurrency` | Number of concurrent async workers |
| `--frontend-url`, `--api-url` | Override target URIs |

## Dependencies
- **Python 3 / backend virtualenv**: These scripts use `SQLAlchemy`, `httpx` (or `aiohttp`), and other backend dependencies.

## Local Development
Run the session summary microbenchmark without Docker:
```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/benchmark_session_summaries.py --sessions 20000 --iterations 25
```
Run a quick HTTP load test:
```bash
PYTHONPATH=backend backend/.venv/bin/python backend/scripts/load_test_services.py --requests 200 --concurrency 20
```
