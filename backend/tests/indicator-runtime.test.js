import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const runtimeUrl = new URL("../../frontend/src/lib/indicatorRuntime.ts", import.meta.url).href;
const bundle = buildSync({
  bundle: true,
  define: { "import.meta.url": JSON.stringify(runtimeUrl) },
  format: "esm",
  logLevel: "silent",
  platform: "node",
  stdin: {
    contents: 'export * from "./frontend/src/lib/indicatorRuntime.ts";',
    loader: "ts",
    resolveDir: repoRoot,
    sourcefile: "indicator-runtime-entry.ts",
  },
  target: "node22",
  write: false,
}).outputFiles[0].text;
const runtime = await import(
  `data:text/javascript;base64,${Buffer.from(bundle + "\n//# sourceURL=indicator-runtime-bundle.js").toString("base64")}`,
);

const request = {
  bars: [{ time: 1_700_000_000, open: 10, high: 11, low: 9, close: 10, volume: 100 }],
  inputs: { period: 3 },
  mode: "historical",
  source: 'indicator "Runtime fixture" pane\nplot "Close" = close color "#ffffff"',
};
const result = {
  audit: { bars: 1, mode: "historical", operations: 1, plots: 1, sourceBytes: 77 },
  diagnostics: [],
  inputs: { period: 3 },
  name: "Runtime fixture",
  overlay: false,
  plots: [{ color: "#ffffff", name: "Close", points: [{ time: 1_700_000_000, value: 10 }] }],
};

async function withHarness(options, run) {
  const previousWorker = globalThis.Worker;
  const previousWindow = globalThis.window;
  const workers = [];
  const constructorCalls = [];
  const timers = [];
  const pendingTimers = new Map();
  const clearedTimers = [];
  class FakeWorker {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    requests = [];
    terminateCalls = 0;

    constructor(url, workerOptions) {
      constructorCalls.push({ url, options: workerOptions });
      if (options.constructorThrows) throw new Error("Worker construction failed");
      workers.push(this);
    }

    postMessage(value) {
      if (options.postMessageThrows) throw new Error("Worker postMessage failed");
      this.requests.push(value);
    }

    terminate() {
      this.terminateCalls += 1;
    }
  }
  globalThis.Worker = options.unavailable ? undefined : FakeWorker;
  globalThis.window = {
    setTimeout(callback, delay) {
      const id = timers.length + 1;
      timers.push({ callback, delay, id });
      pendingTimers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      clearedTimers.push(id);
      pendingTimers.delete(id);
    },
  };
  const harness = { workers, constructorCalls, timers, pendingTimers, clearedTimers };
  try {
    await run(harness);
  } finally {
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

function observeSettlement(job) {
  let settlements = 0;
  const observed = job.promise.then(
    () => { settlements += 1; },
    () => { settlements += 1; },
  );
  return { count: () => settlements, observed };
}

function assertReleased(harness, expectedWorkers = 1) {
  assert.equal(harness.workers.length, expectedWorkers);
  assert.equal(harness.pendingTimers.size, 0);
  assert.equal(harness.clearedTimers.length, expectedWorkers ? 1 : 0);
  for (const worker of harness.workers) {
    assert.equal(worker.terminateCalls, 1);
    assert.equal(worker.onmessage, null);
    assert.equal(worker.onerror, null);
    assert.equal(worker.onmessageerror, null);
  }
}

function assertFailure(promise, code, message) {
  return assert.rejects(promise, (error) => {
    assert.ok(error instanceof runtime.IndicatorWorkerError);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    return true;
  });
}

test("worker success preserves the request and releases all resources exactly once", async () => {
  await withHarness({}, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    const settlement = observeSettlement(job);
    const worker = harness.workers[0];
    assert.equal(harness.constructorCalls[0].url.href, new URL("../workers/indicatorRuntime.worker.ts", runtimeUrl).href);
    assert.deepEqual(harness.constructorCalls[0].options, { name: "EdgeLab indicator runtime", type: "module" });
    assert.deepEqual(worker.requests, [{ ...request, id: job.id }]);
    assert.equal(harness.timers[0].delay, 1_200);
    const message = worker.onmessage;
    message({ data: { id: "unrelated-job", result, status: "completed" } });
    await Promise.resolve();
    assert.equal(settlement.count(), 0);
    assert.equal(worker.terminateCalls, 0);
    message({ data: { id: job.id, result, status: "completed" } });
    assert.equal(await job.promise, result);
    await settlement.observed;
    message({ data: { id: job.id, error: { code: "LATE", message: "late" }, status: "failed" } });
    harness.timers[0].callback();
    job.cancel();
    job.cancel();
    await Promise.resolve();
    assert.equal(settlement.count(), 1);
    assertReleased(harness);
  });
});

test("DSL worker failures preserve their code and message and clean up", async () => {
  await withHarness({}, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    const settlement = observeSettlement(job);
    harness.workers[0].onmessage({
      data: { error: { code: "OPERATION_LIMIT", message: "Operation budget exceeded" }, id: job.id, status: "failed" },
    });
    await assertFailure(job.promise, "OPERATION_LIMIT", "Operation budget exceeded");
    await settlement.observed;
    job.cancel();
    assert.equal(settlement.count(), 1);
    assertReleased(harness);
  });
});

