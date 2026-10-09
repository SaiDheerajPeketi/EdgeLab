import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

// Execute the production component/helpers. Only React scheduling, chart geometry,
// and browser event surfaces are controlled; commits are never replaced.
const bundle = buildSync({ entryPoints: ["frontend/src/components/PineInputAnchors.tsx"], bundle: true,
  platform: "node", format: "cjs", minify: true, write: false, logLevel: "silent",
  external: ["react", "react/jsx-runtime", "react-dom", "lucide-react", "../lib/pineLinePrimitive"],
}).outputFiles[0].text;
const loaded = { exports: {} };
const jsx = (type, props) => ({ type, props });
const react = Object.fromEntries(["useRef", "useMemo", "useState", "useLayoutEffect", "useId"].map(name =>
  [name, (...args) => globalThis.__pineAnchor134[name](...args)]));
new Function("require", "module", "exports", bundle)(name => {
  if (name === "react") return react;
  if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
  if (name === "react-dom") return { createPortal: child => child };
  if (name === "lucide-react") return { Crosshair: "Crosshair", MoveHorizontal: "MoveHorizontal", MoveVertical: "MoveVertical", X: "X" };
  if (name === "../lib/pineLinePrimitive") return { acquireTooltipContainer() {}, releaseTooltipContainer() {} };
  throw Error(`Unexpected dependency ${name}`);
}, loaded, loaded.exports);
const { PineInputAnchors, pineLoadedAnchorIndex, pinePickedAnchorTime } = loaded.exports;
const bars = [{ time: -60 }, { time: 0 }, { time: 120 }];

test("loaded time snapping preserves sparse, zero and negative timestamps without future slots", () => {
  assert.equal(pineLoadedAnchorIndex(bars, -60_000), 0);
  assert.equal(pineLoadedAnchorIndex(bars, 0), 1);
  assert.equal(pineLoadedAnchorIndex(bars, 60_000), 1);
  assert.equal(pineLoadedAnchorIndex(bars, 119_999), 2);
  for (const value of [-60_001, 120_001, 1.1, Infinity]) assert.equal(pineLoadedAnchorIndex(bars, value), null);
  assert.equal(pineLoadedAnchorIndex([], 0), null);
});

test("time picks require loaded candles and refuse foreign/future logical slots", () => {
  let time = null, logical = 1;
  const chart = { timeScale: () => ({ coordinateToTime: () => time, coordinateToLogical: x => x === 100 ? 8 : logical,
    timeToCoordinate: () => 100 }) };
  assert.equal(pinePickedAnchorTime(chart, bars, 10), null); // Foreign timeline slot.
  time = 60; assert.equal(pinePickedAnchorTime(chart, bars, 10), 0);
  time = 121; assert.equal(pinePickedAnchorTime(chart, bars, 10), null);
  time = null; logical = 3; assert.equal(pinePickedAnchorTime(chart, bars, 10), null);
  chart.timeScale = () => ({ coordinateToTime: () => null, coordinateToLogical: () => 1,
    timeToCoordinate: () => 100 });
  assert.equal(pinePickedAnchorTime(chart, bars, 10), 0);
});

