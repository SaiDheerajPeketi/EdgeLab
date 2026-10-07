import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

// Run the production hook with controlled React scheduling and provider I/O.
// A render can deliberately precede effect cleanup, as in real React transitions.
const bundle = (await build({ entryPoints: ["frontend/src/components/chart/usePaneMarketData.ts"],
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
  plugins: [{ name: "ownership-fixtures", setup(builder) {
    builder.onResolve({ filter: /^(react)$|\/lib\/(api|authSession|charting|marketInfrastructure)$/ }, args =>
      ({ path: args.path === "react" ? "react" : args.path.split("/").at(-1), namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: {
      react: "export const useState=(...args)=>globalThis.fixture.hooks.useState(...args); export const useRef=(...args)=>globalThis.fixture.hooks.useRef(...args); export const useMemo=(...args)=>globalThis.fixture.hooks.useMemo(...args); export const useEffect=(...args)=>globalThis.fixture.hooks.useEffect(...args); export const useSyncExternalStore=(_subscribe,get)=>get();",
      api: "export const getApiBearerToken=()=>globalThis.fixture.session.token;",
      authSession: "export const getStoredAuthSession=()=>globalThis.fixture.session; export const subscribeAuthSession=()=>()=>{};",
      charting: "export const getTimeframeSeconds=tf=>({'1m':60,'5m':300}[tf]);",
      marketInfrastructure: "export const resolveMarketInstrument=(...args)=>globalThis.fixture.resolve(...args); export const loadNormalizedCandles=(...args)=>globalThis.fixture.load(...args); export const createMarketSubscription=(...args)=>globalThis.fixture.create(...args); export const deleteMarketSubscription=(...args)=>globalThis.fixture.remove(...args);",
    }[path], loader: "js" }));
  } }],
})).outputFiles[0].text;
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const bar = close => ({ time: 1700000000, open: close, high: close, low: close, close, volume: 1 });
const pane = (symbol = "BTCUSDT", timeframe = "1m", extra = {}) => ({ id: "same-pane", symbol, timeframe, ...extra });

function harness() {
  let cursor = 0, pending = [], slots = [], result, panes = [pane()], enabled = true;
  const timers = new Set(), requests = [], created = [], deleted = [];
  const fixture = { session: { token: "owner-seven", user: { id: 7 } },
    resolve: async symbol => ({ id: symbol === "BTCUSDT" ? 1 : 2, canonical_symbol: symbol }),
    create: async payload => { created.push(payload); return { subscription_id: `lease-${created.length}` }; },
    remove: async (id, owner) => { deleted.push({ id, token: owner.token }); },
    load: (id, interval, window) => { const request = { id, interval, window, ...defer() }; requests.push(request); return request.promise; },
    hooks: {
      useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }]; },
      useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
      useMemo(factory, deps) { const index = cursor++; const slot = slots[index]; if (!slot || deps.some((dep, i) => !Object.is(dep, slot.deps[i]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useEffect(effect, deps) { const index = cursor++; const slot = slots[index]; if (!slot || deps.some((dep, i) => !Object.is(dep, slot.deps[i]))) {
        slots[index] = { deps, cleanup: slot?.cleanup }; pending.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      } },
    },
  };
  globalThis.fixture = fixture;
  const savedWindow = globalThis.window, savedDocument = globalThis.document;
  globalThis.window = { setInterval: callback => { timers.add(callback); return callback; }, clearInterval: callback => timers.delete(callback) };
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle)(createRequire(import.meta.url), loaded, loaded.exports);
  return { fixture, requests, created, deleted,
    render(next = panes, nextEnabled = enabled) { panes = next; enabled = nextEnabled; cursor = 0; result = loaded.exports.usePaneMarketData(panes, enabled); return result; },
    commit() { const effects = pending; pending = []; effects.forEach(effect => effect()); },
    poll() { timers.forEach(callback => callback()); },
    async cleanup() { slots.forEach(slot => slot.cleanup?.()); await turn(); globalThis.window = savedWindow; globalThis.document = savedDocument; delete globalThis.fixture; },
  };
}

async function seed(h) {
  h.render(); h.commit(); await turn();
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve([bar(100)]); await turn();
  assert.equal(h.render()["same-pane"].bars[0].close, 100);
}

test("new symbol hides old bars before cleanup and rejects an old pending refresh", async () => {
  const h = harness(); try {
    await seed(h); h.poll(); await turn(); const old = h.requests[1];
    assert.deepEqual(h.render([pane("ETHUSDT")])["same-pane"].bars, []);
    old.resolve([bar(999)]); await turn();
    assert.deepEqual(h.render()["same-pane"].bars, []);
    h.commit(); await turn(); h.requests[2].reject(new Error("ETH unavailable")); await turn();
    const output = h.render()["same-pane"];
    assert.equal(output.status, "error"); assert.deepEqual(output.bars, []);
  } finally { await h.cleanup(); }
});

