import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tscBin = path.join(repoRoot, "frontend/node_modules/typescript/bin/tsc");
const copyId = "workspace-copy-proof1234";
const appStorageKey = `workspace-share-copy.v1.${copyId}`;
const localStorageKey = `edgelab.${appStorageKey}.user-7`;

function loadServerStorageModule() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-server-storage-"));
  const sourceDir = path.join(tempDir, "src");
  const outDir = path.join(tempDir, "out");
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "frontend/src/lib/serverStorage.ts"),
    path.join(sourceDir, "serverStorage.ts"),
  );
  fs.copyFileSync(path.join(repoRoot, "frontend/src/lib/appDataBarrier.ts"), path.join(sourceDir, "appDataBarrier.ts"));
  fs.writeFileSync(
    path.join(sourceDir, "api.ts"),
    [
      "export type AppStorageItem<T = unknown> = { namespace: string; key: string; value: T | null; updated_at: string | null };",
      "export async function getAppStorageItem<T>(namespace: string, key: string) {",
      "  return globalThis.__edgelabStorageGet(namespace, key) as Promise<{ value: T | null; updated_at: string | null }>;",
      "}",
      "export async function putAppStorageItem<T>(namespace: string, key: string, value: T) {",
      "  return globalThis.__edgelabStoragePut(namespace, key, value) as Promise<{ value: T; updated_at: string | null }>;",
      "}",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(sourceDir, "authSession.ts"),
    "export function getStoredAuthSession() { return { token: globalThis.__edgelabStorageToken ?? null, user: { id: globalThis.__edgelabStorageOwner ?? 7, email: 'owner@example.com' } }; }\n",
  );
  const inputs = fs.readdirSync(sourceDir).map((file) => path.join(sourceDir, file));
  const compile = spawnSync(
    process.execPath,
    [tscBin, "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--outDir", outDir, ...inputs],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (compile.status !== 0) {
    fs.rmSync(tempDir, { force: true, recursive: true });
    throw new Error(compile.stderr || compile.stdout || "serverStorage compile failed");
  }
  return {
    cleanup: () => fs.rmSync(tempDir, { force: true, recursive: true }),
    module: createRequire(import.meta.url)(path.join(outDir, "serverStorage.js")),
  };
}

function memoryStorage({ rejectWrites = false } = {}) {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    keys: () => [...values.keys()],
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => {
      if (rejectWrites) throw new Error("storage full");
      values.set(key, String(value));
    },
  };
}

test("confirmed copy storage waits for the server and writes a reload-safe local copy", async () => {
  const previousWindow = globalThis.window;
  const localStorage = memoryStorage();
  globalThis.window = { localStorage };
  globalThis.__edgelabStorageGet = async () => ({ updated_at: null, value: null });
  let releaseWrite;
  globalThis.__edgelabStoragePut = () => new Promise((resolve) => { releaseWrite = resolve; });
  const { module, cleanup } = loadServerStorageModule();
  const value = { id: copyId, payload: { schemaVersion: 1 } };

  try {
    let settled = false;
    const pending = module
      .saveAppStorageItemConfirmed(appStorageKey, value)
      .then((result) => { settled = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(settled, false);
    assert.deepEqual(JSON.parse(localStorage.getItem(localStorageKey)), value);
    releaseWrite({ updated_at: "2026-09-15T10:00:00Z", value });
    assert.deepEqual(await pending, {
      localPersisted: true,
      serverPersisted: true,
      value,
    });
  } finally {
    cleanup();
    globalThis.window = previousWindow;
    delete globalThis.__edgelabStorageGet;
    delete globalThis.__edgelabStoragePut;
  }
});

test("strict storage rejects failed writes without publishing an optimistic value", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage() };
  const { module, cleanup } = loadServerStorageModule();
  try {
    await assert.rejects(module.confirmAppStorageOperation("notebook-template.v1", async () => { throw new Error("offline"); }), /offline/);
    assert.equal(module.getCachedAppStorageItem("notebook-template.v1", "original"), "original");
    assert.equal(globalThis.window.localStorage.keys().length, 0);
  } finally { cleanup(); globalThis.window = previousWindow; }
});

