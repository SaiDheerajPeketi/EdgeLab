import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { build } from "esbuild";

// Extract genuine App helpers through its AST; storage and admission remain
// production code. Only authenticated HTTP transport is controlled.
const ts = createRequire(import.meta.url)(path.resolve("frontend/node_modules/typescript"));
const appSource = fs.readFileSync("frontend/src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["saveNamedChartLayout", "deleteChartLayoutRecord", "loadChartLayoutRecord", "loadChartLayoutRecords", "normalizeLayoutName", "upgradeStoredChartLayout"];
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(helpers.length, names.length);
const keys = ["CHART_LAYOUT_STORAGE_KEY", "CHART_LAYOUTS_STORAGE_KEY", "ACTIVE_CHART_LAYOUT_STORAGE_KEY", "CHART_WORKSPACE_SCHEMA_VERSION", "CHART_SETTINGS_DEFAULTS_VERSION"];
const constants = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => keys.includes(declaration.name.getText(ast))));
const bundled = (await build({ bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", stdin: {
  loader: "tsx", resolveDir: process.cwd(), contents: `
    import { assertAppDataAccess, captureAppDataAccess } from "./frontend/src/lib/appDataBarrier.ts";
    import { getCachedAppStorageItem, saveAppStorageItem } from "./frontend/src/lib/serverStorage.ts";
    import { nextWorkspaceRevision } from "./frontend/src/lib/chartWorkspace.ts";
    export { createOwnedSaveFeedback as createChartLayoutSaveFeedback } from "./frontend/src/lib/saveFeedback.ts";
    export * from "./frontend/src/lib/serverStorage.ts";
    export * from "./frontend/src/lib/chartSettings.ts";
    ${constants.map(node => node.getText(ast)).join("\n")}
    ${helpers.map(node => node.getText(ast)).join("\n")}
    export { ${names.join(",")} };
  `,
}, plugins: [{ name: "http-auth-boundary", setup(builder) {
  builder.onLoad({ filter: /[\\/]api\.ts$/ }, () => ({ loader: "ts", contents: `
    export const getAppStorageItem = (namespace,key) => globalThis.layoutGet(namespace,key);
    export const putAppStorageItem = (namespace,key,value) => globalThis.layoutPut(namespace,key,value);
  ` }));
  builder.onLoad({ filter: /[\\/]authSession\.ts$/ }, () => ({ loader: "ts", contents: "export const getStoredAuthSession = () => globalThis.layoutOwner;" }));
} }] })).outputFiles[0].text;
let instance = 0;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const owner = () => ({ token: "owner-token", user: { id: 7 } });

async function fixture(run) {
  const globals = ["window", "layoutOwner", "layoutGet", "layoutPut"];
  const previous = Object.fromEntries(globals.map(name => [name, globalThis[name]]));
  const local = new Map(), unhandled = [];
  let rejectWrites = false;
  globalThis.window = { localStorage: {
    get length() { return local.size; }, key: index => [...local.keys()][index] ?? null,
    getItem: key => local.get(key) ?? null, removeItem: key => local.delete(key),
    setItem(key, value) { if (rejectWrites) throw new Error("Browser storage full"); local.set(key, String(value)); },
  }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} };
  globalThis.layoutOwner = owner();
  globalThis.layoutGet = async (namespace, key) => ({ namespace, key, value: null, updated_at: null });
  globalThis.layoutPut = async (namespace, key, value) => ({ namespace, key, value, updated_at: "2026-10-10T00:00:00Z" });
  const listener = error => unhandled.push(error);
  process.on("unhandledRejection", listener);
  try {
    const api = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}#${++instance}`);
    const saved = [], failed = [], feedback = api.createChartLayoutSaveFeedback(() => saved.push("local"), error => failed.push(error));
    await run({ api, local, saved, failed, feedback, full: value => { rejectWrites = value; } });
    await turn();
    assert.deepEqual(unhandled, []);
  } catch (error) {
    if (error.stack) error.stack = error.stack.replace(/data:text\/javascript;base64,[^\s)]+/g, "production-layout-helpers");
    throw error;
  } finally {
    process.off("unhandledRejection", listener);
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; }
  }
}

