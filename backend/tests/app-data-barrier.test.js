import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({ bundle: true, define: { "import.meta.env": "{}" }, format: "esm", platform: "node", write: false, logLevel: "silent", stdin: { contents: 'export * from "./frontend/src/lib/appDataBarrier.ts"; export * from "./frontend/src/lib/api.ts"; export * from "./frontend/src/lib/serverStorage.ts"; export * from "./frontend/src/lib/navigationState.ts"; export { setStoredAuthSession } from "./frontend/src/lib/authSession.ts";', loader: "ts", resolveDir: root } }).outputFiles[0].text;
let instance = 0;
const fresh = () => import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}#${++instance}`);
const epochKey = "edgelab.app-data-generation.v1.user-1";
const uncertainKey = "edgelab.app-data-uncertain.v1.user-1.";
const requestMarkers = (storage) => [...storage.values.keys()].filter((key) => key.startsWith(uncertainKey));
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const session = (id = 1, token = `token-${id}`) => ({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token, user: { approved: true, email: `user-${id}@test.invalid`, id, name: `User ${id}`, isBetaUser: true, plan: "beta", provider: "email", betaPosition: null } });
const reload = (error) => error.requiresReload === true;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

function memory(values = new Map()) {
  return { values, get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

// A FIFO queue that admits adjacent shared requests together, never admitting
// a new reader past a waiting writer. The callback retains the lock until settled.
function webLocks() {
  const states = new Map();
  function drain(state) {
    if (state.exclusive || !state.queue.length) return;
    if (state.queue[0].mode === "exclusive" && state.shared) return;
    while (state.queue.length && !state.exclusive) {
      const job = state.queue[0];
      if (job.mode === "exclusive" && state.shared) break;
      state.queue.shift();
      if (job.mode === "exclusive") state.exclusive = true; else state.shared += 1;
      let result;
      try { result = job.callback(); } catch (error) { result = Promise.reject(error); }
      Promise.resolve(result).then(job.resolve, job.reject).finally(() => {
        if (job.mode === "exclusive") state.exclusive = false; else state.shared -= 1;
        drain(state);
      });
    }
  }
  return { request: (name, options, callback) => new Promise((resolve, reject) => {
    let state = states.get(name);
    if (!state) { state = { shared: 0, exclusive: false, queue: [] }; states.set(name, state); }
    state.queue.push({ mode: options.mode, callback, resolve, reject });
    drain(state);
  }) };
}

async function harness(run, initial = {}) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  const local = memory(new Map(Object.entries({ "edgelab.auth.session.v1": JSON.stringify(session()), ...initial })));
  const sessionStorage = memory();
  globalThis.window = { localStorage: local, sessionStorage, navigator: { locks: webLocks() }, crypto: globalThis.crypto, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const requests = [];
  globalThis.fetch = async (...args) => { requests.push(args); return json({ value: null, updated_at: null }); };
  try { await run({ api: await fresh(), local, sessionStorage, requests }); }
  finally { globalThis.fetch = previous.fetch; if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window; }
}

const portable = { app: "edgelab", version: 1, tables: { app_storage: [{ id: 1 }] } };
const acknowledgment = (api) => ({ ok: true, imported_at: "2026-10-07T12:00:00Z", summary: Object.fromEntries(api.APP_DATA_TABLE_NAMES.map((name) => [name, portable.tables[name]?.length ?? 0])) });

test("replacement waits for a sent shared mutation and rejects queued and newly admitted work before sending", async () => {
  await harness(async ({ api }) => {
    const access = api.captureAppDataAccess();
    const sent = deferred();
    const order = [];
    const active = api.runAppDataRequest(access, true, async (progress) => { progress.sent(); order.push("sent"); await sent.promise; progress.completed(); order.push("response consumed"); });
    const activeRejected = assert.rejects(active, reload);
    const finish = deferred();
    const replacement = api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => { order.push("replace"); await finish.promise; });
    const queued = api.runAppDataRequest(access, true, async () => { order.push("queued sent"); });
    const rejected = assert.rejects(queued, reload);
    await turn();
    assert.deepEqual(order, ["sent"]);
    sent.resolve();
    await activeRejected;
    await turn();
    assert.deepEqual(order, ["sent", "response consumed", "replace"]);
    finish.resolve();
    await replacement;
    await rejected;
    assert.throws(() => api.assertAppDataAccess(access, true), reload);
  });
});

test("suspended and mid-import tabs cannot adopt the new epoch; a cold reload can", async () => {
  await harness(async ({ api, local }) => {
    const suspended = await fresh();
    const finish = deferred();
    const replacement = api.runAppDataReplacement({ id: 1, token: "token-1" }, () => finish.promise);
    await turn();
    const midImport = await fresh();
    const middle = JSON.parse(local.getItem(epochKey));
    assert.equal(middle.phase, "replacing");
    assert.throws(() => midImport.assertAppDataAccess(midImport.captureAppDataAccess()), reload);
    finish.resolve();
    await replacement;
    assert.notEqual(JSON.parse(local.getItem(epochKey)).revision, middle.revision);
    for (const tab of [api, suspended, midImport]) assert.throws(() => tab.assertAppDataAccess(tab.captureAppDataAccess(), true), reload);
    const reloaded = await fresh();
    reloaded.assertAppDataAccess(reloaded.captureAppDataAccess(), true);
    assert.equal(reloaded.appDataLegacyMigrationAllowed(), false);
  });
});

test("startup snapshots owners not yet signed in, preventing suspended-tab account-switch bypass", async () => {
  await harness(async ({ api, local }) => {
    local.setItem(epochKey.replace("user-1", "user-2"), JSON.stringify({ revision: "new-owner-data", phase: "ready" }));
    api.setStoredAuthSession(session(2));
    assert.throws(() => api.assertAppDataAccess(api.captureAppDataAccess(), true), reload);
    const reloaded = await fresh();
    reloaded.assertAppDataAccess(reloaded.captureAppDataAccess(), true);
  });
});

test("an unconfirmed mutation durably stops saves and imports in another tab and after reload", async () => {
  await harness(async ({ api, local }) => {
    const other = await fresh();
    await assert.rejects(api.runAppDataRequest(api.captureAppDataAccess(), true, async (progress) => { progress.sent(); throw new Error("lost response"); }), /lost response/);
    assert.equal(requestMarkers(local).length, 1);
    assert.equal(local.getItem(requestMarkers(local)[0]), "u");
    for (const tab of [other, await fresh()]) {
      let requested = false;
      await assert.rejects(tab.runAppDataRequest(tab.captureAppDataAccess(), true, async () => { requested = true; }), reload);
      await assert.rejects(tab.runAppDataReplacement({ id: 1, token: "token-1" }, async () => { requested = true; }), reload);
      assert.equal(requested, false);
      tab.assertAppDataAccess(tab.captureAppDataAccess());
    }
  });
});

test("a confirmed HTTP failure does not poison the next save", async () => {
  await harness(async ({ api, local }) => {
    await assert.rejects(api.runAppDataRequest(api.captureAppDataAccess(), true, async (progress) => { progress.sent(); progress.completed(); throw new Error("validation failed"); }), /validation failed/);
    assert.deepEqual(requestMarkers(local), []);
    api.assertAppDataAccess(api.captureAppDataAccess(), true);
  });
});

for (const kind of ["missing locks", "missing secure UUID", "corrupt epoch", "read failure", "probe write failure", "probe removal failure", "epoch write failure", "silent epoch write", "silent probe write", "local enumeration failure", "local purge failure", "session purge failure"]) test(`replacement fails before sending on ${kind}`, async () => {
  await harness(async ({ api, local, sessionStorage, requests }) => {
    if (kind === "missing locks") delete window.navigator.locks;
    if (kind === "missing secure UUID") window.crypto = {};
    if (kind === "corrupt epoch") local.setItem(epochKey, "invalid json");
    if (kind === "read failure") { const get = local.getItem; local.getItem = (key) => { if (key === epochKey) throw new Error("storage denied"); return get(key); }; }
    if (kind === "probe write failure") local.setItem = () => { throw new Error("quota"); };
    if (kind === "probe removal failure") local.removeItem = () => { throw new Error("cannot remove"); };
    if (kind === "epoch write failure") { const set = local.setItem; local.setItem = (key, value) => { if (key === epochKey) throw new Error("cannot persist epoch"); return set(key, value); }; }
    if (kind === "silent epoch write") { const set = local.setItem; local.setItem = (key, value) => { if (key !== epochKey) set(key, value); }; }
    if (kind === "silent probe write") local.setItem = () => {};
    if (kind === "local enumeration failure") Object.defineProperty(local, "length", { get() { throw new Error("enumeration denied"); } });
    if (kind === "local purge failure") { local.setItem("edgelab.live-journal.v1.user-1", "old"); local.removeItem = (key) => { if (key.endsWith("user-1")) throw new Error("cannot purge"); }; }
    if (kind === "session purge failure") { sessionStorage.setItem("edgelab.navigation-surfaces.v3.user-1", "old"); sessionStorage.removeItem = () => { throw new Error("cannot purge session"); }; }
    await assert.rejects(api.importAppDataBundle(portable));
    assert.equal(requests.length, 0);
  });
});

test("replacement purges every account mirror while preserving other owners, auth, rollout and legacy", async () => {
  await harness(async ({ api, local, sessionStorage }) => {
    const mirrors = ["edgelab.settings.v1.user-1", "edgelab.live-journal.v1.user-1", "edgelab.custom-copy.v3.user-1", "edgelab.live-journal.v1.user-1.__updatedAt", "edgelab.navigation-surfaces.v3.user-1", "edgelab.navigation-surfaces.v3.user-1.data-old-generation"];
    const keep = ["edgelab.settings.v1.user-2", "edgelab.auth.session.v1", "edgelab.live-journal.v1", "edgelab.rollout.v1"];
    for (const key of [...mirrors, ...keep.filter((key) => key !== "edgelab.auth.session.v1")]) local.setItem(key, "private");
    for (const key of mirrors) sessionStorage.setItem(key, "private");
    await api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => {
      for (const key of mirrors) { assert.equal(local.getItem(key), null, key); assert.equal(sessionStorage.getItem(key), null, key); }
      for (const key of keep) assert.notEqual(local.getItem(key), null, key);
    });
  });
});

