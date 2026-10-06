import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({ bundle: true, define: { "import.meta.env": "{}" }, format: "esm", platform: "node", write: false, logLevel: "silent", stdin: { contents: 'export * from "./frontend/src/lib/api.ts"; export * from "./frontend/src/lib/appDataBarrier.ts"; export { setStoredAuthSession } from "./frontend/src/lib/authSession.ts";', loader: "ts", resolveDir: root } }).outputFiles[0].text;
let instance = 0;
const fresh = () => import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}#${++instance}`);
const markerPrefix = "edgelab.app-data-uncertain.v1.user-1.";
const epochKey = "edgelab.app-data-generation.v1.user-1";
const operation = { version: 2, id: "11111111-1111-4111-8111-111111111111", method: "PUT", path: "/app-storage/edgelab/proof" };
const second = { ...operation, id: "22222222-2222-4222-8222-222222222222" };
const session = (id = 1, token = `token-${id}`) => ({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token, user: { approved: true, email: `owner-${id}@test.invalid`, id, name: "Owner", isBetaUser: true, plan: "beta", provider: "email", betaPosition: null } });
const receipt = (op = operation) => ({ operation_id: op.id, method: op.method, path: op.path, status: "completed", http_status: 200, result: null, created_at: "2026-10-07T12:00:00Z", completed_at: "2026-10-07T12:00:01Z" });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const memory = (values = new Map()) => ({ values, get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) });
const reload = (error) => error.requiresReload === true;
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function locks() {
  let readers = 0;
  let writer = false;
  const queue = [];
  const drain = () => {
    while (queue.length && !writer && (queue[0].mode !== "exclusive" || !readers)) {
      const job = queue.shift();
      if (job.mode === "exclusive") writer = true; else readers += 1;
      Promise.resolve().then(job.callback).then(job.resolve, job.reject).finally(() => { if (job.mode === "exclusive") writer = false; else readers -= 1; drain(); });
    }
  };
  return { request: (_name, options, callback) => new Promise((resolve, reject) => { queue.push({ ...options, callback, resolve, reject }); drain(); }) };
}

async function harness(run, markers = [operation]) {
  const previous = { window: globalThis.window, fetch: globalThis.fetch };
  const local = memory(new Map([["edgelab.auth.session.v1", JSON.stringify(session())]]));
  const drafts = memory();
  for (const op of markers) local.setItem(markerPrefix + op.id, JSON.stringify({ ...op, phase: "uncertain" }));
  globalThis.window = { localStorage: local, sessionStorage: drafts, navigator: { locks: locks() }, crypto: globalThis.crypto, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const requests = [];
  globalThis.fetch = async (path, init) => {
    requests.push({ path: String(path), init });
    const op = markers.find((item) => String(path).includes(item.id));
    return json(receipt(op));
  };
  try { await run({ api: await fresh(), local, drafts, requests }); }
  finally { globalThis.fetch = previous.fetch; if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window; }
}

test("terminal recovery rotates the generation, purges only owner mirrors, and requires a reload before writes", async () => {
  await harness(async ({ api, local, drafts, requests }) => {
    local.setItem("edgelab.proof.user-1", "stale value");
    local.setItem("edgelab.proof.user-2", "other owner's value");
    local.setItem("edgelab.proof", "legacy value");
    drafts.setItem("edgelab.navigation-surfaces.v3.user-1", "stale draft");
    const old = api.captureAppDataAccess();
    await api.recoverAccountDataOperations();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.method, "POST");
    assert.equal(requests[0].init.headers.get("Authorization"), "Bearer token-1");
    assert.match(requests[0].path, /\/recover$/);
    assert.equal(local.getItem(markerPrefix + operation.id), null);
    assert.equal(local.getItem("edgelab.proof.user-1"), null);
    assert.equal(drafts.getItem("edgelab.navigation-surfaces.v3.user-1"), null);
    assert.equal(local.getItem("edgelab.proof.user-2"), "other owner's value");
    assert.equal(local.getItem("edgelab.proof"), "legacy value");
    assert.equal(JSON.parse(local.getItem(epochKey)).phase, "ready");
    assert.throws(() => api.assertAppDataAccess(old, true), reload);
    const reloaded = await fresh();
    reloaded.assertAppDataAccess(reloaded.captureAppDataAccess(), true);
  });
});

