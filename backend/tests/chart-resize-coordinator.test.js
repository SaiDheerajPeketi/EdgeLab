import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildSync } from "../../node_modules/esbuild/lib/main.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

async function bundle(relativePath) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "edgelab-resize-"));
  const output = path.join(directory, "module.mjs");
  buildSync({ bundle: true, entryPoints: [path.join(ROOT, relativePath)], format: "esm", outfile: output, platform: "node" });
  return { cleanup: () => fs.rmSync(directory, { force: true, recursive: true }), module: await import(`${pathToFileURL(output).href}?${Date.now()}`) };
}

test("dense chart panes share one observer and flush its pre-paint batch immediately", async () => {
  const originalElement = globalThis.Element;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalObserver = globalThis.ResizeObserver;
  const originalRequestFrame = globalThis.requestAnimationFrame;
  const originalCancelFrame = globalThis.cancelAnimationFrame;
  const frames = [];
  const observers = [];

  class FakeElement {
    constructor(width, height) { this.clientHeight = height; this.clientWidth = width; }
  }
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); }
    disconnect() { this.observed.clear(); }
    observe(element) { this.observed.add(element); }
    unobserve(element) { this.observed.delete(element); }
    emit(entries) { this.callback(entries); }
  }

  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => undefined;

  const { cleanup, module } = await bundle("frontend/src/lib/sharedChartResize.ts");
  try {
    const panes = Array.from({ length: 16 }, () => new FakeElement(320, 180));
    const sizes = panes.map(() => []);
    const stopObserving = panes.map((pane, index) =>
      module.observeSharedChartSize(pane, (size) => sizes[index].push(size)),
    );

    assert.equal(observers.length, 1);
    assert.equal(observers[0].observed.size, 16);
    assert.equal(frames.length, 1);
    frames.shift()(0);
    assert.deepEqual(
      sizes.map((paneSizes) => paneSizes.at(-1)),
      panes.map(() => ({ width: 320, height: 180 })),
    );

    observers[0].emit(
      panes.map((pane) => ({ target: pane, contentRect: { width: 400, height: 220 } })),
    );
    assert.equal(frames.length, 0);
    assert.deepEqual(
      sizes.map((paneSizes) => paneSizes.at(-1)),
      panes.map(() => ({ width: 400, height: 220 })),
    );

    stopObserving.forEach((stop) => stop());
    assert.equal(observers[0].observed.size, 0);
  } finally {
    cleanup();
    globalThis.Element = originalElement;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.ResizeObserver = originalObserver;
    globalThis.requestAnimationFrame = originalRequestFrame;
    globalThis.cancelAnimationFrame = originalCancelFrame;
  }
});

test("suppresses duplicate and zero sizes while unregistering panes independently", async () => {
  const originalElement = globalThis.Element;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalObserver = globalThis.ResizeObserver;
  const originalRequestFrame = globalThis.requestAnimationFrame;
  const originalCancelFrame = globalThis.cancelAnimationFrame;
  const frames = [];
  const observers = [];

  class FakeElement {
    constructor(width, height) { this.clientHeight = height; this.clientWidth = width; }
  }
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnectCalls = 0;
      this.observed = new Set();
      observers.push(this);
    }
    disconnect() { this.disconnectCalls += 1; this.observed.clear(); }
    observe(element) { this.observed.add(element); }
    unobserve(element) { this.observed.delete(element); }
    emit(entries) { this.callback(entries); }
  }

  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = FakeResizeObserver;
  globalThis.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => undefined;

  const { cleanup, module } = await bundle("frontend/src/lib/sharedChartResize.ts");
  try {
    const first = new FakeElement(320, 180);
    const second = new FakeElement(320, 180);
    const firstSizes = [];
    const secondSizes = [];
    const stopFirst = module.observeSharedChartSize(first, (size) => firstSizes.push(size));
    const stopSecond = module.observeSharedChartSize(second, (size) => secondSizes.push(size));
    frames.shift()(0);

    observers[0].emit([
      { target: first, contentRect: { width: 320, height: 180 } },
      { target: second, contentRect: { width: 0, height: 0 } },
    ]);
    assert.equal(frames.length, 0);
    assert.equal(firstSizes.length, 1);
    assert.equal(secondSizes.length, 1);

    stopFirst();
    assert.equal(observers[0].observed.has(first), false);
    assert.equal(observers[0].observed.has(second), true);
    assert.equal(observers[0].disconnectCalls, 0);

    observers[0].emit([
      { target: first, contentRect: { width: 640, height: 360 } },
      { target: second, contentRect: { width: 640, height: 360 } },
    ]);
    assert.equal(firstSizes.length, 1);
    assert.deepEqual(secondSizes.at(-1), { width: 640, height: 360 });

    stopSecond();
    assert.equal(observers[0].disconnectCalls, 1);
  } finally {
    cleanup();
    globalThis.Element = originalElement;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.ResizeObserver = originalObserver;
    globalThis.requestAnimationFrame = originalRequestFrame;
    globalThis.cancelAnimationFrame = originalCancelFrame;
  }
});

test("fallback removes its shared listener and cancels a pending final frame", async () => {
  const originalElement = globalThis.Element;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalObserver = globalThis.ResizeObserver;
  const originalRequestFrame = globalThis.requestAnimationFrame;
  const originalCancelFrame = globalThis.cancelAnimationFrame;
  const originalWindow = globalThis.window;
  const cancelledFrames = [];
  const frames = new Map();
  const listeners = new Map();
  let nextFrame = 0;

  class FakeElement {
    constructor(width, height) { this.clientHeight = height; this.clientWidth = width; }
  }

  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.ResizeObserver = undefined;
  globalThis.window = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  };
  globalThis.cancelAnimationFrame = (frame) => {
    cancelledFrames.push(frame);
    frames.delete(frame);
  };

  const { cleanup, module } = await bundle("frontend/src/lib/sharedChartResize.ts");
  try {
    const callbacks = [];
    const stopFirst = module.observeSharedChartSize(
      new FakeElement(320, 180),
      (size) => callbacks.push(size),
    );
    const stopSecond = module.observeSharedChartSize(
      new FakeElement(320, 180),
      (size) => callbacks.push(size),
    );

    assert.equal(listeners.has("resize"), true);
    assert.equal(frames.size, 1);
    stopFirst();
    assert.equal(listeners.has("resize"), true);
    assert.deepEqual(cancelledFrames, []);

    stopSecond();
    assert.equal(listeners.has("resize"), false);
    assert.deepEqual(cancelledFrames, [1]);
    assert.equal(frames.size, 0);
    assert.deepEqual(callbacks, []);
  } finally {
    cleanup();
    globalThis.Element = originalElement;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.ResizeObserver = originalObserver;
    globalThis.requestAnimationFrame = originalRequestFrame;
    globalThis.cancelAnimationFrame = originalCancelFrame;
    globalThis.window = originalWindow;
  }
});

test("TradingChart disables per-chart auto sizing and uses the shared coordinator", () => {
  const source = fs.readFileSync(path.join(ROOT, "frontend/src/components/TradingChart.tsx"), "utf8");
  assert.match(source, /autoSize:\s*false/);
  assert.match(source, /observeSharedChartSize\(chartContainer/);
  assert.doesNotMatch(source, /autoSize:\s*true/);
});
