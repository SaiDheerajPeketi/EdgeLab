import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const apiBaseUrl = (__ENV.EDGELAB_API_BASE_URL || "http://127.0.0.1:8080/api").replace(/\/$/, "");
const frontendBaseUrl = (__ENV.EDGELAB_FRONTEND_BASE_URL || "").replace(/\/$/, "");
const authTokens = parseList(__ENV.EDGELAB_AUTH_TOKENS || __ENV.EDGELAB_AUTH_TOKEN || "");
const sessionIds = parseList(__ENV.EDGELAB_SESSION_IDS || __ENV.EDGELAB_SESSION_ID || "");
const profile = (__ENV.EDGELAB_CAPACITY_PROFILE || "ramping").trim().toLowerCase();
const p95ThresholdMs = Number(__ENV.EDGELAB_CAPACITY_P95_MS || 750);
const p99ThresholdMs = Number(__ENV.EDGELAB_CAPACITY_P99_MS || 1500);
const maxErrorRate = Number(__ENV.EDGELAB_CAPACITY_MAX_ERROR_RATE || 0.01);
const thinkTimeSeconds = Number(__ENV.EDGELAB_CAPACITY_THINK_TIME_SECONDS || 1);
const modeledRttMs = Number(__ENV.EDGELAB_CAPACITY_NETWORK_RTT_MS || 0);
const allowSharedUsers = parseBoolean(__ENV.EDGELAB_CAPACITY_ALLOW_SHARED_USERS, false);
const requestWallMs = new Trend("request_wall_ms", true);
const responseErrors = new Rate("response_errors");
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
if (!["constant", "ramping"].includes(profile)) {
  throw new Error("EDGELAB_CAPACITY_PROFILE must be constant or ramping");
}
for (const [name, value] of Object.entries({ p95ThresholdMs, p99ThresholdMs, thinkTimeSeconds, modeledRttMs })) {
  if (!Number.isFinite(value) || value < 0 || (name.startsWith("p") && value === 0)) {
    throw new Error(`${name} must be a finite ${name.startsWith("p") ? "positive" : "nonnegative"} number`);
  }
}
if (!Number.isFinite(maxErrorRate) || maxErrorRate <= 0 || maxErrorRate > 1) {
  throw new Error("EDGELAB_CAPACITY_MAX_ERROR_RATE must be in (0, 1]");
}
if (new Set(authTokens).size !== authTokens.length) {
  throw new Error("Duplicate auth tokens do not represent distinct benchmark users");
}
if (!allowSharedUsers && authTokens.length < configuredMaxVus()) {
  throw new Error("Supply one distinct user's auth token per VU; shared identities require EDGELAB_CAPACITY_ALLOW_SHARED_USERS=true");
}
if (sessionIds.length && sessionIds.length !== authTokens.length) {
  throw new Error("Session IDs must align one-to-one with auth tokens in the same order");
}
if (includeReplayAdvance && (!sessionIds.length || new Set(sessionIds).size !== sessionIds.length || allowSharedUsers)) {
  throw new Error("Replay mutations require one distinct session and user per VU");
}

export const options = {
  summaryTrendStats: ["avg", "min", "med", "max", "p(95)", "p(99)"],
  scenarios: {
    e2e_capacity: buildScenario(),
  },
  thresholds: buildThresholds(),
};

