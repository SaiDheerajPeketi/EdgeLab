import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build, buildSync } from "esbuild";

const require = createRequire(import.meta.url);
const storeBundle = buildSync({ entryPoints: ["frontend/src/store/backtestStore.ts"], bundle: true,
  minify: true, format: "cjs", platform: "node", external: ["../lib/api"], write: false, logLevel: "silent" }).outputFiles[0].text;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key) };
}

// Only API transport is replaced; the real minified Zustand store, auth and data barrier execute.
function datasetsFixture(t) {
  const previousWindow = globalThis.window, storage = memoryStorage();
  const auth = (id = 1) => ({ token: `token-${id}`, expiresAt: "2099-01-01T00:00:00Z", user: { id, email: `user${id}@example.com` } });
  storage.setItem("edgelab.auth.session.v1", JSON.stringify(auth()));
  globalThis.window = { localStorage: storage, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.window = previousWindow; });
  const calls = [], server = { root: "/old", instruments: [{ id: "EURUSD", currency: "USD", timezone: "UTC", pnl_multiplier: 1 }] };
  let autoComplete = false;
  const token = () => JSON.parse(storage.getItem("edgelab.auth.session.v1") ?? "null")?.token ?? null;
  function send(method, update, result = () => structuredClone(server)) {
    update?.();
    const gate = deferred(), value = result();
    calls.push({ method, token: token(), gate, value });
    if (autoComplete) gate.resolve(value);
    return gate.promise;
  }
  const api = {
    ApiError: class extends Error {}, getApiBearerToken: token,
    patchDatasetSettings: payload => send("root", () => { server.root = payload.root_path; }),
    patchDatasetAsset: (id, payload) => send("asset", () => Object.assign(server.instruments.find(item => item.id === id), payload)),
    refreshDatasets: () => send("refresh", null, () => ({ catalog: structuredClone(server), status: { running: false } })),
    getDatasetRefreshStatus: () => send("status", null, () => ({ running: false })),
    getDatasets: () => send("catalog"),
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", storeBundle)(name => name === "../lib/api" ? api : require(name), loaded, loaded.exports);
  return { store: loaded.exports.useBacktestStore, calls, server, storage,
    finish(index) { calls[index].gate.resolve(calls[index].value); },
    switchOwner(id) { storage.setItem("edgelab.auth.session.v1", JSON.stringify(auth(id))); },
    autoComplete() { autoComplete = true; } };
}

test("dataset root and calibration dispatch in order, preserving the newer acknowledged calibration", async t => {
  const h = datasetsFixture(t), actions = h.store.getState();
  const root = actions.updateDatasetSettings({ root_path: "/new" });
  const asset = actions.updateDatasetAsset("EURUSD", { currency: "EUR" });
  await flush();
  assert.deepEqual(h.calls.map(call => call.method), ["root"]);
  assert.equal(h.server.instruments[0].currency, "USD", "Queued writes must not dispatch early");
  h.finish(0); await root; await flush();
  assert.deepEqual(h.calls.map(call => call.method), ["root", "asset"]);
  h.finish(1); await asset;
  assert.equal(h.store.getState().datasets.instruments[0].currency, "EUR");
  assert.deepEqual(h.store.getState().datasets, h.server);
});

test("status and its catalog read settle before a later calibration can dispatch", async t => {
  const h = datasetsFixture(t), actions = h.store.getState();
  const status = actions.refreshDatasetStatus();
  const asset = actions.updateDatasetAsset("EURUSD", { currency: "EUR" });
  await flush(); h.finish(0); await flush();
  assert.deepEqual(h.calls.map(call => call.method), ["status", "catalog"]);
  h.finish(1); await status; await flush();
  assert.equal(h.calls[2].method, "asset");
  h.finish(2); await asset;
  assert.equal(h.store.getState().datasets.instruments[0].currency, "EUR");
});

