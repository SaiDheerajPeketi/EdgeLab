import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// Real store and authentication helpers; only browser storage/events and delivery
// are controlled. Native event production is tested in pine-alert-events177.
const compiled = (await build({ bundle: true, platform: "node", format: "cjs", write: false,
  logLevel: "silent", stdin: { resolveDir: process.cwd(), loader: "ts", contents:
    'export * from "./frontend/src/lib/pineChartAlerts"; export {setStoredAuthSession,getStoredAuthSession} from "./frontend/src/lib/authSession";' },
})).outputFiles[0].text;
console.info("PINE_CHART_ALERT177_BINDING " + JSON.stringify({ actualStore: true, actualAuth: true,
  controlledBrowserEvents: true, bundleSha256: createHash("sha256").update(compiled).digest("hex") }));
const AUTH_KEY = "edgelab.auth.session.v1";
const session = (id = 1, token = `owner-${id}`) => ({ createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(), token,
  user: { id, email: `${id}@example.test`, name: `Owner ${id}`, approved: true, betaPosition: null,
    deploymentMode: "production", workspaceAccess: true, accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    isBetaUser: false, plan: "pro", provider: "google" } });
const event = (message = "Signal", id = "site-one", time = 180) => ({ id, message,
  freq: "all", time, barIndex: 2 });
const batch = (events = [event()], dropped = 0) => ({ events, dropped });
function browser() {
  const previous = globalThis.window, values = new Map(), listeners = new Map();
  const window = new EventTarget(), add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key), clear: () => values.clear() };
  window.addEventListener = (name, fn, options) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); add(name, fn, options); };
  window.removeEventListener = (name, fn, options) => { listeners.get(name)?.delete(fn); remove(name, fn, options); };
  globalThis.window = window;
  const module = { exports: {} }; new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), module, module.exports);
  const api = module.exports;
  api.setStoredAuthSession(session());
  return { api, window, values, listeners, storage(key, oldValue = null, newValue = null) {
    const incoming = new Event("storage"); Object.defineProperties(incoming, { key: { value: key }, oldValue: { value: oldValue }, newValue: { value: newValue } });
    window.dispatchEvent(incoming);
  }, restore() { globalThis.window = previous; } };
}
function harness(options = {}) {
  const b = browser(), deliveries = [], current = { epoch: 7, sequence: 10 }, ownership = { active: true };
  const store = new b.api.PineChartAlertStore({ ownsAccount: () => ownership.active,
    deliver: signal => { deliveries.push(signal); options.deliver?.(signal); }, now: () => 1000 });
  const register = (overrides = {}) => store.register({ name: "Actual study", symbol: "BINANCE:BTCUSDT", timeframe: "1m",
    readCurrent: () => ({ ...current }), owns: () => ownership.active, ...overrides });
  const ready = () => { const handle = register(); handle.setReady(); const id = store.getSnapshot().sources.at(-1).id;
    assert.equal(store.setEnabled(id, true), true); return { handle, id }; };
  return { ...b, store, deliveries, current, ownership, register, ready,
    close() { store.reset(); b.restore(); } };
}

test("arming excludes buffered current receipts and accepts only the owned epoch after its cutoff", () => {
  const h = harness(); try {
    const handle = h.register(), id = h.store.getSnapshot().sources[0].id;
    assert.equal(h.store.setEnabled(id, true), false);
    assert.equal(handle.capture(7, 11), undefined);
    handle.setReady(); assert.equal(h.store.setEnabled(id, true), true);
    assert.equal(handle.capture(7, 10), undefined);
    h.current.sequence = 11;
    const receipt = handle.capture(7, 11); assert.notEqual(receipt, undefined);
    handle.receive(receipt, batch());
    assert.equal(h.store.getSnapshot().events.length, 1); assert.equal(h.deliveries.length, 1);
    handle.receive(receipt, batch([event("Duplicated callback")]));
    assert.equal(h.store.getSnapshot().events.length, 1); assert.equal(h.deliveries.length, 1);
    assert.equal(handle.capture(6, 12), undefined); assert.equal(h.store.getSnapshot().sources[0].enabled, false);
  } finally { h.close(); }
});

