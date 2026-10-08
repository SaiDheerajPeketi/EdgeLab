import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";
import { transformSync } from "esbuild";

// Execute the actual App hydration effects and chart mutation handlers. The
// network boundary is held; no production helper is added solely for testing.
const source = fs.readFileSync("frontend/src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "WorkspaceApp");
const statements = [...app.body.statements];
const declares = (node, name) => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => ts.isIdentifier(value.name) && value.name.text === name);
const scopeStart = statements.findIndex(node => declares(node, "chartSettingsHydrationSessionId"));
const scopeEnd = statements.findIndex((node, index) => index > scopeStart && ts.isIfStatement(node));
assert.ok(scopeStart >= 0 && scopeEnd > scopeStart);
const scope = statements.slice(scopeStart, scopeEnd + 1).map(node => node.getText(ast)).join("\n");
const names = ["captureChartSettingsHydration", "setActiveChartPaneId", "setChartSyncSettings", "applyChartSettingsToCurrentScope", "selectChartPane", "changeChartPaneLayout", "applyChartLayout"];
const handlers = names.map(name => {
  const node = statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name); return node.getText(ast);
}).join("\n");
function hydrationEffect(name) {
  const node = statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(ast) === "useEffect"
    && node.expression.arguments[0]?.getText(ast).includes(`void ${name}()`));
  assert.ok(node, name); return node.getText(ast);
}
const mountEffect = hydrationEffect("hydrateChartPersistence");
const sessionEffect = hydrationEffect("hydrateChartSettingsPresets");
const compiled = transformSync(`
  const useRef = value => fixture.refs[fixture.cursor++] ??= { current: value };
  const useEffect = (callback, dependencies) => fixture.effect(callback, dependencies);
  const captureAppDataAccess = () => ({ ...fixture.access });
  const assertAppDataAccess = access => {
    if (JSON.stringify(access) !== JSON.stringify(fixture.access)) throw Error("retired account");
  };
  const sanitizeChartVisualSettings = value => ({ ...value });
  const DEFAULT_CHART_VISUAL_SETTINGS = { backgroundColor: "initial", textSize: 12 };
  const resolveStateAction = (action, previous) => typeof action === "function" ? action(previous) : action;
  const chartPaneLayoutById = id => ({ id, panes: id === "two" ? 2 : 1 });
  const sanitizeChartPaneLayout = id => id ?? "one";
  const sanitizeChartPanes = layout => layout.panes;
  const sanitizeChartSyncSettings = value => value ?? { style: false };
  const sanitizeTimeframe = value => value;
  const createDefaultChartPane = index => fixture.pane("pane-" + (index + 1));
  const loadChartLayout = () => fixture.savedLayout;
  const loadChartLayoutRecords = () => fixture.records;
  const loadActiveLayoutName = () => fixture.serverLayoutName;
  const loadActiveChartSettingsPreset = () => fixture.preset;
  const loadActiveChartSettingsPresetName = presets => presets[0]?.name;
  const hydrateChartPersistence = () => { fixture.mountCalls++; return fixture.mount.promise; };
  const hydrateChartSettingsPresets = () => {
    const request = fixture.sessionCalls++ === 0 ? fixture.session : fixture.newDeferred();
    fixture.sessionRequests.push(request); return request.promise;
  };
  const subscribeAppStorageItem = () => () => {};
  const CHART_LAYOUTS_STORAGE_KEY = "layouts", ACTIVE_CHART_LAYOUT_STORAGE_KEY = "active";
  const window = { location: { href: "http://localhost/app/backtest" } };
  export function render(kind) {
    fixture.cursor = 0;
    const state = { session: { id: fixture.sessionId } };
    const chartPanes = fixture.panes, activeChartPaneId = fixture.activePaneId;
    const activeChartPaneIndex = chartPanes.findIndex(pane => pane.id === activeChartPaneId);
    const activeChartPane = chartPanes[activeChartPaneIndex];
    const chartPaneLayout = fixture.layout, chartSyncSettings = fixture.sync;
    const visibleChartPanes = chartPanes.slice(0, chartPaneLayoutById(chartPaneLayout).panes);
    const chartPersistenceHydrated = fixture.hydrated, sourceTimeframe = "1m";
    const setChartPanes = action => { fixture.panes = resolveStateAction(action, fixture.panes); };
    const setActiveChartPaneIdState = id => fixture.activePaneId = id;
    const setChartSyncSettingsState = action => fixture.sync = resolveStateAction(action, fixture.sync);
    const setChartPaneLayout = value => fixture.layout = value;
    const setLayoutName = value => fixture.layoutName = value;
    const setAvailableLayouts = value => fixture.available = value;
    const setDefaultLayoutName = () => {}, setStartupLayoutName = () => {};
    const setChartPersistenceHydrated = value => fixture.hydrated = value;
    const setSharedCopyResolving = () => {}, setSharedCopyNotice = () => {};
    const setReplayTimeframe = () => {}, setWorkspacePanel = () => {};
    const setLayersPanelOpen = () => {}, setLeftPaneOpen = () => {}, setSidebarCollapsed = () => {};
    const setSelectedDrawingId = () => {}, resetDrawingUndoHistory = () => {};
    const drawingsRef = { current: [] }, workspaceRevisionRef = { current: 0 };
    ${scope}
    ${handlers}
    if (kind !== "session") { ${mountEffect} }
    if (kind !== "mount") { ${sessionEffect} }
    return { applyChartSettingsToCurrentScope, applyChartLayout, selectChartPane,
      changeChartPaneLayout, setChartSyncSettings, setActiveChartPaneId };
  }
`, { loader: "ts", format: "cjs" }).code;

