import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildSync } from "esbuild";

const storePath = "frontend/src/store/backtestStore.ts";
const bundle = buildSync({
  entryPoints: [storePath],
  bundle: true,
  minify: true,
  format: "cjs",
  platform: "node",
  external: ["../lib/api"],
  write: false,
  logLevel: "silent",
}).outputFiles[0].text;
const require = createRequire(import.meta.url);
const receiptDirectory = process.env.EDGELAB_REPLAY_SESSION_ARTIFACTS;
const binding = {
  storeSha256: createHash("sha256").update(fs.readFileSync(storePath)).digest("hex"),
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  seam: "Only the API transport is controlled; the actual minified store and genuine Zustand are bundled unchanged.",
};

// API transport errors retain the real exported ApiError shape.
class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function candle(id) {
  return { timestamp: `2026-10-08T00:0${id}:00Z`, open: id * 100, high: id * 100 + 2,
    low: id * 100 - 2, close: id * 100 + 1, volume: id,
    ema_20: null, ema_50: null, rsi_14: null };
}

function candleAtOffset(id, offset) {
  const index = offset - id * 10;
  return {
    ...candle(id),
    timestamp: new Date(Date.parse(candle(id).timestamp) + index * 60000).toISOString(),
    open: id * 100 + index,
    high: id * 100 + index + 2,
    low: id * 100 + index - 2,
    close: id * 100 + index + 1,
  };
}