for (const [label, mutate] of [
  ["wrong ID", (value) => ({ ...value, operation_id: second.id })],
  ["wrong method", (value) => ({ ...value, method: "DELETE" })],
  ["wrong path", (value) => ({ ...value, path: "/journal/trades" })],
  ["running", (value) => ({ ...value, status: "running", http_status: null, completed_at: null })],
  ["reserved", (value) => ({ ...value, status: "reserved", http_status: null, completed_at: null })],
  ["unknown status", (value) => ({ ...value, status: "finished" })],
  ["noninteger HTTP status", (value) => ({ ...value, http_status: 200.5 })],
  ["missing HTTP status", (value) => ({ ...value, http_status: null })],
  ["invalid creation date", (value) => ({ ...value, created_at: "2026-02-30T12:00:00Z" })],
  ["invalid completion date", (value) => ({ ...value, completed_at: "yesterday" })],
  ["missing completion date", (value) => ({ ...value, completed_at: null })],
]) test(`recovery rejects ${label} without dropping durable uncertainty or purging drafts`, async () => {
  await harness(async ({ api, local }) => {
    local.setItem("edgelab.proof.user-1", "unconfirmed draft");
    globalThis.fetch = async () => json(mutate(receipt()));
    await assert.rejects(api.recoverAccountDataOperations());
    assert.notEqual(local.getItem(markerPrefix + operation.id), null);
    assert.equal(local.getItem("edgelab.proof.user-1"), "unconfirmed draft");
    assert.throws(() => api.assertAppDataAccess(api.captureAppDataAccess(), true), reload);
  });
});

test("recovery is all-or-nothing when one of multiple receipts still runs", async () => {
  await harness(async ({ api, local, requests }) => {
    globalThis.fetch = async (path, init) => {
      requests.push({ path, init });
      return json(String(path).includes(second.id) ? { ...receipt(second), status: "running", completed_at: null, http_status: null } : receipt());
    };
    await assert.rejects(api.recoverAccountDataOperations());
    for (const op of [operation, second]) assert.notEqual(local.getItem(markerPrefix + op.id), null);
    assert.equal(local.getItem(epochKey), null);
  }, [operation, second]);
});

for (const value of ["p", "u", "invalid json", JSON.stringify({ ...operation, version: 3, phase: "uncertain" })]) test(`legacy or invalid marker ${value} is never cleared by a guessed receipt`, async () => {
  await harness(async ({ api, local, requests }) => {
    local.setItem(markerPrefix + operation.id, value);
    await assert.rejects(api.recoverAccountDataOperations());
    assert.equal(local.getItem(markerPrefix + operation.id), value);
    assert.equal(requests.length, 0);
  });
});

test("owner change while recovering prevents receipt publication or deletion", async () => {
  await harness(async ({ api, local }) => {
    const pending = deferred();
    globalThis.fetch = async () => pending.promise;
    const recovery = api.recoverAccountDataOperations();
    await turn();
    api.setStoredAuthSession(session(2));
    pending.resolve(json(receipt()));
    await assert.rejects(recovery, { name: "AbortError" });
    assert.notEqual(local.getItem(markerPrefix + operation.id), null);
    assert.equal(local.getItem(epochKey), null);
  });
});

for (const failure of ["epoch write", "purge", "marker removal", "silent marker removal"]) test(`recovery storage failure during ${failure} remains blocked after a reload`, async () => {
  await harness(async ({ api, local }) => {
    local.setItem("edgelab.proof.user-1", "stale");
    const set = local.setItem;
    const remove = local.removeItem;
    local.setItem = (key, value) => { if (failure === "epoch write" && key === epochKey) throw new Error("write denied"); return set(key, value); };
    local.removeItem = (key) => { if (failure === "silent marker removal" && key.startsWith(markerPrefix)) return; if ((failure === "purge" && key === "edgelab.proof.user-1") || (failure === "marker removal" && key.startsWith(markerPrefix))) throw new Error("remove denied"); return remove(key); };
    await assert.rejects(api.recoverAccountDataOperations());
    const reloaded = await fresh();
    assert.throws(() => reloaded.assertAppDataAccess(reloaded.captureAppDataAccess(), true), reload);
  });
});