test("owner and token changes reject a delayed response before publishing it", async () => {
  for (const next of [session(2), session(1, "rotated-token")]) await harness(async ({ api }) => {
    const response = deferred();
    const pending = api.runAppDataRequest(api.captureAppDataAccess(), false, async () => response.promise);
    api.setStoredAuthSession(next);
    response.resolve("private old response");
    await assert.rejects(pending, { name: "AbortError" });
  });
});

test("the mutation lock includes delayed response-body decoding", async () => {
  await harness(async ({ api, requests }) => {
    const body = deferred();
    const order = [];
    globalThis.fetch = async (...args) => { requests.push(args); return { ok: true, status: 200, text: async () => { order.push("body pending"); return JSON.stringify(await body.promise); } }; };
    const pending = api.putAppStorageItem("edgelab", "proof", { value: "old" });
    await turn();
    const pendingRejected = assert.rejects(pending, reload);
    const replacement = api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => { order.push("replacement"); });
    await turn();
    assert.deepEqual(order, ["body pending"]);
    body.resolve({ namespace: "edgelab", key: "proof", value: "old", updated_at: null });
    await pendingRejected;
    await replacement;
    assert.deepEqual(order, ["body pending", "replacement"]);
  });
});

test("a delayed previous-generation GET cannot refill storage cache or mirrors", async () => {
  await harness(async ({ api, local }) => {
    const body = deferred();
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(await body.promise) });
    const pending = api.loadAppStorageItem("proof", null);
    const rejected = assert.rejects(pending, reload);
    await turn();
    local.setItem(epochKey, JSON.stringify({ revision: "external-replacement", phase: "ready" }));
    body.resolve({ namespace: "edgelab", key: "proof", value: "old private", updated_at: null });
    await rejected;
    assert.equal(local.getItem("edgelab.proof.user-1"), null);
    assert.equal(api.getCachedAppStorageItem("proof", null), null);
  });
});