function replay(id) {
  return {
    session: { id, name: `Session ${id}`, symbol: `SYMBOL${id}`, instrument: null,
      timeframe: "M1", csv_path: `/datasets/session-${id}.csv`, currency: "USD",
      timezone: "UTC", pnl_multiplier: 1, strategy_name: null, playbook_id: null,
      start_at: null, end_at: null, start_offset: id * 10, end_offset: id * 10 + 4,
      status: "ACTIVE", current_offset: id * 10, replay_ready: true,
      initial_balance: 10000, realized_pnl: 0, default_commission_mode: "FIXED",
      default_commission_value: 0, default_fee_mode: "FIXED", default_fee_value: 0,
      created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z" },
    current_candle: candle(id), position: null, orders: [], executions: [], trades: [],
    metrics: { net_pnl: 0, win_rate: 0, total_trades: 0, winning_trades: 0,
      breakeven_trades: 0, open_trades: 0, profit_factor: null, gross_pnl: 0,
      total_commissions: 0, total_fees: 0, max_drawdown: 0, recovery_factor: null,
      sharpe_ratio: null, average_r: null, average_hold_minutes: null,
      average_win: null, average_loss: null, expectancy: null, best_trade: null,
      worst_trade: null, longest_win_streak: 0, longest_loss_streak: 0,
      equity_curve: [], strategy_performance: [], side_breakdown: [], calendar: [] },
  };
}

function fixture() {
  const calls = [];
  const states = new Map([1, 2].map(id => [id, deferred()]));
  const metadata = new Map([1, 2].map(id => [id, deferred()]));
  const windows = new Map([1, 2].map(id => [id, deferred()]));
  const shell = { playbooks: [], recent_sessions: [replay(1).session, replay(2).session],
    recent_sessions_next_offset: 2, recent_sessions_next_cursor: null,
    recent_sessions_has_more: false, strategy_summaries: [] };
  const api = {
    ApiError,
    getApiBearerToken() { return null; },
    getBacktest(id) { calls.push({ method: "getBacktest", id }); return states.get(id).promise; },
    getMeta(id) { calls.push({ method: "getMeta", id }); return metadata.get(id).promise; },
    getBars(offset, limit, id) {
      calls.push({ method: "getBars", id, offset, limit });
      return windows.get(id).promise;
    },
    async getBootstrapShell() { calls.push({ method: "getBootstrapShell" }); return shell; },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle)(specifier => {
    if (specifier === "../lib/api") return api;
    return require(specifier);
  }, loaded, loaded.exports);
  return { store: loaded.exports.useBacktestStore, states, metadata, windows, calls };
}

const flush = async () => {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
};

function snapshot(store) {
  const current = store.getState();
  return structuredClone({ state: current.state, meta: current.meta, bars: current.bars,
    barOffset: current.barOffset, error: current.error, isLoading: current.isLoading,
    isPlaying: current.isPlaying, pendingReplaySyncOffset: current.pendingReplaySyncOffset,
    replaySeekVersion: current.replaySeekVersion });
}

function completeHydration(harness, id) {
  harness.metadata.get(id).resolve({ csv_path: `/datasets/session-${id}.csv`, rows: 5,
    first_timestamp: candle(id).timestamp, last_timestamp: candle(id).timestamp });
  harness.windows.get(id).resolve({ bars: [candle(id)] });
}

async function selectedAndHydrated(harness, id) {
  const request = harness.store.getState().loadSession(id);
  harness.states.get(id).resolve(replay(id));
  completeHydration(harness, id);
  assert.equal(await request, true);
  await flush();
  const current = snapshot(harness.store);
  assert.equal(current.state.session.id, id);
  assert.equal(current.meta.csv_path, `/datasets/session-${id}.csv`);
  assert.deepEqual(current.bars, [candle(id)]);
  assert.equal(current.barOffset, id * 10);
  assert.equal(current.isLoading, false);
  assert.equal(current.error, null);
  return current;
}

function receipt(name, harness, observations) {
  if (!receiptDirectory) return;
  fs.mkdirSync(receiptDirectory, { recursive: true });
  fs.writeFileSync(path.join(receiptDirectory, name + ".json"), JSON.stringify({
    binding, calls: harness.calls, observations,
  }, null, 2));
}

test("a delayed initial session response cannot replace the newer hydrated selection", { timeout: 3000 }, async () => {
  const harness = fixture();
  const oldRequest = harness.store.getState().loadSession(1);
  const newer = await selectedAndHydrated(harness, 2);
  harness.states.get(1).resolve(replay(1));
  assert.equal(await oldRequest, false);
  const afterInitial = snapshot(harness.store);
  completeHydration(harness, 1);
  await flush();
  const afterHydration = snapshot(harness.store);
  receipt("late-initial-success", harness, { newer, afterInitial, afterHydration });
  assert.deepEqual(afterInitial, newer);
  assert.deepEqual(afterHydration, newer);
  assert.equal(harness.calls.filter(call => call.method === "getMeta" && call.id === 1).length, 0);
  assert.equal(harness.calls.filter(call => call.method === "getBars" && call.id === 1).length, 0);
});

test("a delayed initial session error cannot clear or relabel the newer selection", { timeout: 3000 }, async () => {
  const harness = fixture();
  const oldRequest = harness.store.getState().loadSession(1);
  const newer = await selectedAndHydrated(harness, 2);
  harness.states.get(1).reject(new Error("Session 1 transport failed"));
  assert.equal(await oldRequest, false);
  await flush();
  const afterError = snapshot(harness.store);
  receipt("late-initial-error", harness, { newer, afterError });
  assert.deepEqual(afterError, newer);
});

test("older hydration cannot publish or settle loading while a newer selection awaits its initial response", { timeout: 3000 }, async () => {
  const harness = fixture();
  const oldRequest = harness.store.getState().loadSession(1);
  harness.states.get(1).resolve(replay(1));
  await flush();
  const newerRequest = harness.store.getState().loadSession(2);
  const pendingNewer = snapshot(harness.store);
  assert.equal(pendingNewer.isLoading, true);
  completeHydration(harness, 1);
  assert.equal(await oldRequest, false);
  await flush();
  const afterOldHydration = snapshot(harness.store);
  harness.states.get(2).resolve(replay(2));
  completeHydration(harness, 2);
  assert.equal(await newerRequest, true);
  await flush();
  const completedNewer = snapshot(harness.store);
  receipt("late-hydration-during-selection", harness, { pendingNewer, afterOldHydration, completedNewer });
  assert.deepEqual(afterOldHydration, pendingNewer);
  assert.equal(completedNewer.state.session.id, 2);
  assert.deepEqual(completedNewer.bars, [candle(2)]);
  assert.equal(completedNewer.meta.csv_path, "/datasets/session-2.csv");
  assert.equal(completedNewer.error, null);
  assert.equal(completedNewer.isLoading, false);
});


function memoryStorage(values = new Map()) {
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key), clear: () => values.clear() };
}