test("an earlier strict read cannot replace a newer queued local edit", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage() };
  globalThis.__edgelabStoragePut = async (_namespace, _key, value) => ({ value, updated_at: "2026-10-07T10:00:00Z" });
  const { module, cleanup } = loadServerStorageModule();
  let release;
  try {
    const earlier = module.confirmAppStorageOperation("notebook-template.v1", () => new Promise((resolve) => { release = resolve; }));
    await new Promise((resolve) => setImmediate(resolve));
    await module.saveAppStorageItem("notebook-template.v1", "Newer template");
    release({ value: "Earlier template", updated_at: "2026-10-07T09:00:00Z" });
    await earlier;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(module.getCachedAppStorageItem("notebook-template.v1", null), "Newer template");
  } finally { cleanup(); globalThis.window = previousWindow; delete globalThis.__edgelabStoragePut; }
});

test("defaults acknowledgment rebases a later full-journal write without losing new records", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage() };
  let persisted;
  globalThis.__edgelabStoragePut = async (_namespace, _key, value) => { persisted = value; return { value, updated_at: "2026-10-07T10:00:00Z" }; };
  const { module, cleanup } = loadServerStorageModule();
  let release;
  try {
    const confirmed = module.confirmAppStorageOperation("live-journal.v1", () => new Promise((resolve) => { release = resolve; }), "edgelab", (pending, acknowledged) => ({ ...pending, settings: { ...pending.settings, default_currency: acknowledged.settings.default_currency } }));
    await new Promise((resolve) => setImmediate(resolve));
    const later = { settings: { default_currency: "USD", timezone: "UTC" }, trades: [{ id: "new-trade" }], notes: ["Keep"] };
    await module.saveAppStorageItem("live-journal.v1", later);
    release({ value: { settings: { default_currency: "EUR" }, trades: [] }, updated_at: "2026-10-07T09:00:00Z" });
    await confirmed;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(persisted, { ...later, settings: { default_currency: "EUR", timezone: "UTC" } });
    assert.deepEqual(module.getCachedAppStorageItem("live-journal.v1", null), persisted);
  } finally { cleanup(); globalThis.window = previousWindow; delete globalThis.__edgelabStoragePut; }
});

test("owner changes reject strict acknowledgments and skip old-owner queued requests", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage() };
  let requests = 0;
  globalThis.__edgelabStoragePut = async () => { requests += 1; return { value: "private" }; };
  const { module, cleanup } = loadServerStorageModule();
  let release;
  try {
    const pending = module.confirmAppStorageOperation("notebook-template.v1", () => new Promise((resolve) => { release = resolve; }));
    await new Promise((resolve) => setImmediate(resolve));
    await module.saveAppStorageItem("notebook-template.v1", "Owner 7 draft");
    globalThis.__edgelabStorageOwner = 8;
    release({ value: "Owner 7 confirmed", updated_at: "2026-10-07T09:00:00Z" });
    await assert.rejects(pending, /Storage owner changed/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 0);
    assert.equal(module.getCachedAppStorageItem("notebook-template.v1", null), null);
    assert.equal(globalThis.window.localStorage.getItem("edgelab.notebook-template.v1.user-8"), null);
  } finally { cleanup(); globalThis.window = previousWindow; delete globalThis.__edgelabStoragePut; delete globalThis.__edgelabStorageOwner; }
});

test("a rejected server write is surfaced while the scoped local copy hydrates after reload", async () => {
  const previousWindow = globalThis.window;
  const localStorage = memoryStorage();
  globalThis.window = { localStorage };
  globalThis.__edgelabStorageGet = async () => { throw new Error("offline"); };
  globalThis.__edgelabStoragePut = async () => { throw new Error("offline"); };
  const value = { id: copyId, payload: { schemaVersion: 1 } };
  let loaded = loadServerStorageModule();

  try {
    const result = await loaded.module.saveAppStorageItemConfirmed(
      appStorageKey,
      value,
    );
    assert.equal(result.localPersisted, true);
    assert.equal(result.serverPersisted, false);
    loaded.cleanup();
    loaded = loadServerStorageModule();
    assert.deepEqual(
      await loaded.module.loadAppStorageItem(appStorageKey, null),
      value,
    );
  } finally {
    loaded.cleanup();
    globalThis.window = previousWindow;
    delete globalThis.__edgelabStorageGet;
    delete globalThis.__edgelabStoragePut;
  }
});

