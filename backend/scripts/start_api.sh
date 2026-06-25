#!/bin/sh
set -eu

alembic -c /app/backend/alembic.ini upgrade head

if [ -n "${EDGELAB_API_WORKERS:-}" ]; then
  workers="${EDGELAB_API_WORKERS}"
else
  workers="$(python -c 'import os; print(max((os.cpu_count() or 1) * 2, 2))')"
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