function lifecycleFixture(t) {
  const previousWindow = globalThis.window;
  const localStorage = memoryStorage();
  const auth = (id = 1, token = "verified-session-1") => ({
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), token,
    user: { id, email: `owner${id}@example.test`, name: `Owner ${id}`, provider: "google",
      approved: true, betaPosition: null, deploymentMode: "production", workspaceAccess: true,
      accessExpiresAt: new Date(Date.now() + 300000).toISOString(), isBetaUser: false, plan: "pro" },
  });
  localStorage.setItem("edgelab.auth.session.v1", JSON.stringify(auth()));
  globalThis.window = { localStorage, sessionStorage: memoryStorage(), dispatchEvent() {},
    addEventListener() {}, removeEventListener() {}, navigator: {}, location: { origin: "http://localhost" } };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const calls = [];
  const waiting = new Map();
  const server = new Map([1, 2].map(id => [id, replay(id)]));
  const key = (method, id) => `${method}:${id ?? ""}`;
  function hold(method, id) {
    const value = deferred();
    const list = waiting.get(key(method, id)) ?? [];
    list.push(value);
    waiting.set(key(method, id), list);
    return value;
  }
  async function invoke(method, id, payload) {
    calls.push({ method, id, payload: structuredClone(payload) });
    const gate = waiting.get(key(method, id))?.shift();
    if (method === "updateBacktestSession") {
      Object.assign(server.get(id).session, payload);
      const captured = structuredClone(server.get(id).session);
      const delivered = gate ? await gate.promise : undefined;
      return delivered === undefined ? captured : structuredClone(delivered);
    }
    const override = gate ? await gate.promise : undefined;
    if (override !== undefined) return structuredClone(override);
    if (method === "getMeta") return { csv_path: `/datasets/session-${id}.csv`, rows: 5,
      first_timestamp: candle(id).timestamp, last_timestamp: candle(id).timestamp };
    if (method === "getBars") {
      const bars = Array.from({ length: 5 }, (_, index) => candleAtOffset(id, id * 10 + index));
      return { bars: bars.slice(payload.offset - id * 10, payload.offset - id * 10 + payload.limit) };
    }
    if (method === "createBacktest") server.set(id, replay(id));
    if (method === "deleteBacktestSession") { server.delete(id); return; }
    if (method === "jumpBacktest") {
      const state = server.get(id);
      state.session.current_offset = payload.offset ?? state.session.start_offset + 1;
      state.current_candle = candleAtOffset(id, state.session.current_offset);
    }
    if (method === "advanceBacktestCompact") {
      const state = server.get(id);
      state.session.current_offset += payload;
      state.current_candle = candleAtOffset(id, state.session.current_offset);
      return { ...structuredClone(state), history_changed: false, metrics_changed: false };
    }
    if (method === "postBacktestOrder") {
      server.get(id).orders.push({ id: 61, session_id: id, status: "PENDING", ...payload });
    }
    return structuredClone(server.get(id));
  }
  const api = {
    ApiError,
    getApiBearerToken: () => JSON.parse(localStorage.getItem("edgelab.auth.session.v1") ?? "null")?.token ?? null,
    getBacktest: id => invoke("getBacktest", id),
    getLatestBacktest: () => invoke("getLatestBacktest", 1),
    createBacktest: payload => invoke("createBacktest", 3, payload),
    getMeta: id => invoke("getMeta", id),
    getBars: (offset, limit, id) => invoke("getBars", id, { offset, limit }),
    jumpBacktest: (id, payload) => invoke("jumpBacktest", id, payload),
    advanceBacktestCompact: (id, steps) => invoke("advanceBacktestCompact", id, steps),
    postBacktestOrder: (id, payload) => invoke("postBacktestOrder", id, payload),
    deleteBacktestSession: id => invoke("deleteBacktestSession", id),
    updateBacktestSession: (id, payload) => invoke("updateBacktestSession", id, payload),
    async getBootstrapShell() { return { playbooks: [], recent_sessions: [...server.values()].map(state => state.session),
      recent_sessions_next_offset: server.size, recent_sessions_next_cursor: null,
      recent_sessions_has_more: false, strategy_summaries: [] }; },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle)(specifier => specifier === "../lib/api" ? api : require(specifier),
    loaded, loaded.exports);
  return { store: loaded.exports.useBacktestStore, calls, hold, server, localStorage,
    switchOwner(id, token) { localStorage.setItem("edgelab.auth.session.v1", JSON.stringify(auth(id, token))); } };
}

async function select(harness, id) {
  assert.equal(await harness.store.getState().loadSession(id), true);
  const current = snapshot(harness.store);
  assert.equal(current.state.session.id, id);
  assert.equal(current.meta.csv_path, `/datasets/session-${id}.csv`);
  assert.equal(current.bars.length, 5);
  assert.equal(current.bars[0].close, candle(id).close);
  assert.equal(current.bars[4].close, id * 100 + 5);
  assert.equal(current.isLoading, false);
  assert.equal(current.error, null);
  return current;
}