test("new-generation server emptiness cannot migrate preserved legacy mirrors back to the server", async () => {
  await harness(async ({ api, requests }) => {
    assert.equal(await api.loadAppStorageItem("notebook-template.v1", "fresh fallback"), "fresh fallback");
    await turn();
    assert.equal(requests.length, 1);
    assert.equal(requests[0][1].method ?? "GET", "GET");
  }, { [epochKey]: JSON.stringify({ revision: "confirmed-generation", phase: "ready" }), "edgelab.notebook-template.v1": "old legacy template" });
});

test("blocked multi-key storage rejects before publishing optimistic values or reserving stale queues", async () => {
  await harness(async ({ api, local }) => {
    const changes = [];
    api.subscribeAppStorageItem("a", (value) => changes.push(value));
    await api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => {});
    changes.length = 0;
    await assert.rejects(api.saveAppStorageItem("a", "stale"), reload);
    await assert.rejects(api.saveAppStorageItemConfirmed("a", "stale"), reload);
    let request = false;
    await assert.rejects(api.confirmAppStorageOperations([{ key: "a" }, { key: "b" }], async () => { request = true; return []; }), reload);
    assert.equal(request, false);
    assert.deepEqual(changes, []);
    assert.equal(local.getItem("edgelab.a.user-1"), null);
  });
});


