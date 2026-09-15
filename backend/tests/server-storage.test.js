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
  fs.writeFileSync(
    path.join(sourceDir, "api.ts"),
    [
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
    "export function getStoredAuthSession() { return { user: { id: 7, email: 'owner@example.com' } }; }\n",
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
