#!/bin/sh
set -eu

require_env() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "missing required env: $name" >&2
    exit 1
  fi
}

require_env POSTGRES_USER
require_env POSTGRES_PASSWORD
require_env EDGELAB_PGBOUNCER_TARGET_HOST

listen_port="${EDGELAB_PGBOUNCER_LISTEN_PORT:-6432}"
target_port="${EDGELAB_PGBOUNCER_TARGET_PORT:-5432}"
database_name="${EDGELAB_PGBOUNCER_DATABASE:-${POSTGRES_DB:-edgelab}}"
target_db="${EDGELAB_PGBOUNCER_TARGET_DB:-${POSTGRES_DB:-edgelab}}"
pool_mode="${EDGELAB_PGBOUNCER_POOL_MODE:-transaction}"
max_client_conn="${EDGELAB_PGBOUNCER_MAX_CLIENT_CONN:-400}"
default_pool_size="${EDGELAB_PGBOUNCER_DEFAULT_POOL_SIZE:-25}"
reserve_pool_size="${EDGELAB_PGBOUNCER_RESERVE_POOL_SIZE:-5}"
server_idle_timeout="${EDGELAB_PGBOUNCER_SERVER_IDLE_TIMEOUT_SECONDS:-600}"
server_connect_timeout="${EDGELAB_PGBOUNCER_SERVER_CONNECT_TIMEOUT_SECONDS:-15}"
pidfile="/var/lib/pgbouncer/pgbouncer.pid"
unix_socket_dir="/var/lib/pgbouncer"
socket_file="${unix_socket_dir}/.s.PGSQL.${listen_port}"
socket_lock_file="${socket_file}.lock"

# Compose restarts can reuse the container writable layer after the old pooler
# exits, so clear stale runtime artifacts before starting the next PgBouncer.
rm -f "$pidfile" "$socket_file" "$socket_lock_file"

cat > /var/lib/pgbouncer/userlist.txt <<EOF
"${POSTGRES_USER}" "${POSTGRES_PASSWORD}"
EOF

cat > /var/lib/pgbouncer/pgbouncer.ini <<EOF
[databases]
${database_name} = host=${EDGELAB_PGBOUNCER_TARGET_HOST} port=${target_port} dbname=${target_db}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = ${listen_port}
auth_type = plain
auth_file = /var/lib/pgbouncer/userlist.txt
admin_users = ${POSTGRES_USER}
stats_users = ${POSTGRES_USER}
pool_mode = ${pool_mode}
max_client_conn = ${max_client_conn}
default_pool_size = ${default_pool_size}
reserve_pool_size = ${reserve_pool_size}
server_idle_timeout = ${server_idle_timeout}
server_connect_timeout = ${server_connect_timeout}
server_reset_query = DISCARD ALL
server_check_query = select 1
ignore_startup_parameters = extra_float_digits,options
log_connections = 0
log_disconnections = 0
log_pooler_errors = 1
pidfile = ${pidfile}
unix_socket_dir = ${unix_socket_dir}
EOF

exec pgbouncer /var/lib/pgbouncer/pgbouncer.ini
