import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const code = (await build({ entryPoints: ["frontend/src/lib/pineInputClickGuard.ts"], bundle: true, minify: true,
  format: "esm", platform: "browser", write: false, logLevel: "silent" })).outputFiles[0].text;
const { guardPineInputCompletionClick } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

// A document's capture listeners run before the newly mounted target's action.
// Timers belong to that document's window, avoiding changes to global timers.
function documentHarness() {
  const listeners = [], timers = new Map(); let sequence = 0, now = 0;
  const document = {
    defaultView: {
      setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    addEventListener(type, callback, options) { listeners.push({ type, callback, capture: options === true || options?.capture === true }); },
    removeEventListener(type, callback, options) {
      const capture = options === true || options?.capture === true;
      const index = listeners.findIndex(item => item.type === type && item.callback === callback && item.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  return { document, listeners, timers,
    dispatch(type, fields = {}, targetAction = () => {}) {
      const event = new Event(type, { bubbles: true, cancelable: true }); let immediate = false;
      Object.defineProperties(event, Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { value }])));
      const stop = event.stopImmediatePropagation.bind(event);
      event.stopImmediatePropagation = () => { immediate = true; stop(); };
      for (const listener of [...listeners]) {
        if (listener.type === type && listener.capture && listeners.includes(listener)) listener.callback(event);
        if (immediate) break;
      }
      if (!immediate) targetAction(event);
      return { event, immediate };
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.callback();
    },
  };
}
const completion = { clientX: 126.25, clientY: 218.75 };
const mouseClick = { ...completion, detail: 1 };
function assertClean(harness) { assert.equal(harness.listeners.length, 0); assert.equal(harness.timers.size, 0); }

test("real guard captures a completion click before a replacement popup target can save or add", () => {
  const harness = documentHarness(); let addCalls = 0;
  const dispose = guardPineInputCompletionClick(harness.document, completion);
  assert.equal(typeof dispose, "function");
  assert.ok(harness.listeners.some(item => item.type === "click" && item.capture));
  // The picker has unmounted and a different element is now under the same pixel.
  const { event, immediate } = harness.dispatch("click", { ...mouseClick, target: { id: "new-add-button", parent: "new-dialog" } }, () => addCalls++);
  assert.equal(event.defaultPrevented, true); assert.equal(immediate, true);
  assert.equal(addCalls, 0); assertClean(harness);
  dispose(); assertClean(harness);
  harness.dispatch("click", mouseClick, () => addCalls++); assert.equal(addCalls, 1);
});

test("completion filtering tolerates a two-pixel offset but never suppresses an unrelated position or keyboard click", () => {
  for (const fields of [{ clientX: completion.clientX + 1, clientY: completion.clientY - 1, detail: 1 },
    { ...completion, detail: 2 }]) {
    const harness = documentHarness(); let calls = 0;
    const dispose = guardPineInputCompletionClick(harness.document, completion);
    const { event } = harness.dispatch("click", fields, () => calls++);
    assert.equal(calls, 0); assert.equal(event.defaultPrevented, true); dispose(); assertClean(harness);
  }
  for (const fields of [{ ...mouseClick, clientX: completion.clientX + 3 }, { ...mouseClick, clientY: completion.clientY - 3 },
    { ...mouseClick, detail: 0 }, { ...mouseClick, detail: -1 }]) {
    const harness = documentHarness(); let calls = 0;
    const dispose = guardPineInputCompletionClick(harness.document, completion);
    const { event, immediate } = harness.dispatch("click", fields, () => calls++);
    assert.equal(calls, 1); assert.equal(event.defaultPrevented, false); assert.equal(immediate, false);
    dispose(); assertClean(harness);
  }
});

test("a fresh pointerdown releases the guard before a deliberate click on the same replacement action", () => {
  const harness = documentHarness(); let calls = 0;
  const dispose = guardPineInputCompletionClick(harness.document, completion);
  const fresh = harness.dispatch("pointerdown", completion);
  assert.equal(fresh.event.defaultPrevented, false); assertClean(harness);
  const click = harness.dispatch("click", mouseClick, () => calls++);
  assert.equal(click.event.defaultPrevented, false); assert.equal(calls, 1); dispose(); assertClean(harness);
});

test("a fresh keydown restores both native keyboard and subsequent pointer activations", () => {
  for (const key of ["Enter", " ", "Tab", "Escape"]) {
    const harness = documentHarness(); let calls = 0;
    const dispose = guardPineInputCompletionClick(harness.document, completion);
    const fresh = harness.dispatch("keydown", { key });
    assert.equal(fresh.event.defaultPrevented, false); assertClean(harness);
    harness.dispatch("click", { ...mouseClick, detail: 0 }, () => calls++);
    harness.dispatch("click", mouseClick, () => calls++);
    assert.equal(calls, 2); dispose(); assertClean(harness);
  }
});

test("the document-owned timeout expires after 750ms and releases every listener without blocking later actions", () => {
  const harness = documentHarness(); let calls = 0;
  const dispose = guardPineInputCompletionClick(harness.document, completion);
  assert.equal(harness.timers.size, 1);
  harness.advance(749); assert.ok(harness.listeners.length > 0);
  harness.advance(1); assertClean(harness);
  harness.dispatch("click", mouseClick, () => calls++); assert.equal(calls, 1);
  dispose(); dispose(); harness.advance(1000); assertClean(harness);
});

test("explicit cleanup is idempotent before a click or timeout and cannot leave capture listeners behind", () => {
  const harness = documentHarness(); let calls = 0;
  const dispose = guardPineInputCompletionClick(harness.document, completion);
  dispose(); dispose(); assertClean(harness);
  harness.advance(1000); harness.dispatch("click", mouseClick, () => calls++);
  assert.equal(calls, 1); assertClean(harness);
});


test("a missing document window or nonfinite gesture position installs no listener or timer", () => {
  for (const point of [{ clientX: NaN, clientY: 1 }, { clientX: 1, clientY: Infinity }, { clientX: -Infinity, clientY: 1 }]) {
    const harness = documentHarness();
    const dispose = guardPineInputCompletionClick(harness.document, point);
    dispose(); dispose(); assertClean(harness);
  }
  const harness = documentHarness(); harness.document.defaultView = null;
  const dispose = guardPineInputCompletionClick(harness.document, completion);
  dispose(); dispose(); assertClean(harness);
});
