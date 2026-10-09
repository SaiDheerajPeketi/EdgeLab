import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

// Actual hooks; only React scheduling and asynchronous transport are controlled.
// Transport deliberately ignores abort to test the hooks' publication fences.
const bundle = (await build({ entryPoints: ["frontend/src/components/chart/useMarketToolsData.ts"],
  bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
  plugins: [{ name: "market-tools-ownership-fixture", setup(builder) {
    builder.onResolve({ filter: /^react$|\/lib\/(api|authSession|marketInfrastructure)$/ }, args =>
      ({ path: args.path === "react" ? "react" : args.path.split("/").at(-1), namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "js", contents: {
      react: ['useState', 'useRef', 'useMemo', 'useEffect', 'useCallback', 'useSyncExternalStore'].map(name =>
        `export const ${name}=(...args)=>globalThis.fixture172.hooks.${name}(...args);`).join("\n"),
      api: 'export const getApiBearerToken=()=>globalThis.fixture172.session?.token??null;',
      authSession: 'export const getStoredAuthSession=()=>globalThis.fixture172.session; export const subscribeAuthSession=callback=>globalThis.fixture172.subscribe(callback);',
      marketInfrastructure: ['resolveMarketInstrument', 'getOrderBook', 'listMarketAlerts', 'listMarketAlertEvents', 'createMarketAlert', 'deleteMarketAlert', 'acknowledgeMarketAlertEvent'].map(name =>
        `export const ${name}=(...args)=>globalThis.fixture172.request(${JSON.stringify(name)},args);`).join("\n"),
    }[path] }));
  } }],
})).outputFiles[0].text;
console.info("MARKET_TOOLS172_BINDING " + JSON.stringify({ actualHooks: true, controlledReact: true,
  ignoredAbortTransport: true, bundleSha256: createHash("sha256").update(bundle).digest("hex") }));
const turn = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const instrument = (id = 1, symbol = "BTCUSDT") => ({ id, canonical_symbol: symbol, display_name: symbol, active: true });
const snapshot = (id = 1, price = 100) => ({ instrument_id: id, contract_id: null, provider: "controlled-provider", sequence: price,
  captured_at: "2026-10-10T00:00:00Z", status: "AVAILABLE", aggregation_tick_size: 1,
  levels: [{ side: "BID", price, size: 2, order_count: 1 }], message: null });
const rule = id => ({ id, instrument_id: id, name: `Rule ${id}`, alert_type: "PRICE_ABOVE", condition: { threshold: 100 }, enabled: true });
const event = id => ({ id, rule_id: id, instrument_id: id, message: `Event ${id}`, acknowledged_at: null });