test("worker error events clean up and preserve the browser failure message", async () => {
  await withHarness({}, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    harness.workers[0].onerror({ message: "Worker crashed" });
    await assertFailure(job.promise, "WORKER_ERROR", "Worker crashed");
    assertReleased(harness);
  });
});

test("unreadable worker messages reject instead of leaving jobs pending", async () => {
  await withHarness({}, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    harness.workers[0].onmessageerror({});
    await assertFailure(job.promise, "WORKER_ERROR", "The isolated indicator worker returned an unreadable result.");
    assertReleased(harness);
  });
});

for (const [mode, limit] of [["live", 350], ["historical", 1_200]]) {
  test(`${mode} runtime enforces its ${limit} ms limit and cleans up on timeout`, async () => {
    await withHarness({}, async (harness) => {
      const job = runtime.createIndicatorRuntimeJob({ ...request, mode });
      const settlement = observeSettlement(job);
      const worker = harness.workers[0];
      const lateMessage = worker.onmessage;
      assert.equal(worker.requests[0].mode, mode);
      assert.equal(harness.timers[0].delay, limit);
      harness.timers[0].callback();
      await assertFailure(job.promise, "TIME_LIMIT", `Indicator worker exceeded its ${limit} ms time limit.`);
      await settlement.observed;
      lateMessage({ data: { id: job.id, result, status: "completed" } });
      job.cancel();
      assert.equal(settlement.count(), 1);
      assertReleased(harness);
    });
  });
}

test("repeated cancellation and queued late callbacks settle and terminate only once", async () => {
  await withHarness({}, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    const settlement = observeSettlement(job);
    const worker = harness.workers[0];
    const lateMessage = worker.onmessage;
    const lateError = worker.onerror;
    const lateUnreadable = worker.onmessageerror;
    job.cancel();
    job.cancel();
    await assertFailure(job.promise, "CANCELLED", "Indicator execution was cancelled.");
    await settlement.observed;
    lateMessage({ data: { id: job.id, result, status: "completed" } });
    lateError({ message: "Late worker error" });
    lateUnreadable({});
    harness.timers[0].callback();
    await Promise.resolve();
    assert.equal(settlement.count(), 1);
    assertReleased(harness);
  });
});

test("constructor failures return rejected jobs without leaking timers", async () => {
  await withHarness({ constructorThrows: true }, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    const settlement = observeSettlement(job);
    await assertFailure(job.promise, "WORKER_ERROR", "Worker construction failed");
    job.cancel();
    job.cancel();
    await settlement.observed;
    assert.equal(settlement.count(), 1);
    assert.equal(harness.constructorCalls.length, 1);
    assert.equal(harness.timers.length, 0);
    assertReleased(harness, 0);
  });
});

test("postMessage failures clear the installed handlers and timer", async () => {
  await withHarness({ postMessageThrows: true }, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    const settlement = observeSettlement(job);
    await assertFailure(job.promise, "WORKER_ERROR", "Worker postMessage failed");
    job.cancel();
    harness.timers[0].callback();
    await settlement.observed;
    assert.equal(settlement.count(), 1);
    assertReleased(harness);
  });
});

test("unavailable workers reject with a stable code and harmless cancellation", async () => {
  await withHarness({ unavailable: true }, async (harness) => {
    const job = runtime.createIndicatorRuntimeJob(request);
    const settlement = observeSettlement(job);
    await assertFailure(job.promise, "WORKER_UNAVAILABLE", "This browser cannot start the isolated indicator worker.");
    job.cancel();
    job.cancel();
    await settlement.observed;
    assert.equal(settlement.count(), 1);
    assert.equal(harness.constructorCalls.length, 0);
    assert.equal(harness.timers.length, 0);
    assertReleased(harness, 0);
  });
});