for (const status of ["completed", "canceled"]) test(`a terminal ${status} receipt permits cold-reload mutations`, async () => {
  await harness(async ({ api }) => {
    globalThis.fetch = async () => json(status === "completed" ? { ...receipt(), http_status: 500 } : { ...receipt(), method: null, path: null, status: "canceled", http_status: null });
    await api.recoverAccountDataOperations();
    const reloaded = await fresh();
    reloaded.assertAppDataAccess(reloaded.captureAppDataAccess(), true);
  });
});

for (const [label, mutate] of [
  ["HTTP error", () => json({ detail: "Cannot reserve" }, 503)],
  ["wrong operation ID", (value) => json({ ...value, operation_id: second.id })],
  ["wrong method", (value) => json({ ...value, method: "DELETE" })],
  ["wrong path", (value) => json({ ...value, path: "/journal/trades" })],
  ["already running", (value) => json({ ...value, status: "running" })],
  ["canceled", (value) => json({ ...value, status: "canceled", completed_at: "2026-10-07T12:00:01Z" })],
  ["completed", (value) => json({ ...value, status: "completed", completed_at: "2026-10-07T12:00:01Z", http_status: 200 })],
  ["malformed JSON", () => new Response("not JSON")],
]) test(`invalid reservation ${label} never sends the business mutation`, async () => {
  await harness(async ({ api }) => {
    let writes = 0;
    let reserves = 0;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        reserves += 1;
        const id = String(path).split("/").at(-2);
        const reserved = { ...receipt({ ...operation, id }), ...JSON.parse(init.body), status: "reserved", http_status: null, completed_at: null };
        return mutate(reserved);
      }
      if (String(path).endsWith("/recover")) {
        const id = String(path).split("/").at(-2);
        return json({ ...receipt({ ...operation, id }), status: "canceled", http_status: null });
      }
      writes += 1;
      return json({ value: "unsafe" });
    };
    await assert.rejects(api.apiRequest(operation.path, { method: "PUT", body: "{}" }));
    assert.equal(reserves, 1);
    assert.equal(writes, 0);
  }, []);
});

test("a completed HTTP response does not release its shared lock before receipt verification", async () => {
  await harness(async ({ api, local }) => {
    const terminal = deferred();
    const observed = [];
    let id;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        id = String(path).split("/").at(-2);
        return json({ ...receipt({ ...operation, id }), ...JSON.parse(init.body), status: "reserved", http_status: null, completed_at: null });
      }
      if (String(path).endsWith("/recover")) { observed.push("receipt pending"); await terminal.promise; return json(receipt({ ...operation, id })); }
      observed.push("mutation sent");
      assert.equal(new Headers(init.headers).get("X-EdgeLab-Operation-Id"), id);
      return json({ value: "confirmed" });
    };
    const pending = api.apiRequest(operation.path, { method: "PUT", body: "{}" });
    const rejected = assert.rejects(pending, reload);
    await turn();
    const replacement = api.runAppDataReplacement({ id: 1, token: "token-1" }, async () => { observed.push("replacement"); });
    await turn();
    assert.deepEqual(observed, ["mutation sent", "receipt pending"]);
    assert.equal([...local.values.keys()].filter((key) => key.startsWith(markerPrefix)).length, 1);
    terminal.resolve();
    await rejected;
    await replacement;
    assert.deepEqual(observed, ["mutation sent", "receipt pending", "replacement"]);
  }, []);
});

test("a lost import response uses its completed server receipt without replaying the import", async () => {
  await harness(async ({ api, local }) => {
    const source = { app: "edgelab", version: 1, tables: { app_storage: [{ id: 1 }] } };
    const expected = Object.fromEntries(api.APP_DATA_TABLE_NAMES.map((name) => [name, source.tables[name]?.length ?? 0]));
    const result = { ok: true, imported_at: "2026-10-07T12:00:01Z", summary: expected };
    let imported = 0;
    let op;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        op = { ...operation, id: String(path).split("/").at(-2), ...JSON.parse(init.body) };
        return json({ ...receipt(op), status: "reserved", http_status: null, completed_at: null });
      }
      if (String(path).endsWith("/recover")) return json({ ...receipt(op), result });
      imported += 1;
      assert.equal(new Headers(init.headers).get("X-EdgeLab-Operation-Id"), op.id);
      throw new TypeError("import response lost");
    };
    assert.deepEqual(await api.importAppDataBundle(source), result);
    assert.equal(imported, 1);
    assert.equal(JSON.parse(local.getItem(epochKey)).phase, "ready");
    await assert.rejects(api.importAppDataBundle(source), /Reload/);
    assert.equal(imported, 1);
  }, []);
});