const count = (harness, method, id) => harness.calls.filter(call => call.method === method && call.id === id).length;

test("latest replay initialization loses ownership to an explicit fully hydrated selection", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  const initial = harness.hold("getLatestBacktest", 1);
  const latest = harness.store.getState().ensureLatestReplayLoaded();
  const newer = await select(harness, 2);
  initial.resolve();
  assert.equal(await latest, false);
  assert.deepEqual(snapshot(harness.store), newer);
  assert.equal(count(harness, "getMeta", 1), 0);
  receipt("latest-versus-explicit", harness, { newer, afterLatest: snapshot(harness.store) });
});

test("late failure cannot settle a newer initial request's loading", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  const first = harness.hold("getBacktest", 1);
  const second = harness.hold("getBacktest", 2);
  const old = harness.store.getState().loadSession(1);
  const current = harness.store.getState().loadSession(2);
  const pending = snapshot(harness.store);
  first.reject(new Error("Old session failed"));
  assert.equal(await old, false);
  assert.deepEqual(snapshot(harness.store), pending);
  assert.equal(harness.store.getState().isLoading, true);
  second.resolve();
  assert.equal(await current, true);
  assert.equal(harness.store.getState().state.session.id, 2);
  receipt("late-error-current-loading", harness, { pending, completed: snapshot(harness.store) });
});

for (const operation of ["seek", "step", "pause-sync"]) {
  test(`${operation} from an old session cannot publish after a newer selection`, { timeout: 3000 }, async t => {
    const harness = lifecycleFixture(t);
    await select(harness, 1);
    let gate, action;
    if (operation === "step") {
      // No finite local replay range: this exercises the real server advance path.
      harness.server.get(1).session.end_offset = null;
      harness.store.setState({ state: structuredClone(harness.server.get(1)) });
      gate = harness.hold("advanceBacktestCompact", 1);
      action = harness.store.getState().stepForward(1);
    } else {
      gate = harness.hold("jumpBacktest", 1);
      if (operation === "seek") action = harness.store.getState().jumpToOffset(13);
      else {
        harness.store.setState({ pendingReplaySyncOffset: 13, isPlaying: true });
        action = harness.store.getState().setPlaying(false);
      }
    }
    await flush();
    const newer = await select(harness, 2);
    gate.resolve();
    await action;
    await flush();
    assert.deepEqual(snapshot(harness.store), newer);
    assert.equal(harness.store.getState().isStepping, false);
    receipt(`old-${operation}`, harness, { newer, afterOld: snapshot(harness.store) });
  });
}

test("an order waiting for old pending sync cannot dispatch against the replacement session", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  harness.store.setState({ pendingReplaySyncOffset: 13 });
  const sync = harness.hold("jumpBacktest", 1);
  const order = harness.store.getState().placeOrder({ side: "BUY", quantity: 1, order_type: "MARKET" });
  await flush();
  const newer = await select(harness, 2);
  sync.resolve();
  assert.equal(await order, false);
  assert.equal(count(harness, "postBacktestOrder", 1), 0);
  assert.equal(count(harness, "postBacktestOrder", 2), 0);
  assert.deepEqual(snapshot(harness.store), newer);
  receipt("order-waiting-old-sync", harness, { newer, afterOrder: snapshot(harness.store) });
});

test("deleting the active session invalidates its held hydration", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  const meta = harness.hold("getMeta", 1);
  const bars = harness.hold("getBars", 1);
  const loading = harness.store.getState().loadSession(1);
  await flush();
  assert.equal(harness.store.getState().state.session.id, 1);
  await harness.store.getState().deleteSession(1);
  const deleted = snapshot(harness.store);
  assert.equal(deleted.state, null);
  meta.resolve();
  bars.resolve();
  assert.equal(await loading, false);
  assert.deepEqual(snapshot(harness.store), deleted);
  receipt("delete-held-hydration", harness, { deleted, afterHydration: snapshot(harness.store) });
});