function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness(kind = "session") {
  const fixture = {
    access: { owner: "user-7", token: "original", epoch: "" }, sessionId: 1,
    refs: [], effects: [], cursor: 0, hydrated: kind === "session", layout: "two", sync: { style: false },
    activePaneId: "pane-1", layoutName: "Working", serverLayoutName: "Server layout",
    pane: id => ({ id, timeframe: "1m", chartSettings: { backgroundColor: "initial", textSize: 12 }, drawings: [] }),
    mount: deferred(), session: deferred(), newDeferred: deferred, sessionRequests: [], mountCalls: 0, sessionCalls: 0, records: [], savedLayout: null,
    preset: { name: "Default", settings: { backgroundColor: "server", textSize: 14 } },
    effect(callback, dependencies) {
      const index = this.cursor++, previous = this.effects[index];
      if (!previous || !dependencies.every((value, position) => Object.is(value, previous.dependencies[position]))) {
        previous?.cleanup?.(); this.effects[index] = { dependencies, cleanup: callback() };
      }
    },
  };
  fixture.panes = [fixture.pane("pane-1"), fixture.pane("pane-2")];
  const module = { exports: {} };
  new Function("fixture", "module", "exports", compiled)(fixture, module, module.exports);
  const h = { fixture, render: () => module.exports.render(kind),
    async release(which = kind === "combined" ? "mount" : kind) { fixture[which].resolve(which === "session" ? [fixture.preset] : undefined); await fixture[which].promise; await Promise.resolve(); },
    close: () => fixture.effects.forEach(effect => effect?.cleanup?.()),
  };
  h.current = h.render();
  // The mount writer owns the startup baseline. A later session is the first
  // legitimate trigger for the session-only writer in isolated tests.
  if (kind === "session") { fixture.sessionId = 2; h.current = h.render(); }
  return h;
}

test("untouched initial and session preset hydration still applies", async () => {
  for (const kind of ["mount", "session"]) {
    const h = harness(kind); try {
      await h.release(); assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, "server");
      if (kind === "mount") assert.equal(h.fixture.hydrated, true);
    } finally { h.close(); }
  }
});

test("delayed hydration preserves newer edits, Reset, and template selection before a rerender", async () => {
  for (const kind of ["mount", "session"]) for (const backgroundColor of ["edited", "reset", "selected-template"]) {
    const h = harness(kind); try {
      h.current.applyChartSettingsToCurrentScope({ backgroundColor, textSize: 16 });
      await h.release(); assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, backgroundColor);
    } finally { h.close(); }
  }
});