for (const [label, mutate] of [
  ["matching counts", (result) => result],
  ["wrong counts", (result) => ({ ...result, summary: { ...result.summary, app_storage: 2 } })],
  ["missing counts", (result) => { const copy = structuredClone(result); delete copy.summary.trades; return copy; }],
  ["extra counts", (result) => ({ ...result, summary: { ...result.summary, unknown: 0 } })],
  ["missing result", () => null],
  ["wrong success flag", (result) => ({ ...result, ok: false })],
  ["invalid import time", (result) => ({ ...result, imported_at: "2026-02-30T12:00:00Z" })],
]) test(`interrupted import recovery verifies ${label} against the frozen submitted table counts`, async () => {
  await harness(async ({ api, local }) => {
    const counts = Object.fromEntries(api.APP_DATA_TABLE_NAMES.map((name) => [name, name === "app_storage" ? 1 : 0]));
    const importedOperation = { ...operation, method: "POST", path: "/app-data/import", expected: counts };
    const epoch = { revision: "interrupted-import", phase: "uncertain", operation: importedOperation };
    local.setItem(epochKey, JSON.stringify(epoch));
    const result = { ok: true, imported_at: "2026-10-07T12:00:01Z", summary: counts };
    globalThis.fetch = async () => json({ ...receipt(importedOperation), result: mutate(result) });
    if (label === "matching counts") {
      const recovered = await api.recoverAccountDataOperations();
      assert.equal(recovered.requiresReload, true);
      assert.deepEqual(recovered.results[0].result, result);
      assert.equal(JSON.parse(local.getItem(epochKey)).phase, "ready");
    } else {
      await assert.rejects(api.recoverAccountDataOperations());
      assert.deepEqual(JSON.parse(local.getItem(epochKey)), epoch);
      const reloaded = await fresh();
      assert.throws(() => reloaded.assertAppDataAccess(reloaded.captureAppDataAccess(), true), reload);
    }
  }, []);
});

for (const failure of ["running", "query network error", "query HTTP error", "query malformed JSON"]) test(`lost import with ${failure} retains its receipt and never automatically retries the replacement`, async () => {
  await harness(async ({ api, local }) => {
    const source = { app: "edgelab", version: 1, tables: {} };
    let imports = 0;
    let op;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        op = { ...operation, id: String(path).split("/").at(-2), ...JSON.parse(init.body) };
        return json({ ...receipt(op), status: "reserved", http_status: null, completed_at: null });
      }
      if (String(path).endsWith("/recover")) {
        if (failure === "query network error") throw new TypeError("receipt unreachable");
        if (failure === "query HTTP error") return json({ detail: "temporarily unavailable" }, 503);
        if (failure === "query malformed JSON") return new Response("not JSON");
        return json({ ...receipt(op), status: "running", http_status: null, completed_at: null });
      }
      imports += 1;
      throw new TypeError("import response lost");
    };
    await assert.rejects(api.importAppDataBundle(source), reload);
    assert.equal(imports, 1);
    const epoch = JSON.parse(local.getItem(epochKey));
    assert.equal(epoch.phase, "uncertain");
    assert.equal(epoch.operation.id, op.id);
    assert.equal(Object.keys(epoch.operation.expected).length, 23);
    await assert.rejects(api.importAppDataBundle(source), /Reload/);
    assert.equal(imports, 1);
  }, []);
});

test("a tab opened during recovery must reload after the ready generation changes", async () => {
  await harness(async ({ api }) => {
    const terminal = deferred();
    globalThis.fetch = async () => { await terminal.promise; return json(receipt()); };
    const pending = api.recoverAccountDataOperations();
    await turn();
    const middle = await fresh();
    const access = middle.captureAppDataAccess();
    terminal.resolve();
    await pending;
    assert.throws(() => middle.assertAppDataAccess(access, true), reload);
    const ready = await fresh();
    ready.assertAppDataAccess(ready.captureAppDataAccess(), true);
  });
});

