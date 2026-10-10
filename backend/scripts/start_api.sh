#!/bin/sh
set -eu

attempt=1
max_attempts="${EDGELAB_MIGRATION_MAX_ATTEMPTS:-12}"
retry_seconds="${EDGELAB_MIGRATION_RETRY_SECONDS:-5}"
case "$max_attempts" in ''|*[!0-9]*|0) echo "EDGELAB_MIGRATION_MAX_ATTEMPTS must be a positive integer" >&2; exit 1;; esac
case "$retry_seconds" in ''|*[!0-9]*) echo "EDGELAB_MIGRATION_RETRY_SECONDS must be a nonnegative integer" >&2; exit 1;; esac

if [ "${EDGELAB_RUN_MIGRATIONS:-1}" != "0" ]; then
  until alembic -c /app/backend/alembic.ini upgrade head; do
    if [ "${attempt}" -ge "${max_attempts}" ]; then
      echo "alembic upgrade failed after ${attempt} attempts" >&2
      exit 1
    fi
    echo "alembic upgrade failed on attempt ${attempt}; retrying in ${retry_seconds} seconds" >&2
    attempt=$((attempt + 1))
    sleep "$retry_seconds"
  done
fi

# Initialize the separate candle schema before forking; workers must not race DDL.
python -c 'from app.market_data_db import init_market_data_db; init_market_data_db()'

if [ -n "${EDGELAB_API_WORKERS:-}" ]; then
  workers="${EDGELAB_API_WORKERS}"
else
  workers="$(python -c 'import os; from app.config import settings; cpu_count = os.cpu_count() or 1; print(1 if settings.database_url.startswith("sqlite") else min(max(cpu_count, 1), 2))')"
fi

# Isolated mmap files per Gunicorn master, set before any worker imports the client.
# Never share this directory across replicas or reuse counters from a previous run.
PROMETHEUS_MULTIPROC_DIR="$(mktemp -d "${EDGELAB_METRICS_BASE_DIR:-/tmp}/edgelab-metrics.XXXXXXXX")"
export PROMETHEUS_MULTIPROC_DIR

exec gunicorn app.main:app \
  --config /app/backend/scripts/gunicorn_config.py \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers "${workers}" \
  --timeout "${EDGELAB_API_TIMEOUT_SECONDS:-120}" \
  --graceful-timeout "${EDGELAB_API_GRACEFUL_TIMEOUT_SECONDS:-30}" \
  --keep-alive "${EDGELAB_API_KEEPALIVE_SECONDS:-5}" \
  --error-logfile -
