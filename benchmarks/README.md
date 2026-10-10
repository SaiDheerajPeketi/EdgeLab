# Python microbenchmarks

The executable scripts live in `backend/scripts/`. This directory is a documentation entry point. Use the backend Python 3.12 environment and repository-root package commands; argument details are in each script's parser.

| Command | Measures |
| --- | --- |
| `npm run bench:session-summaries` | Legacy filtered versus indexed session summaries |
| `npm run bench:bootstrap-profiles` | Full versus shell bootstrap functions and serialized payload sizes |
| `npm run bench:metrics-profiles` | Summary, curve and full metrics functions |
| `npm run bench:market-data-storage` | CSV versus indexed SQLite candle reads, including cold/warm timings |
| `backend/scripts/benchmark_hot_paths.py` | Synthetic memory-cache retention and candle-conversion output parity/timing |

The first four scripts create and remove temporary SQLite fixtures. They call application functions directly, bypassing HTTP, proxy, authentication and production PostgreSQL contention. The hot-path script uses synthetic data in memory; `--compare-cache-source` loads a Python module from the supplied path, so use only reviewed source. These results identify code-path costs; they do not establish server concurrency or production capacity.

```bash
npm run bench:session-summaries -- --sessions 20000 --iterations 25
npm run bench:bootstrap-profiles -- --assets 3 --sessions 100 --iterations 10
```

Record source revision, fixture size, interpreter/hardware, cache state and iteration count when comparing results. Temporary files are removed after a normal run; record outputs outside Git if needed. Review script defaults before large runs on a shared development machine.

## HTTP measurements

`backend/scripts/load_test_services.py` uses threaded HTTP workers. Its default `endpoints` mode runs request-count diagnostics; it does not model concurrent signed-in users or enforce the mixed workload's latency SLOs. `--workload mixed` runs a duration-based workload with distinct credentials, aligned sessions and think time.

Use [load testing](../benchmark/README.md) for the Python mixed workload, k6 sweep, isolated fixture creation and cleanup. See [production capacity](../docs/production-capacity.md) for the scope of measured results and [observability](../docs/observability.md) for private runtime metrics. Never seed or stress customer databases as part of a microbenchmark.