test("new durable work during recovery invalidates the whole receipt batch before purging", async () => {
  await harness(async ({ api, local }) => {
    local.setItem("edgelab.proof.user-1", "preserved draft");
    globalThis.fetch = async () => {
      local.setItem(markerPrefix + second.id, JSON.stringify({ ...second, phase: "pending" }));
      return json(receipt());
    };
    await assert.rejects(api.recoverAccountDataOperations(), /Recovery state changed/);
    assert.equal(local.getItem(epochKey), null);
    assert.equal(local.getItem("edgelab.proof.user-1"), "preserved draft");
    assert.notEqual(local.getItem(markerPrefix + operation.id), null);
    assert.notEqual(local.getItem(markerPrefix + second.id), null);
  });
});

test("a closed-tab pending reservation is canceled before import and requires a fresh page", async () => {
  await harness(async ({ api, local, requests }) => {
    local.setItem(markerPrefix + operation.id, JSON.stringify({ ...operation, phase: "pending" }));
    globalThis.fetch = async (path, init) => { requests.push({ path: String(path), init }); return json({ ...receipt(), status: "canceled", http_status: null }); };
    await assert.rejects(api.importAppDataBundle({ app: "edgelab", version: 1, tables: {} }), reload);
    assert.equal(requests.length, 1);
    assert.match(requests[0].path, /\/recover$/);
    assert.equal(local.getItem(markerPrefix + operation.id), null);
    const ready = await fresh();
    ready.assertAppDataAccess(ready.captureAppDataAccess(), true);
  });
});

test("a closed-tab pending operation still running on the server prevents replacement", async () => {
  await harness(async ({ api, local, requests }) => {
    local.setItem(markerPrefix + operation.id, JSON.stringify({ ...operation, phase: "pending" }));
    globalThis.fetch = async (path, init) => { requests.push({ path: String(path), init }); return json({ ...receipt(), status: "running", http_status: null, completed_at: null }); };
    await assert.rejects(api.importAppDataBundle({ app: "edgelab", version: 1, tables: {} }), reload);
    assert.equal(requests.length, 1);
    assert.match(requests[0].path, /\/recover$/);
    assert.notEqual(local.getItem(markerPrefix + operation.id), null);
    assert.equal(local.getItem(epochKey), null);
  });
});

test("receipt reservation pins the owner and discards the result after an account switch", async () => {
  await harness(async ({ api }) => {
    const reserved = deferred();
    let op;
    let actual = 0;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        op = { ...operation, id: String(path).split("/").at(-2), ...JSON.parse(init.body) };
        assert.equal(new Headers(init.headers).get("Authorization"), "Bearer token-1");
        await reserved.promise;
        return json({ ...receipt(op), status: "reserved", http_status: null, completed_at: null });
      }
      actual += 1;
      return json({});
    };
    const pending = api.apiRequest(operation.path, { method: "PUT", body: "{}" });
    await turn();
    api.setStoredAuthSession(session(2));
    reserved.resolve();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(actual, 0);
  }, []);
});

for (const mismatch of ["canceled success", "different HTTP status"]) test(`mutation response with ${mismatch} remains uncertain`, async () => {
  await harness(async ({ api, local }) => {
    let op;
    let mutations = 0;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        op = { ...operation, id: String(path).split("/").at(-2), ...JSON.parse(init.body) };
        return json({ ...receipt(op), status: "reserved", http_status: null, completed_at: null });
      }
      if (String(path).endsWith("/recover")) return json(mismatch === "canceled success" ? { ...receipt(op), status: "canceled", http_status: null } : { ...receipt(op), http_status: 500 });
      mutations += 1;
      return json({ value: "untrusted success" });
    };
    await assert.rejects(api.apiRequest(operation.path, { method: "PUT", body: "{}" }), reload);
    assert.equal(mutations, 1);
    assert.equal(JSON.parse(local.getItem(markerPrefix + op.id)).phase, "uncertain");
    assert.throws(() => api.assertAppDataAccess(api.captureAppDataAccess(), true), reload);
  }, []);
});

