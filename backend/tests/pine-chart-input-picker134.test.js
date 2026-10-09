import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const code = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false, logLevel: "silent",
  stdin: { contents: 'export * from "./frontend/src/lib/pineChartInputPicker.ts"; export {setStoredAuthSession} from "./frontend/src/lib/authSession.ts";',
    loader: "ts", resolveDir: new URL("../../", import.meta.url).pathname },
})).outputFiles[0].text;
const picker = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const cleanup = [];
const session = (id = 1, token = "picker-user-a") => ({ createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), token,
  user: { id, email: `picker${id}@example.test`, approved: true, name: "Picker test", deploymentMode: "beta", workspaceAccess: true,
    accessExpiresAt: new Date(Date.now() + 86400000).toISOString(), isBetaUser: true, plan: "beta", provider: "google", betaPosition: null } });
const request = () => ({ symbol: "TEST", timeframe: "5", definitions: [
  { id: "in_0", name: "Price", type: "price", defval: 0, confirm: true, inline: "point" },
  { id: "in_1", name: "Time", type: "time", defval: 0, confirm: true, inline: "point" },
], inputs: { in_0: 0, in_1: -1, literal: "rgba(1,2,3,0.25)", flag: false }, anchorIds: ["point:in_0:in_1"] });
function register(pick, fields = {}) {
  const endpoint = { symbol: "TEST", timeframe: "5", owner: picker.pineInputPickerOwner(), pick, ...fields };
  const unregister = picker.registerPineChartInputPicker(endpoint); cleanup.push(unregister);
  return unregister;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test.beforeEach(() => {
  const storage = new Map();
  const browser = new EventTarget();
  browser.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  picker.setStoredAuthSession(session());
});
test.afterEach(() => {
  for (const unregister of cleanup.splice(0)) unregister();
  picker.setStoredAuthSession(null);
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete globalThis.window;
});

test("real broker admits only the exact active chart and auth owner and forwards the unmodified request and cancellation signal", async () => {
  const calls = [], values = { in_0: 12.5, in_1: 1700000040123 }, req = request(), held = structuredClone(req), controller = new AbortController();
  for (const fields of [{ symbol: "OTHER" }, { timeframe: "1" }, { owner: JSON.stringify([2, "picker-user-b"]) }]) register(async () => { calls.push("foreign"); return {}; }, fields);
  register(async (received, signal) => { calls.push("active"); assert.equal(received, req); assert.equal(signal, controller.signal); return values; });
  assert.equal(await picker.pickPineChartInputs(req, controller.signal), values);
  assert.deepEqual(calls, ["active"]); assert.deepEqual(req, held);
});

test("missing, case/timeframe-mismatched and ambiguous matching endpoints never receive a pick", async () => {
  let calls = 0; const callback = async () => { calls++; return {}; };
  await assert.rejects(picker.pickPineChartInputs(request(), new AbortController().signal), /matching active chart/);
  const lower = register(callback, { symbol: "test" }), alias = register(callback, { timeframe: "5m" });
  await assert.rejects(picker.pickPineChartInputs(request(), new AbortController().signal), /matching active chart/);
  lower(); alias(); const first = register(callback), second = register(callback);
  await assert.rejects(picker.pickPineChartInputs(request(), new AbortController().signal), /matching active chart/);
  assert.equal(calls, 0); second();
  assert.deepEqual(await picker.pickPineChartInputs(request(), new AbortController().signal), {}); assert.equal(calls, 1); first();
});

test("already aborted admission returns null before selecting or invoking any endpoint", async () => {
  const controller = new AbortController(); controller.abort();
  assert.equal(await picker.pickPineChartInputs(request(), controller.signal), null);
  let called = false; register(async () => { called = true; return { in_0: 999 }; });
  assert.equal(await picker.pickPineChartInputs(request(), controller.signal), null); assert.equal(called, false);
});

test("cancellation reaches the real endpoint signal and a late successful response cannot commit values", async () => {
  const pending = deferred(), controller = new AbortController(); let sawAbort = false;
  register((_request, signal) => { signal.addEventListener("abort", () => { sawAbort = true; }, { once: true }); return pending.promise; });
  const result = picker.pickPineChartInputs(request(), controller.signal);
  controller.abort(); assert.equal(sawAbort, true); pending.resolve({ in_0: 999, in_1: 1700000040000 });
  assert.equal(await result, null);
});

test("account switch, bearer rotation, sign-out and expired owner invalidate pending successful picks", async () => {
  for (const next of [session(2, "picker-user-b"), session(1, "rotated-token"), null, { ...session(), expiresAt: new Date(0).toISOString() }]) {
    picker.setStoredAuthSession(session()); const pending = deferred();
    const unregister = register(() => pending.promise), result = picker.pickPineChartInputs(request(), new AbortController().signal);
    picker.setStoredAuthSession(next); pending.resolve({ in_0: 999, in_1: 1700000040000 });
    assert.equal(await result, null); unregister();
  }
});

test("chart unregistration or replacement rejects the captured old endpoint response even with matching new chart coordinates", async () => {
  const pending = deferred(); let replacementCalls = 0;
  const unregister = register(() => pending.promise);
  const stale = picker.pickPineChartInputs(request(), new AbortController().signal);
  unregister(); register(async () => { replacementCalls++; return { in_0: 3, in_1: 0 }; });
  pending.resolve({ in_0: 999, in_1: 1700000040000 }); assert.equal(await stale, null); assert.equal(replacementCalls, 0);
  assert.deepEqual(await picker.pickPineChartInputs(request(), new AbortController().signal), { in_0: 3, in_1: 0 }); assert.equal(replacementCalls, 1);
});

test("explicit cancellation and exact scalar picks preserve zero, negative milliseconds and authored literals", async () => {
  const stop = register(async () => null); assert.equal(await picker.pickPineChartInputs(request(), new AbortController().signal), null); stop();
  const values = { in_0: 0, in_1: -1, color: "rgba(1,2,3,0.25)", text: "\\n", enabled: false };
  register(async () => values); assert.deepEqual(await picker.pickPineChartInputs(request(), new AbortController().signal), values);
});

test("owned endpoint failures remain actionable and repeated cleanup leaves no stale admission", async () => {
  const failure = new Error("No loaded candles in the active chart.");
  const unregister = register(async () => { throw failure; });
  await assert.rejects(picker.pickPineChartInputs(request(), new AbortController().signal), error => error === failure);
  unregister(); unregister();
  await assert.rejects(picker.pickPineChartInputs(request(), new AbortController().signal), /matching active chart/);
});
