import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const bundle = buildSync({
  bundle: true, define: { "import.meta.env": "{}" }, format: "esm", logLevel: "silent",
  platform: "node", target: "node22", write: false,
  stdin: { contents: 'export * from "./frontend/src/lib/api.ts"; export { setStoredAuthSession } from "./frontend/src/lib/authSession.ts";', loader: "ts", resolveDir: repoRoot, sourcefile: "app-data-transfer-entry.ts" },
}).outputFiles[0].text;
let instance = 0;
const freshApi = () => import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}#${++instance}`);
const api = await freshApi();
const tables = api.APP_DATA_TABLE_NAMES;
const timestamp = "2026-10-07T12:00:00.123456Z";
const ownerSession = (id) => ({
  createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token: `owner-${id}`,
  user: { approved: true, email: `owner-${id}@example.com`, id, name: `Owner ${id}`, isBetaUser: true, plan: "beta", provider: "google", betaPosition: null },
});
const emptyTables = () => Object.fromEntries(tables.map((name) => [name, []]));
const partialBundle = () => ({ app: "edgelab", version: 1, tables: { app_storage: [{ id: 7, value: { theme: "dark" } }], journal_accounts: [{ id: 12 }, { id: 20 }] } });
const completeBundle = () => ({ app: "edgelab", version: 1, exported_at: timestamp, tables: emptyTables() });
const countsFor = (value) => Object.fromEntries(tables.map((name) => [name, value.tables[name]?.length ?? 0]));
const acknowledgment = (value) => ({ ok: true, imported_at: timestamp, summary: countsFor(value) });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const uncertain = (error) => error.name === "AppDataImportUncertainError" && error.requiresReload === true;

async function withHarness(run) {
  const transfer = await freshApi(); // A reload creates a fresh module and clears its owner locks.
  const previous = { fetch: globalThis.fetch, window: globalThis.window };
  const storage = new Map();
  const requests = [];
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, dispatchEvent() {}, addEventListener() {} };
  transfer.setStoredAuthSession(ownerSession(1));
  const harness = {
    api: transfer, requests, storage,
    fetch: (handler, expectedToken) => { globalThis.fetch = async (path, init) => {
      const url = new URL(path, "http://fixture");
      const session = JSON.parse(storage.get("edgelab.auth.session.v1"));
      assert.equal(init.headers.get("Authorization"), `Bearer ${expectedToken ?? session.token}`);
      requests.push({ url, init });
      return handler(url, init, requests.length);
    }; },
  };
  try { await run(harness); }
  finally { globalThis.fetch = previous.fetch; if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window; }
}

test("frontend transfer tables exactly match the bounded backend registry", () => {
  const source = readFileSync(new URL("../app/api/routes.py", import.meta.url), "utf8");
  const registry = source.match(/^APP_DATA_TABLES = \[\n([\s\S]*?)^\]/m);
  assert.ok(registry, "backend registry must have an explicit bounded list");
  const names = [...registry[1].matchAll(/^\s*\("([a-z_]+)",\s*\w+\),?$/gm)].map((match) => match[1]);
  assert.equal(names.length, 23);
  assert.deepEqual(tables, names);
  assert.equal(Object.isFrozen(tables), true);
});

test("partial imports allow omitted tables, empty tables, and table-local record IDs", () => {
  for (const value of [
    { app: "edgelab", version: 1, tables: {} },
    { app: "edgelab", version: 1, exported_at: null, tables: { app_storage: [] } },
    { app: "edgelab", version: 1, tables: { app_storage: [{ id: 1 }], journal_accounts: [{ id: 1 }] } },
    partialBundle(),
  ]) assert.equal(api.validateAppDataBundle(value), value);
});

