#!/bin/sh
set -eu

attempt=1
max_attempts=12

until alembic -c /app/backend/alembic.ini upgrade head; do
  if [ "${attempt}" -ge "${max_attempts}" ]; then
    echo "alembic upgrade failed after ${attempt} attempts" >&2
    exit 1
  fi
  echo "alembic upgrade failed on attempt ${attempt}; retrying in 5 seconds" >&2
  attempt=$((attempt + 1))
  sleep 5
done

if [ -n "${EDGELAB_API_WORKERS:-}" ]; then
  workers="${EDGELAB_API_WORKERS}"
else
  workers="$(python -c 'import os; from app.config import settings; cpu_count = os.cpu_count() or 1; print(1 if settings.database_url.startswith("sqlite") else max(cpu_count * 2, 2))')"
fi

exec gunicorn app.main:app \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --workers "${workers}" \
  --timeout "${EDGELAB_API_TIMEOUT_SECONDS:-120}" \
  --graceful-timeout "${EDGELAB_API_GRACEFUL_TIMEOUT_SECONDS:-30}" \
  --keep-alive "${EDGELAB_API_KEEPALIVE_SECONDS:-5}" \
  --access-logfile - \
  --error-logfile -