test("off/on invalidates held receipt tokens without replaying old signals or advancing the chart", () => {
  const h = harness(); try {
    const { handle, id } = h.ready(); h.current.sequence = 11;
    const old = handle.capture(7, 11);
    assert.equal(h.store.setEnabled(id, false), true); assert.equal(h.store.setEnabled(id, true), true);
    handle.receive(old, batch([event("Old arm")])); assert.equal(h.store.getSnapshot().events.length, 0);
    assert.equal(handle.capture(7, 11), undefined);
    h.current.sequence = 12; const fresh = handle.capture(7, 12); handle.receive(fresh, batch([event("Fresh arm")]));
    assert.deepEqual(h.store.getSnapshot().events.map(value => value.message), ["Fresh arm"]);
    assert.equal(h.current.sequence, 12);
  } finally { h.close(); }
});

test("identical studies in two panes have independent handles and disposing one cannot stop the other", () => {
  const h = harness(); try {
    const first = h.ready(), second = h.ready(); assert.notEqual(first.id, second.id);
    h.current.sequence = 11; const old = first.handle.capture(7, 11), next = second.handle.capture(7, 11);
    first.handle.dispose(); first.handle.receive(old, batch([event("Removed pane")]));
    second.handle.receive(next, batch([event("Still visible pane")]));
    assert.deepEqual(h.store.getSnapshot().sources.map(value => value.id), [second.id]);
    assert.deepEqual(h.store.getSnapshot().events.map(value => value.sourceId), [second.id]);
  } finally { h.close(); }
});

test("disarming for context replacement requires readiness and explicit rearming again", () => {
  const h = harness(); try {
    const { handle, id } = h.ready(); h.current.sequence = 11; const old = handle.capture(7, 11);
    handle.disarm("Chart view changed."); handle.receive(old, batch());
    assert.equal(h.store.getSnapshot().events.length, 0); assert.equal(h.store.setEnabled(id, true), false);
    handle.setReady(); assert.equal(h.store.getSnapshot().sources[0].enabled, false);
    assert.equal(handle.capture(7, 12), undefined); assert.equal(h.store.setEnabled(id, true), true);
    h.current.sequence = 12; handle.receive(handle.capture(7, 12), batch()); assert.equal(h.store.getSnapshot().events.length, 1);
  } finally { h.close(); }
});

test("delivery failure never replays stored history after permissions or the callback recover", () => {
  let denied = true;
  const h = harness({ deliver() { if (denied) throw new Error("Notification permission denied"); } }); try {
    const { handle, id } = h.ready(); h.current.sequence = 11; handle.receive(handle.capture(7, 11), batch());
    assert.equal(h.store.getSnapshot().events.length, 1); assert.equal(h.deliveries.length, 1);
    assert.match(h.store.getSnapshot().deliveryError, /delivery failed.*saved/i);
    denied = false; h.store.dismissToast(); h.store.setEnabled(id, false); h.store.setEnabled(id, true);
    assert.equal(h.deliveries.length, 1); assert.equal(h.store.getSnapshot().toast, null);
    h.current.sequence = 12; handle.receive(handle.capture(7, 12), batch([event("New signal")]));
    assert.equal(h.deliveries.length, 2);
  } finally { h.close(); }
});

test("history is copied and capped at 100 actual signals without mutating earlier snapshots", () => {
  const h = harness(); try {
    const { handle } = h.ready(), first = batch([event("First retained copy")]);
    h.current.sequence = 11; handle.receive(handle.capture(7, 11), first);
    const earlier = h.store.getSnapshot(); first.events[0].message = "Provider mutation";
    assert.equal(earlier.events[0].message, "First retained copy");
    for (let index = 1; index <= 110; index++) { h.current.sequence++; handle.receive(handle.capture(7, h.current.sequence), batch([event(`Signal ${index}`)])); }
    const latest = h.store.getSnapshot(); assert.equal(latest.events.length, 100);
    assert.equal(latest.events[0].message, "Signal 110"); assert.equal(latest.events.at(-1).message, "Signal 11");
    assert.equal(earlier.events.length, 1); assert.equal(earlier.events[0].message, "First retained copy");
    h.store.clearHistory(); assert.equal(h.store.getSnapshot().events.length, 0); assert.equal(h.deliveries.length, 111);
  } finally { h.close(); }
});