const invalidBundles = [
  ["null envelope", () => null], ["array envelope", () => []], ["class envelope", () => new Date()],
  ["wrong app", () => ({ ...partialBundle(), app: "other" })],
  ...[0, 2, "1", true, null, undefined].map((version) => [`version ${String(version)}`, () => ({ ...partialBundle(), version })]),
  ["extra envelope field", () => ({ ...partialBundle(), future_option: true })],
  ["missing tables", () => ({ app: "edgelab", version: 1 })],
  ["null tables", () => ({ ...partialBundle(), tables: null })],
  ["array tables", () => ({ ...partialBundle(), tables: [] })],
  ["class tables", () => ({ ...partialBundle(), tables: new Date() })],
  ["unknown table", () => ({ ...partialBundle(), tables: { future_table: [] } })],
  ...[null, {}, "rows"].map((rows) => [`non-array rows ${String(rows)}`, () => ({ ...partialBundle(), tables: { app_storage: rows } })]),
  ...[null, [], new Date(), {}, { id: 0 }, { id: -1 }, { id: 1.5 }, { id: "1" }, { id: true }, { id: Number.MAX_SAFE_INTEGER + 1 }].map((row, index) => [`invalid record ${index}`, () => ({ ...partialBundle(), tables: { app_storage: [row] } })]),
  ["duplicate IDs", () => ({ ...partialBundle(), tables: { app_storage: [{ id: 7 }, { id: 7 }] } })],
  ...["not a date", "2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-13-01T00:00:00Z", "0000-01-01T00:00:00Z", "2026-10-07T24:00:00Z", "2026-10-07T00:60:00Z", "2026-10-07T00:00:60Z", "2026-10-07", 12].map((exported_at) => [`invalid timestamp ${String(exported_at)}`, () => ({ ...partialBundle(), exported_at })]),
];

for (const [label, makeValue] of invalidBundles) test(`invalid ${label} is rejected before a request or import lock`, async () => {
  assert.throws(() => api.validateAppDataBundle(makeValue()));
  await withHarness(async ({ api, fetch, requests }) => {
    const valid = partialBundle();
    fetch(() => response(acknowledgment(valid)));
    await assert.rejects(api.importAppDataBundle(makeValue()));
    assert.equal(requests.length, 0);
    await api.importAppDataBundle(valid);
    assert.equal(requests.length, 1);
  });
});

test("complete exports require every table and a valid creation timestamp", () => {
  const value = completeBundle();
  assert.equal(api.validateAppDataBundle(value, true), value);
  for (const name of tables) {
    const incomplete = completeBundle();
    delete incomplete.tables[name];
    assert.throws(() => api.validateAppDataBundle(incomplete, true), /incomplete/);
  }
  for (const exported_at of [undefined, null, "2026-02-30T00:00:00Z"])
    assert.throws(() => api.validateAppDataBundle({ ...value, exported_at }, true), /creation time/);
  assert.equal(api.validateAppDataBundle({ ...value, exported_at: "2024-02-29T23:59:59+05:30" }, true).app, "edgelab");
});

test("export helper requests and validates the complete 23-table server bundle", async () => {
  await withHarness(async ({ api, fetch, requests }) => {
    const value = completeBundle();
    fetch(() => response(value));
    assert.deepEqual(await api.exportAppDataBundle(), value);
    assert.equal(requests[0].url.pathname, "/api/app-data/export");
    assert.equal(requests[0].init.method ?? "GET", "GET");
  });
});

for (const [label, makeValue] of [
  ["partial", partialBundle],
  ["missing timestamp", () => ({ ...completeBundle(), exported_at: undefined })],
  ["invalid row", () => ({ ...completeBundle(), tables: { ...emptyTables(), app_storage: [{ id: "7" }] } })],
]) test(`export helper rejects ${label} server data`, async () => {
  await withHarness(async ({ api, fetch }) => {
    fetch(() => response(makeValue()));
    await assert.rejects(api.exportAppDataBundle());
  });
});

const invalidAcknowledgments = [
  ["null", (value) => null], ["array", (value) => []],
  ["ok false", (value) => ({ ...value, ok: false })],
  ["missing ok", ({ ok, ...value }) => value],
  ["missing summary", ({ summary, ...value }) => value],
  ["array summary", (value) => ({ ...value, summary: [] })],
  ["missing table", (value) => { delete value.summary.app_storage; return value; }],
  ["unknown table replacing a known table", (value) => { delete value.summary.app_storage; value.summary.future_table = 1; return value; }],
  ["extra table", (value) => ({ ...value, summary: { ...value.summary, future_table: 0 } })],
  ...[-1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1, null, 2].map((count) => [`invalid or mismatched count ${String(count)}`, (value) => ({ ...value, summary: { ...value.summary, app_storage: count } })]),
  ...[undefined, "yesterday", "2026-02-30T00:00:00Z", "2026-10-07"].map((imported_at) => [`invalid import time ${String(imported_at)}`, (value) => ({ ...value, imported_at })]),
];