test("local save feedback waits for accepted browser writes without claiming a server acknowledgment", () => fixture(async ({ api, local, saved, failed, feedback }) => {
  const server = deferred();
  globalThis.layoutPut = (namespace, key, value) => server.promise.then(() => ({ namespace, key, value, updated_at: "2026-10-10T00:00:00Z" }));
  const pending = feedback.run(() => {
    const result = api.saveNamedChartLayout("Morning", { drawings: [{ id: "kept" }] }, 0);
    return Promise.all([result.accepted, api.saveAppStorageItem("chart-layout.v1", result.record.layout), api.saveAppStorageItem("active-chart-layout.v1", result.record.name)]);
  });
  assert.deepEqual(saved, []);
  await pending;
  assert.deepEqual(saved, ["local"]);
  assert.deepEqual(failed, []);
  assert.equal(JSON.parse(local.get("edgelab.chart-layouts.v1.user-7"))[0].layout.drawings[0].id, "kept");
  assert.equal(local.get("edgelab.active-chart-layout.v1.user-7"), "Morning");
  server.resolve(); await turn();
}));

test("unverified-operation admission rejects actual storage and produces handled recovery feedback", () => fixture(async ({ api, local, saved, failed, feedback }) => {
  local.set("edgelab.app-data-uncertain.v1.user-7.interrupted", "u");
  let actions = 0;
  await feedback.run(() => { actions += 1; return api.saveNamedChartLayout("Blocked", {}, 0).accepted; });
  assert.equal(actions, 0);
  assert.deepEqual(saved, []);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].requiresReload, true);
  await assert.rejects(api.saveAppStorageItem("chart-layout.v1", {}), error => error.requiresReload === true);
  assert.equal(local.has("edgelab.chart-layouts.v1.user-7"), false);
  assert.equal(local.get("edgelab.app-data-uncertain.v1.user-7.interrupted"), "u");
  local.delete("edgelab.app-data-uncertain.v1.user-7.interrupted");
  local.set("edgelab.app-data-generation.v1.user-7", JSON.stringify({ revision: "replaced-data", phase: "ready" }));
  await feedback.run(() => { actions += 1; return api.saveNamedChartLayout("Blocked", {}, 0).accepted; });
  assert.equal(actions, 0);
  assert.equal(failed.length, 2);
  assert.equal(failed[1].requiresReload, true);
  assert.deepEqual(saved, []);
}));

test("a failed local write is not saved, and a real retry can accept the retained chart", () => fixture(async ({ api, local, saved, failed, feedback, full }) => {
  full(true);
  await feedback.run(() => api.saveNamedChartLayout("Retry", { drawings: [{ id: "draft" }] }, 0).accepted);
  assert.deepEqual(saved, []);
  assert.equal(failed.length, 1);
  assert.match(failed[0].message, /storage full/i);
  assert.equal(local.has("edgelab.chart-layouts.v1.user-7"), false);
  full(false);
  await feedback.run(() => api.saveNamedChartLayout("Retry", { drawings: [{ id: "draft" }] }, 1).accepted);
  assert.deepEqual(saved, ["local"]);
  assert.equal(JSON.parse(local.get("edgelab.chart-layouts.v1.user-7"))[0].layout.drawings[0].id, "draft");
}));

test("older accepted or rejected attempts cannot replace current save feedback", () => fixture(async ({ api, saved, failed, feedback }) => {
  for (const rejects of [false, true]) {
    const held = deferred();
    const older = feedback.run(async () => { await api.saveAppStorageItem("chart-layout.v1", { old: true }); await held.promise; });
    await turn();
    await feedback.run(() => api.saveAppStorageItem("chart-layout.v1", { current: true }));
    const before = saved.length;
    if (rejects) held.reject(new Error("Old failure")); else held.resolve();
    await older;
    assert.equal(saved.length, before);
    assert.deepEqual(failed, []);
  }
}));