test("32 held replies are bounded and the next receipt pauses alerts without throwing or altering market state", () => {
  const h = harness(); try {
    const { handle, id } = h.ready(), receipts = [];
    for (let index = 0; index < 32; index++) { h.current.sequence++; receipts.push(handle.capture(7, h.current.sequence)); }
    assert.equal(new Set(receipts).size, 32); assert.equal(receipts.includes(undefined), false);
    h.current.sequence++; assert.equal(handle.capture(7, h.current.sequence), undefined);
    const paused = h.store.getSnapshot().sources[0]; assert.equal(paused.enabled, false); assert.equal(paused.ready, true);
    assert.match(paused.reason, /too quickly/i);
    for (const receipt of receipts) handle.receive(receipt, batch());
    assert.equal(h.store.getSnapshot().events.length, 0); assert.equal(h.current.sequence, 43);
    assert.equal(h.store.setEnabled(id, true), true);
    h.current.sequence++; handle.receive(handle.capture(7, h.current.sequence), batch()); assert.equal(h.deliveries.length, 1);
  } finally { h.close(); }
});

test("64 source registrations remain bounded and disposal permits a fresh unique owner", () => {
  const h = harness(); try {
    const handles = Array.from({ length: 64 }, () => h.register());
    assert.equal(handles.includes(undefined), false); assert.equal(new Set(handles.map(handle => handle.id)).size, 64);
    assert.equal(h.register(), undefined); assert.equal(h.store.getSnapshot().sources.length, 64);
    handles[0].dispose(); const replacement = h.register(); assert.ok(replacement);
    assert.equal(handles.some(handle => handle.id === replacement.id), false); assert.equal(h.store.getSnapshot().sources.length, 64);
  } finally { h.close(); }
});

test("disclosed native overflow keeps valid messages but pauses only that source and never replays a consumed batch", () => {
  const h = harness(); try {
    const { handle } = h.ready(); h.current.sequence = 11; const receipt = handle.capture(7, 11);
    handle.receive(receipt, batch([event("First"), event("Last")], 16));
    assert.deepEqual(h.store.getSnapshot().events.map(signal => signal.message), ["Last", "First"]);
    assert.equal(h.deliveries.length, 1); assert.equal(h.deliveries[0].message, "Last");
    assert.match(h.store.getSnapshot().sources[0].reason, /16.*limit/i); assert.equal(h.store.getSnapshot().sources[0].enabled, false);
    assert.equal(h.store.getSnapshot().sources[0].ready, true);
    handle.receive(receipt, batch([event("Forged repetition")])); assert.equal(h.store.getSnapshot().events.length, 2);
  } finally { h.close(); }
});

test("invalid accessor batches are not evaluated and cannot poison chart state or restore a retired owner", () => {
  const h = harness(); try {
    const { handle } = h.ready(); h.current.sequence = 11; const receipt = handle.capture(7, 11);
    let getterCalls = 0; const malformed = { dropped: 0 }; Object.defineProperty(malformed, "events", { enumerable: true, get() { getterCalls++; return [event()]; } });
    assert.doesNotThrow(() => handle.receive(receipt, malformed)); assert.equal(getterCalls, 0);
    assert.equal(h.store.getSnapshot().events.length, 0); assert.equal(h.store.getSnapshot().sources[0].enabled, false);
    assert.match(h.store.getSnapshot().sources[0].reason, /invalid response/i); assert.equal(h.current.sequence, 11);
  } finally { h.close(); }
});