function harness(kind = "book") {
  let cursor = 0, slots = [], pending = [], output, symbol = "BTCUSDT", aggregation = 1, depth = 20;
  const timers = new Set(), subscribers = new Set(), requests = [], writes = [], windowListeners = new Map(), identityEvents = [], storageEvents = [];
  const fixture = { session: { token: "owner-A", user: { id: 1 } }, subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    request(name, args) { const entry = { name, args, signal: args.find(arg => arg?.signal)?.signal, ...defer() }; requests.push(entry); return entry.promise; },
    hooks: {
      useState(initial) { const index = cursor++; slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, next => { writes.push(index); slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }]; },
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useMemo(factory, deps) { const index = cursor++; const previous = slots[index]; if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) slots[index] = { value: factory(), deps }; return slots[index].value; },
      useCallback(callback, deps) { return fixture.hooks.useMemo(() => callback, deps); },
      useEffect(effect, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        slots[index] = { deps, cleanup: previous?.cleanup }; pending.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      } },
      useSyncExternalStore(subscribe, get) { const index = cursor++; if (!slots[index]) slots[index] = { cleanup: subscribe(() => {}) }; return get(); },
    },
  };
  const previous = { fixture: globalThis.fixture172, window: globalThis.window, document: globalThis.document };
  globalThis.fixture172 = fixture;
  const window = new EventTarget(), add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (name, callback, options) => { if (!windowListeners.has(name)) windowListeners.set(name, new Set()); windowListeners.get(name).add(callback); add(name, callback, options); };
  window.removeEventListener = (name, callback, options) => { windowListeners.get(name)?.delete(callback); remove(name, callback, options); };
  window.setInterval = callback => { timers.add(callback); return callback; }; window.clearInterval = callback => timers.delete(callback);
  globalThis.window = window;
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  const loaded = { exports: {} }; new Function("require", "module", "exports", bundle)(createRequire(import.meta.url), loaded, loaded.exports);
  const render = (next = {}) => { symbol = next.symbol ?? symbol; aggregation = next.aggregation ?? aggregation; depth = next.depth ?? depth; cursor = 0;
    output = kind === "book" ? loaded.exports.useOrderBookData(symbol, aggregation, depth) : loaded.exports.useMarketAlertsData(symbol); return output; };
  const commit = () => { const effects = pending; pending = []; effects.forEach(effect => effect()); };
  const unmount = () => { slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); pending = []; };
  return { fixture, requests, writes, timers, subscribers, windowListeners, render, commit, unmount,
    latest(name) { const entry = requests.filter(request => request.name === name).at(-1); assert.ok(entry, `Missing ${name}`); return entry; },
    auth(id, token = `owner-${id}`, options = {}) {
      const previousIdentity = fixture.session ? `${fixture.session.user.id}:${fixture.session.token}` : "";
      fixture.session = { token, user: { id } };
      if (options.notify !== false) [...subscribers].forEach(callback => callback());
      if (previousIdentity !== `${id}:${token}`) {
        const dispatch = () => window.dispatchEvent(new Event("edgelab:auth-session-change"));
        if (options.delayIdentity) identityEvents.push(dispatch); else dispatch();
      } },
    clearStorage(options = {}) { fixture.session = null; const event = new Event("storage"); Object.defineProperty(event, "key", { value: null });
      const dispatch = () => window.dispatchEvent(event); if (options.delayEvent) storageEvents.push(dispatch); else dispatch(); },
    dispatchIdentity() { assert.ok(identityEvents.length); identityEvents.shift()(); },
    dispatchStorageClear() { assert.ok(storageEvents.length); storageEvents.shift()(); },
    poll() { [...timers].forEach(callback => callback()); },
    async cleanup() { unmount(); await turn(); globalThis.fixture172 = previous.fixture; globalThis.window = previous.window; globalThis.document = previous.document; },
  };
}
async function begin(h) { h.render(); h.commit(); await turn(); }
async function seedBook(h, id = 1, symbol = "BTCUSDT", price = 100) {
  await begin(h); h.latest("resolveMarketInstrument").resolve(instrument(id, symbol)); await turn();
  h.latest("getOrderBook").resolve(snapshot(id, price)); await turn(); const output = h.render();
  assert.equal(output.snapshot.levels[0].price, price); return output;
}
async function finishAlerts(h, id = 1, symbol = "BTCUSDT") {
  h.latest("resolveMarketInstrument").resolve(instrument(id, symbol)); h.latest("listMarketAlerts").resolve([rule(id)]);
  h.latest("listMarketAlertEvents").resolve([event(id)]); await turn(); return h.render();
}
async function seedAlerts(h, id = 1, symbol = "BTCUSDT") { await begin(h); return finishAlerts(h, id, symbol); }

test("symbol change hides book and instrument before cleanup and old ignored-abort responses cannot publish", async () => {
  const h = harness(); try {
    await seedBook(h); const pending = h.render().refresh(); await turn(); const old = h.latest("getOrderBook");
    const changed = h.render({ symbol: "ETHUSDT" }); assert.equal(changed.instrument, null); assert.equal(changed.snapshot, null);
    old.resolve(snapshot(1, 999)); await pending; await turn(); assert.equal(h.render().snapshot, null);
    h.commit(); await turn(); h.latest("resolveMarketInstrument").resolve(instrument(2, "ETHUSDT")); await turn();
    h.latest("getOrderBook").resolve(snapshot(2, 200)); await turn(); assert.equal(h.render().snapshot.instrument_id, 2);
  } finally { await h.cleanup(); }
});