class Element {
  captured = new Set(); isConnected = true; ownerDocument = { defaultView: null };
  focus() {} getBoundingClientRect() { return { left: 10, top: 20 }; }
  hasPointerCapture(id) { return this.captured.has(id); }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
}
function fixture(t, definitions = [{ id: "p", name: "Price", type: "price", defval: 0 }]) {
  const saved = Object.fromEntries(["HTMLElement", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "__pineAnchor134"].map(key => [key, globalThis[key]]));
  globalThis.HTMLElement = Element;
  globalThis.document = { activeElement: null };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  const root = new Element(), slots = [], effects = [], commits = [], picks = [], primitive = [];
  let index = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useId: () => "anchor-instructions",
    useRef: initial => { const slot = index++; return slots[slot] ??= { current: initial }; },
    useMemo: (fn, deps) => { const slot = index++; if (!slots[slot] || !equal(slots[slot].deps, deps)) slots[slot] = { deps, value: fn() }; return slots[slot].value; },
    useState: initial => { const slot = index++; slots[slot] ??= { value: initial }; return [slots[slot].value, value => { slots[slot].value = typeof value === "function" ? value(slots[slot].value) : value; }]; },
    useLayoutEffect: (fn, deps) => { const slot = index++; if (!slots[slot] || !equal(slots[slot].deps, deps)) { const old = slots[slot]; slots[slot] = { deps }; effects.push(() => { old?.cleanup?.(); slots[slot].cleanup = fn(); }); } },
  };
  globalThis.__pineAnchor134 = hooks;
  let inverted = false;
  const scale = { coordinateToTime: x => bars[Math.round(x / 100)]?.time ?? null,
    coordinateToLogical: x => x / 100, timeToCoordinate: time => { const i = bars.findIndex(bar => bar.time === time); return i < 0 ? null : i * 100; },
    subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {} };
  const chart = { chartElement: () => root, paneSize: () => ({ width: 300, height: 200 }), priceScale: () => ({ width: () => 40 }), timeScale: () => scale };
  const series = { priceToCoordinate: price => inverted ? 100 + price : 100 - price,
    coordinateToPrice: y => inverted ? y - 100 : 100 - y,
    attachPrimitive: p => primitive.push(p), detachPrimitive: p => primitive.splice(primitive.indexOf(p), 1) };
  let props = { chart, series, bars, definitions, inputs: {}, contextKey: "owner-a", onCommit: patch => commits.push(patch) };
  const walk = (node, predicate) => { if (!node || typeof node !== "object") return null; if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(3)) { const result = walk(child, predicate); if (result) return result; } return null; };
  let tree;
  const render = () => { index = 0; tree = PineInputAnchors(props); while (effects.length) effects.shift()(); return tree; };
  const button = () => walk(tree, node => node.props?.["data-pine-input-anchor"]);
  const event = (x, y, target = root) => ({ clientX: 50 + x, clientY: 20 + y, pointerId: 1, button: 0, isPrimary: true,
    currentTarget: target, target, preventDefault() {}, stopPropagation() {} });
  render(); render();
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  return { root, commits, picks, primitive, render, button, event, tree: () => tree,
    change: patch => { props = { ...props, ...patch }; render(); render(); },
    invert: () => { inverted = true; render(); },
    picker: () => walk(tree, node => node.props?.role === "group"),
    pickMode: () => { props = { ...props, picking: { anchorId: definitions.length === 2 ? "point:p:t" : definitions[0].id, onPick: patch => picks.push(patch), onCancel() {} } }; render(); render(); },
    dispose: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("off-center clicks do not write; displacement preview commits once without positive-price clamping", t => {
  const f = fixture(t), b = f.button();
  b.props.onPointerDown(f.event(280, 115)); b.props.onPointerUp(f.event(280, 115));
  assert.deepEqual(f.commits, []);
  b.props.onPointerDown(f.event(280, 115)); b.props.onPointerMove(f.event(281, 116));
  assert.deepEqual(f.commits, []);
  b.props.onPointerUp(f.event(281, 116)); assert.deepEqual(f.commits, [{ p: -1 }]);
  assert.equal(f.root.captured.size, 0);
  b.props.onPointerUp(f.event(281, 116)); assert.equal(f.commits.length, 1);
});

test("inverted scales and keyboard previews use actual chart coordinates; Escape cancels", t => {
  const f = fixture(t); f.invert();
  const key = value => ({ key: value, shiftKey: false, preventDefault() {}, stopPropagation() {} });
  f.button().props.onKeyDown(key("ArrowUp")); assert.deepEqual(f.commits, []);
  f.button().props.onKeyDown(key("Enter")); assert.deepEqual(f.commits, [{ p: -1 }]);
  f.button().props.onKeyDown(key("ArrowDown")); f.button().props.onKeyDown(key("Escape"));
  f.button().props.onKeyDown(key("Enter")); assert.equal(f.commits.length, 1);
});

test("owner change, hide, cancellation and disposal never commit a held pointer", t => {
  const f = fixture(t);
  for (const patch of [{ contextKey: "owner-b" }, { enabled: false }, { inputs: { p: 5 } }]) {
    f.change({ enabled: true }); const b = f.button(); b.props.onPointerDown(f.event(280, 100));
    b.props.onPointerMove(f.event(280, 110)); f.change(patch); b.props.onPointerUp(f.event(280, 110));
  }
  f.change({ enabled: true }); const b = f.button(); b.props.onPointerDown(f.event(280, 100));
  b.props.onPointerCancel(f.event(280, 110)); b.props.onPointerUp(f.event(280, 110));
  b.props.onPointerDown(f.event(280, 100)); f.dispose(); b.props.onPointerUp(f.event(280, 110));
  assert.deepEqual(f.commits, []); assert.equal(f.root.captured.size, 0); assert.equal(f.primitive.length, 0);
});

test("routine live array refresh retains authority but departing loaded history refuses a point commit", t => {
  const definitions = [{ id: "p", name: "Price", type: "price", defval: 0, inline: "point" },
    { id: "t", name: "Time", type: "time", defval: 0, inline: "point" }];
  const f = fixture(t, definitions), b = f.button();
  b.props.onPointerDown(f.event(100, 100)); b.props.onPointerMove(f.event(200, 110));
  f.change({ bars: [...bars] }); f.button().props.onPointerUp(f.event(200, 110));
  assert.deepEqual(f.commits, [{ p: -10, t: 120_000 }]);
  f.button().props.onPointerDown(f.event(100, 100)); f.button().props.onPointerMove(f.event(200, 110));
  f.change({ bars: [{ time: -60 }, { time: 0 }] }); b.props.onPointerUp(f.event(200, 110));
  assert.equal(f.commits.length, 1);
});

test("picker consumes a plot gesture and atomically delivers both members without ordinary commit", t => {
  const f = fixture(t, [{ id: "p", name: "Price", type: "price", defval: 0, inline: "point" },
    { id: "t", name: "Time", type: "time", defval: 0, inline: "point" }]);
  f.pickMode(); const picker = f.picker();
  f.root.closest = () => null;
  picker.props.onPointerDown(f.event(200, 125)); picker.props.onPointerUp(f.event(200, 125));
  assert.deepEqual(f.picks, [{ p: -25, t: 120_000 }]); assert.deepEqual(f.commits, []);
});

test("leaving the pane or disabling an active member discards a held preview", t => {
  const f = fixture(t), b = f.button();
  b.props.onPointerDown(f.event(280, 100)); b.props.onPointerMove(f.event(280, 110));
  b.props.onPointerUp(f.event(301, 110)); assert.deepEqual(f.commits, []);
  b.props.onPointerDown(f.event(280, 100)); b.props.onPointerMove(f.event(280, 110));
  f.change({ definitions: [{ id: "p", name: "Price", type: "price", defval: 0, active: false }] });
  b.props.onPointerUp(f.event(280, 110)); assert.deepEqual(f.commits, []); assert.equal(f.button(), null);
});
