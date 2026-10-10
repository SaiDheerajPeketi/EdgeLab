import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../../benchmark/k6/e2e-capacity.js", import.meta.url), "utf8")
  .replace(/^import .*;$/gm, "")
  .replace("export default function ()", "function iteration()")
  .replace(/export (const|function) /g, "$1 ");

function harness(env = {}) {
  let elapsed = 0;
  const samples = [];
  const calls = [];
  class Metric {
    constructor(name) { this.name = name; }
    add(value, tags) { samples.push({ name: this.name, value, tags }); }
  }
  const response = { status: 200, body: "{}" };
  const context = vm.createContext({
    __ENV: { EDGELAB_CAPACITY_PROFILE: "constant", K6_VUS: "2", EDGELAB_AUTH_TOKENS: "owner-1,owner-2", ...env },
    __VU: 1, __ITER: 0,
    Date: { now: () => elapsed }, Trend: Metric, Rate: Metric,
    http: {
      get(url, params) { calls.push({ url, params }); elapsed += 10; return response; },
      post(url, payload, params) { calls.push({ url, payload, params }); elapsed += 10; return response; },
    },
    check: (res, checks) => Object.values(checks).every((check) => check(res)),
    group: (_name, callback) => callback(), sleep: (seconds) => { elapsed += seconds * 1000; },
  });
  vm.runInContext(`${source}\n globalThis.harness = { options, iteration, handleSummary };`, context);
  return { ...context.harness, samples, calls, context };
}

function passingData(options) {
  const metrics = Object.fromEntries(Object.entries(options.thresholds).map(([name, thresholds]) => [name, {
    thresholds: Object.fromEntries(thresholds.map((threshold) => [threshold, { ok: true }])),
    values: { "p(95)": 100, "p(99)": 200, rate: 0 },
  }]));
  metrics.checks.values.rate = 1;
  metrics.http_reqs = { values: { count: 100, rate: 20 } };
  metrics.iterations = { values: { count: 10 } };
  return { metrics };
}

test("distinct credentials and aligned sessions are admitted before traffic", () => {
  assert.throws(() => harness({ EDGELAB_AUTH_TOKENS: "owner-1" }), /one distinct user's auth token per VU/);
  assert.throws(() => harness({ EDGELAB_AUTH_TOKENS: "owner-1,owner-1" }), /Duplicate auth tokens/);
  assert.throws(() => harness({ EDGELAB_SESSION_IDS: "101" }), /one-to-one/);
  assert.throws(() => harness({ EDGELAB_INCLUDE_REPLAY_ADVANCE: "true" }), /distinct session and user/);
  assert.throws(() => harness({ EDGELAB_CAPACITY_PROFILE: "ramping", K6_STEP_VUS: "0" }), /positive integers/);
});

test("p99 and all endpoint SLOs are required; any failed or missing result prevents PASS", () => {
  const runner = harness();
  assert.ok(runner.options.summaryTrendStats.includes("p(99)"));
  assert.deepEqual(Array.from(runner.options.thresholds["http_req_duration{endpoint:market_data_bars}"]), ["p(95)<750", "p(99)<1500"]);
  const data = passingData(runner.options);
  assert.match(runner.handleSummary(data).stdout, /Status: PASS/);
  data.metrics["http_req_duration{endpoint:bootstrap_shell}"].thresholds["p(95)<750"].ok = false;
  assert.match(runner.handleSummary(data).stdout, /Status: FAIL/);
  delete data.metrics["http_req_duration{endpoint:bootstrap_shell}"];
  assert.match(runner.handleSummary(data).stdout, /missing threshold results/);
  delete data.metrics.http_req_duration.values["p(99)"];
  assert.match(runner.handleSummary(data).stdout, /Status: FAIL/);
});

test("modeled RTT is counted in wall latency and session identity stays paired", () => {
  const runner = harness({ EDGELAB_CAPACITY_NETWORK_RTT_MS: "125", EDGELAB_SESSION_IDS: "101,202" });
  runner.context.__VU = 2;
  runner.iteration();
  const wallSamples = runner.samples.filter(({ name }) => name === "request_wall_ms");
  assert.equal(wallSamples.length, 9);
  assert.ok(wallSamples.every(({ value }) => value === 135));
  const bars = runner.calls.find(({ url }) => url.includes("/market-data/bars"));
  assert.match(bars.url, /session_id=202/);
  assert.equal(bars.params.headers.Authorization, "Bearer owner-2");
  assert.match(runner.handleSummary(passingData(runner.options)).stdout, /modeled fixed delay, not measured RTT/);
});

test("ramping and shared-account runs cannot claim sustained distinct-user capacity", () => {
  const ramp = harness({ EDGELAB_CAPACITY_PROFILE: "ramping", K6_STAGES: "2:30s,0:1s" });
  assert.match(ramp.handleSummary(passingData(ramp.options)).stdout, /no sustained distinct-user capacity established/);
  const shared = harness({ EDGELAB_AUTH_TOKENS: "owner-1", EDGELAB_CAPACITY_ALLOW_SHARED_USERS: "true" });
  assert.match(shared.handleSummary(passingData(shared.options)).stdout, /no sustained distinct-user capacity established/);
  const smoke = harness({ K6_DURATION: "5s" });
  assert.match(smoke.handleSummary(passingData(smoke.options)).stdout, /no sustained distinct-user capacity established/);
});

test("sweep defaults to loopback and fails its process after the first failed step", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-sweep209-"));
  try {
    fs.writeFileSync(path.join(directory, "k6"), '#!/bin/sh\nprintf "%s" "$EDGELAB_API_BASE_URL" > "$SWEEP_OBSERVED_URL"\n[ "$K6_VUS" -lt 10 ]\n', { mode: 0o700 });
    const observed = path.join(directory, "observed-url");
    const result = spawnSync("bash", ["benchmark/run-capacity-sweep.sh"], { encoding: "utf8", env: {
      ...process.env, PATH: `${directory}:${process.env.PATH}`, EDGELAB_API_BASE_URL: "", EDGELAB_FRONTEND_BASE_URL: "",
      EDGELAB_AUTH_TOKENS: "test-credentials", EDGELAB_CAPACITY_VUS_STEPS: "5 10 20",
      EDGELAB_CAPACITY_RESULTS_DIR: path.join(directory, "results"), SWEEP_OBSERVED_URL: observed,
      EDGELAB_CAPACITY_ALLOW_SHARED_USERS: "false",
    } });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(fs.readFileSync(observed, "utf8"), "http://127.0.0.1:8080/api");
    assert.match(result.stdout, /Last passing distinct-credential concurrency: 5 VUs/);
    assert.match(result.stdout, /First failing concurrency: 10 VUs/);
    assert.doesNotMatch(result.stdout, /step: 20/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
