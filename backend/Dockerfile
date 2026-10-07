FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend \
    EDGELAB_API_TOKEN= \
    EDGELAB_API_WORKERS= \
    EDGELAB_API_TIMEOUT_SECONDS=120 \
    EDGELAB_API_GRACEFUL_TIMEOUT_SECONDS=30 \
    EDGELAB_API_KEEPALIVE_SECONDS=5 \
    EDGELAB_RUN_MIGRATIONS=1 \
    EDGELAB_JWT_SECRET= \
    EDGELAB_BILLING_ENABLED=0 \
    EDGELAB_STRIPE_MODE=test \
    EDGELAB_DATASETS_ROOT=/datasets \
    EDGELAB_MAX_APP_DATA_ROWS=100000 \
    EDGELAB_MAX_REQUEST_BODY_BYTES=26214400 \
    EDGELAB_MARKET_DATA_IMPORT_ENABLED=1 \
    EDGELAB_MARKET_DATA_DATABASE_URL= \
    POSTGRES_DB=edgelab \
    POSTGRES_USER=edgelab \
    POSTGRES_PASSWORD=edgelab \
    EDGELAB_POSTGRES_HOST=pgbouncer-postgres \
    EDGELAB_POSTGRES_CONNECT_PORT=6432

WORKDIR /app

RUN addgroup --system edgelab \
    && adduser --system --ingroup edgelab edgelab \
    && mkdir -p /datasets /var/lib/edgelab \
    && chown -R edgelab:edgelab /var/lib/edgelab

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend

USER edgelab
EXPOSE 8000

CMD ["sh", "/app/backend/scripts/start_api.sh"]
