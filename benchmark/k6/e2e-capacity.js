import http from "k6/http";
import { check, group, sleep } from "k6";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const frontendBaseUrl = (__ENV.EDGELAB_FRONTEND_BASE_URL || "").replace(/\/$/, "");
const authTokens = parseList(__ENV.EDGELAB_AUTH_TOKENS || __ENV.EDGELAB_AUTH_TOKEN || "");
const sessionIds = parseList(__ENV.EDGELAB_SESSION_IDS || __ENV.EDGELAB_SESSION_ID || "");
const profile = (__ENV.EDGELAB_CAPACITY_PROFILE || "ramping").trim().toLowerCase();
const p95ThresholdMs = Number(__ENV.EDGELAB_CAPACITY_P95_MS || 750);
const p99ThresholdMs = Number(__ENV.EDGELAB_CAPACITY_P99_MS || 1500);
const maxErrorRate = Number(__ENV.EDGELAB_CAPACITY_MAX_ERROR_RATE || 0.01);
const thinkTimeSeconds = Number(__ENV.EDGELAB_CAPACITY_THINK_TIME_SECONDS || 1);
const includeAnalytics = parseBoolean(__ENV.EDGELAB_INCLUDE_ANALYTICS, true);
const includeMarketData = parseBoolean(__ENV.EDGELAB_INCLUDE_MARKET_DATA, true);
const includeReplayAdvance = parseBoolean(__ENV.EDGELAB_INCLUDE_REPLAY_ADVANCE, false);
const includeSessionCreate = parseBoolean(__ENV.EDGELAB_INCLUDE_SESSION_CREATE, false);
const createEveryIterations = Math.max(Number(__ENV.EDGELAB_CREATE_SESSION_EVERY_ITERATIONS || 25), 1);
const bootstrapLimit = Number(__ENV.EDGELAB_BOOTSTRAP_LIMIT || 25);
const summariesLimit = Number(__ENV.EDGELAB_SUMMARIES_LIMIT || 50);
const tradesLimit = Number(__ENV.EDGELAB_TRADES_LIMIT || 100);
const barsLimit = Number(__ENV.EDGELAB_BARS_LIMIT || 300);
const summaryPath = (__ENV.K6_SUMMARY_PATH || "").trim();

if (!authTokens.length) {
  throw new Error("EDGELAB_AUTH_TOKEN or EDGELAB_AUTH_TOKENS is required for E2E capacity testing");
}

export const options = {
  scenarios: {
    e2e_capacity: buildScenario(),
  },
  thresholds: buildThresholds(),
};