for (const [label, mutate] of invalidAcknowledgments) test(`invalid acknowledgment ${label} is uncertain in validator and import helper`, async () => {
  const source = partialBundle();
  assert.throws(() => api.validateAppDataImportResult(mutate(acknowledgment(source)), countsFor(source)), uncertain);
  await withHarness(async ({ api, fetch, requests }) => {
    fetch(() => response(mutate(acknowledgment(source))));
    await assert.rejects(api.importAppDataBundle(source), uncertain);
    await assert.rejects(api.importAppDataBundle(source), /Reload/);
    assert.equal(requests.length, 1);
  });
});

test("import accepts exact counts for all tables, including zero counts for omitted tables", async () => {
  await withHarness(async ({ api, fetch, requests }) => {
    const source = partialBundle();
    const result = acknowledgment(source);
    assert.equal(Object.keys(result.summary).length, 23);
    assert.equal(result.summary.app_storage, 1);
    assert.equal(result.summary.journal_accounts, 2);
    assert.equal(result.summary.positions, 0);
    assert.equal(api.validateAppDataImportResult(result, countsFor(source)), result);
    fetch(() => response(result));
    assert.deepEqual(await api.importAppDataBundle(source), result);
    assert.equal(requests[0].url.pathname, "/api/app-data/import");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body), source);
  });
});

test("duplicate pending imports send only one replacement POST", async () => {
  await withHarness(async ({ api, fetch, requests }) => {
    const source = partialBundle();
    const active = deferred();
    fetch(() => active.promise);
    const first = api.importAppDataBundle(source);
    await assert.rejects(api.importAppDataBundle(source), /already running/);
    assert.equal(requests.length, 1);
    active.resolve(response(acknowledgment(source)));
    await first;
    await assert.rejects(api.importAppDataBundle(source), /Reload/);
    assert.equal(requests.length, 1);
  });
});

for (const outcome of ["success", "HTTP failure", "network failure", "malformed JSON", "malformed acknowledgment"])
  test(`a sent ${outcome} import stays blocked for its owner after token refresh; another owner may import`, async () => {
    await withHarness(async ({ api, fetch, requests }) => {
      const source = partialBundle();
      fetch((_url, _init, index) => {
        if (index > 1 || outcome === "success") return response(acknowledgment(source));
        if (outcome === "HTTP failure") return response({ detail: "Storage unavailable" }, 500);
        if (outcome === "network failure") throw new TypeError("Network interrupted");
        if (outcome === "malformed JSON") return new Response("not JSON", { status: 200 });
        return response({ ok: true });
      });
      if (outcome === "success") await api.importAppDataBundle(source);
      else await assert.rejects(api.importAppDataBundle(source), uncertain);
      api.setStoredAuthSession({ ...ownerSession(1), token: "refreshed-owner-1" });
      await assert.rejects(api.importAppDataBundle(source), /Reload/);
      assert.equal(requests.length, 1);
      api.setStoredAuthSession(ownerSession(2));
      await api.importAppDataBundle(source);
      assert.equal(requests.length, 2);
    });
  });

const sessionChanges = [
  ["owner", (api) => api.setStoredAuthSession(ownerSession(2))],
  ["same-token owner", (api) => api.setStoredAuthSession({ ...ownerSession(2), token: "owner-1" })],
  ["token", (api) => api.setStoredAuthSession({ ...ownerSession(1), token: "refreshed-owner-1" })],
  ["expiry", (api) => api.setStoredAuthSession({ ...ownerSession(1), expiresAt: "2000-01-01T00:00:00Z" })],
  ["sign-out", (api) => api.setStoredAuthSession(null)],
];
for (const operation of ["export", "import"])
  for (const outcome of ["success", "HTTP failure", "network failure"])
  for (const [label, change] of sessionChanges) test(`${operation} discards a pending ${outcome} response after ${label} changes`, async () => {
    await withHarness(async ({ api, fetch, requests }) => {
      const source = partialBundle();
      const active = deferred();
      fetch(() => active.promise);
      const pending = operation === "export" ? api.exportAppDataBundle() : api.importAppDataBundle(source);
      change(api);
      active.resolve(outcome === "HTTP failure" ? response({ detail: "Previous owner storage unavailable" }, 500)
        : outcome === "network failure" ? Promise.reject(new TypeError("Previous owner network interrupted"))
        : response(operation === "export" ? completeBundle() : acknowledgment(source)));
      await assert.rejects(pending, { name: "AbortError" });
      assert.equal(requests.length, 1);
      if (operation === "import") {
        api.setStoredAuthSession(ownerSession(1));
        await assert.rejects(api.importAppDataBundle(source), /Reload/);
        assert.equal(requests.length, 1);
      }
    });
  });