test("confirmed copy storage fails when neither durable path accepts the copy", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage({ rejectWrites: true }) };
  globalThis.__edgelabStorageGet = async () => ({ updated_at: null, value: null });
  globalThis.__edgelabStoragePut = async () => { throw new Error("offline"); };
  const { module, cleanup } = loadServerStorageModule();

  try {
    await assert.rejects(
      module.saveAppStorageItemConfirmed(appStorageKey, { id: copyId }),
      /offline/,
    );
  } finally {
    cleanup();
    globalThis.window = previousWindow;
    delete globalThis.__edgelabStorageGet;
    delete globalThis.__edgelabStoragePut;
  }
});

test("a server-confirmed copy succeeds when local storage rejects an oversized value", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage({ rejectWrites: true }) };
  globalThis.__edgelabStorageGet = async () => ({ updated_at: null, value: null });
  let storedKey = null;
  let storedValue = null;
  globalThis.__edgelabStoragePut = async (_namespace, key, value) => {
    storedKey = key;
    storedValue = value;
    return { updated_at: "2026-09-15T10:00:00Z", value };
  };
  const { module, cleanup } = loadServerStorageModule();
  const value = { id: copyId, payload: "x".repeat(10_000) };

  try {
    assert.deepEqual(await module.saveAppStorageItemConfirmed(appStorageKey, value), {
      localPersisted: false,
      serverPersisted: true,
      value,
    });
    assert.equal(storedKey, appStorageKey);
    assert.deepEqual(storedValue, value);
  } finally {
    cleanup();
    globalThis.window = previousWindow;
    delete globalThis.__edgelabStorageGet;
    delete globalThis.__edgelabStoragePut;
  }
});

test("workspace copies use one owner-scoped local key per artifact", async () => {
  const previousWindow = globalThis.window;
  const localStorage = memoryStorage();
  globalThis.window = { localStorage };
  globalThis.__edgelabStorageGet = async () => ({ updated_at: null, value: null });
  globalThis.__edgelabStoragePut = async () => { throw new Error("offline"); };
  const { module, cleanup } = loadServerStorageModule();
  const secondId = "workspace-copy-proof5678";
  const secondStorageKey = `workspace-share-copy.v1.${secondId}`;

  try {
    await module.saveAppStorageItemConfirmed(appStorageKey, { id: copyId });
    await module.saveAppStorageItemConfirmed(secondStorageKey, { id: secondId });
    const valueKeys = localStorage.keys().filter((key) => !key.endsWith(".__updatedAt"));
    assert.deepEqual(valueKeys.sort(), [
      `edgelab.${appStorageKey}.user-7`,
      `edgelab.${secondStorageKey}.user-7`,
    ].sort());
    assert.equal(valueKeys.every((key) => module.isAppStorageLocalStorageKey(key)), true);
  } finally {
    cleanup();
    globalThis.window = previousWindow;
    delete globalThis.__edgelabStorageGet;
    delete globalThis.__edgelabStoragePut;
  }
});


const chartPresetsKey = "chart-settings-presets.v1";
const chartActiveKey = "active-chart-settings-preset.v1";
const storageTurn = () => new Promise((resolve) => setImmediate(resolve));
const acknowledgedStorage = (key, value) => ({ namespace: "edgelab", key, value, updated_at: "2026-10-07T12:00:00Z" });

async function withGroupedStorage(run) {
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: memoryStorage() };
  const loaded = loadServerStorageModule();
  try {
    await run(loaded.module, globalThis.window.localStorage);
  } finally {
    loaded.cleanup();
    globalThis.window = previousWindow;
    delete globalThis.__edgelabStorageGet;
    delete globalThis.__edgelabStoragePut;
    delete globalThis.__edgelabStorageOwner;
  }
}