export default function () {
  const token = authTokens[(__VU - 1) % authTokens.length];
  const sessionId = sessionIds.length ? sessionIds[(__VU - 1) % sessionIds.length] : "";
  const authParams = {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  group("frontend_shell", () => {
    if (!frontendBaseUrl) {
      return;
    }
    const response = http.get(frontendBaseUrl, {
      tags: { endpoint: "frontend_root" },
    });
    check(response, {
      "frontend root is available": (res) => res.status >= 200 && res.status < 400,
    });
  });

  group("workspace_bootstrap", () => {
    getJson(`/bootstrap-shell?limit=${bootstrapLimit}`, authParams, "bootstrap_shell");
    getJson(`/bootstrap?limit=${bootstrapLimit}`, authParams, "bootstrap");
    getJson("/datasets", authParams, "datasets");
  });

  group("journal_reads", () => {
    getJson(`/backtests/summaries?limit=${summariesLimit}`, authParams, "backtests_summaries");
    getJson(`/trades/page?limit=${tradesLimit}`, authParams, "trades_page");
  });

  if (includeAnalytics) {
    group("analytics_reads", () => {
      getJson("/metrics/summary", authParams, "metrics_summary");
      getJson("/metrics/curves", authParams, "metrics_curves");
    });
  }

  if (includeMarketData) {
    group("market_data_reads", () => {
      const sessionQuery = sessionId ? `session_id=${encodeURIComponent(sessionId)}&` : "";
      getJson(`/market-data/meta${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`, authParams, "market_data_meta");
      getJson(`/market-data/bars?${sessionQuery}limit=${barsLimit}`, authParams, "market_data_bars");
    });
  }

  if (includeReplayAdvance && sessionId) {
    group("replay_mutation", () => {
      postJson(`/backtests/${encodeURIComponent(sessionId)}/advance-compact`, { steps: 1 }, authParams, "replay_advance");
    });
  }

  if (includeSessionCreate && __ITER % createEveryIterations === 0) {
    group("session_create_mutation", () => {
      postJson("/backtests", buildCreateSessionPayload(), authParams, "session_create");
    });
  }

  sleep(thinkTimeSeconds);
}

export function handleSummary(data) {
  const failedRate = metricValue(data, "http_req_failed", "rate");
  const p95 = metricValue(data, "http_req_duration", "p(95)");
  const p99 = metricValue(data, "http_req_duration", "p(99)");
  const requests = metricValue(data, "http_reqs", "count");
  const iterations = metricValue(data, "iterations", "count");
  const checksRate = metricValue(data, "checks", "rate");
  const maxVus = configuredMaxVus();
  const passed = failedRate < maxErrorRate && p95 < p95ThresholdMs && p99 < p99ThresholdMs && checksRate > 0.99;

  const report = [
    "",
    "EdgeLab E2E capacity result",
    `  Status: ${passed ? "PASS" : "FAIL"}`,
    `  Tested concurrency: ${maxVus} VUs`,
    `  Requests: ${requests}`,
    `  Iterations: ${iterations}`,
    `  Error rate: ${(failedRate * 100).toFixed(2)}%`,
    `  Check pass rate: ${(checksRate * 100).toFixed(2)}%`,
    `  HTTP p95: ${p95.toFixed(2)} ms`,
    `  HTTP p99: ${p99.toFixed(2)} ms`,
    passed
      ? `  Capacity statement: deployment handled at least ${maxVus} concurrent synthetic users within thresholds.`
      : "  Capacity statement: degradation threshold crossed at this concurrency.",
    "",
  ].join("\n");

  const outputs = { stdout: report };
  if (summaryPath) {
    outputs[summaryPath] = JSON.stringify(data, null, 2);
  }
  return outputs;
}

function getJson(path, params, endpoint) {
  const response = http.get(`${apiBaseUrl}${path}`, {
    ...params,
    tags: { endpoint },
  });
  checkJsonResponse(response, endpoint);
  return response;
}

function postJson(path, payload, params, endpoint) {
  const response = http.post(`${apiBaseUrl}${path}`, JSON.stringify(payload), {
    ...params,
    tags: { endpoint },
  });
  checkJsonResponse(response, endpoint);
  return response;
}

function checkJsonResponse(response, endpoint) {
  check(response, {
    [`${endpoint} status is 2xx`]: (res) => res.status >= 200 && res.status < 300,
    [`${endpoint} returns json`]: (res) => {
      if (res.status < 200 || res.status >= 300) {
        return false;
      }
      try {
        JSON.parse(res.body);
        return true;
      } catch {
        return false;
      }
    },
  });
}

function buildScenario() {
  if (profile === "constant") {
    return {
      executor: "constant-vus",
      vus: Number(__ENV.K6_VUS || 20),
      duration: __ENV.K6_DURATION || "2m",
      gracefulStop: __ENV.K6_GRACEFUL_STOP || "30s",
    };
  }

  return {
    executor: "ramping-vus",
    startVUs: Number(__ENV.K6_START_VUS || 0),
    stages: parseStages(),
    gracefulRampDown: __ENV.K6_GRACEFUL_RAMP_DOWN || "30s",
  };
}

function buildThresholds() {
  const thresholds = {
    checks: ["rate>0.99"],
    http_req_failed: [`rate<${maxErrorRate}`],
    http_req_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
    "http_req_duration{endpoint:bootstrap_shell}": [`p(95)<${p95ThresholdMs}`],
    "http_req_duration{endpoint:backtests_summaries}": [`p(95)<${p95ThresholdMs}`],
  };
  if (includeMarketData) {
    thresholds["http_req_duration{endpoint:market_data_bars}"] = [`p(95)<${p99ThresholdMs}`];
  }
  return thresholds;
}

function parseStages() {
  const configured = (__ENV.K6_STAGES || "").trim();
  if (configured) {
    return configured.split(",").map((stage) => {
      const [target, duration] = stage.split(":");
      return {
        target: Number(target.trim()),
        duration: duration.trim(),
      };
    });
  }

  const maxVus = Number(__ENV.K6_MAX_VUS || 100);
  const stepVus = Number(__ENV.K6_STEP_VUS || 25);
  const stepDuration = __ENV.K6_STEP_DURATION || "2m";
  const stages = [];
  for (let target = stepVus; target < maxVus; target += stepVus) {
    stages.push({ target, duration: stepDuration });
  }
  stages.push({ target: maxVus, duration: __ENV.K6_SUSTAIN_DURATION || stepDuration });
  stages.push({ target: 0, duration: __ENV.K6_COOLDOWN_DURATION || "1m" });
  return stages;
}

function configuredMaxVus() {
  if (profile === "constant") {
    return Number(__ENV.K6_VUS || 20);
  }
  return parseStages().reduce((max, stage) => Math.max(max, stage.target), 0);
}

function buildCreateSessionPayload() {
  return {
    name: `Capacity Session VU ${__VU} Iter ${__ITER}`,
    symbol: optionalString(__ENV.EDGELAB_CREATE_SESSION_SYMBOL),
    instrument: optionalString(__ENV.EDGELAB_CREATE_SESSION_INSTRUMENT),
    timeframe: optionalString(__ENV.EDGELAB_CREATE_SESSION_TIMEFRAME),
    csv_path: optionalString(__ENV.EDGELAB_CREATE_SESSION_CSV_PATH),
    currency: optionalString(__ENV.EDGELAB_CREATE_SESSION_CURRENCY),
    timezone: optionalString(__ENV.EDGELAB_CREATE_SESSION_TIMEZONE),
    strategy_name: "capacity-benchmark",
    initial_balance: Number(__ENV.EDGELAB_CREATE_SESSION_INITIAL_BALANCE || 100000),
  };
}

function parseList(value) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function optionalString(value) {
  const normalized = (value || "").trim();
  return normalized || null;
}

function metricValue(data, metricName, valueName) {
  return data.metrics[metricName]?.values?.[valueName] ?? 0;
}
