#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/mykey}"
SSH_TARGET="${SSH_TARGET:-ubuntu@150.136.235.179}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/peketi_20214004/EdgeLab}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://edgelab.co.in}"
GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-${PUBLIC_ORIGIN%/}/auth/callback/google}"
REMOTE_SECRET_PATH="${DEPLOY_DIR}/deployment/google-oauth-client.json"
REMOTE_ENV_FILE="${DEPLOY_DIR}/.env"
SOURCE_FILE="${1:-}"

if [[ -z "${SOURCE_FILE}" ]]; then
  SOURCE_FILE="$(find "${SCRIPT_DIR}" -maxdepth 1 -name 'client_secret_*.json' | head -n 1)"
fi

if [[ -z "${SOURCE_FILE}" || ! -f "${SOURCE_FILE}" ]]; then
  echo "Provide Google OAuth client JSON path as first arg or place client_secret_*.json under deployment/." >&2
  exit 1
fi

ssh -i "${SSH_KEY}" "${SSH_TARGET}" "mkdir -p '${DEPLOY_DIR}/deployment'"
scp -i "${SSH_KEY}" "${SOURCE_FILE}" "${SSH_TARGET}:${REMOTE_SECRET_PATH}"
ssh -i "${SSH_KEY}" "${SSH_TARGET}" \
  "REMOTE_SECRET_PATH='${REMOTE_SECRET_PATH}' REMOTE_ENV_FILE='${REMOTE_ENV_FILE}' GOOGLE_REDIRECT_URI='${GOOGLE_REDIRECT_URI}' PUBLIC_ORIGIN='${PUBLIC_ORIGIN}' bash -s" <<'EOF'
set -euo pipefail
chmod 600 "${REMOTE_SECRET_PATH}"
mkdir -p "$(dirname "${REMOTE_ENV_FILE}")"
touch "${REMOTE_ENV_FILE}"
tmp_file="$(mktemp)"
grep -vE "^(GOOGLE_CLIENT_SECRETS_FILE|GOOGLE_REDIRECT_URI|EDGELAB_PUBLIC_ORIGIN|EDGELAB_BETA_MANUAL_ACCESS_ENABLED)=" "${REMOTE_ENV_FILE}" > "${tmp_file}" || true
printf "GOOGLE_CLIENT_SECRETS_FILE=/opt/edgelab/deployment/google-oauth-client.json\n" >> "${tmp_file}"
printf "GOOGLE_REDIRECT_URI=%s\n" "${GOOGLE_REDIRECT_URI}" >> "${tmp_file}"
printf "EDGELAB_PUBLIC_ORIGIN=%s\n" "${PUBLIC_ORIGIN}" >> "${tmp_file}"
printf "EDGELAB_BETA_MANUAL_ACCESS_ENABLED=0\n" >> "${tmp_file}"
mv "${tmp_file}" "${REMOTE_ENV_FILE}"
EOF

echo "Synced Google OAuth secret to ${SSH_TARGET}:${REMOTE_SECRET_PATH}"
echo "Jenkins next deploy will mount /opt/edgelab/deployment/google-oauth-client.json into api container."