test("grouped storage reserves every queue immediately and waits for earlier writes on either key", async () => {
  await withGroupedStorage(async (module) => {
    const calls = [];
    let releaseEarlier;
    globalThis.__edgelabStoragePut = async (_namespace, key, value) => {
      calls.push([key, value]);
      if (key === chartPresetsKey) return new Promise((resolve) => { releaseEarlier = resolve; });
      return acknowledgedStorage(key, value);
    };
    await module.saveAppStorageItem(chartPresetsKey, ["Earlier presets"]);
    let releaseBundle;
    let bundleCalls = 0;
    const operation = module.confirmAppStorageOperations(
      [{ key: chartActiveKey }, { key: chartPresetsKey }],
      () => { bundleCalls += 1; return new Promise((resolve) => { releaseBundle = resolve; }); },
    );
    // This save is queued in the same turn as the grouped operation, before its callback runs.
    await module.saveAppStorageItem(chartActiveKey, "Later active selection");
    await storageTurn();
    assert.equal(bundleCalls, 0);
    assert.deepEqual(calls, [[chartPresetsKey, ["Earlier presets"]]]);
    releaseEarlier(acknowledgedStorage(chartPresetsKey, ["Earlier presets"]));
    await storageTurn();
    assert.equal(bundleCalls, 1);
    assert.equal(calls.length, 1);
    const response = [acknowledgedStorage(chartPresetsKey, ["Confirmed presets"]), acknowledgedStorage(chartActiveKey, "Settings default")];
    releaseBundle(response);
    assert.deepEqual(await operation, response);
    await storageTurn();
    assert.deepEqual(calls[1], [chartActiveKey, "Later active selection"]);
    assert.equal(module.getCachedAppStorageItem(chartActiveKey, null), "Later active selection");
    assert.deepEqual(module.getCachedAppStorageItem(chartPresetsKey, null), ["Confirmed presets"]);
  });
});

test("grouped acknowledgment publishes in entry order only after the whole server operation succeeds", async () => {
  await withGroupedStorage(async (module, localStorage) => {
    let release;
    const publications = [];
    module.subscribeAppStorageItem(chartActiveKey, (value) => publications.push(["active", value]));
    module.subscribeAppStorageItem(chartPresetsKey, (value) => publications.push(["presets", value, module.getCachedAppStorageItem(chartActiveKey, null)]));
    const operation = module.confirmAppStorageOperations(
      [{ key: chartActiveKey }, { key: chartPresetsKey }],
      () => new Promise((resolve) => { release = resolve; }),
    );
    await storageTurn();
    assert.deepEqual(publications, []);
    assert.equal(localStorage.keys().length, 0);
    const presets = [{ name: "Settings default", settings: { textSize: 14 } }];
    // The server response ordering need not match the publication ordering.
    release([acknowledgedStorage(chartPresetsKey, presets), acknowledgedStorage(chartActiveKey, "Settings default")]);
    await operation;
    assert.deepEqual(publications, [["active", "Settings default"], ["presets", presets, "Settings default"]]);
    assert.deepEqual(JSON.parse(localStorage.getItem(`edgelab.${chartPresetsKey}.user-7`)), presets);
    assert.equal(localStorage.getItem(`edgelab.${chartActiveKey}.user-7`), "Settings default");
  });
});

test("grouped operation failure publishes neither key and releases both queues for later writes", async () => {
  await withGroupedStorage(async (module, localStorage) => {
    const calls = [];
    globalThis.__edgelabStoragePut = async (_namespace, key, value) => { calls.push([key, value]); return acknowledgedStorage(key, value); };
    let reject;
    const operation = module.confirmAppStorageOperations(
      [{ key: chartActiveKey }, { key: chartPresetsKey }],
      () => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }),
    );
    const rejection = assert.rejects(operation, /offline bundle/);
    await storageTurn();
    assert.equal(localStorage.keys().length, 0);
    assert.equal(module.getCachedAppStorageItem(chartPresetsKey, null), null);
    assert.equal(module.getCachedAppStorageItem(chartActiveKey, null), null);
    reject(new Error("offline bundle"));
    await rejection;
    await module.saveAppStorageItem(chartActiveKey, "Recovered active");
    await module.saveAppStorageItem(chartPresetsKey, ["Recovered presets"]);
    await storageTurn();
    assert.deepEqual(calls, [[chartActiveKey, "Recovered active"], [chartPresetsKey, ["Recovered presets"]]]);
  });
});

