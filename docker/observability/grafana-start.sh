#!/bin/sh
set -eu
# Validate only when this optional service starts, never during Compose parsing.
GF_SECURITY_ADMIN_PASSWORD=${GF_SECURITY_ADMIN_PASSWORD:-}
if [ "${#GF_SECURITY_ADMIN_PASSWORD}" -lt 12 ]; then
  echo "EDGELAB_GRAFANA_ADMIN_PASSWORD must contain at least 12 characters." >&2
  exit 1
fi
exec /run.sh "$@"