test("returning A after selecting B waits for the already-sent A mutation and reads its real server state", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  const mutation = harness.hold("jumpBacktest", 1);
  const oldSeek = harness.store.getState().jumpToOffset(13);
  await flush();
  const newer = await select(harness, 2);
  const beforeReturnReads = count(harness, "getBacktest", 1);
  const returning = harness.store.getState().loadSession(1);
  await flush();
  assert.equal(count(harness, "getBacktest", 1), beforeReturnReads);
  assert.equal(harness.store.getState().isLoading, true);
  mutation.resolve();
  await oldSeek;
  assert.equal(await returning, true);
  assert.equal(harness.store.getState().state.session.id, 1);
  assert.equal(harness.store.getState().state.session.current_offset, 13);
  assert.equal(harness.server.get(1).session.current_offset, 13);
  receipt("return-after-sent-mutation", harness, { newer, returned: snapshot(harness.store) });
});

test("same-session queued seeks serialize and stale unsent seek is dropped without changing backend state", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  const first = harness.hold("jumpBacktest", 1);
  const oldest = harness.store.getState().jumpToOffset(11);
  await flush();
  const superseded = harness.store.getState().jumpToOffset(12);
  const newest = harness.store.getState().jumpToOffset(13);
  await flush();
  assert.equal(count(harness, "jumpBacktest", 1), 1);
  first.resolve();
  await Promise.all([oldest, superseded, newest]);
  assert.deepEqual(harness.calls.filter(call => call.method === "jumpBacktest").map(call => call.payload.offset), [11, 13]);
  assert.equal(harness.server.get(1).session.current_offset, 13);
  assert.equal(harness.store.getState().state.session.current_offset, 13);
  assert.equal(harness.store.getState().isLoading, false);
  receipt("serialized-seeks", harness, { completed: snapshot(harness.store), backendOffset: harness.server.get(1).session.current_offset });
});

for (const boundary of ["owner", "token", "data-epoch"]) {
  test(`actual account barrier rejects held session data after ${boundary} changes`, { timeout: 3000 }, async t => {
    const harness = lifecycleFixture(t);
    const initial = harness.hold("getBacktest", 1);
    const loading = harness.store.getState().loadSession(1);
    const pending = snapshot(harness.store);
    if (boundary === "owner") harness.switchOwner(2, "verified-session-2");
    if (boundary === "token") harness.switchOwner(1, "replacement-session-1");
    if (boundary === "data-epoch") harness.localStorage.setItem("edgelab.app-data-generation.v1.user-1",
      JSON.stringify({ revision: "changed-durable-epoch", phase: "ready" }));
    initial.resolve();
    assert.equal(await loading, false);
    assert.deepEqual(snapshot(harness.store), pending);
    assert.equal(count(harness, "getMeta", 1), 0);
    assert.equal(count(harness, "getBars", 1), 0);
    receipt(`account-${boundary}`, harness, { pending, afterStale: snapshot(harness.store) });
  });
}


test("the current initial failure returns false and owns its error/loading settlement", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  const response = harness.hold("getBacktest", 2);
  const loading = harness.store.getState().loadSession(2);
  response.reject(new Error("Current session is unavailable"));
  assert.equal(await loading, false);
  assert.equal(harness.store.getState().error, "Current session is unavailable");
  assert.equal(harness.store.getState().isLoading, false);
  assert.equal(harness.store.getState().state, null);
  assert.equal(count(harness, "getMeta", 2), 0);
});

test("no latest session settles once without publishing a replay", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  const latest = harness.hold("getLatestBacktest", 1);
  const loading = harness.store.getState().ensureLatestReplayLoaded();
  latest.reject(new ApiError(404, "No replay session", "No replay session"));
  assert.equal(await loading, false);
  assert.equal(harness.store.getState().isLoading, false);
  assert.equal(harness.store.getState().state, null);
  assert.equal(harness.store.getState().error, null);
  assert.equal(harness.store.getState().replayLoadAttempted, true);
  assert.equal(count(harness, "getLatestBacktest", 1), 1);
});

test("a newly created session cannot replace a later explicit selection", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  const response = harness.hold("createBacktest", 3);
  const creating = harness.store.getState().newSession({ name: "Created session", symbol: "SYMBOL3" });
  const newer = await select(harness, 2);
  response.resolve();
  assert.equal(await creating, false);
  assert.deepEqual(snapshot(harness.store), newer);
  assert.equal(count(harness, "getMeta", 3), 0);
  assert.equal(count(harness, "getBars", 3), 0);
  assert.equal(harness.server.get(3).session.id, 3);
});