test("aggregation and depth own the snapshot and are passed to the actual transport boundary", async () => {
  const h = harness(); try {
    await seedBook(h); assert.equal(h.render({ aggregation: 5, depth: 50 }).snapshot, null); h.commit(); await turn();
    const resolve = h.latest("resolveMarketInstrument"); resolve.resolve(instrument()); await turn();
    const request = h.latest("getOrderBook"); assert.equal(request.args[1].aggregationTicks, 5); assert.equal(request.args[1].depth, 50);
    request.resolve(snapshot(1, 150)); await turn(); assert.equal(h.render().snapshot.levels[0].price, 150);
  } finally { await h.cleanup(); }
});

for (const retired of ["success", "failure"]) test(`a newer forced manual refresh wins over old ${retired} while ordinary polling remains single flight`, async () => {
  const h = harness(); try {
    await seedBook(h); const first = h.render().refresh(); await turn(); const old = h.latest("getOrderBook");
    h.poll(); h.poll(); await turn(); assert.equal(h.latest("getOrderBook"), old);
    const second = h.render().refresh(); await turn(); const latest = h.latest("getOrderBook"); assert.notEqual(latest, old);
    assert.ok(old.signal.aborted); latest.resolve(snapshot(1, 200)); await second;
    if (retired === "success") old.resolve(snapshot(1, 999)); else old.reject(new Error("Retired failure"));
    await first; await turn();
    assert.equal(h.render().snapshot.levels[0].price, 200); assert.equal(h.render().error, null);
  } finally { await h.cleanup(); }
});

test("symbol ABA cannot revive a pending callback from the first generation", async () => {
  const h = harness(); try {
    await seedBook(h); const pending = h.render().refresh(); await turn(); const old = h.latest("getOrderBook");
    h.render({ symbol: "ETHUSDT" }); h.render({ symbol: "BTCUSDT" }); old.resolve(snapshot(1, 999)); await pending;
    assert.notEqual(h.render().snapshot?.levels[0].price, 999);
  } finally { await h.cleanup(); }
});

test("auth change hides book before cleanup and durable auth ABA retires old pending work", async () => {
  const h = harness(); try {
    await seedBook(h); const pending = h.render().refresh(); await turn(); const old = h.latest("getOrderBook");
    h.auth(2, "owner-B"); assert.equal(h.render().instrument, null); assert.equal(h.render().snapshot, null);
    h.auth(1, "owner-A"); old.resolve(snapshot(1, 999)); await pending; await turn(); assert.equal(h.render().snapshot, null);
  } finally { await h.cleanup(); }
});

test("instrument mismatch is a visible failure and cannot masquerade as a valid owned book", async () => {
  const h = harness(); try {
    await begin(h); h.latest("resolveMarketInstrument").resolve(instrument()); await turn(); h.latest("getOrderBook").resolve(snapshot(2, 200)); await turn();
    const output = h.render(); assert.equal(output.state, "error"); assert.equal(output.snapshot, null); assert.match(output.error, /instrument|symbol|match/i);
  } finally { await h.cleanup(); }
});

test("late resolve after unmount triggers no book request and no publication and cancels owned work", async () => {
  const h = harness(); try {
    await begin(h); const old = h.latest("resolveMarketInstrument"); h.unmount(); const count = h.writes.length;
    old.resolve(instrument()); await turn(); assert.equal(h.requests.filter(request => request.name === "getOrderBook").length, 0);
    assert.equal(h.writes.length, count); assert.equal(h.timers.size, 0); assert.equal(h.subscribers.size, 0); assert.ok(old.signal.aborted);
  } finally { await h.cleanup(); }
});

test("alert lists are account-global while symbol lookup is separately owned and hidden synchronously", async () => {
  const h = harness("alerts"); try {
    const seeded = await seedAlerts(h), generation = seeded.generation;
    const changed = h.render({ symbol: "ETHUSDT" }); assert.equal(changed.instrument, null);
    assert.equal(changed.generation, generation); assert.deepEqual(changed.rules.map(rule => rule.id), [1]); assert.deepEqual(changed.events.map(event => event.id), [1]);
    h.commit(); await turn(); h.latest("resolveMarketInstrument").resolve(instrument(2, "ETHUSDT")); await turn();
    assert.equal(h.render().instrument.id, 2); assert.equal(h.requests.filter(request => request.name === "listMarketAlerts").length, 1);
  } finally { await h.cleanup(); }
});