test("restored layout and its selected name survive a held initial response", async () => {
  const h = harness("mount"); try {
    h.fixture.records = [{ name: "Server layout", isStartup: true }];
    const panes = [h.fixture.pane("replacement" )]; panes[0].chartSettings.backgroundColor = "chosen-layout";
    h.current.applyChartLayout({ paneLayout: "one", panes, activePaneId: "replacement", syncSettings: { style: false } });
    h.fixture.layoutName = "Chosen layout";
    await h.release();
    assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, "chosen-layout");
    assert.equal(h.fixture.activePaneId, "replacement"); assert.equal(h.fixture.layoutName, "Chosen layout");
    assert.deepEqual(h.fixture.available, ["Server layout"]); assert.equal(h.fixture.hydrated, true);
  } finally { h.close(); }
});

test("active pane, layout, and style synchronization changes invalidate a held preset", async () => {
  for (const change of [h => h.current.selectChartPane("pane-2"), h => h.current.changeChartPaneLayout("one"), h => h.current.setChartSyncSettings({ style: true })]) {
    const h = harness(); try {
      change(h); await h.release();
      assert.deepEqual(h.fixture.panes.map(pane => pane.chartSettings.backgroundColor), ["initial", "initial"]);
    } finally { h.close(); }
  }
});

test("A to B to A pane selection cannot revive the old preset request", async () => {
  const h = harness(); try {
    h.current.setActiveChartPaneId("pane-2"); h.render().setActiveChartPaneId("pane-1"); h.render();
    await h.release(); assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, "initial");
  } finally { h.close(); }
});

test("new session render, account/token/data replacement, and unmount reject old results", async () => {
  const changes = [
    h => { h.fixture.sessionId = 3; h.render(); },
    h => { h.fixture.access.owner = "user-8"; },
    h => { h.fixture.access.token = "renewed"; },
    h => { h.fixture.access.epoch = "imported"; },
    h => h.close(),
  ];
  for (const change of changes) {
    const h = harness(); try {
      change(h); await h.release(); assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, "initial");
    } finally { h.close(); }
  }
});

test("both actual effects preserve an edit through mount completion without a duplicate preset request", async () => {
  const h = harness("combined"); try {
    assert.equal(h.fixture.sessionCalls, 0);
    h.current.applyChartSettingsToCurrentScope({ backgroundColor: "newer", textSize: 16 });
    await h.release("mount"); h.render(); await h.release("session");
    assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, "newer");
    assert.equal(h.fixture.hydrated, true); assert.equal(h.fixture.sessionCalls, 0);
    h.fixture.sessionId = 2; h.render(); await Promise.resolve();
    assert.equal(h.fixture.sessionCalls, 1); assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, "server");
  } finally { h.close(); }
});

test("ordinary null to first-session bootstrap retains untouched startup layout", async () => {
  const h = harness("combined"); try {
    // Start another mounted lifecycle with no selected session yet.
    h.close(); h.fixture.refs = []; h.fixture.effects = []; h.fixture.sessionId = null; h.render();
    h.fixture.savedLayout = { paneLayout: "two", panes: [h.fixture.pane("pane-1"), h.fixture.pane("pane-2")], activePaneId: "pane-2", syncSettings: { style: true } };
    h.fixture.sessionId = 7; h.render(); await h.release("mount"); h.render();
    assert.equal(h.fixture.activePaneId, "pane-2"); assert.equal(h.fixture.sync.style, true);
    assert.equal(h.fixture.layoutName, "Server layout"); assert.equal(h.fixture.sessionCalls, 0);
  } finally { h.close(); }
});

test("startup preset follows the restored active pane and its actual style synchronization", async () => {
  for (const style of [false, true]) {
    const h = harness("combined"); try {
      const panes = [h.fixture.pane("pane-1"), h.fixture.pane("pane-2")];
      panes[0].chartSettings.backgroundColor = "pane-one-layout";
      panes[1].chartSettings.backgroundColor = "pane-two-layout";
      h.fixture.savedLayout = { paneLayout: "two", panes, activePaneId: "pane-2", syncSettings: { style } };
      await h.release("mount"); h.render();
      assert.equal(h.fixture.activePaneId, "pane-2");
      assert.equal(h.fixture.panes[1].chartSettings.backgroundColor, "server");
      assert.equal(h.fixture.panes[0].chartSettings.backgroundColor, style ? "server" : "pane-one-layout");
      assert.equal(h.fixture.sessionCalls, 0);
    } finally { h.close(); }
  }
});