for (const operation of ["export", "import"]) test(`${operation} rejects a session that expires without a storage change`, async () => {
  await withHarness(async ({ api, fetch }) => {
    const originalNow = Date.now;
    const start = originalNow();
    api.setStoredAuthSession({ ...ownerSession(1), expiresAt: new Date(start + 1000).toISOString() });
    const source = partialBundle();
    const active = deferred();
    fetch(() => active.promise);
    const pending = operation === "export" ? api.exportAppDataBundle() : api.importAppDataBundle(source);
    try {
      Date.now = () => start + 2000;
      active.resolve(response(operation === "export" ? completeBundle() : acknowledgment(source)));
      await assert.rejects(pending, { name: "AbortError" });
    } finally { Date.now = originalNow; }
  });
});

test("mutating the caller bundle during a pending import cannot change its submitted body or expected counts", async () => {
  await withHarness(async ({ api, fetch, requests }) => {
    const source = partialBundle();
    const original = structuredClone(source);
    const active = deferred();
    fetch(() => active.promise);
    const pending = api.importAppDataBundle(source);
    source.tables.app_storage[0].value.theme = "light";
    source.tables.app_storage.push({ id: 9 });
    delete source.tables.journal_accounts;
    source.tables.positions = [{ id: 100 }];
    assert.deepEqual(JSON.parse(requests[0].init.body), original);
    active.resolve(response(acknowledgment(original)));
    assert.deepEqual(await pending, acknowledgment(original));
  });
});

for (const operation of ["export", "import"]) test(`${operation} pins the captured token when owner changes during the request auth reread`, async () => {
  await withHarness(async ({ api, storage, fetch, requests }) => {
    const source = partialBundle();
    const active = deferred();
    let authReads = 0;
    window.localStorage.getItem = (key) => {
      if (key === "edgelab.auth.session.v1" && ++authReads === 2)
        api.setStoredAuthSession(ownerSession(2));
      return storage.get(key) ?? null;
    };
    fetch(() => active.promise, "owner-1");
    const pending = operation === "export" ? api.exportAppDataBundle() : api.importAppDataBundle(source);
    assert.equal(authReads, 2, "change must occur between owner capture and request auth reread");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.headers.get("Authorization"), "Bearer owner-1");
    if (operation === "import") assert.deepEqual(JSON.parse(requests[0].init.body), source);
    active.resolve(response(operation === "export" ? completeBundle() : acknowledgment(source)));
    await assert.rejects(pending, { name: "AbortError" });
  });
});

const invalidSessions = [
  ["signed out", () => null],
  ["unapproved", () => ({ ...ownerSession(1), user: { ...ownerSession(1).user, approved: false } })],
  ["truthy approval", () => ({ ...ownerSession(1), user: { ...ownerSession(1).user, approved: "yes" } })],
  ...[0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1].map((id) => [`invalid owner ID ${String(id)}`, () => ({ ...ownerSession(1), user: { ...ownerSession(1).user, id } })]),
  ...["", "   ", 7].map((token) => [`invalid token ${String(token)}`, () => ({ ...ownerSession(1), token })]),
  ...["2000-01-01T00:00:00Z", "not a date", null].map((expiresAt) => [`invalid expiry ${String(expiresAt)}`, () => ({ ...ownerSession(1), expiresAt })]),
];
for (const operation of ["export", "import"])
  for (const [label, makeSession] of invalidSessions) test(`${operation} requires a valid approved owner before fetching (${label})`, async () => {
    await withHarness(async ({ api, fetch, requests }) => {
      api.setStoredAuthSession(makeSession());
      fetch(() => { throw new Error("must not request"); });
      await assert.rejects(operation === "export" ? api.exportAppDataBundle() : api.importAppDataBundle(partialBundle()), /Sign in/);
      assert.equal(requests.length, 0);
    });
  });