test("refresh catalog publication cannot overtake a later root update", async t => {
  const h = datasetsFixture(t), actions = h.store.getState();
  const refresh = actions.refreshDatasets(), root = actions.updateDatasetSettings({ root_path: "/new" });
  await flush(); assert.deepEqual(h.calls.map(call => call.method), ["refresh"]);
  h.finish(0); await refresh; await flush(); h.finish(1); await root;
  assert.equal(h.store.getState().datasets.root, "/new");
  assert.equal(h.store.getState().isLoading, false);
});

test("a failed dataset operation releases its successor and successful recovery clears the error", async t => {
  const h = datasetsFixture(t), actions = h.store.getState();
  const root = actions.updateDatasetSettings({ root_path: "/new" });
  const rejected = assert.rejects(root, /offline/);
  const asset = actions.updateDatasetAsset("EURUSD", { currency: "EUR" });
  await flush(); h.calls[0].gate.reject(Error("offline")); await rejected; await flush();
  assert.equal(h.calls[1].method, "asset");
  h.finish(1); await asset;
  assert.equal(h.store.getState().error, null);
  assert.equal(h.store.getState().datasets.instruments[0].currency, "EUR");
});

for (const boundary of ["account", "data-generation"]) {
  test(`dataset ${boundary} changes reject old publication and queued dispatch`, async t => {
    const h = datasetsFixture(t), actions = h.store.getState();
    const root = actions.updateDatasetSettings({ root_path: "/new" });
    const oldRoot = assert.rejects(root, /Account data changed/);
    const queued = actions.updateDatasetAsset("EURUSD", { currency: "EUR" });
    const oldQueued = assert.rejects(queued, /Account data changed/);
    await flush();
    if (boundary === "account") h.switchOwner(2);
    else h.storage.setItem("edgelab.app-data-generation.v1.user-1", JSON.stringify({ revision: "replacement", phase: "ready" }));
    h.store.setState({ datasets: { root: "/current-owner", instruments: [] }, error: "current error", isLoading: false });
    const current = boundary === "account" ? h.store.getState().updateDatasetAsset("EURUSD", { currency: "GBP" }) : null;
    await flush(); assert.equal(h.calls.length, 1, "New-owner requests also wait for the already dispatched request");
    h.finish(0); await Promise.all([oldRoot, oldQueued]);
    assert.equal(h.calls.filter(call => call.method === "asset" && call.token === "token-1").length, 0);
    assert.equal(h.store.getState().datasets.root, "/current-owner");
    assert.equal(h.store.getState().error, "current error");
    if (boundary === "account") {
      await flush(); assert.equal(h.calls[1].token, "token-2");
      h.finish(1); await current;
      assert.equal(h.store.getState().datasets.instruments[0].currency, "GBP");
    }
  });
}

test("the dataset dispatch queue bounds pending requests and drains after settlement", async t => {
  const h = datasetsFixture(t), actions = h.store.getState();
  const requests = Array.from({ length: 32 }, (_, index) => actions.updateDatasetAsset("EURUSD", { pnl_multiplier: index + 1 }));
  await assert.rejects(actions.updateDatasetAsset("EURUSD", { currency: "EUR" }), /busy/);
  await flush(); assert.equal(h.calls.length, 1);
  h.autoComplete(); h.finish(0); await Promise.all(requests);
  assert.equal(h.calls.length, 32);
  assert.equal(h.store.getState().datasets.instruments[0].pnl_multiplier, 32);
  await actions.updateDatasetAsset("EURUSD", { currency: "EUR" });
  assert.equal(h.store.getState().datasets.instruments[0].currency, "EUR");
});

