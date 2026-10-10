# EdgeLab load testing

Use an isolated benchmark database and dataset root. The seed refuses accounts outside its benchmark namespace and refuses an unmarked nonempty dataset directory. Never point it at customer data. Tokens and seed manifests are credentials; keep them private and outside Git.

[Python microbenchmarks](../benchmarks/README.md) call functions against temporary fixtures. This guide covers HTTP load against a running isolated stack. Neither the optional `benchmark` Compose profile nor the harness provisions redundant infrastructure. Use [setup](../docs/setup-and-deployment.md) for deployment selection, [observability](../docs/observability.md) for private metrics, and [maintenance](../docs/maintenance.md) for production recovery procedures.

## Seed a workload

The database URL and dataset root are required. Set a restrictive `umask` (for example, `umask 077`) before redirecting the credential manifest to an existing private directory:

    PYTHONPATH=backend backend/.venv/bin/python backend/scripts/seed_benchmark_data.py \
      --database-url "$BENCHMARK_DATABASE_URL" --dataset-root /tmp/edgelab-benchmark \
      --users 100 --assets 3 --timeframes 3 --sessions-per-user 100 \
      --trades-per-session 10 --bars-per-timeframe 2000 > /private/path/users.json

Set an isolated JWT secret before seeding. These initial tokens exercise legacy beta authentication. They do not measure production Google sign-in or subscription verification. For production measurements, create actual native sessions in a disposable Better Auth store and match verified API identities; any synthetic billing leases must be labeled. Do not add an application auth bypass for load tests.

The fixtures contain actual CSV bars, not metadata pointing at absent files. Import the chart series into the configured SQL candle store if measuring indexed chart reads. Record which series are imported, trade density, catalog size, cache state and worker/pool settings.

## Python mixed workload

    PYTHONPATH=backend backend/.venv/bin/python backend/scripts/load_test_services.py \
      --workload mixed --api-url http://127.0.0.1:8080/api \
      --frontend-url http://127.0.0.1:8080 --benchmark-users-file /private/path/users.json \
      --concurrency 50 --duration-seconds 120 --think-time 1 \
      --network-rtt-ms 0 --json-output /private/path/results.json

Each concurrent worker needs its own user credential and replay session. The sequential read loop includes bootstrap, catalog, journal, metrics, chart metadata and 300 bars; specifying `--frontend-url` also fetches the HTML root. This is a read stress workload, not all product activity. Writes, WebSockets, downloads and external providers need separate tests.

A nonzero exit means an endpoint or aggregate SLO failed, a worker failed, or results were missing. Default limits are P95 below 750ms, P99 below 1500ms and errors below 1%. Percentiles use bounded 1% logarithmic buckets; they are approximate. Whole-request latency includes configured extra RTT. RTT is modeled client delay, not geographic measurement, and must not be converted into extra server capacity.

## k6 sweep

Provide `EDGELAB_AUTH_TOKENS` and aligned `EDGELAB_SESSION_IDS` with one distinct user/session per virtual user, then run `npm run bench:e2e-capacity`. Set `EDGELAB_FRONTEND_BASE_URL` to include the frontend HTML request; it is empty by default. Use the host frontend URL with native k6, or `http://frontend` from the Docker runner. A shared identity is permitted only as an explicit cache diagnostic; it cannot establish user capacity. Native k6 defaults to loopback; the Docker fallback targets the Compose frontend and uses `--no-deps`, so the target stack must already be running. On Linux/macOS, set `COMPOSE_FILE=docker-compose.yml:docker-compose.efficient.yml` before the sweep if its Docker fallback targets an efficient installation. The sweep uses increasing constant-load steps and stops with a nonzero exit at the first failing step.

| Variable | Default | Meaning |
| --- | --- | --- |
| EDGELAB_CAPACITY_VUS_STEPS | 5 10 25 50 75 100 150 200 | Increasing concurrent users |
| K6_DURATION | 2m | Duration of each constant-load step |
| EDGELAB_CAPACITY_P95_MS | 750 | Endpoint and aggregate P95 limit |
| EDGELAB_CAPACITY_P99_MS | 1500 | Endpoint and aggregate P99 limit |
| EDGELAB_CAPACITY_MAX_ERROR_RATE | 0.01 | Maximum error fraction |
| EDGELAB_CAPACITY_THINK_TIME_SECONDS | 1 | Pause after each full iteration |
| EDGELAB_CAPACITY_NETWORK_RTT_MS | 0 | Modeled additional RTT per request |

Runs shorter than 30 seconds are smoke checks. Ramping summaries blend load levels and do not certify the highest level. A deployment result must include endpoint latency/errors, CPU/RAM, database waits, sustained duration, generator headroom and network/auth exclusions. Test from a separate physical generator before publishing a cloud capacity number. See [production capacity](../docs/production-capacity.md) for measured local results and launch limits. Returned body-byte rates exclude other browser assets, compression/TLS effects and real geographic transport; they are not monthly egress forecasts.

## Cleanup and reproducibility

Record the tested source/image identifiers, Compose files/profiles, data density, auth/billing fixture scope, pool/worker settings, cache state and resource limits with each result. Keep seed manifests, tokens and private runner output out of source offers and CI uploads.

Stop the owned generators before restoring changed CPU limits, worker counts or telemetry settings. Remove data only from the explicitly disposable benchmark project/database/dataset root after retaining the result evidence. The seed `--reset` option resets benchmark fixtures; it is not an application cleanup or backup tool. Never run Compose volume removal or a seed reset against a shared/customer deployment.