test("alert owner change hides all rows before cleanup and old list success or rejection cannot restore them", async () => {
  const h = harness("alerts"); try {
    await seedAlerts(h); h.poll(); await turn(); const oldRules = h.latest("listMarketAlerts"), oldEvents = h.latest("listMarketAlertEvents");
    h.auth(2, "owner-B"); const changed = h.render(); assert.deepEqual(changed.rules, []); assert.deepEqual(changed.events, []); assert.equal(changed.instrument, null);
    oldRules.resolve([rule(999)]); oldEvents.reject(new Error("Retired events failure")); await turn();
    assert.deepEqual(h.render().rules, []); assert.equal(h.render().error, null);
  } finally { await h.cleanup(); }
});

for (const [method, endpoint] of [["remove", "deleteMarketAlert"], ["acknowledge", "acknowledgeMarketAlertEvent"]])
  test(`${method} failure is recoverable, preserves rows and polling success cannot erase its error`, async () => {
    const h = harness("alerts"); try {
      await seedAlerts(h); const pending = h.render()[method](1); await turn(); h.latest(endpoint).reject(new Error("Provider mutation unavailable"));
      assert.equal(await pending, false); assert.match(h.render().error, /Provider mutation unavailable/); assert.equal(h.render().busy, null);
      assert.deepEqual(h.render().rules.map(rule => rule.id), [1]); assert.deepEqual(h.render().events.map(event => event.id), [1]);
      h.poll(); await turn(); h.latest("listMarketAlerts").resolve([rule(1)]); h.latest("listMarketAlertEvents").resolve([event(1)]); await turn();
      assert.match(h.render().error, /Provider mutation unavailable/);
      const retry = h.render()[method](1); await turn(); h.latest(endpoint).resolve(method === "remove" ? { ok: true } : { ...event(1), acknowledged_at: "2026-10-10T00:01:00Z" });
      await turn(); h.latest("listMarketAlerts").resolve(method === "remove" ? [] : [rule(1)]); h.latest("listMarketAlertEvents").resolve(method === "acknowledge" ? [] : [event(1)]);
      assert.equal(await retry, true); assert.equal(h.render().error, null); assert.equal(h.render().busy, null);
    } finally { await h.cleanup(); }
  });

test("mutations are serial and an old owner's finally cannot clear the replacement owner's busy state", async () => {
  const h = harness("alerts"); try {
    await seedAlerts(h); const oldMutation = h.render().remove(1); await turn(); const old = h.latest("deleteMarketAlert");
    const before = h.requests.length; assert.equal(await h.render().acknowledge(1), false); assert.equal(h.requests.length, before);
    h.auth(2, "owner-B"); h.render(); h.commit(); await turn(); await finishAlerts(h, 2, "BTCUSDT");
    const nextMutation = h.render().remove(2); await turn(); const next = h.latest("deleteMarketAlert"), busy = h.render().busy;
    assert.ok(busy); old.resolve({ ok: true }); assert.equal(await oldMutation, false); assert.equal(h.render().busy, busy);
    next.reject(new Error("Current owner failure")); assert.equal(await nextMutation, false); assert.equal(h.render().busy, null); assert.match(h.render().error, /Current owner failure/);
  } finally { await h.cleanup(); }
});

test("alert auth ABA invalidates pending delivery data and unmount cancels lists without late state writes", async () => {
  const h = harness("alerts"); try {
    await seedAlerts(h); h.poll(); await turn(); const oldRules = h.latest("listMarketAlerts"), oldEvents = h.latest("listMarketAlertEvents");
    h.auth(2, "owner-B"); h.auth(1, "owner-A"); assert.deepEqual(h.render().events, []);
    h.unmount(); const count = h.writes.length; oldRules.resolve([rule(999)]); oldEvents.resolve([event(999)]); await turn();
    assert.equal(h.writes.length, count); assert.equal(h.timers.size, 0); assert.equal(h.subscribers.size, 0); assert.ok(oldRules.signal.aborted); assert.ok(oldEvents.signal.aborted);
  } finally { await h.cleanup(); }
});

