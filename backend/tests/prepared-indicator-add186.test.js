import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// React scheduling and prepare-job completion are controlled for lifecycle
// tests. Metadata is compiled by the real worker and admitted by the real
// source-exact sanitizer; these tests make no numerical execution claim.
Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent",
  define: { "import.meta.env": "{}" }, plugins: [{ name: "prepared-add186-controller", setup(api) {
    api.onResolve({ filter: /^react$|^\.\/pineRuntime$/ }, args => ({ path: args.path, namespace: "controller186" }));
    api.onLoad({ filter: /.*/, namespace: "controller186" }, ({ path }) => ({ loader: "js", contents: path === "react"
      ? ["useState", "useRef", "useEffect", "useCallback"].map(name => `export const ${name}=(...args)=>globalThis.fixture186.hooks.${name}(...args);`).join("\n")
      : 'export const createPineRuntimeJob=request=>globalThis.fixture186.job(request);' }));
  } }, createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), contents:
    'export * from "./frontend/src/lib/usePreparedIndicatorAdd.ts";export {setStoredAuthSession} from "./frontend/src/lib/authSession.ts";export {executePineRequest} from "./frontend/src/workers/pineNative.worker.ts";' } })).outputFiles[0].text;
console.info("PREPARED_ADD186_BINDING " + JSON.stringify({ actualHook: true, actualAuth: true, actualSanitizer: true,
  actualMetadataCompiler: true, controlledReactAndJobLifecycle: true, bundleSha256: createHash("sha256").update(bundle).digest("hex") }));
const turn = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const source = '//@version=6\nindicator("Lifecycle186",overlay=true)\nplot(close,"Price")';
const script = extra => ({ id: "first-party:lifecycle186", name: "Lifecycle", source, origin: "first-party", revision: 1,
  category: "basic", color: "#38bdf8", description: "Lifecycle test", preview: "average", synonyms: [], inputs: {},
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", versions: [], ...extra });
const session = (id, token = `owner-${id}`) => ({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token,
  user: { id, email: "owner@example.test", name: "Owner", provider: "google", approved: false, betaPosition: null,
    workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });

async function harness() {
  const previous = { fixture: globalThis.fixture186, window: globalThis.window };
  const storage = new Map(), window = new EventTarget();
  window.localStorage = { get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null,
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  window.location = { origin: "https://edgelab.test" }; globalThis.window = window;
  let cursor = 0, slots = [], effects = [], scope = { activePaneLabel: "Chart 1", symbol: "BTCUSDT", timeframe: "1m", sourceTimeframe: "1m" };
  let scripts = [script()], additions = [], callback = value => additions.push(value);
  const jobs = [], writes = [], fixture = { job(request) { const job = { request, cancelled: 0, ...deferred() }; jobs.push(job);
    return { id: "prepare186", promise: job.promise, cancel() { job.cancelled++; } }; }, hooks: {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, value => { writes.push(i); slots[i].value = typeof value === "function" ? value(slots[i].value) : value; }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback(value, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) slots[i] = { value, deps }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
      slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = effect(); }); } },
  } }; globalThis.fixture186 = fixture;
  const module = { exports: {} }; new Function("require", "module", "exports", bundle)(createRequire(import.meta.url), module, module.exports);
  const api = module.exports; api.setStoredAuthSession(session(1));
  const prepared = await api.executePineRequest({ id: "prepare-exact186", action: "prepare", source });
  const render = (next = {}) => { scope = { ...scope, ...next.scope }; scripts = next.scripts ?? scripts; callback = next.callback ?? callback;
    cursor = 0; return api.usePreparedIndicatorAdd(scope, scripts, callback); };
  const commit = () => { const pending = effects; effects = []; pending.forEach(effect => effect()); };
  const unmount = () => { for (const slot of slots) { slot.cleanup?.(); slot.cleanup = undefined; } effects = []; };
  render(); commit();
  return { api, prepared, jobs, additions, writes, render, commit, unmount, storage,
    async cleanup() { unmount(); await turn(); globalThis.window = previous.window; globalThis.fixture186 = previous.fixture; },
    identity(id, token, options) { api.setStoredAuthSession(session(id, token), options); },
    storageEvent(key, oldValue, newValue) { const event = new Event("storage"); Object.defineProperties(event, { key: { value: key }, oldValue: { value: oldValue }, newValue: { value: newValue } }); window.dispatchEvent(event); },
  };
}

test("one job, source-exact compiler metadata, captured callback and invalid-metadata retry", async () => {
  const h = await harness(); try {
    const first = h.render(); first.add(script()); first.add(script()); assert.equal(h.jobs.length, 1);
    assert.equal(h.render().pendingId, script().id);
    h.jobs[0].resolve({ ...h.prepared, source: source + "\n// wrong source" }); await turn();
    assert.equal(h.additions.length, 0); assert.match(h.render().message, /Could not add Lifecycle.*Try again/); assert.equal(h.render().pendingId, undefined);
    const replacement = []; h.render().add(script()); h.render({ callback: value => replacement.push(value) });
    h.jobs[1].resolve(h.prepared); await turn(); assert.equal(h.additions.length, 1); assert.equal(replacement.length, 0);
    assert.equal(h.additions[0].pinePrepared.source, source); assert.deepEqual(h.additions[0].inputs, {});
  } finally { await h.cleanup(); }
});