// Execute the unchanged bundled hook; React scheduling, private draft persistence and API I/O are seams.
async function chartFixture(t) {
  const fixture = { effects: [], edits: {}, fail: true, held: null, writes: [] };
  const previous = globalThis.__chartSettings90, previousWindow = globalThis.window;
  globalThis.__chartSettings90 = fixture;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { globalThis.__chartSettings90 = previous; globalThis.window = previousWindow; });
  const seams = { name: "chart-settings-runtime-seams", setup(builder) {
    builder.onResolve({ filter: /^react$|\/(api|authSession|journalDrafts|serverStorage)$/ }, args => ({ path: args.path, namespace: "chart90" }));
    builder.onLoad({ filter: /.*/, namespace: "chart90" }, args => {
      const code = args.path === "react" ? `export const useEffect=fn=>globalThis.__chartSettings90.effects.push(fn);export const useSyncExternalStore=(sub,get)=>get();`
        : args.path.endsWith("/api") ? `export const getChartSettings=()=>Promise.resolve(globalThis.__chartSettings90.response());export const patchChartSettings=changes=>{const f=globalThis.__chartSettings90;f.writes.push(changes);return f.held?f.held.promise:f.fail?Promise.reject(Error("offline")):Promise.resolve(f.response(changes));};`
        : args.path.endsWith("/authSession") ? `export const getStoredAuthSession=()=>({user:{id:1}});export const subscribeAuthSession=()=>()=>{};`
        : args.path.endsWith("/serverStorage") ? `export const confirmAppStorageOperations=async(ops,request)=>request();export const getCachedAppStorageItem=()=>null;export const loadAppStorageItem=()=>Promise.resolve(null);export const saveAppStorageItem=()=>{};export const subscribeAppStorageItem=()=>()=>{};`
        : `export const useJournalDraft=(surface,base)=>[{...base,...globalThis.__chartSettings90.edits},update=>{const f=globalThis.__chartSettings90;const next=typeof update==="function"?update({...base,...f.edits}):update;f.edits=Object.fromEntries(Object.keys(base).filter(key=>next[key]!==base[key]).map(key=>[key,next[key]]));},(fields,submitted)=>{const f=globalThis.__chartSettings90;for(const key of fields)if(f.edits[key]===submitted[key])delete f.edits[key];}];`;
      return { contents: code, loader: "js" };
    });
  } };
  fixture.response = (changes = {}) => ({ active: { namespace: "edgelab", key: "active-chart-settings-preset.v1", value: "Settings default" },
    presets: { namespace: "edgelab", key: "chart-settings-presets.v1", value: [{ name: "Settings default", settings: changes }] } });
  const output = await build({ entryPoints: ["frontend/src/components/settings/useChartSettings.ts"], bundle: true, minify: true, write: false, format: "cjs", platform: "node", logLevel: "silent", plugins: [seams] });
  const loaded = { exports: {} };
  new Function("module", "exports", output.outputFiles[0].text)(loaded, loaded.exports);
  const render = loaded.exports.useChartSettings;
  render(); fixture.effects.shift()(); await flush();
  return { fixture, render };
}

test("chart failure feedback disappears after reverting and returns only for the same failed draft", async t => {
  const { render } = await chartFixture(t);
  let settings = render(), originalGrid = settings.defaults.gridMode;
  settings.change({ gridMode: "none" }); await render().save();
  assert.equal(render().saveState, "error");
  render().change({ gridMode: originalGrid });
  assert.equal(render().dirty, false); assert.equal(render().saveState, "idle");
  render().change({ gridMode: "horizontal" }); assert.equal(render().saveState, "idle");
  render().change({ gridMode: "none" }); assert.equal(render().saveState, "error");
});

test("a delayed chart failure preserves later edits without assigning the old error to them", async t => {
  const { fixture, render } = await chartFixture(t);
  fixture.held = deferred(); render().change({ gridMode: "none" });
  const save = render().save();
  render().change({ textSize: "14" }); fixture.held.reject(Error("offline")); await save;
  assert.equal(render().draft.textSize, "14"); assert.equal(render().dirty, true); assert.equal(render().saveState, "idle");
  fixture.held = null; fixture.fail = false; await render().save();
  assert.equal(render().draft.textSize, "14"); assert.equal(render().dirty, false); assert.equal(render().saveState, "saved");
});
