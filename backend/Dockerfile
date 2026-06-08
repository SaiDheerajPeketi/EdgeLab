FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend \
    EDGELAB_CSV_PATH=/data/EURUSD_M1.csv \
    EDGELAB_DATASETS_ROOT=/datasets \
    EDGELAB_MAX_REQUEST_BODY_BYTES=26214400 \
    DATABASE_URL=sqlite:////var/lib/edgelab/trade_journal_v2.db

WORKDIR /app

RUN addgroup --system edgelab \
    && adduser --system --ingroup edgelab edgelab \
    && mkdir -p /data /datasets /var/lib/edgelab \
    && chown -R edgelab:edgelab /var/lib/edgelab

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend

USER edgelab
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