test("an order cannot dispatch while an accepted seek awaits its candle window", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  const window = harness.hold("getBars", 1);
  const seeking = harness.store.getState().jumpToOffset(13);
  await flush();
  assert.equal(harness.server.get(1).session.current_offset, 13);
  assert.equal(harness.store.getState().isLoading, true);
  assert.equal(await harness.store.getState().placeOrder({ side: "BUY", quantity: 1, order_type: "MARKET" }), false);
  assert.equal(count(harness, "postBacktestOrder", 1), 0);
  window.resolve();
  await seeking;
  assert.equal(harness.store.getState().state.session.current_offset, 13);
  assert.equal(harness.store.getState().isLoading, false);
  receipt("order-during-seek-window", harness, { completed: snapshot(harness.store) });
});

test("a delayed pause sync cannot undo a newer same-session seek", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  harness.store.setState({ pendingReplaySyncOffset: 12, isPlaying: true });
  const sync = harness.hold("jumpBacktest", 1);
  harness.store.getState().setPlaying(false);
  await flush();
  assert.equal(count(harness, "jumpBacktest", 1), 1);
  const seeking = harness.store.getState().jumpToOffset(14);
  sync.resolve();
  await seeking;
  await flush();
  assert.deepEqual(harness.calls.filter(call => call.method === "jumpBacktest").map(call => call.payload.offset), [12, 14]);
  assert.equal(harness.server.get(1).session.current_offset, 14);
  assert.equal(harness.store.getState().state.session.current_offset, 14);
  assert.equal(harness.store.getState().pendingReplaySyncOffset, null);
  assert.equal(harness.store.getState().isLoading, false);
  assert.equal(harness.store.getState().isPlaying, false);
  receipt("pause-sync-versus-new-seek", harness, { completed: snapshot(harness.store) });
});

test("a renewed token for the same owner waits for its already-sent same-session mutation", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  const mutation = harness.hold("jumpBacktest", 1);
  const seeking = harness.store.getState().jumpToOffset(13);
  await flush();
  harness.switchOwner(1, "verified-session-1-renewed");
  const reads = count(harness, "getBacktest", 1);
  const loading = harness.store.getState().loadSession(1);
  await flush();
  assert.equal(count(harness, "getBacktest", 1), reads);
  assert.equal(harness.store.getState().isLoading, true);
  mutation.resolve();
  await seeking;
  assert.equal(await loading, true);
  assert.equal(harness.server.get(1).session.current_offset, 13);
  assert.equal(harness.store.getState().state.session.current_offset, 13);
  receipt("renewed-token-drains-mutation", harness, { completed: snapshot(harness.store) });
});


test("delayed metadata from offset 10 cannot rewind a newer seek to offset 13", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  const response = harness.hold("updateBacktestSession", 1);
  const editing = harness.store.getState().updateSession(1, { name: "Renamed A" });
  await flush();
  assert.equal(harness.server.get(1).session.name, "Renamed A");
  const seeking = harness.store.getState().jumpToOffset(13);
  await flush();
  assert.equal(count(harness, "jumpBacktest", 1), 0);
  response.resolve();
  const metadataResponse = await editing;
  assert.equal(metadataResponse.current_offset, 10);
  await seeking;
  const current = harness.store.getState();
  assert.equal(current.state.session.name, "Renamed A");
  assert.equal(current.state.session.current_offset, 13);
  assert.deepEqual(current.state.current_candle, candleAtOffset(1, 13));
  assert.equal(harness.server.get(1).session.current_offset, 13);
  assert.equal(current.isLoading, false);
  receipt("metadata-versus-seek", harness, { metadataResponse, completed: snapshot(harness.store) });
});

test("a delayed metadata error cannot relabel a newer selection or clear its loading", { timeout: 3000 }, async t => {
  const harness = lifecycleFixture(t);
  await select(harness, 1);
  const metadata = harness.hold("updateBacktestSession", 1);
  const editing = harness.store.getState().updateSession(1, { name: "Renamed A" });
  const rejected = assert.rejects(editing, /Old metadata failed/);
  await flush();
  const response = harness.hold("getBacktest", 2);
  const loading = harness.store.getState().loadSession(2);
  const pending = snapshot(harness.store);
  metadata.reject(new Error("Old metadata failed"));
  await rejected;
  assert.deepEqual(snapshot(harness.store), pending);
  assert.equal(harness.store.getState().isLoading, true);
  response.resolve();
  assert.equal(await loading, true);
  assert.equal(harness.store.getState().state.session.id, 2);
  assert.equal(harness.store.getState().error, null);
  receipt("metadata-error-new-selection", harness, { pending, completed: snapshot(harness.store) });
});
