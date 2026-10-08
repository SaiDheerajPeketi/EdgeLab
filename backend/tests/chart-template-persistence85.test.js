import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const source = (await build({ bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent", stdin: { contents: 'export * from "./frontend/src/lib/chartSettingsTemplates.ts"; export * from "./frontend/src/lib/serverStorage.ts"; export * from "./frontend/src/lib/chartSettings.ts";', loader: "ts", resolveDir: process.cwd() }, plugins: [{ name: "boundary", setup(build) {
  build.onLoad({ filter: /[\/]api\.ts$/ }, () => ({ loader: "ts", contents: `export const updateChartSettingsTemplate = (payload) => globalThis.templateRequest(payload); export const getAppStorageItem = (namespace, key) => globalThis.storageGet(namespace, key); export const putAppStorageItem = (namespace, key, value) => globalThis.storagePut(namespace, key, value);` }));
  build.onLoad({ filter: /[\/]authSession\.ts$/ }, () => ({ loader: "ts", contents: 'export const getStoredAuthSession = () => globalThis.templateOwner;' }));
} }] })).outputFiles[0].text;
let instance = 0;
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const presetsKey = "chart-settings-presets.v1";
const activeKey = "active-chart-settings-preset.v1";
const item = (key, value) => ({ namespace: "edgelab", key, value, updated_at: "2026-10-08T12:00:00Z" });
const original = [{ name: "Morning", settings: { textSize: 12 }, updatedAt: "old" }, { name: "Evening", settings: { textSize: 16 }, updatedAt: "old" }];
const bundle = (presets = original, active = "Morning") => ({ presets: item(presetsKey, presets), active: item(activeKey, active) });