function accountHarness() {
  const b = browser(), deliveries = [], account = b.api.createPineChartAlertAccount(signal => deliveries.push(signal));
  const stop = account.start(), store = account.store, current = { epoch: 1, sequence: 30 };
  const handle = store.register({ name: "Account-owned study", symbol: "BINANCE:BTCUSDT", timeframe: "1m",
    owns: () => true, readCurrent: () => ({ ...current }) });
  handle.setReady(); const id = store.getSnapshot().sources[0].id; assert.equal(store.setEnabled(id, true), true);
  current.sequence = 31; const receipt = handle.capture(1, 31);
  return { ...b, deliveries, store, handle, receipt, current, id,
    close() { stop(); store.reset(); assert.equal([...b.listeners.values()].reduce((total, entries) => total + entries.size, 0), 0); b.restore(); } };
}

for (const transition of ["silent auth ABA", "storage clear/restore", "delayed identity event", "delayed storage clear event"])
  test(`real account ${transition} retires the old generation even when final credentials equal the original`, () => {
    const h = accountHarness(); try {
      const before = h.store.getGeneration(), original = h.values.get(AUTH_KEY);
      if (transition === "silent auth ABA") {
        h.api.setStoredAuthSession(session(2), { notify: false }); h.api.setStoredAuthSession(JSON.parse(original), { notify: false });
      } else if (transition === "storage clear/restore") {
        h.values.clear(); h.storage(null); h.values.set(AUTH_KEY, original); h.storage(AUTH_KEY, null, original);
      } else if (transition === "delayed identity event") {
        // Cross-tab credentials have already gone A -> B -> A when their queued
        // storage events are delivered; reading final storage alone loses ABA.
        const middle = JSON.stringify(session(2)); h.values.set(AUTH_KEY, original);
        h.storage(AUTH_KEY, original, middle); h.storage(AUTH_KEY, middle, original);
      } else {
        h.values.clear(); h.values.set(AUTH_KEY, original); h.storage(null);
      }
      assert.ok(h.store.getGeneration() > before);
      h.handle.receive(h.receipt, batch([event("Retired account callback")]));
      assert.deepEqual(h.store.getSnapshot().events, []); assert.deepEqual(h.store.getSnapshot().sources, []);
      assert.equal(h.deliveries.length, 0);
    } finally { h.close(); }
  });

test("same-identity entitlement refresh does not retire an armed actual account", () => {
  const h = accountHarness(); try {
    const generation = h.store.getGeneration(), refreshed = { ...h.api.getStoredAuthSession(), user: { ...h.api.getStoredAuthSession().user, name: "Updated profile" } };
    h.api.setStoredAuthSession(refreshed);
    assert.equal(h.store.getGeneration(), generation);
    h.handle.receive(h.receipt, batch()); assert.equal(h.store.getSnapshot().events.length, 1); assert.equal(h.deliveries.length, 1);
  } finally { h.close(); }
});

test("auth loss hides stored account alerts immediately and late callbacks cannot recreate them", () => {
  const h = accountHarness(); try {
    h.handle.receive(h.receipt, batch()); assert.equal(h.store.getSnapshot().events.length, 1);
    h.current.sequence = 32; const old = h.handle.capture(1, 32);
    h.api.setStoredAuthSession(null, { notify: false });
    assert.deepEqual(h.store.getSnapshot().events, []); assert.equal(h.store.getSnapshot().toast, null);
    h.handle.receive(old, batch()); assert.equal(h.deliveries.length, 1); assert.deepEqual(h.store.getSnapshot().sources, []);
  } finally { h.close(); }
});

