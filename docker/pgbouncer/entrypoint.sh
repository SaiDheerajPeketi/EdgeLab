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
pool_mode = ${EDGELAB_PGBOUNCER_POOL_MODE:-transaction}
max_client_conn = ${EDGELAB_PGBOUNCER_MAX_CLIENT_CONN:-400}
default_pool_size = ${EDGELAB_PGBOUNCER_DEFAULT_POOL_SIZE:-25}
reserve_pool_size = ${EDGELAB_PGBOUNCER_RESERVE_POOL_SIZE:-5}
server_idle_timeout = ${EDGELAB_PGBOUNCER_SERVER_IDLE_TIMEOUT_SECONDS:-600}
server_connect_timeout = ${EDGELAB_PGBOUNCER_SERVER_CONNECT_TIMEOUT_SECONDS:-15}
server_reset_query = DISCARD ALL
server_check_query = select 1
ignore_startup_parameters = extra_float_digits,options
pidfile = /var/lib/pgbouncer/pgbouncer.pid
unix_socket_dir = /var/lib/pgbouncer
EOF

exec pgbouncer /var/lib/pgbouncer/pgbouncer.ini
