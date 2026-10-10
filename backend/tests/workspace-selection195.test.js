import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const ts = createRequire(import.meta.url)(path.resolve("frontend/node_modules/typescript"));
const source = fs.readFileSync("frontend/src/App.tsx", "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let selection;
const rawSetters = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "selectWorkspace") selection = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "setActiveWorkspace") rawSetters.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(selection, "App must use its actual selection helper");
const bundle = (await build({ bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", stdin: {
  loader: "tsx", resolveDir: process.cwd(), contents: `
    import { workspaceHrefForView } from "./frontend/src/lib/workspaceRoute.ts";
    export * from "./frontend/src/lib/workspaceRoute.ts";
    export function bindSelection(navigate, setActiveWorkspace, flushSync, window) {
      ${selection}
      return selectWorkspace;
    }
  `,
} })).outputFiles[0].text;
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);

function fixture(pathname, hash = "") {
  const location = { pathname, hash }, events = [];
  const select = api.bindSelection(href => {
    events.push(["navigate", href]);
    const next = new URL(href, "https://edgelab.test");
    location.pathname = next.pathname; location.hash = next.hash;
  }, view => events.push(["selected", view]), apply => apply(), { location });
  return { select, location, events };
}

test("internal workspace selections update the URL before selecting the page", () => {
  for (const view of new Set(api.WORKSPACE_ROUTE_DEFINITIONS.map(route => route.view))) {
    const { select, location, events } = fixture("/previous");
    select(view);
    assert.deepEqual(events, [["navigate", api.workspacePathForView(view)], ["selected", view]]);
    assert.equal(api.workspaceViewFromPath(location.pathname), view);
  }
});

test("repeat selection avoids duplicate browser history and preserves destination entity hashes", () => {
  const { select, location, events } = fixture("/app/journal/trades", "#journal/trades?trade=42");
  select("journalTrades");
  assert.deepEqual(events, [["selected", "journalTrades"]]);
  assert.equal(location.hash, "#journal/trades?trade=42");
  select("backtest");
  assert.deepEqual(events.slice(1), [["navigate", "/app/replay"], ["selected", "backtest"]]);
  assert.equal(location.hash, "");
});

test("raw workspace setters are confined to URL restoration and the synchronized selector", () => {
  assert.equal(rawSetters.length, 2, "Internal page actions must not bypass browser history");
  assert.ok(rawSetters.some(node => node.arguments[0].getText(ast) === "workspaceViewFromPath(location.pathname)"));
  assert.ok(rawSetters.some(node => node.arguments[0].getText(ast) === "view"));
});
