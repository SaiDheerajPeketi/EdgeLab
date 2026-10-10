#!/bin/sh
set -eu
# This one-user SQLite process intentionally has no public proxy trust or prefork pool.
# Validate before migrations so a mistaken public configuration never alters storage.
python -c 'from app.config import settings; from app.personal_access import validate_personal_settings; validate_personal_settings(settings)'
alembic -c /app/backend/alembic.ini upgrade head
python -c 'from app.market_data_db import init_market_data_db; init_market_data_db()'
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-proxy-headers