test("a pending marker left by a terminated tab blocks import even though its browser lock was released", async () => {
  await harness(async ({ api, local, requests }) => {
    local.setItem(`${uncertainKey}terminated-request`, "p");
    await assert.rejects(api.importAppDataBundle(portable), reload);
    assert.equal(requests.length, 0);
    assert.equal(local.getItem(epochKey), null);
    assert.equal(local.getItem(`${uncertainKey}terminated-request`), "p");
    const reloaded = await fresh();
    await assert.rejects(reloaded.importAppDataBundle(portable), reload);
    assert.equal(requests.length, 0);
  });
});

test("mutation reserves a durable pending marker before sending and clears it only after completion", async () => {
  await harness(async ({ api, local }) => {
    const completed = deferred();
    const active = api.runAppDataRequest(api.captureAppDataAccess(), true, async (progress) => {
      assert.equal(requestMarkers(local).length, 1);
      assert.equal(local.getItem(requestMarkers(local)[0]), "p");
      progress.sent();
      await completed.promise;
      progress.completed();
    });
    await turn();
    assert.equal(requestMarkers(local).length, 1);
    completed.resolve();
    await active;
    assert.deepEqual(requestMarkers(local), []);
  });
});

test("a failed request-marker reservation prevents mutation execution", async () => {
  await harness(async ({ api, local }) => {
    let sent = false;
    local.setItem = () => { throw new Error("storage unavailable"); };
    await assert.rejects(api.runAppDataRequest(api.captureAppDataAccess(), true, async () => { sent = true; }), /storage unavailable/);
    assert.equal(sent, false);
  });
});


test("raw portable mutations retain their shared lock while the cloned body is pending", async () => {
  await harness(async ({ api, local }) => {
    const body = deferred();
    const order = [];
    const response = { clone: () => ({ arrayBuffer: async () => { order.push("clone pending"); await body.promise; return new ArrayBuffer(0); } }) };
    globalThis.fetch = async () => response;
    const pending = api.authenticatedApiFetch("/journal/trades", { method: "PATCH", body: "{}" });
    const rejected = assert.rejects(pending, reload);
    await turn();
    assert.equal(requestMarkers(local).length, 1);
    const replacement = api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => { order.push("replacement"); });
    await turn();
    assert.deepEqual(order, ["clone pending"]);
    body.resolve();
    await rejected;
    await replacement;
    assert.deepEqual(order, ["clone pending", "replacement"]);
    assert.deepEqual(requestMarkers(local), []);
  });
});


