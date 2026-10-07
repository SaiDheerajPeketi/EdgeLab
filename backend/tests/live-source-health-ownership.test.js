import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";
import { transformSync } from "esbuild";

// Compile the real component's owned-state boundary and the real health effect.
// No production helper is added solely to expose this regression to a test.
const workspaceSource = fs.readFileSync("frontend/src/components/EdgeLabWorkspace.tsx", "utf8");
const workspaceAst = ts.createSourceFile("workspace.tsx", workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = workspaceAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LiveMarketsPage");
const statements = [...page.body.statements];
const declares = (node, name) => ts.isVariableStatement(node) && node.declarationList.declarations.some(value => ts.isIdentifier(value.name) && value.name.text === name);
const first = statements.findIndex(node => declares(node, "emptyCredentials"));
const last = statements.findIndex(node => declares(node, "setFeedIssue"));
assert.ok(first >= 0 && last > first);
const ownedStatements = statements.slice(first, last + 1).map(node => node.getText(workspaceAst)).join("\n");
const healthSource = fs.readFileSync("frontend/src/components/live/LiveFeedHealthSurface.tsx", "utf8");
const healthAst = ts.createSourceFile("health.tsx", healthSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const healthComponent = healthAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LiveFeedHealthSurface");
const healthNotification = healthComponent.body.statements.find(node => ts.isExpressionStatement(node)
  && node.getText(healthAst).includes("onIssueChange?.(issue)")).getText(healthAst);
const source = `import { useState, useRef, useMemo, useCallback, useEffect } from "react";
const EMPTY_LIVE_BARS = []; const EMPTY_LIVE_CACHE = {};
const getStoredAuthSession = () => globalThis.fixture.session;
const getApiBearerToken = () => globalThis.fixture.session.token;
const defaultAngelOneCredentials = () => ({ apiKey: "" });
const liveSymbolKey = value => value.symbol;
export function renderOwned(sourceSymbol) {
  const owner = JSON.stringify([getStoredAuthSession()?.user.id ?? null, getApiBearerToken()]);
  const selectedLiveSymbol = sourceSymbol ? { symbol: sourceSymbol } : null;
  const journalChartFocus = null;
  ${ownedStatements}
  return { feedState, connectionStatus, feedError, feedIssue, setFeedIssue, setFeedError,
    setConnectionStatus, credentialSource, setAngelOneCredentials, tickerSource, setTickers, cachedSource, setLiveBars };
}
export function renderHealth(issue, onIssueChange) { ${healthNotification} }`;
const compiled = transformSync(source, { loader: "tsx", format: "cjs" }).code;

function harness() {
  let cursor = 0, slots = [], pending = [], dirty = false, updates = 0, output;
  const fixture = { session: { token: "original-token", user: { id: 7 } } };
  globalThis.fixture = fixture;
  const same = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const hooks = {
    useState(initial) { const index = cursor++; if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, action => { const value = typeof action === "function" ? action(slots[index].value) : action;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; updates++; } }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(factory, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: factory(), deps }; return slots[index].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) { slots[index] = { deps }; pending.push(effect); } },
  };
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => name === "react" ? hooks : createRequire(import.meta.url)(name), loaded, loaded.exports);
  return { fixture,
    get dirty() { return dirty; }, get updates() { return updates; },
    render(symbol = "BTCUSDT") { cursor = 0; dirty = false; output = loaded.exports.renderOwned(symbol);
      loaded.exports.renderHealth(output.feedIssue, output.setFeedIssue); return output; },
    commit() { const effects = pending; pending = []; effects.forEach(effect => effect()); },
    settle(symbol = "BTCUSDT") { let count = 0; do { this.render(symbol); this.commit(); assert.ok(++count < 8, "actual health effect must not keep rendering its parent"); } while (dirty); return output; },
    close() { delete globalThis.fixture; },
  };
}

test("actual feed health notification settles and keeps a stable owned callback", () => {
  const h = harness(); try {
    const first = h.settle();
    assert.equal(h.updates, 0, "initial null issue must preserve existing state");
    const second = h.render(); h.commit();
    assert.equal(second.setFeedIssue, first.setFeedIssue);
    assert.equal(second.feedState, first.feedState); assert.equal(h.dirty, false);
    second.setFeedIssue("stale"); const changed = h.settle();
    assert.equal(changed.feedIssue, "stale");
    assert.equal(changed.setFeedIssue, first.setFeedIssue); assert.equal(h.updates, 1);
  } finally { h.close(); }
});

test("unchanged owned status, ticker, credentials and bars preserve their records", () => {
  const h = harness(); try {
    const first = h.settle();
    first.setFeedError(null); first.setConnectionStatus("idle"); first.setFeedIssue(null);
    first.setTickers(current => current); first.setAngelOneCredentials(current => current); first.setLiveBars(current => current);
    const next = h.render(); h.commit();
    assert.equal(h.updates, 0);
    for (const key of ["feedState", "credentialSource", "tickerSource", "cachedSource"]) assert.equal(next[key], first[key], key);
  } finally { h.close(); }
});

test("feed generation hides prior status on A to B to A and rejects retired setters", () => {
  const h = harness(); try {
    const original = h.settle(); original.setConnectionStatus("live"); original.setFeedIssue("stale"); original.setFeedError("old feed");
    const ready = h.settle(); assert.equal(ready.connectionStatus, "live");
    const replacement = h.render("ETHUSDT");
    assert.equal(replacement.connectionStatus, "idle"); assert.equal(replacement.feedIssue, null); assert.equal(replacement.feedError, null);
    const returned = h.render("BTCUSDT");
    assert.equal(returned.connectionStatus, "idle"); assert.equal(returned.feedIssue, null); assert.equal(returned.feedError, null);
    const before = h.updates;
    original.setConnectionStatus("error"); original.setFeedIssue("stale"); replacement.setFeedError("retired");
    assert.equal(h.updates, before, "retired generation cannot publish before cleanup");
    const current = h.settle(); current.setConnectionStatus("live"); assert.equal(h.settle().connectionStatus, "live");
  } finally { h.close(); }
});

test("old account callbacks fail before rendering and new owner resets once", () => {
  const h = harness(); try {
    const original = h.settle(); original.setTickers({ BTCUSDT: { last: 100 } }); original.setAngelOneCredentials({ apiKey: "private-seven" }); h.settle();
    h.fixture.session = { token: "new-owner", user: { id: 8 } };
    const before = h.updates;
    original.setFeedIssue("stale"); original.setTickers({ BTCUSDT: { last: 999 } }); original.setAngelOneCredentials({ apiKey: "old-callback" });
    assert.equal(h.updates, before);
    const current = h.settle(); assert.equal(current.feedIssue, null); assert.equal(current.connectionStatus, "idle");
    assert.notEqual(current.setFeedIssue, original.setFeedIssue);
    const settledUpdates = h.updates; current.setFeedIssue(null); current.setTickers(value => value); current.setAngelOneCredentials(value => value);
    h.settle(); assert.equal(h.updates, settledUpdates + 2, "first new-owner empty ticker/credential records replace old ownership once");
    const finalUpdates = h.updates; const final = h.settle(); final.setTickers(value => value); final.setAngelOneCredentials(value => value); final.setFeedIssue(null);
    h.settle(); assert.equal(h.updates, finalUpdates);
  } finally { h.close(); }
});