// The production hook and production store run together. React scheduling and
// session replies are controlled publication seams, not fabricated Pine proof.
// All alert() calculation/transport claims belong to the independent worker file.
const hookCompiled = (await build({ bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent",
  entryPoints: ["frontend/src/components/chart/useLivePineRuntime.ts"], plugins: [{ name: "chart-alert-hook-boundaries", setup(plugin) {
    plugin.onResolve({ filter: /^react$|authSession$|customIndicators$|pineRuntime$|pineInstrumentContext$/ }, args => ({ path: args.path, namespace: "alert177" }));
    plugin.onLoad({ filter: /.*/, namespace: "alert177" }, ({ path }) => ({ loader: "js", contents:
      path === "react" ? ["useState", "useRef", "useMemo", "useEffect"].map(name => `export const ${name}=(...args)=>globalThis.__chartAlert177.hooks.${name}(...args);`).join("\n") :
      path.endsWith("authSession") ? 'export const getStoredAuthSession=()=>globalThis.__chartAlert177.auth();' :
      path.endsWith("pineInstrumentContext") ? 'export const binanceChartSymbolMatches=()=>false;' :
      path.endsWith("customIndicators") ? 'export const isPersistentPineIndicator=x=>!!x.customScriptSource;export const sanitizePinePrepared=(x,source)=>x?.source===source?x:undefined;export const pineContextForChart=(symbol,timeframe)=>({symbol,timeframe});' :
      'export const createPineLiveMarketRuntime=()=>{throw Error("Unexpected foreign market coordinator");};export const createPineLiveRuntimeSession=x=>globalThis.__chartAlert177.createSession(x);export const createPineRuntimeJob=()=>{throw Error("Unexpected prepare");};' }));
  } }],
})).outputFiles[0].text;
console.info("PINE_CHART_ALERT177_HOOK " + JSON.stringify({ actualHook: true, actualStore: true, controlledReactAndReplyDelivery: true,
  bundleSha256: createHash("sha256").update(hookCompiled).digest("hex") }));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const candle = (time, close = 10) => ({ time, open: close, high: close + 1, low: close - 1, close, volume: 10 });
const reply = (value, alertEvents, usesVisibleRange = false) => ({ kind: "run", usesVisibleRange, fixtureValue: value,
  ...(alertEvents ? { alertEvents } : {}) });
function hookHarness() {
  const h = harness(), prior = globalThis.__chartAlert177, slots = [], effects = [], sessions = [], listeners = new Set();
  let cursor = 0, pending = [], output;
  const current = { epoch: 7, bars: [candle(60), candle(120), candle(180)], event: { sequence: 10, bar: candle(180), confirmed: false },
    chart: { history: [candle(60), candle(120)], bar: candle(180), confirmed: false } };
  const feed = { getSnapshot: () => current, subscribe(fn) { listeners.add(fn); fn(current); return () => listeners.delete(fn); } };
  const fixture = { auth: () => h.api.getStoredAuthSession(), hooks: {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(factory) { cursor++; return factory(); },
    useEffect(effect, dependencies) { const index = cursor++, old = effects[index]; if (!old || dependencies.some((value, position) => !Object.is(value, old.dependencies[position]))) {
      pending.push(() => { old?.cleanup?.(); effects[index] = { dependencies, cleanup: effect() }; }); } },
  }, createSession(input) {
    const initial = deferred(), session = { input, initial, promise: initial.promise, commands: [], cancelled: false,
      update(bar, confirmed, source, collectAlerts) { const held = deferred(); this.commands.push({ action: "update", bar, confirmed, source, collectAlerts, ...held }); return held.promise; },
      setViewport(viewport) { const held = deferred(); this.commands.push({ action: "viewport", viewport, ...held }); return held.promise; },
      cancel() { this.cancelled = true; },
    }; sessions.push(session); return session;
  } };
  globalThis.__chartAlert177 = fixture;
  const module = { exports: {} }; new Function("require", "module", "exports", hookCompiled)(createRequire(import.meta.url), module, module.exports);
  const options = { feed, timeframe: "1m", symbol: "TEST", userId: 1, token: "owner-1", viewport: { from: 60, to: 180 },
    alerts: { store: h.store, generation: h.store.getGeneration() },
    indicators: [{ id: "owned-study", visible: true, customScriptName: "Owned study", customScriptSource: "//@version=6\nindicator('Owned study')\nplot(close)", settings: {} }] };
  const render = () => { cursor = 0; pending = []; output = module.exports.useLivePineRuntime(options); for (const effect of pending) effect(); return output; };
  const tick = (close = 20, confirmed = false) => { current.event = { sequence: current.event.sequence + 1, bar: candle(180, close), confirmed };
    current.bars = [...current.bars.slice(0, -1), current.event.bar];
    current.chart = { ...current.chart, bar: current.event.bar, confirmed }; h.current.sequence = current.event.sequence; h.current.epoch = current.epoch;
    for (const callback of listeners) callback(current); };
  const close = () => { for (const effect of effects) effect?.cleanup?.(); assert.equal(listeners.size, 0); globalThis.__chartAlert177 = prior; h.close(); };
  render();
  return { ...h, current, options, sessions, listeners, render, tick, close, async settle() { await flush(); return render(); },
    async warm(visibleRange = false) { sessions[0].initial.resolve(reply("history", undefined, visibleRange)); sessions[0].commands[0].resolve(reply("startup", undefined, visibleRange)); await flush(); render(); },
    arm() { const source = h.store.getSnapshot().sources[0]; assert.ok(source.ready); assert.equal(h.store.setEnabled(source.id, true), true); return source.id; } };
}