test("account, token, import generation, ABA retirement and unmount suppress late feedback", () => fixture(async ({ api, local, saved, failed, feedback }) => {
  const changes = [
    () => { globalThis.layoutOwner = { token: "owner-token", user: { id: 8 } }; },
    () => { globalThis.layoutOwner = { token: "new-token", user: { id: 7 } }; },
    () => { local.set("edgelab.app-data-generation.v1.user-7", JSON.stringify({ revision: "replacement", phase: "ready" })); },
    () => { globalThis.layoutOwner = { token: "temporary", user: { id: 8 } }; feedback.invalidate(); globalThis.layoutOwner = owner(); },
    () => feedback.dispose(),
  ];
  for (const change of changes) {
    globalThis.layoutOwner = owner(); local.delete("edgelab.app-data-generation.v1.user-7"); feedback.mount();
    const held = deferred();
    const pending = feedback.run(async () => { await api.saveAppStorageItem("chart-layout.v1", { source: "owned" }); await held.promise; });
    await turn(); change(); held.resolve(); await pending;
    assert.deepEqual(saved, []); assert.deepEqual(failed, []);
  }
}));

test("revision conflicts preserve the newer record and accept a distinct recovered local record", () => fixture(async ({ api, local, saved, feedback }) => {
  let first;
  await feedback.run(() => { first = api.saveNamedChartLayout("Original", { drawings: [{ id: "newer" }] }, 0); return first.accepted; });
  let recovered;
  await feedback.run(() => { recovered = api.saveNamedChartLayout("Original", { drawings: [{ id: "edited" }] }, 0); return recovered.accepted; });
  assert.equal(first.record.revision, 1);
  assert.equal(recovered.conflict, true);
  assert.match(recovered.record.name, /recovered/);
  assert.equal(api.loadChartLayoutRecord("Original").layout.drawings[0].id, "newer");
  assert.equal(api.loadChartLayoutRecord(recovered.record.name).layout.drawings[0].id, "edited");
  await turn();
  const records = JSON.parse(local.get("edgelab.chart-layouts.v1.user-7"));
  assert.equal(records.find(record => record.name === "Original").layout.drawings[0].id, "newer");
  assert.equal(records.find(record => record.name === recovered.record.name).layout.drawings[0].id, "edited");
  assert.equal(saved.length, 2);
}));

test("an old server acknowledgment cannot erase a newer accepted local layout when its sync fails", () => fixture(async ({ api, local, saved, feedback }) => {
  const oldServer = deferred();
  let requests = 0;
  globalThis.layoutPut = (namespace, key, value) => {
    requests += 1;
    if (requests === 1) return oldServer.promise.then(() => ({ namespace, key, value, updated_at: "2026-10-10T00:00:00Z" }));
    return Promise.reject(new Error("Newer server sync unavailable"));
  };
  let first;
  await feedback.run(() => { first = api.saveNamedChartLayout("Current", { drawings: [{ id: "earlier" }] }, 0); return first.accepted; });
  await feedback.run(() => api.saveNamedChartLayout("Current", { drawings: [{ id: "later" }] }, first.record.revision).accepted);
  assert.equal(JSON.parse(local.get("edgelab.chart-layouts.v1.user-7"))[0].layout.drawings[0].id, "later");
  oldServer.resolve(); await turn();
  assert.equal(requests, 2);
  assert.equal(JSON.parse(local.get("edgelab.chart-layouts.v1.user-7"))[0].layout.drawings[0].id, "later");
  assert.equal(api.loadChartLayoutRecord("Current").layout.drawings[0].id, "later");
  assert.equal(saved.length, 2);
}));

test("legacy preset helpers consume blocked admission while strict saves still reject", () => fixture(async ({ api, local }) => {
  local.set("edgelab.app-data-uncertain.v1.user-7.interrupted", "u");
  api.saveChartSettingsPreset("Blocked", api.DEFAULT_CHART_VISUAL_SETTINGS);
  api.deleteChartSettingsPreset("Blocked");
  api.persistActiveChartSettingsPresetName(null);
  api.persistActiveChartSettingsPresetName("Blocked");
  await turn();
  assert.equal(local.has("edgelab.chart-settings-presets.v1.user-7"), false);
  assert.equal(local.has("edgelab.active-chart-settings-preset.v1.user-7"), false);
  await assert.rejects(api.saveAppStorageItemConfirmed("chart-settings-presets.v1", []), error => error.requiresReload === true);
}));