test("chart scope and script source A to B to A retire a late result even before passive cleanup", async () => {
  for (const field of ["activePaneLabel", "symbol", "timeframe", "sourceTimeframe", "source"]) {
    const h = await harness(); try {
      h.render().add(script());
      if (field === "source") { h.render({ scripts: [script({ source: source + "\n// changed" })] }); h.render({ scripts: [script()] }); }
      else { const original = { activePaneLabel: "Chart 1", symbol: "BTCUSDT", timeframe: "1m", sourceTimeframe: "1m" }[field];
        h.render({ scope: { [field]: field === "symbol" ? "ETHUSDT" : field === "activePaneLabel" ? "Chart 2" : "5m" } }); h.render({ scope: { [field]: original } }); }
      h.jobs[0].resolve(h.prepared); await turn(); assert.equal(h.additions.length, 0, field);
      assert.equal(h.render().pendingId, undefined, field); assert.equal(h.render().message, undefined, field); h.commit();
      h.render().add(script()); assert.equal(h.jobs.length, 2, field); h.jobs[1].resolve(h.prepared); await turn(); assert.equal(h.additions.length, 1, field);
      h.render().add(script());
      if (field === "source") h.render({ scripts: [script({ source: source + "\n// changed" })] });
      else h.render({ scope: { [field]: field === "symbol" ? "ETHUSDT" : field === "activePaneLabel" ? "Chart 2" : "5m" } });
      h.commit(); assert.equal(h.jobs[2].cancelled, 1, field);
      h.jobs[2].resolve(h.prepared); await turn(); assert.equal(h.additions.length, 1, field);
    } finally { await h.cleanup(); }
  }
});

test("quiet account and token ABA, delayed storage identity transitions and storage clear cancel publication", async () => {
  for (const kind of ["identity", "token", "delayed-storage", "storage-clear"]) {
    const h = await harness(); try {
      h.render().add(script());
      if (kind === "identity") { h.identity(2, "owner-2", { notify: false }); h.identity(1, "owner-1", { notify: false }); }
      if (kind === "token") { h.identity(1, "rotated", { notify: false }); h.identity(1, "owner-1", { notify: false }); }
      if (kind === "delayed-storage") h.storageEvent("edgelab.auth.session.v1", JSON.stringify(session(1)), JSON.stringify(session(2)));
      if (kind === "storage-clear") h.storageEvent(null, null, null);
      assert.equal(h.jobs[0].cancelled, 1, kind); h.jobs[0].resolve(h.prepared); await turn(); assert.equal(h.additions.length, 0, kind);
      h.render().add(script()); h.jobs[1].resolve(h.prepared); await turn(); assert.equal(h.additions.length, 1, kind);
    } finally { await h.cleanup(); }
  }
});

test("same identity billing refresh and unrelated storage preserve the pending job; unmount ignores fulfillment", async () => {
  const h = await harness(); try {
    h.render().add(script()); h.identity(1, "owner-1", { notify: false }); h.storageEvent("unrelated", "before", "after");
    assert.equal(h.jobs[0].cancelled, 0); h.jobs[0].resolve(h.prepared); await turn(); assert.equal(h.additions.length, 1);
    h.render().add(script()); h.unmount(); const writes = h.writes.length;
    assert.equal(h.jobs[1].cancelled, 1); h.jobs[1].resolve(h.prepared); await turn();
    assert.equal(h.additions.length, 1); assert.equal(h.writes.length, writes);
  } finally { await h.cleanup(); }
});

test("DSL and already prepared user scripts remain synchronous while first-party strategies cannot add", async () => {
  const h = await harness(); try {
    h.render().add(script({ source: 'indicator "DSL" overlay\nplot close color "#38bdf8"' }));
    h.render().add(script({ origin: "user", pinePrepared: h.prepared })); assert.equal(h.jobs.length, 0); assert.equal(h.additions.length, 2);
    const strategySource = '//@version=6\nstrategy("Not a built-in indicator")\nplot(close)';
    const strategy = await h.api.executePineRequest({ id: "prepare-strategy186", action: "prepare", source: strategySource });
    h.render().add(script({ source: strategySource, pinePrepared: strategy })); assert.equal(h.additions.length, 2); assert.match(h.render().message, /Could not add/);
    h.render().add(script({ source: strategySource })); h.jobs[0].resolve(strategy); await turn(); assert.equal(h.additions.length, 2);
  } finally { await h.cleanup(); }
});
