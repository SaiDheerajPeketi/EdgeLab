#!/bin/sh
set -eu

alembic -c /app/backend/alembic.ini upgrade head
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
