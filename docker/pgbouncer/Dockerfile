FROM postgres:16-alpine

ENV EDGELAB_PGBOUNCER_LISTEN_PORT=6432 \
    EDGELAB_PGBOUNCER_POOL_MODE=transaction \
    EDGELAB_PGBOUNCER_MAX_CLIENT_CONN=400 \
    EDGELAB_PGBOUNCER_DEFAULT_POOL_SIZE=25 \
    EDGELAB_PGBOUNCER_RESERVE_POOL_SIZE=5 \
    EDGELAB_PGBOUNCER_SERVER_IDLE_TIMEOUT_SECONDS=600 \
    EDGELAB_PGBOUNCER_SERVER_CONNECT_TIMEOUT_SECONDS=15

RUN set -eux; \
    apk add --no-cache pgbouncer; \
    if ! grep -q '^pgbouncer:' /etc/group; then addgroup -S pgbouncer; fi; \
    if ! id -u pgbouncer >/dev/null 2>&1; then adduser -S -D -h /var/lib/pgbouncer -G pgbouncer pgbouncer; fi; \
    install -d -o pgbouncer -g pgbouncer /var/lib/pgbouncer

COPY docker/pgbouncer/entrypoint.sh /usr/local/bin/edgelab-pgbouncer-entrypoint.sh
RUN chmod +x /usr/local/bin/edgelab-pgbouncer-entrypoint.sh

USER pgbouncer
WORKDIR /var/lib/pgbouncer
EXPOSE 6432
ENTRYPOINT ["/usr/local/bin/edgelab-pgbouncer-entrypoint.sh"]