for (const kind of ["book", "alerts"]) for (const transition of ["silent auth ABA", "storage clear and restore"])
  test(`${kind} durable ${transition} retires pending responses before any React render`, async () => {
    const h = harness(kind); try {
      if (kind === "book") await seedBook(h); else await seedAlerts(h);
      let pending;
      if (kind === "book") { pending = h.render().refresh(); await turn(); } else { h.poll(); await turn(); }
      const old = h.latest(kind === "book" ? "getOrderBook" : "listMarketAlertEvents");
      if (transition === "silent auth ABA") h.auth(2, "owner-B", { notify: false }); else h.clearStorage();
      h.auth(1, "owner-A", { notify: false });
      const before = h.render(); assert.equal(before.instrument, null);
      if (kind === "book") { assert.equal(before.snapshot, null); old.resolve(snapshot(1, 999)); await pending; }
      else { assert.deepEqual(before.events, []); assert.equal(before.eventsReady, false); h.latest("listMarketAlerts").resolve([rule(999)]); old.resolve([event(999)]); }
      await turn(); const output = h.render();
      if (kind === "book") assert.equal(output.snapshot, null); else assert.deepEqual(output.events, []);
      h.unmount(); assert.equal([...h.windowListeners.values()].reduce((sum, entries) => sum + entries.size, 0), 0);
    } finally { await h.cleanup(); }
  });

test("same-identity session refresh notifies subscribers without an identity transition and retains pending ownership", async () => {
  const h = harness(); try {
    await seedBook(h); const pending = h.render().refresh(); await turn(); const request = h.latest("getOrderBook");
    h.auth(1, "owner-A"); request.resolve(snapshot(1, 200)); await pending; await turn();
    assert.equal(h.render().snapshot.levels[0].price, 200); assert.equal(request.signal.aborted, false);
  } finally { await h.cleanup(); }
});

test("eventsReady stays false after an initial partial list failure and becomes true only with a successful complete receipt", async () => {
  const h = harness("alerts"); try {
    await begin(h); assert.equal(h.render().eventsReady, false);
    h.latest("resolveMarketInstrument").resolve(instrument());
    h.latest("listMarketAlertEvents").resolve([event(7)]); h.latest("listMarketAlerts").reject(new Error("Initial rules unavailable")); await turn();
    assert.equal(h.render().eventsReady, false); assert.deepEqual(h.render().events, []); assert.match(h.render().error, /Initial rules unavailable/);
    h.poll(); await turn(); h.latest("listMarketAlerts").resolve([rule(7)]); h.latest("listMarketAlertEvents").resolve([event(7)]); await turn();
    const output = h.render(); assert.equal(output.eventsReady, true); assert.deepEqual(output.events.map(item => item.id), [7]); assert.equal(output.error, null);
    h.auth(2, "owner-B", { notify: false }); assert.equal(h.render().eventsReady, false);
  } finally { await h.cleanup(); }
});

for (const kind of ["book", "alerts"]) for (const delayed of ["identity transition", "storage clear"])
  test(`${kind} retires the old generation when a delayed ${delayed} arrives after storage has already returned to A`, async () => {
    const h = harness(kind); try {
      if (kind === "book") await seedBook(h); else await seedAlerts(h);
      let pending;
      if (kind === "book") { pending = h.render().refresh(); await turn(); } else { h.poll(); await turn(); }
      const old = h.latest(kind === "book" ? "getOrderBook" : "listMarketAlertEvents");
      if (delayed === "identity transition") h.auth(2, "owner-B", { notify: false, delayIdentity: true });
      else h.clearStorage({ delayEvent: true });
      h.auth(1, "owner-A", { notify: false, delayIdentity: true });
      assert.equal(h.fixture.session.user.id, 1); assert.equal(h.fixture.session.token, "owner-A");
      // Deliver a real transition signal after the getter again reports A,
      // without any intervening React render or ordinary auth notification.
      if (delayed === "identity transition") h.dispatchIdentity(); else h.dispatchStorageClear();
      const retired = h.render(); assert.equal(retired.instrument, null);
      if (kind === "book") { assert.equal(retired.snapshot, null); old.resolve(snapshot(1, 999)); await pending; }
      else { assert.deepEqual(retired.events, []); assert.equal(retired.eventsReady, false);
        h.latest("listMarketAlerts").resolve([rule(999)]); old.resolve([event(999)]); }
      await turn(); const output = h.render();
      if (kind === "book") assert.equal(output.snapshot, null); else assert.deepEqual(output.events, []);
    } finally { await h.cleanup(); }
  });