test("actual hook receives older owned alerts before coalescing stale plot replies and startup is unarmed", async () => {
  const h = hookHarness(); try {
    assert.equal(h.sessions[0].commands[0].collectAlerts, undefined); await h.warm(); h.arm();
    assert.equal(h.store.getSnapshot().events.length, 0); h.tick(20); h.tick(30);
    assert.deepEqual(h.sessions[0].commands.map(command => command.collectAlerts), [undefined, true, true]);
    h.sessions[0].commands[1].resolve(reply("older plot", batch([event("Earlier actual receipt")] )));
    const earlier = await h.settle(); assert.notEqual(earlier[0].result.fixtureValue, "older plot");
    assert.deepEqual(h.store.getSnapshot().events.map(signal => signal.message), ["Earlier actual receipt"]);
    h.sessions[0].commands[2].resolve(reply("latest plot", batch([event("Latest actual receipt")] )));
    const latest = await h.settle(); assert.equal(latest[0].result.fixtureValue, "latest plot");
    assert.deepEqual(h.store.getSnapshot().events.map(signal => signal.message), ["Latest actual receipt", "Earlier actual receipt"]);
    assert.equal(h.deliveries.length, 2);
  } finally { h.close(); }
});

test("actual hook cannot publish held pre-enable or off/on replies and hiding disposes their owner", async () => {
  const h = hookHarness(); try {
    await h.warm(); h.tick(20); const unarmed = h.sessions[0].commands[1]; assert.equal(unarmed.collectAlerts, undefined);
    const id = h.arm(); unarmed.resolve(reply("unarmed", batch([event("Forbidden pre-enable batch")]))); await h.settle();
    assert.equal(h.store.getSnapshot().events.length, 0); h.tick(30); const old = h.sessions[0].commands[2];
    h.store.setEnabled(id, false); h.store.setEnabled(id, true); old.resolve(reply("old arm", batch())); await h.settle();
    assert.equal(h.store.getSnapshot().events.length, 0); h.tick(40); const hidden = h.sessions[0].commands[3];
    h.options.indicators = [{ ...h.options.indicators[0], visible: false }]; h.render();
    assert.equal(h.sessions[0].cancelled, true); assert.equal(h.store.getSnapshot().sources.length, 0);
    hidden.resolve(reply("hidden", batch())); await h.settle(); assert.equal(h.deliveries.length, 0);
  } finally { h.close(); }
});

test("actual viewport rerun disarms old receipts and its successful result becomes ready without rearming", async () => {
  const h = hookHarness(); try {
    await h.warm(true); const id = h.arm(); h.tick(20); const old = h.sessions[0].commands[1];
    h.options.viewport = { from: 120, to: 180 }; h.render();
    const view = h.sessions[0].commands.find(command => command.action === "viewport"); assert.ok(view);
    assert.equal(h.store.setEnabled(id, true), false); old.resolve(reply("old view", batch(), true)); await h.settle();
    assert.equal(h.store.getSnapshot().events.length, 0); view.resolve(reply("new view", undefined, true)); await h.settle();
    const source = h.store.getSnapshot().sources[0]; assert.equal(source.ready, true); assert.equal(source.enabled, false);
    assert.equal(h.store.setEnabled(id, true), true); h.tick(30);
    h.sessions[0].commands.at(-1).resolve(reply("new view tick", batch([event("Fresh view signal")]), true)); await h.settle();
    assert.deepEqual(h.store.getSnapshot().events.map(signal => signal.message), ["Fresh view signal"]);
  } finally { h.close(); }
});