async function fixture(run) {
  const previous = { window: globalThis.window, templateOwner: globalThis.templateOwner, templateRequest: globalThis.templateRequest, storageGet: globalThis.storageGet, storagePut: globalThis.storagePut };
  const values = new Map();
  globalThis.window = { localStorage: { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  globalThis.templateOwner = { token: "owner-token", user: { id: 1 } };
  globalThis.storageGet = async (_namespace, key) => item(key, key === presetsKey ? original : "Morning");
  globalThis.storagePut = async (_namespace, key, value) => item(key, value);
  globalThis.templateRequest = async () => bundle();
  try {
    const api = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${++instance}`);
    await api.hydrateChartSettingsPresets();
    await run(api, values);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
}

test("template save publishes selection and presets only after a complete matching acknowledgment", async () => {
  await fixture(async (api) => {
    const held = deferred(); const requests = []; const published = [];
    globalThis.templateRequest = (payload) => { requests.push(payload); return held.promise; };
    api.subscribeChartSettingsPresets((presets) => published.push({ names: presets.map((entry) => entry.name), active: api.loadActiveChartSettingsPresetName() }));
    const settings = { ...api.DEFAULT_CHART_VISUAL_SETTINGS, textSize: 15 };
    const operation = api.confirmChartSettingsTemplate("save", "  My   template  ", settings);
    await turn();
    assert.equal(requests.length, 1); assert.equal(requests[0].name, "My template");
    assert.deepEqual(api.loadChartSettingsPresets().map((entry) => entry.name), ["Morning", "Evening"]);
    assert.equal(api.loadActiveChartSettingsPresetName(), "Morning"); assert.deepEqual(published, []);
    held.resolve(bundle([{ name: "My template", settings: requests[0].settings, updatedAt: "ack" }, ...original], "My template"));
    const confirmed = await operation;
    assert.equal(confirmed.activeName, "My template"); assert.equal(confirmed.presets[0].settings.textSize, 15);
    assert.deepEqual(published, [{ names: ["My template", "Morning", "Evening"], active: "My template" }]);
  });
});

test("failed saves preserve acknowledged cache and explicit retry can succeed", async () => {
  await fixture(async (api) => {
    const settings = api.DEFAULT_CHART_VISUAL_SETTINGS;
    globalThis.templateRequest = async () => { throw new Error("Service unavailable"); };
    await assert.rejects(api.confirmChartSettingsTemplate("save", "New", settings), /unavailable/);
    assert.equal(api.loadActiveChartSettingsPresetName(), "Morning"); assert.deepEqual(api.loadChartSettingsPresets().map((entry) => entry.name), ["Morning", "Evening"]);
    globalThis.templateRequest = async (payload) => bundle([{ name: "New", settings: payload.settings }, ...original], "New");
    await api.confirmChartSettingsTemplate("save", "New", settings);
    assert.equal(api.loadActiveChartSettingsPresetName(), "New");
  });
});

test("malformed or incomplete template acknowledgments cannot publish or claim success", async () => {
  for (const response of [null, { ...bundle(), active: item("wrong-key", "Evening") }, bundle(original, "Absent"), bundle(original, "Morning"), bundle([{ name: "Evening", settings: null }], "Evening"), bundle([...original, original[1]], "Evening")]) {
    await fixture(async (api) => {
      globalThis.templateRequest = async () => response;
      await assert.rejects(api.confirmChartSettingsTemplate("activate", "Evening"));
      assert.equal(api.loadActiveChartSettingsPresetName(), "Morning");
    });
  }
  await fixture(async (api) => {
    globalThis.templateRequest = async () => bundle(original, "Evening");
    await assert.rejects(api.confirmChartSettingsTemplate("save", "Evening", { ...api.DEFAULT_CHART_VISUAL_SETTINGS, textSize: 18 }));
    assert.equal(api.loadActiveChartSettingsPresetName(), "Morning");
  });
});

test("delete holds membership until acknowledgment and verifies that its target was removed", async () => {
  await fixture(async (api) => {
    const held = deferred(); globalThis.templateRequest = () => held.promise;
    const operation = api.confirmChartSettingsTemplate("delete", "Morning"); await turn();
    assert.equal(api.loadChartSettingsPresets().length, 2);
    held.resolve(bundle([original[1]], "Evening"));
    await operation; assert.deepEqual(api.loadChartSettingsPresets().map((entry) => entry.name), ["Evening"]);
    globalThis.templateRequest = async () => bundle([original[1]], "Evening");
    await assert.rejects(api.confirmChartSettingsTemplate("delete", "Evening"), /not confirmed/);
    assert.equal(api.loadChartSettingsPresets().length, 1);
    globalThis.templateRequest = async () => bundle([], null);
    await api.confirmChartSettingsTemplate("delete", "Evening");
    assert.equal(api.loadActiveChartSettingsPresetName(), null);
  });
});

test("template operations wait behind legacy writes and rebase later unrelated preset edits", async () => {
  await fixture(async (api) => {
    const legacy = deferred(); const held = deferred(); let calls = 0;
    globalThis.storagePut = () => legacy.promise;
    await api.saveAppStorageItem(presetsKey, original);
    globalThis.templateRequest = () => { calls += 1; return held.promise; };
    const operation = api.confirmChartSettingsTemplate("activate", "Evening"); await turn(); assert.equal(calls, 0);
    legacy.resolve(item(presetsKey, original)); await turn(); assert.equal(calls, 1);
    const later = [...original, { name: "Later", settings: { textSize: 17 } }];
    await api.saveAppStorageItem(presetsKey, later);
    held.resolve(bundle([...original, { name: "Remote", settings: { textSize: 14 } }], "Evening"));
    await operation; assert.deepEqual(api.loadChartSettingsPresets().map((entry) => entry.name), ["Morning", "Evening", "Later", "Remote"]);
  });
});

test("a changed account or token rejects late acknowledgment before cache publication", async () => {
  for (const nextOwner of [{ token: "owner-token", user: { id: 2 } }, { token: "replacement-token", user: { id: 1 } }]) {
    await fixture(async (api) => {
      const held = deferred(); globalThis.templateRequest = () => held.promise;
      const operation = api.confirmChartSettingsTemplate("activate", "Evening"); const rejection = assert.rejects(operation, { name: "AbortError" }); await turn();
      globalThis.templateOwner = nextOwner; held.resolve(bundle(original, "Evening")); await rejection;
      globalThis.templateOwner = { token: "owner-token", user: { id: 1 } }; assert.equal(api.loadActiveChartSettingsPresetName(), "Morning");
    });
  }
});

test("a data replacement during a held save rejects its result instead of publishing stale templates", async () => {
  await fixture(async (api, values) => {
    const held = deferred(); globalThis.templateRequest = () => held.promise;
    const operation = api.confirmChartSettingsTemplate("activate", "Evening"); const rejected = assert.rejects(operation, (error) => error.requiresReload === true); await turn();
    values.set("edgelab.app-data-generation.v1.user-1", JSON.stringify({ revision: "replacement", phase: "ready" }));
    held.resolve(bundle(original, "Evening")); await rejected;
  });
});

test("deletion accepts preserved legacy selection without falsely reporting a committed deletion as failed", async () => {
  for (const active of ["missing legacy name", "  Evening  "]) {
    await fixture(async (api) => {
      globalThis.templateRequest = async () => bundle([original[1]], active);
      const confirmed = await api.confirmChartSettingsTemplate("delete", "Morning");
      assert.equal(confirmed.activeName, "Evening");
      assert.deepEqual(api.loadChartSettingsPresets().map((preset) => preset.name), ["Evening"]);
    });
  }
  await fixture(async (api) => {
    globalThis.templateRequest = async () => bundle(null, null);
    const confirmed = await api.confirmChartSettingsTemplate("delete", "Missing");
    assert.deepEqual(confirmed, { presets: [], activeName: null });
  });
});
