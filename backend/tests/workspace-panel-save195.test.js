import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

// Control React scheduling and HTTP only. Click/resize handlers, journal saves,
// account identity, browser storage, and write admission are production code.
const bundle = (await build({ bundle: true, format: "cjs", platform: "node", write: false, logLevel: "silent",
  plugins: [{ name: "panel195-boundaries", setup(api) {
    api.onResolve({ filter: /^react$|^react\/jsx-runtime$|^lucide-react$|^\.\/Primitives$/ }, args => ({ path: args.path, namespace: "panel195" }));
    api.onLoad({ filter: /.*/, namespace: "panel195" }, ({ path }) => ({ loader: "js", contents: path === "react"
      ? ["useState", "useRef", "useEffect", "useLayoutEffect", "useMemo"].map(name => `export const ${name}=(...args)=>globalThis.panel195.hooks.${name}(...args);`).join("\n")
      : path === "react/jsx-runtime" ? "export const jsx=(...args)=>globalThis.panel195.jsx(...args);export const jsxs=jsx;"
      : path === "./Primitives" ? "export const IconButton=()=>null;"
      : ["ChevronLeft", "ChevronRight", "Columns3", "PanelLeftClose", "PanelRightClose", "PanelsTopLeft"].map(name => `export const ${name}=()=>null;`).join("\n") }));
    api.onLoad({ filter: /[\\/]api\.ts$/ }, () => ({ loader: "js", contents: `
      export const getAppStorageItem=async(namespace,key)=>({namespace,key,value:null,updated_at:null});
      export const putAppStorageItem=(...args)=>globalThis.panel195.put(...args);
    ` }));
  } }], stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
    export {WorkspacePanelManager} from "./frontend/src/components/ui/WorkspacePanelManager.tsx";
    export {saveJournalPanelPreferences} from "./frontend/src/lib/journalWorkspaceState.ts";
    export {setStoredAuthSession,subscribeAuthSession} from "./frontend/src/lib/authSession.ts";
  ` } })).outputFiles[0].text;
const turn = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const session = (id = 7, token = `owner-${id}`) => ({ createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", token,
  user: { id, email: "owner@example.test", name: "Owner", provider: "google", approved: false, betaPosition: null,
    workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });
const walk = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node?.props?.children ?? "");

async function fixture(run, initial = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, panel195: globalThis.panel195 };
  const storage = new Map(), window = new EventTarget(), unhandled = [], writes = [], requests = [];
  let full = false, cursor = 0, slots = [], effects = [], tree, putError = null;
  window.localStorage = { get length() { return storage.size; }, key: i => [...storage.keys()][i] ?? null,
    getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key),
    setItem(key, value) { if (full) throw new Error("Browser storage full"); storage.set(key, String(value)); } };
  window.innerHeight = 900; window.innerWidth = 1280; window.matchMedia = () => ({ matches: true });
  window.requestAnimationFrame = callback => callback();
  globalThis.window = window; globalThis.document = { activeElement: null };
  const effect = (callback, deps) => { const i = cursor++, old = slots[i];
    if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
      slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = callback(); });
    } };
  const controller = { put(namespace, key, value) { requests.push(value);
    return putError ? Promise.reject(putError) : Promise.resolve({ namespace, key, value, updated_at: "2026-10-10T00:00:00Z" }); }, hooks: {
    useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, next => { writes.push(i); // Replaying updater functions simulates Strict Mode's purity check.
        if (typeof next === "function") next(slots[i].value);
        slots[i].value = typeof next === "function" ? next(slots[i].value) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useMemo(callback, deps) { const i = cursor++, old = slots[i];
      if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) slots[i] = { value: callback(), deps }; return slots[i].value; },
    useEffect: effect, useLayoutEffect: effect,
  }, jsx(type, props) {
    if (typeof type === "string" && props.ref) props.ref.current = { contains: () => false, focus() {}, querySelector: () => null,
      getBoundingClientRect: () => ({ left: 920, right: 1280, top: 100, bottom: 150 }) };
    return { type, props };
  } };
  globalThis.panel195 = controller;
  const module = { exports: {} }; new Function("require", "module", "exports", bundle)(createRequire(import.meta.url), module, module.exports);
  const api = module.exports; api.setStoredAuthSession(session());
  // The actual application also subscribes, forwarding delayed storage identity changes.
  const unsubscribe = api.subscribeAuthSession(() => {});
  const props = { children: "Chart", definitions: [{ id: "journal", icon: () => null, label: "Journal", content: "Journal content" },
    { id: "watchlist", icon: () => null, label: "Watchlist", content: "Watchlist content" }],
    value: { activePanel: "journal", collapsed: false, dock: "right", mode: "compact", width: 360, ...initial },
    onChange: api.saveJournalPanelPreferences };
  const render = () => { cursor = 0; tree = api.WorkspacePanelManager(props); return tree; };
  const commit = () => { const pending = effects; effects = []; pending.forEach(callback => callback()); };
  const unmount = () => { slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); effects = []; };
  const node = predicate => { const result = walk(tree).find(predicate); assert.ok(result, "actual rendered control exists"); return result; };
  const click = label => { node(item => item.props?.label === label || item.props?.title === label).props.onClick(); render(); commit(); };
  const alert = () => text(walk(tree).find(item => item.props?.role === "alert"));
  const dispatch = (type, fields = {}) => { const event = new Event(type); Object.defineProperties(event, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }]))); window.dispatchEvent(event); };
  const listener = error => unhandled.push(error); process.on("unhandledRejection", listener);
  try {
    render(); commit(); render();
    await run({ api, props, render, commit, unmount, node, click, alert, dispatch, storage, requests, writes, controller,
      full: value => { full = value; }, failServer: value => { putError = value; } });
    await turn(); assert.deepEqual(unhandled, []);
  } catch (error) {
    if (error.stack) error.stack = error.stack.replace(/data:text\/javascript;base64,[^\s)]+/g, "production-panel"); throw error;
  } finally {
    unmount(); unsubscribe(); await turn(); process.off("unhandledRejection", listener);
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}

test("actual collapse and reopen handlers retain the layout and handle failed persistence; a real retry clears feedback", () => fixture(async h => {
  h.full(true); h.failServer(new Error("Server unavailable"));
  h.click("Collapse workspace panel"); await turn(); h.render();
  assert.equal(h.requests.length, 1, "one save despite React updater replay");
  assert.match(h.alert(), /Could not save panel preferences/);
  assert.equal(h.node(item => item.props?.title === "Open Journal").props["aria-expanded"], false);
  assert.equal(walk(h.render()).some(item => item.props?.["data-workspace-panel-manager"] === "true"), false);
  h.full(false); h.failServer(null); h.click("Open Journal"); await turn(); h.render();
  assert.equal(h.requests.length, 2); assert.equal(h.alert(), "");
  assert.equal(h.node(item => item.props?.["data-workspace-panel-manager"] === "true").props["data-dock"], "right");
  assert.equal(JSON.parse(h.storage.get("edgelab.journal-panel-layout.v1.user-7")).collapsed, false);
}));

test("pointer resize saves the final width only on release, keyboard resize catches synchronous callback errors", () => fixture(async h => {
  h.full(true); h.failServer(new Error("Server unavailable"));
  h.node(item => item.props?.role === "separator").props.onPointerDown({ clientX: 500, pointerId: 1, currentTarget: { setPointerCapture() {} } });
  h.dispatch("pointermove", { clientX: 420 }); h.render();
  assert.equal(h.requests.length, 0); assert.equal(h.node(item => item.props?.role === "separator").props["aria-valuenow"], 440);
  h.dispatch("pointerup"); await turn(); h.render();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].width, 440); assert.match(h.alert(), /Could not save/);
  h.props.onChange = () => { throw new Error("Synchronous callback failure"); }; h.render(); h.commit();
  h.node(item => item.props?.role === "separator").props.onKeyDown({ key: "ArrowLeft", preventDefault() {} });
  await turn(); h.render(); assert.equal(h.node(item => item.props?.role === "separator").props["aria-valuenow"], 464);
  assert.match(h.alert(), /Could not save/);
}));

test("real account admission stays blocked and offers recovery without discarding the requested layout", () => fixture(async h => {
  const marker = "edgelab.app-data-uncertain.v1.user-7.interrupted";
  h.storage.set(marker, "u"); h.click("Dock workspace panel to left"); await turn(); h.render();
  assert.equal(h.requests.length, 0); assert.match(h.alert(), /Panel saves are paused.*Storage.*reload/);
  assert.equal(h.node(item => item.props?.["data-workspace-panel-manager"] === "true").props["data-dock"], "left");
  assert.equal(h.storage.get(marker), "u", "receipt barrier remains intact");
  await assert.rejects(h.api.saveJournalPanelPreferences(h.props.value), error => error.requiresReload === true);
}));

test("older completion cannot clear newer failed preferences", () => fixture(async h => {
  const held = deferred(); let first = true;
  h.props.onChange = async next => { await h.api.saveJournalPanelPreferences(next); if (first) { first = false; await held.promise; } };
  h.render(); h.commit(); h.click("Expand workspace panel"); await turn();
  h.full(true); h.failServer(new Error("Latest save failed")); h.click("Dock workspace panel to left"); await turn(); h.render();
  assert.match(h.alert(), /Could not save/); held.resolve(); await turn(); h.render(); assert.match(h.alert(), /Could not save/);
}));

test("account/token ABA, import replacement, callback replacement and unmount suppress late save feedback", async () => {
  for (const kind of ["account", "token", "account-aba", "delayed-storage", "epoch", "callback", "unmount"]) await fixture(async h => {
    const held = deferred();
    h.controller.put = async () => { await held.promise; throw new Error("Old failed save"); };
    h.full(true); h.click("Expand workspace panel"); await turn(); h.full(false);
    if (kind === "account") h.api.setStoredAuthSession(session(8), { notify: false });
    if (kind === "token") h.api.setStoredAuthSession(session(7, "changed"), { notify: false });
    if (kind === "account-aba") { h.api.setStoredAuthSession(session(8), { notify: false }); h.api.setStoredAuthSession(session(), { notify: false }); }
    if (kind === "delayed-storage") h.dispatch("storage", { key: "edgelab.auth.session.v1", oldValue: JSON.stringify(session()), newValue: JSON.stringify(session(8)) });
    if (kind === "epoch") h.storage.set("edgelab.app-data-generation.v1.user-7", JSON.stringify({ revision: "new-import", phase: "ready" }));
    if (kind === "callback") { h.props.onChange = () => undefined; h.render(); h.commit(); }
    if (kind === "unmount") h.unmount();
    const writes = h.writes.length; held.resolve(); await turn();
    assert.equal(h.writes.length, writes, kind); h.render(); assert.equal(h.alert(), "", kind);
  });
});

test("hover preview is ephemeral and never invokes the preference save handler", () => fixture(async h => {
  h.node(item => item.props?.title === "Open Journal").props.onPointerEnter({ pointerType: "mouse" }); h.render(); h.commit(); h.render();
  assert.equal(h.node(item => item.props?.["data-workspace-panel-manager"] === "true").props["data-hover-preview"], true);
  assert.equal(h.requests.length, 0);
  h.node(item => item.props?.["data-workspace-panel-layout"] === "true").props.children[1].props.onKeyDown({ key: "Escape", preventDefault() {} });
  h.render(); assert.equal(walk(h.render()).some(item => item.props?.["data-hover-preview"] === true), false);
  assert.equal(h.requests.length, 0);
}, { collapsed: true }));