test("replacement drains sent storage writes, cancels queued writes, and invalidates old memory", async () => {
  await harness(async ({ api, local, requests }) => {
    const body = deferred();
    globalThis.fetch = async (url, init) => {
      requests.push([url, init]);
      if (init.method === "PUT") return { ok: true, status: 200, text: async () => JSON.stringify(await body.promise) };
      assert.equal(init.method, "POST");
      assert.equal(local.getItem("edgelab.notebook-template.v1.user-1"), null);
      return json(acknowledgment(api));
    };
    await api.saveAppStorageItem("notebook-template.v1", "already sent");
    await turn();
    await api.saveAppStorageItem("notebook-template.v1", "queued draft");
    assert.equal(api.getCachedAppStorageItem("notebook-template.v1", null), "queued draft");
    const imported = api.importAppDataBundle(portable);
    await turn();
    assert.equal(requests.length, 1);
    body.resolve({ namespace: "edgelab", key: "notebook-template.v1", value: "already sent", updated_at: "2026-10-07T12:00:00Z" });
    await imported;
    assert.deepEqual(requests.map(([, init]) => init.method), ["PUT", "POST"]);
    assert.equal(local.getItem("edgelab.notebook-template.v1.user-1"), null);
    assert.equal(api.getCachedAppStorageItem("notebook-template.v1", null), null);
    const reloaded = await fresh();
    globalThis.fetch = async (url, init) => { requests.push([url, init]); return json({ namespace: "edgelab", key: "notebook-template.v1", value: "imported server value", updated_at: "2026-10-07T12:05:00Z" }); };
    assert.equal(await reloaded.loadAppStorageItem("notebook-template.v1", null), "imported server value");
    assert.equal(local.getItem(reloaded.appDataSessionKey("edgelab.notebook-template.v1.user-1", "user-1")), "imported server value");
    assert.equal(requests.length, 3);
  });
});


for (const path of ["/app-data/import", "/app-data/import/", "/%61pp-data/import", "/app-data/%69mport", "/app-data%2Fimport", "/app-data//import", "/app-data/./import", "/journal/../app-data/import", "/auth/../app-data/import", "/app-data/import?mode=replace", "/../api/app-data/import", "/..\\api/app-data/import", "/..%5capi/app-data/import", "/.\n./api/app-data/import"]) test(`raw import alias ${JSON.stringify(path)} is rejected before fetching`, async () => {
  await harness(async ({ api, requests }) => {
    for (const call of [api.apiRequest, api.authenticatedApiFetch]) await assert.rejects(call(path, { method: "POST", body: "{}" }), /validated account data import flow|API paths cannot contain/);
    assert.equal(requests.length, 0);
  });
});

for (const path of ["/datasets", "/datasets/settings", "/bootstrap", "/bootstrap-shell", "/backtests", "/backtests/latest", "/backtests/7", "/market-data/meta", "/market-data/bars?timeframe=M1"]) test(`unconfirmed writing GET ${path} blocks replacement`, async () => {
  await harness(async ({ api, local, requests }) => {
    const other = await fresh();
    globalThis.fetch = async (...args) => { requests.push(args); throw new TypeError("lost discovery response"); };
    await assert.rejects(api.apiRequest(path), /lost discovery response/);
    assert.equal(requestMarkers(local).length, 1);
    assert.equal(local.getItem(requestMarkers(local)[0]), "u");
    await assert.rejects(other.importAppDataBundle(portable), reload);
    assert.equal(requests.length, 1);
  });
});

test("raw catalog GET retains its shared lock through the cloned response body", async () => {
  await harness(async ({ api, local }) => {
    const body = deferred();
    let imported = false;
    globalThis.fetch = async () => ({ clone: () => ({ arrayBuffer: () => body.promise }) });
    const pending = api.authenticatedApiFetch("/datasets");
    const rejected = assert.rejects(pending, reload);
    await turn();
    assert.equal(requestMarkers(local).length, 1);
    const replacement = api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => { imported = true; });
    await turn();
    assert.equal(imported, false);
    body.resolve(new ArrayBuffer(0));
    await rejected;
    await replacement;
    assert.equal(imported, true);
    assert.deepEqual(requestMarkers(local), []);
  });
});