test("timeframe and requested history window are part of source ownership", async () => {
  const h = harness(); try {
    await seed(h);
    const changed = [pane("BTCUSDT", "5m", { fromAt: "2026-10-01T00:00:00Z", toAt: "2026-10-02T00:00:00Z" })];
    assert.deepEqual(h.render(changed)["same-pane"].bars, []); h.commit(); await turn();
    assert.equal(h.requests[1].interval, 300);
    assert.equal(h.requests[1].window.from.toISOString(), new Date(changed[0].fromAt).toISOString());
    h.requests[1].resolve([bar(200)]); await turn();
    assert.equal(h.render()["same-pane"].bars[0].close, 200);
    assert.deepEqual(h.render([pane("BTCUSDT", "5m", { ...changed[0], fromAt: "2026-09-30T00:00:00Z" })])["same-pane"].bars, []);
  } finally { await h.cleanup(); }
});

test("owner or token change invalidates bars, callbacks and shared leases before effects", async () => {
  const h = harness(); try {
    await seed(h); h.poll(); await turn(); const old = h.requests[1];
    h.fixture.session = { token: "owner-eight", user: { id: 8 } };
    assert.deepEqual(h.render()["same-pane"].bars, []);
    old.resolve([bar(999)]); await turn(); assert.deepEqual(h.render()["same-pane"].bars, []);
    h.commit(); await turn(); assert.equal(h.created.length, 2); assert.deepEqual(h.deleted, [{ id: "lease-1", token: "owner-seven" }]);
    h.requests[2].resolve([bar(80)]); await turn(); assert.equal(h.render()["same-pane"].bars[0].close, 80);
    h.fixture.session = { token: "renewed-owner-eight", user: { id: 8 } };
    assert.deepEqual(h.render()["same-pane"].bars, []);
  } finally { await h.cleanup(); }
});

test("switch away and back cannot revive a prior generation's callback", async () => {
  const h = harness(); try {
    await seed(h); h.poll(); await turn(); const old = h.requests[1];
    h.render([pane("ETHUSDT")]); h.render([pane()]);
    old.resolve([bar(999)]); await turn();
    assert.equal(h.render()["same-pane"].bars[0].close, 100);
  } finally { await h.cleanup(); }
});

test("disabled data is hidden synchronously and old refreshes cannot publish", async () => {
  const h = harness(); try {
    await seed(h); h.poll(); await turn(); const old = h.requests[1];
    assert.deepEqual(h.render(undefined, false), {}); old.resolve([bar(999)]); await turn();
    assert.deepEqual(h.render(), {});
    h.render(undefined, true); assert.equal(h.render()["same-pane"].bars[0].close, 100);
  } finally { await h.cleanup(); }
});

test("same-source transient failure preserves only its correctly labelled data", async () => {
  const h = harness(); try {
    await seed(h); h.poll(); await turn(); h.requests[1].reject(new Error("Temporary provider failure")); await turn();
    const output = h.render()["same-pane"];
    assert.equal(output.status, "error"); assert.equal(output.bars[0].close, 100);
  } finally { await h.cleanup(); }
});

test("delayed old creation releases only its distinct lease with its original owner", async () => {
  const h = harness(); try {
    const first = defer(), second = defer();
    h.fixture.create = payload => { h.created.push(payload); return h.created.length === 1 ? first.promise : second.promise; };
    h.render(); h.commit(); await turn();
    h.fixture.session = { token: "owner-eight", user: { id: 8 } };
    h.render([pane("ETHUSDT")]); h.commit(); await turn();
    assert.equal(h.created.length, 2);
    assert.notEqual(h.created[0].pane_id, h.created[1].pane_id);
    assert.ok(h.created.every(value => value.pane_id.length <= 64));
    second.resolve({ subscription_id: "replacement" }); await turn();
    assert.equal(h.requests.length, 1); h.requests[0].resolve([bar(200)]); await turn();
    first.resolve({ subscription_id: "retired" }); await turn();
    assert.deepEqual(h.deleted, [{ id: "retired", token: "owner-seven" }]);
    assert.equal(h.render()["same-pane"].bars[0].close, 200);
    assert.equal(h.requests.length, 1, "retired POST must not trigger a candle request");
  } finally { await h.cleanup(); }
});

const releaseBundle = (await build({ entryPoints: ["frontend/src/lib/marketInfrastructure.ts"],
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
  define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "/lease-api" }) },
})).outputFiles[0].text;

test("actual lease DELETE uses captured bearer and fixed API route after account switch", async () => {
  const previousFetch = globalThis.fetch, previousWindow = globalThis.window;
  const currentAccount = JSON.stringify({ token: "replacement-account", user: { id: 8, email: "eight@example.com" }, expiresAt: "2099-01-01" });
  globalThis.window = { localStorage: { getItem: () => currentAccount } };
  const requests = [];
  globalThis.fetch = async (url, init) => { requests.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) }; };
  const loaded = { exports: {} };
  try {
    new Function("require", "module", "exports", releaseBundle)(createRequire(import.meta.url), loaded, loaded.exports);
    assert.deepEqual(await loaded.exports.deleteMarketSubscription("original/id", { token: "original-owner" }), { ok: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/lease-api/market-data/subscriptions/original%2Fid");
    assert.equal(requests[0].init.method, "DELETE");
    assert.equal(new Headers(requests[0].init.headers).get("Authorization"), "Bearer original-owner");
    await assert.rejects(loaded.exports.deleteMarketSubscription("", { token: "original-owner" }), /required/);
    await assert.rejects(loaded.exports.deleteMarketSubscription("original", { token: null }), /required/);
    assert.equal(requests.length, 1, "invalid cleanup must never send a request");
  } finally { globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
});