test("actual feed failure immediately clears ready/enabled and rejects already held replies without a fresh tick", async () => {
  const h = hookHarness(); try {
    await h.warm(); h.arm(); h.tick(20); const held = h.sessions[0].commands[1];
    h.current.error = "Actual provider disconnected"; for (const callback of h.listeners) callback(h.current);
    const source = h.store.getSnapshot().sources[0]; assert.equal(source.ready, false); assert.equal(source.enabled, false);
    assert.match(source.reason, /stopped|disconnect|feed|market/i);
    assert.equal(h.render()[0].error, "Actual provider disconnected");
    held.resolve(reply("late feed reply", batch())); await h.settle(); assert.equal(h.deliveries.length, 0);
    assert.equal(h.store.getSnapshot().events.length, 0);
  } finally { h.close(); }
});

test("actual hook source/input and feed epoch replacement cannot reuse an armed pane handle", async () => {
  const h = hookHarness(); try {
    await h.warm(); const originalId = h.arm(); h.tick(20); const old = h.sessions[0].commands[1];
    h.options.indicators = [{ ...h.options.indicators[0], settings: { customInputs: { in_0: 2 } } }]; h.render();
    assert.equal(h.sessions[0].cancelled, true); assert.equal(h.sessions.length, 2);
    const replacement = h.store.getSnapshot().sources[0]; assert.notEqual(replacement.id, originalId);
    assert.equal(replacement.ready, false); assert.equal(replacement.enabled, false);
    assert.equal(h.sessions[1].commands[0].collectAlerts, undefined);
    old.resolve(reply("retired inputs", batch())); await h.settle(); assert.equal(h.store.getSnapshot().events.length, 0);
    h.sessions[1].initial.resolve(reply("new inputs history")); h.sessions[1].commands[0].resolve(reply("new inputs startup")); await h.settle();
    const currentId = h.arm(); h.tick(30); const beforeEpoch = h.sessions[1].commands[1];
    h.current.epoch++; h.tick(40); assert.equal(h.sessions[1].cancelled, true);
    const epochOwner = h.store.getSnapshot().sources[0]; assert.notEqual(epochOwner.id, currentId);
    assert.equal(epochOwner.enabled, false); assert.equal(epochOwner.ready, false);
    beforeEpoch.resolve(reply("retired epoch", batch())); await h.settle(); assert.equal(h.deliveries.length, 0);
  } finally { h.close(); }
});

test("actual hook rejects an account-generation retirement before React cleanup and restarts unarmed", async () => {
  const h = hookHarness(); try {
    await h.warm(); h.arm(); h.tick(20); const held = h.sessions[0].commands[1], previousGeneration = h.options.alerts.generation;
    // The separate real-auth tests prove account events call this synchronous
    // reset. Here the still-mounted hook must fence its held worker callback.
    h.store.reset(); assert.ok(h.store.getGeneration() > previousGeneration);
    held.resolve(reply("retired generation", batch())); assert.deepEqual(await h.settle(), []);
    assert.equal(h.deliveries.length, 0); assert.equal(h.store.getSnapshot().sources.length, 0);
    h.options.alerts = { store: h.store, generation: h.store.getGeneration() }; h.render();
    assert.equal(h.sessions[0].cancelled, true); assert.equal(h.sessions.length, 2);
    assert.equal(h.store.getSnapshot().sources[0].enabled, false); assert.equal(h.store.getSnapshot().sources[0].ready, false);
    assert.equal(h.sessions[1].commands[0].collectAlerts, undefined);
  } finally { h.close(); }
});
