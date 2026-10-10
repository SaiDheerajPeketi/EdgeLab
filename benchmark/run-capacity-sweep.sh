#!/usr/bin/env bash
set -euo pipefail

configured_api_url="${EDGELAB_API_BASE_URL:-}"
export EDGELAB_API_BASE_URL="${EDGELAB_API_BASE_URL:-http://127.0.0.1:8080/api}"
export EDGELAB_FRONTEND_BASE_URL="${EDGELAB_FRONTEND_BASE_URL:-}"
export EDGELAB_CAPACITY_PROFILE="constant"
export EDGELAB_CAPACITY_VUS_STEPS="${EDGELAB_CAPACITY_VUS_STEPS:-5 10 25 50 75 100 150 200}"
export K6_DURATION="${K6_DURATION:-2m}"

if [[ -z "${EDGELAB_AUTH_TOKEN:-}" && -z "${EDGELAB_AUTH_TOKENS:-}" ]]; then
  cat >&2 <<'EOF'
EDGELAB_AUTH_TOKEN or EDGELAB_AUTH_TOKENS is required.

Use backend/scripts/seed_benchmark_data.py with an isolated benchmark database and dataset root,
then export one distinct user's token per VU and aligned backtest session IDs.
EOF
  exit 2
fi

previous_vus=0
for vus in ${EDGELAB_CAPACITY_VUS_STEPS}; do
  if [[ ! "${vus}" =~ ^[1-9][0-9]*$ ]] || (( vus <= previous_vus )); then
    echo "EDGELAB_CAPACITY_VUS_STEPS must contain strictly increasing positive integers" >&2
    exit 2
  fi
  previous_vus="${vus}"
done
if (( previous_vus == 0 )); then
  echo "EDGELAB_CAPACITY_VUS_STEPS must not be empty" >&2
  exit 2
fi

case "${EDGELAB_CAPACITY_ALLOW_SHARED_USERS:-false}" in
  1|true|TRUE|True|yes|YES|Yes|on|ON|On) shared_users=true ;;
  *) shared_users=false ;;
esac
export EDGELAB_CAPACITY_ALLOW_SHARED_USERS="${shared_users}"

results_dir="${EDGELAB_CAPACITY_RESULTS_DIR:-benchmark/results}"
mkdir -p "${results_dir}"
if [[ "${results_dir}" = /* ]]; then
  host_results_dir="${results_dir}"
else
  host_results_dir="$(pwd)/${results_dir}"
fi

last_passed_vus=0
failed_vus=0
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

run_k6() {
  local vus="$1"
  local summary_name="e2e-capacity-${vus}vu-${timestamp}.json"
  export K6_VUS="${vus}"

  if command -v k6 >/dev/null 2>&1; then
    K6_SUMMARY_PATH="${results_dir}/${summary_name}" k6 run benchmark/k6/e2e-capacity.js
    return $?
  fi

  local docker_api_url="${EDGELAB_API_BASE_URL}"
  if [[ -z "${configured_api_url}" ]]; then
    docker_api_url="http://frontend/api"
  fi
  docker compose --profile benchmark run --rm --no-deps \
    -v "${host_results_dir}:/results" \
    -e EDGELAB_API_BASE_URL="${docker_api_url}" \
    -e EDGELAB_FRONTEND_BASE_URL \
    -e EDGELAB_AUTH_TOKEN \
    -e EDGELAB_AUTH_TOKENS \
    -e EDGELAB_SESSION_ID \
    -e EDGELAB_SESSION_IDS \
    -e EDGELAB_CAPACITY_PROFILE \
    -e EDGELAB_CAPACITY_P95_MS \
    -e EDGELAB_CAPACITY_P99_MS \
    -e EDGELAB_CAPACITY_MAX_ERROR_RATE \
    -e EDGELAB_CAPACITY_THINK_TIME_SECONDS \
    -e EDGELAB_CAPACITY_NETWORK_RTT_MS \
    -e EDGELAB_CAPACITY_ALLOW_SHARED_USERS \
    -e EDGELAB_INCLUDE_ANALYTICS \
    -e EDGELAB_INCLUDE_MARKET_DATA \
    -e EDGELAB_INCLUDE_REPLAY_ADVANCE \
    -e EDGELAB_INCLUDE_SESSION_CREATE \
    -e EDGELAB_CREATE_SESSION_EVERY_ITERATIONS \
    -e EDGELAB_CREATE_SESSION_SYMBOL \
    -e EDGELAB_CREATE_SESSION_INSTRUMENT \
    -e EDGELAB_CREATE_SESSION_TIMEFRAME \
    -e EDGELAB_CREATE_SESSION_CSV_PATH \
    -e EDGELAB_CREATE_SESSION_CURRENCY \
    -e EDGELAB_CREATE_SESSION_TIMEZONE \
    -e EDGELAB_CREATE_SESSION_INITIAL_BALANCE \
    -e EDGELAB_BOOTSTRAP_LIMIT \
    -e EDGELAB_SUMMARIES_LIMIT \
    -e EDGELAB_TRADES_LIMIT \
    -e EDGELAB_BARS_LIMIT \
    -e K6_DURATION \
    -e K6_VUS \
    -e K6_SUMMARY_PATH="/results/${summary_name}" \
    benchmark-k6 run /benchmark/k6/e2e-capacity.js
}

for vus in ${EDGELAB_CAPACITY_VUS_STEPS}; do
  echo "Running EdgeLab E2E capacity step: ${vus} concurrent synthetic users"
  if run_k6 "${vus}"; then
    if [[ "${shared_users}" == "false" ]]; then
      last_passed_vus="${vus}"
    fi
  else
    failed_vus="${vus}"
    break
  fi
done

echo
echo "EdgeLab capacity sweep complete"
echo "  Last passing distinct-credential concurrency: ${last_passed_vus} VUs"
echo "  Tested duration per step: ${K6_DURATION}; think time: ${EDGELAB_CAPACITY_THINK_TIME_SECONDS:-1}s/iteration"
echo "  Extra RTT: ${EDGELAB_CAPACITY_NETWORK_RTT_MS:-0} ms modeled per request; registered-user capacity and generator headroom are not established"
if [[ "${failed_vus}" != "0" ]]; then
  echo "  First failing concurrency: ${failed_vus} VUs"
else
  echo "  First failing concurrency: not reached"
fi
echo "  Result files: ${results_dir}/e2e-capacity-*-${timestamp}.json"
if [[ "${failed_vus}" != "0" ]]; then
  exit 1
fi