for (const path of ["/broker-connections/7/refresh", "/broker-sync-jobs/7/retry", "/broker-connections/7/refresh/", "/%62roker-sync-jobs/7/retry"]) test(`failed ${path} mutation durably blocks other-tab import`, async () => {
  await harness(async ({ api, local, requests }) => {
    const other = await fresh();
    globalThis.fetch = async (...args) => { requests.push(args); throw new TypeError("lost broker response"); };
    await assert.rejects(api.apiRequest(path, { method: "POST", body: "{}" }), /lost broker response/);
    assert.equal(requests.length, 1);
    assert.equal(requestMarkers(local).length, 1);
    assert.equal(local.getItem(requestMarkers(local)[0]), "u");
    await assert.rejects(other.importAppDataBundle(portable), reload);
    assert.equal(requests.length, 1);
  });
});

test("read-only single and grouped hydration can inspect ready-generation server data while uncertain saves stay blocked", async () => {
  await harness(async ({ api, local, requests }) => {
    const row = (key, value) => ({ namespace: "edgelab", key, value, updated_at: "2026-10-07T12:00:00Z" });
    const single = row("notebook-template.v1", "server preferences");
    const grouped = [row("active-chart-settings-preset.v1", "Server preset"), row("chart-settings-presets.v1", [{ name: "Server preset" }])];
    globalThis.fetch = async (path, init) => { requests.push([path, init]); return json(String(path).includes("chart-settings") ? grouped : single); };
    await api.confirmAppStorageOperation("notebook-template.v1", () => api.apiRequest("/settings/preferences"), "edgelab", undefined, { readOnly: true });
    await api.confirmAppStorageOperations([{ key: "active-chart-settings-preset.v1" }, { key: "chart-settings-presets.v1" }], () => api.apiRequest("/settings/chart-settings"), { readOnly: true });
    assert.equal(api.getCachedAppStorageItem("notebook-template.v1", null), "server preferences");
    assert.equal(api.getCachedAppStorageItem("active-chart-settings-preset.v1", null), "Server preset");
    assert.deepEqual(api.getCachedAppStorageItem("chart-settings-presets.v1", null), [{ name: "Server preset" }]);
    assert.equal(requests.length, 2);
    const generationKey = api.appDataSessionKey("edgelab.notebook-template.v1.user-1", "user-1");
    assert.notEqual(local.getItem(generationKey), null);
    let requested = false;
    await assert.rejects(api.confirmAppStorageOperation("notebook-template.v1", async () => { requested = true; return single; }), reload);
    await assert.rejects(api.confirmAppStorageOperations([{ key: "active-chart-settings-preset.v1" }, { key: "chart-settings-presets.v1" }], async () => { requested = true; return grouped; }), reload);
    await assert.rejects(api.saveAppStorageItem("notebook-template.v1", "stale optimistic preferences"), reload);
    assert.equal(requested, false);
    assert.equal(api.getCachedAppStorageItem("notebook-template.v1", null), "server preferences");
    assert.equal(requests.length, 2);
  }, { [epochKey]: JSON.stringify({ revision: "ready-generation", phase: "ready" }), [`${uncertainKey}failed-request`]: "u" });
});

test("replacement failure becomes uncertain only when the callback marks its network request sent", async () => {
  await harness(async ({ api, local }) => {
    await assert.rejects(api.runAppDataReplacement({ id: 1, token: "token-1" }, async (markSent) => { markSent(); throw new TypeError("replacement response lost"); }), /replacement response lost/);
    assert.equal(JSON.parse(local.getItem(epochKey)).phase, "uncertain");
    const reloaded = await fresh();
    reloaded.assertAppDataAccess(reloaded.captureAppDataAccess());
    await assert.rejects(reloaded.runAppDataReplacement({ id: 1, token: "token-1" }, async () => {}), reload);
  });
  await harness(async ({ api, local }) => {
    await assert.rejects(api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => { throw new DOMException("owner preflight changed", "AbortError"); }), { name: "AbortError" });
    assert.equal(JSON.parse(local.getItem(epochKey)).phase, "ready");
    const reloaded = await fresh();
    reloaded.assertAppDataAccess(reloaded.captureAppDataAccess(), true);
  });
});