test("a matching completed failure preserves the API error and clears its finished mutation marker", async () => {
  await harness(async ({ api, local }) => {
    let op;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        op = { ...operation, id: String(path).split("/").at(-2), ...JSON.parse(init.body) };
        return json({ ...receipt(op), status: "reserved", http_status: null, completed_at: null });
      }
      if (String(path).endsWith("/recover")) return json({ ...receipt(op), http_status: 422 });
      return json({ detail: "Invalid field" }, 422);
    };
    await assert.rejects(api.apiRequest(operation.path, { method: "PUT", body: "{}" }), (error) => error.name === "ApiError" && error.status === 422 && /Invalid field/.test(error.message));
    assert.equal(local.getItem(markerPrefix + op.id), null);
    api.assertAppDataAccess(api.captureAppDataAccess(), true);
  }, []);
});

test("import freezes its body and table counts before awaiting a live save during recovery preflight", async () => {
  await harness(async ({ api, local }) => {
    const saveBody = deferred();
    const operations = new Map();
    const source = { app: "edgelab", version: 1, tables: { app_storage: [{ id: 7, value: { theme: "dark" } }], journal_accounts: [{ id: 12 }] } };
    const initial = structuredClone(source);
    const counts = Object.fromEntries(api.APP_DATA_TABLE_NAMES.map((name) => [name, initial.tables[name]?.length ?? 0]));
    const imported = { ok: true, imported_at: "2026-10-07T12:00:01Z", summary: counts };
    let importBody;
    let saveSent = false;
    globalThis.fetch = async (path, init) => {
      if (String(path).endsWith("/reserve")) {
        const op = { ...operation, id: String(path).split("/").at(-2), ...JSON.parse(init.body) };
        operations.set(op.id, op);
        return json({ ...receipt(op), status: "reserved", http_status: null, completed_at: null });
      }
      if (String(path).endsWith("/recover")) {
        const op = operations.get(String(path).split("/").at(-2));
        return json({ ...receipt(op), result: op.path === "/app-data/import" ? imported : null });
      }
      if (String(path).endsWith(operation.path)) {
        saveSent = true;
        return { ok: true, status: 200, text: async () => { await saveBody.promise; return JSON.stringify({ value: "saved" }); } };
      }
      assert.equal(String(path), "/api/app-data/import");
      importBody = JSON.parse(init.body);
      const epoch = JSON.parse(local.getItem(epochKey));
      assert.deepEqual(epoch.operation.expected, counts);
      return json(imported);
    };
    const save = api.apiRequest(operation.path, { method: "PUT", body: "{}" }).catch((error) => { assert.equal(error.requiresReload, true); });
    await turn();
    assert.equal(saveSent, true);
    const pending = api.importAppDataBundle(source);
    source.tables.app_storage[0].value.theme = "light";
    source.tables.app_storage.push({ id: 9 });
    delete source.tables.journal_accounts;
    source.tables.positions = [{ id: 100 }];
    await turn();
    assert.equal(importBody, undefined, "replacement waits for the shared save and its response body");
    saveBody.resolve();
    assert.deepEqual(await pending, imported);
    await save;
    assert.deepEqual(importBody, initial);
  }, []);
});

for (const failure of ["network rejection", "response-body rejection"]) test(`public recovery discards ${failure} after an owner change without modifying recovery state`, async () => {
  await harness(async ({ api, local }) => {
    const delayed = deferred();
    const originalMarker = local.getItem(markerPrefix + operation.id);
    const originalEpoch = local.getItem(epochKey);
    let requested = false;
    globalThis.fetch = async () => {
      requested = true;
      if (failure === "network rejection") { await delayed.promise; throw new TypeError("old owner's network error"); }
      return { ok: true, status: 200, text: async () => { await delayed.promise; throw new TypeError("old owner's response body error"); } };
    };
    const pending = api.recoverAccountDataOperations();
    await turn();
    assert.equal(requested, true);
    api.setStoredAuthSession(session(2));
    delayed.resolve();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(local.getItem(markerPrefix + operation.id), originalMarker);
    assert.equal(local.getItem(epochKey), originalEpoch);
  });
});
