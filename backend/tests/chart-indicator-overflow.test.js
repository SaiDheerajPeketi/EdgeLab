import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const require = createRequire(new URL("../../frontend/package.json", import.meta.url));
const bundle = buildSync({ bundle: true, format: "cjs", platform: "node", packages: "external", write: false,
  jsx: "automatic", logLevel: "silent", stdin: { loader: "tsx", resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
    contents: 'export { ActiveIndicatorMenu } from "./frontend/src/components/chart/ActiveIndicatorMenu.tsx";' } }).outputFiles[0].text;
function fixture(indicators) {
  const changes = [], actions = [], frames = new Map();
  let nextFrame = 0, refIndex = 0;
  const chart = { focus: () => actions.push(["focus", "chart"]) };
  const trigger = { closest: () => chart, focus: () => actions.push(["focus", "trigger"]) };
  const surface = { querySelectorAll: () => [] };
  const refs = [{ current: trigger }, { current: surface }, { current: 0 }];
  const loaded = { exports: {} };
  new Function("require", "module", "exports", bundle)(name => name === "react" ? { ...require(name),
    useState: () => [true, value => changes.push(value)], useRef: () => refs[refIndex++], useId: () => "active-test",
    useEffect: () => {} } : require(name), loaded, loaded.exports);
  const tree = loaded.exports.ActiveIndicatorMenu({ indicators, onOpenSettings: (id, anchor) => actions.push(["settings", id, anchor]),
    onToggleVisibility: id => actions.push(["visibility", id]), onRemove: id => actions.push(["remove", id]) });
  const nodes = [];
  const walk = value => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value?.props) { nodes.push(value); walk(value.props.children); }
  };
  walk(tree);
  const previous = [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame];
  globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  return { nodes, actions, changes, trigger, surface, refs,
    button: label => nodes.find(node => node.type === "button" && node.props["aria-label"] === label),
    flush: () => { for (const [id, callback] of frames) { frames.delete(id); callback(); } },
    restore: () => { [globalThis.requestAnimationFrame, globalThis.cancelAnimationFrame] = previous; } };
}
const studies = Array.from({ length: 24 }, (_, index) => ({ id: `study-${index}`, kind: "custom", customScriptName: `Study ${index}`,
  visible: index !== 23, settings: { period: 20, color: "#22d3ee" } }));

test("every installed study has labeled settings, visibility and remove controls beyond the old five-study limit", () => {
  const state = fixture(studies);
  try {
    assert.equal(state.nodes.filter(node => node.type === "li").length, 24);
    for (const study of studies) {
      assert.ok(state.button(`Settings for ${study.customScriptName}`));
      assert.ok(state.button(`${study.visible ? "Hide" : "Show"} ${study.customScriptName}`));
      assert.ok(state.button(`Remove ${study.customScriptName}`));
    }
    assert.equal(state.button("Show Study 23").props["aria-pressed"], false);
    state.button("Settings for Study 23").props.onClick();
    state.button("Show Study 23").props.onClick();
    assert.deepEqual(state.actions, [["settings", "study-23", state.trigger], ["visibility", "study-23"]]);
    assert.deepEqual(state.changes, [false]);
  } finally { state.restore(); }
});

test("removing a late study retains keyboard focus at the adjacent surviving settings control", () => {
  const state = fixture(studies);
  try {
    state.button("Remove Study 23").props.onClick();
    const controls = Array.from({ length: 23 }, (_, index) => ({ focus: () => state.actions.push(["focus", index]) }));
    state.surface.querySelectorAll = () => controls;
    state.flush();
    assert.deepEqual(state.actions, [["remove", "study-23"], ["focus", 22]]);
  } finally { state.restore(); }
});

test("removing the final study restores the chart when its trigger disappears", () => {
  const state = fixture([studies[23]]);
  try {
    state.button("Remove Study 23").props.onClick();
    state.refs[0].current = null; state.refs[1].current = null;
    state.flush();
    assert.deepEqual(state.actions, [["remove", "study-23"], ["focus", "chart"]]);
  } finally { state.restore(); }
});