export default function () {
  const token = authTokens[(__VU - 1) % authTokens.length];
  const sessionId = sessionIds.length ? sessionIds[(__VU - 1) % authTokens.length] : "";
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
    const response = timedRequest(() => http.get(frontendBaseUrl, {
      tags: { endpoint: "frontend_root" },
    }), "frontend_root");
    check(response, {
      "frontend root is available": (res) => res.status >= 200 && res.status < 400,
    });
    responseErrors.add(response.status < 200 || response.status >= 400, { endpoint: "frontend_root" });
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
  const sustainedCapacityTest = profile === "constant" && !allowSharedUsers && durationSeconds(__ENV.K6_DURATION || "2m") >= 30;
  const wallP95 = metricValue(data, "request_wall_ms", "p(95)");
  const wallP99 = metricValue(data, "request_wall_ms", "p(99)");
  const failedThresholds = Object.entries(data.metrics).flatMap(([name, metric]) =>
    Object.entries(metric.thresholds || {}).filter(([, result]) => !result.ok).map(([threshold]) => `${name}: ${threshold}`));
  for (const [name, thresholds] of Object.entries(buildThresholds())) {
    if (thresholds.some((threshold) => typeof data.metrics[name]?.thresholds?.[threshold]?.ok !== "boolean")) {
      failedThresholds.push(`${name}: missing threshold results`);
    }
  }
  const passed = requests > 0 && iterations > 0 && failedThresholds.length === 0
    && [failedRate, p95, p99, checksRate, wallP95, wallP99].every(Number.isFinite)
    && failedRate < maxErrorRate && p95 < p95ThresholdMs && p99 < p99ThresholdMs
    && wallP95 < p95ThresholdMs && wallP99 < p99ThresholdMs && checksRate > 0.99;

  const report = [
    "",
    "EdgeLab E2E capacity result",
    `  Status: ${passed ? "PASS" : "FAIL"}`,
    `  Tested concurrency: ${maxVus} VUs`,
    `  Distinct credential slots: ${Math.min(authTokens.length, maxVus)}; think time: ${thinkTimeSeconds}s/iteration`,
    `  Extra per-request RTT: ${modeledRttMs} ms (${modeledRttMs ? "modeled fixed delay, not measured RTT" : "none; observed transport timings are included"})`,
    `  Requests: ${requests}`,
    `  Iterations: ${iterations}`,
    `  Error rate: ${(failedRate * 100).toFixed(2)}%`,
    `  Check pass rate: ${(checksRate * 100).toFixed(2)}%`,
    `  HTTP p95: ${p95.toFixed(2)} ms`,
    `  HTTP p99: ${p99.toFixed(2)} ms`,
    `  Client wall p95/p99: ${wallP95.toFixed(2)} / ${wallP99.toFixed(2)} ms`,
    `  Requests/s: ${metricValue(data, "http_reqs", "rate").toFixed(2)}`,
    `  Connection / TLS / waiting p95: ${metricValue(data, "http_req_connecting", "p(95)").toFixed(2)} / ${metricValue(data, "http_req_tls_handshaking", "p(95)").toFixed(2)} / ${metricValue(data, "http_req_waiting", "p(95)").toFixed(2)} ms (waiting includes server work)`,
    `  Failed thresholds: ${failedThresholds.join("; ") || "none"}`,
    sustainedCapacityTest && passed
      ? `  Capacity statement: ${maxVus} concurrent synthetic credential slots passed this ${__ENV.K6_DURATION || "2m"} read/mutation mix; registered-user capacity is not measured.`
      : "  Capacity statement: no sustained distinct-user capacity established by this run; use passing constant-VU steps and verify load-generator headroom.",
    "",
  ].join("\n");

  const outputs = { stdout: report };
  if (summaryPath) {
    outputs[summaryPath] = JSON.stringify({ ...data, edgelab: {
      passed, profile, configured_vus: maxVus, distinct_credential_slots: Math.min(authTokens.length, maxVus),
      think_time_seconds: thinkTimeSeconds, modeled_extra_rtt_ms: modeledRttMs,
      sustained_capacity_test: sustainedCapacityTest, failed_thresholds: failedThresholds,
      generator_headroom: "not measured; monitor generator CPU and compare a separate generator before certifying capacity",
    } }, null, 2);
  }
  return outputs;
}

function getJson(path, params, endpoint) {
  const response = timedRequest(() => http.get(`${apiBaseUrl}${path}`, {
    ...params,
    tags: { endpoint },
  }), endpoint);
  checkJsonResponse(response, endpoint);
  return response;
}

function postJson(path, payload, params, endpoint) {
  const response = timedRequest(() => http.post(`${apiBaseUrl}${path}`, JSON.stringify(payload), {
    ...params,
    tags: { endpoint },
  }), endpoint);
  checkJsonResponse(response, endpoint);
  return response;
}

function checkJsonResponse(response, endpoint) {
  const ok = check(response, {
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
  responseErrors.add(!ok, { endpoint });
}

function timedRequest(request, endpoint) {
  const started = Date.now();
  if (modeledRttMs) sleep(modeledRttMs / 1000);
  const response = request();
  requestWallMs.add(Date.now() - started, { endpoint });
  return response;
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
    response_errors: [`rate<${maxErrorRate}`],
    http_req_failed: [`rate<${maxErrorRate}`],
    http_req_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
    request_wall_ms: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
  };
  const endpoints = ["bootstrap_shell", "bootstrap", "datasets", "backtests_summaries", "trades_page"];
  if (frontendBaseUrl) endpoints.push("frontend_root");
  if (includeAnalytics) endpoints.push("metrics_summary", "metrics_curves");
  if (includeMarketData) endpoints.push("market_data_meta", "market_data_bars");
  if (includeReplayAdvance) endpoints.push("replay_advance");
  if (includeSessionCreate) endpoints.push("session_create");
  for (const endpoint of endpoints) {
    thresholds[`http_req_duration{endpoint:${endpoint}}`] = [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`];
    thresholds[`request_wall_ms{endpoint:${endpoint}}`] = [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`];
    thresholds[`response_errors{endpoint:${endpoint}}`] = [`rate<${maxErrorRate}`];
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
  if (!Number.isInteger(maxVus) || maxVus < 1 || !Number.isInteger(stepVus) || stepVus < 1) {
    throw new Error("K6_MAX_VUS and K6_STEP_VUS must be positive integers");
  }
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
    const vus = Number(__ENV.K6_VUS || 20);
    if (!Number.isInteger(vus) || vus < 1) throw new Error("K6_VUS must be a positive integer");
    return vus;
  }
  const stages = parseStages();
  if (stages.some((stage) => !Number.isInteger(stage.target) || stage.target < 0 || !stage.duration)) {
    throw new Error("K6_STAGES must contain nonnegative integer targets and durations");
  }
  const vus = stages.reduce((max, stage) => Math.max(max, stage.target), 0);
  if (vus < 1) throw new Error("At least one stage must target positive VUs");
  return vus;
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
  return data.metrics[metricName]?.values?.[valueName] ?? NaN;
}

function durationSeconds(value) {
  const units = { ms: 0.001, s: 1, m: 60, h: 3600 };
  let seconds = 0;
  const remainder = value.replace(/(\d+(?:\.\d+)?)(ms|s|m|h)/g, (_match, amount, unit) => {
    seconds += Number(amount) * units[unit];
    return "";
  });
  return remainder ? NaN : seconds;
}