test("grouped acknowledgment rebases only later queued versions using the pre-operation value", async () => {
  await withGroupedStorage(async (module) => {
    const initial = { textSize: 12, gridMode: "both", hidden: { keep: true } };
    await module.confirmAppStorageOperation(chartPresetsKey, async () => acknowledgedStorage(chartPresetsKey, initial));
    const persisted = [];
    globalThis.__edgelabStoragePut = async (_namespace, key, value) => { persisted.push([key, value]); return acknowledgedStorage(key, value); };
    let release;
    const rebases = [];
    const operation = module.confirmAppStorageOperations(
      [{ key: chartActiveKey }, { key: chartPresetsKey, rebaseQueued: (pending, confirmed, before) => {
        rebases.push({ pending, confirmed, before });
        return { ...pending, gridMode: pending.gridMode === before.gridMode ? confirmed.gridMode : pending.gridMode };
      } }],
      () => new Promise((resolve) => { release = resolve; }),
    );
    await storageTurn();
    const later = { ...initial, textSize: 17 };
    await module.saveAppStorageItem(chartPresetsKey, later);
    await storageTurn();
    assert.equal(persisted.length, 0);
    const confirmed = { ...initial, gridMode: "vertical" };
    release([acknowledgedStorage(chartActiveKey, "Settings default"), acknowledgedStorage(chartPresetsKey, confirmed)]);
    await operation;
    await storageTurn();
    assert.deepEqual(rebases, [{ pending: later, confirmed, before: initial }]);
    const expected = { ...later, gridMode: "vertical" };
    assert.deepEqual(persisted, [[chartPresetsKey, expected]]);
    assert.deepEqual(module.getCachedAppStorageItem(chartPresetsKey, null), expected);
  });
});

test("owner switch rejects the entire grouped response and prevents every old-owner queued request", async () => {
  await withGroupedStorage(async (module, localStorage) => {
    let requests = 0;
    globalThis.__edgelabStoragePut = async (_namespace, key, value) => { requests += 1; return acknowledgedStorage(key, value); };
    let release;
    const operation = module.confirmAppStorageOperations(
      [{ key: chartActiveKey }, { key: chartPresetsKey }],
      () => new Promise((resolve) => { release = resolve; }),
    );
    const rejection = assert.rejects(operation, /Storage owner changed/);
    await storageTurn();
    await module.saveAppStorageItem(chartActiveKey, "Private active");
    await module.saveAppStorageItem(chartPresetsKey, ["Private presets"]);
    globalThis.__edgelabStorageOwner = 8;
    release([acknowledgedStorage(chartActiveKey, "Private acknowledged"), acknowledgedStorage(chartPresetsKey, ["Private acknowledged presets"])]);
    await rejection;
    await storageTurn();
    assert.equal(requests, 0);
    assert.equal(module.getCachedAppStorageItem(chartActiveKey, null), null);
    assert.equal(module.getCachedAppStorageItem(chartPresetsKey, null), null);
    assert.equal(localStorage.getItem(`edgelab.${chartActiveKey}.user-8`), null);
    assert.equal(localStorage.getItem(`edgelab.${chartPresetsKey}.user-8`), null);
  });
});


test("incomplete grouped acknowledgments cannot publish a partial cache bundle", async () => {
  await withGroupedStorage(async (module, localStorage) => {
    for (const response of [
      [acknowledgedStorage(chartActiveKey, "Settings default")],
      [acknowledgedStorage(chartActiveKey, "Settings default"), acknowledgedStorage(chartActiveKey, "Duplicate")],
      [acknowledgedStorage(chartActiveKey, "Settings default"), { ...acknowledgedStorage(chartPresetsKey, []), namespace: "other" }],
    ]) {
      await assert.rejects(module.confirmAppStorageOperations(
        [{ key: chartActiveKey }, { key: chartPresetsKey }], async () => response,
      ), /Incomplete storage acknowledgment/);
      assert.equal(module.getCachedAppStorageItem(chartActiveKey, null), null);
      assert.equal(module.getCachedAppStorageItem(chartPresetsKey, null), null);
      assert.equal(localStorage.keys().length, 0);
    }
    // Invalid input must reject before issuing a request or reserving unusable queues.
    let requested = false;
    await assert.rejects(module.confirmAppStorageOperations([{ key: chartActiveKey }, { key: chartActiveKey }], async () => { requested = true; return []; }), /distinct keys/);
    assert.equal(requested, false);
  });
});
