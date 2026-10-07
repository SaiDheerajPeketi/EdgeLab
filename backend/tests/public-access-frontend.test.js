import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = (await build({ bundle: true, define: { "import.meta.env": "{}" }, format: "esm",
  platform: "node", target: "node22", logLevel: "silent", write: false,
  plugins: [{ name: "image-render-boundary", setup(build) {
    build.onResolve({ filter: /^html-to-image$/ }, () => ({ path: "image-render-fixture", namespace: "image-fixture" }));
    build.onLoad({ filter: /.*/, namespace: "image-fixture" }, () => ({ loader: "js", contents: "export async function toPng(){return await globalThis.__captureFixture();}" }));
  } }],
  stdin: { contents: 'export * from "./frontend/src/lib/authSession.ts"; export { captureVisibleChartGridPng } from "./frontend/src/lib/chartCapture.ts"; export { hasActiveSubscription, requireActiveExportSubscription, downloadSubscribedTextFile } from "./frontend/src/lib/billing.ts";',
    loader: "ts", resolveDir: root, sourcefile: "public-access-entry.ts" },
})).outputFiles[0].text;
let instance = 0;
const fresh = () => import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}#${++instance}`);
const api = await fresh();
const now = Date.parse("2026-10-07T12:00:00Z");
const iso = (delta) => new Date(now + delta).toISOString();
const session = (mode = "production") => ({ createdAt: iso(-1000), expiresAt: iso(3600000), token: "verified-account-session",
  user: { id: 42, email: "verified@example.test", name: "Verified owner", provider: "google",
    approved: mode === "beta", betaPosition: mode === "beta" ? 1 : null, deploymentMode: mode,
    workspaceAccess: true, accessExpiresAt: iso(300000), isBetaUser: mode === "beta", plan: mode === "beta" ? "beta" : "pro" } });
const subscription = () => ({ provider: "stripe", mode: "live", configured: true,
  workspace_access: true, subscription_access: true, plan: "pro", status: "active", cadence: "monthly",
  current_period_end: iso(86400000), cancel_at_period_end: false, verified_at: iso(-1000), refresh_required: false });

for (const mode of ["production", "beta"]) test(`workspace access accepts a current explicit ${mode} entitlement`, () => {
  assert.equal(api.hasWorkspaceAccess(session(mode), now), true);
});
const deniedWorkspace = [
  ["missing session", () => null], ["false access", () => ({ ...session(), user: { ...session().user, workspaceAccess: false } })],
  ["truthy access", () => ({ ...session(), user: { ...session().user, workspaceAccess: "yes" } })],
  ...[iso(0), iso(-1), "bad date", null].map((accessExpiresAt) => [`access expiry ${accessExpiresAt}`, () => ({ ...session(), user: { ...session().user, accessExpiresAt } })]),
  ...[iso(0), iso(-1), "bad date"].map((expiresAt) => [`session expiry ${expiresAt}`, () => ({ ...session(), expiresAt })]),
  ["unknown mode", () => ({ ...session(), user: { ...session().user, deploymentMode: "unknown" } })],
  ["legacy approval is not production payment", () => ({ ...session(), user: { ...session().user, approved: true, plan: "beta", isBetaUser: true } })],
  ["public unpaid", () => ({ ...session(), user: { ...session().user, approved: false, workspaceAccess: false, plan: "none" } })],
  ["unapproved beta", () => ({ ...session("beta"), user: { ...session("beta").user, approved: false } })],
  ["truthy beta approval", () => ({ ...session("beta"), user: { ...session("beta").user, approved: "yes" } })],
];
for (const [label, value] of deniedWorkspace) test(`workspace access fails closed for ${label}`, () => {
  assert.equal(api.hasWorkspaceAccess(value(), now), false);
});

test("paid export accepts current live proof and scheduled cancellation through its paid term", () => {
  assert.equal(api.hasActiveSubscription(subscription(), now), true);
  assert.equal(api.hasActiveSubscription({ ...subscription(), cancel_at_period_end: true }, now), true);
});
const deniedSubscription = [
  ["missing status", () => null], ["disabled", () => ({ ...subscription(), configured: false })], ["truthy configured", () => ({ ...subscription(), configured: "yes" })],
  ["missing subscription proof", () => ({ ...subscription(), subscription_access: false })], ["truthy subscription proof", () => ({ ...subscription(), subscription_access: "yes" })],
  ["test mode", () => ({ ...subscription(), mode: "test" })], ["inactive", () => ({ ...subscription(), status: "canceled" })],
  ["wrong plan", () => ({ ...subscription(), plan: null })], ["false workspace access", () => ({ ...subscription(), workspace_access: false })],
  ["truthy workspace access", () => ({ ...subscription(), workspace_access: "yes" })],
  ...[iso(-300000), iso(-300001), iso(1), null, "invalid"].map((verified_at) => [`verification ${verified_at}`, () => ({ ...subscription(), verified_at })]),
  ...[iso(0), iso(-1), null, "invalid"].map((current_period_end) => [`paid term ${current_period_end}`, () => ({ ...subscription(), current_period_end })]),
];
for (const [label, value] of deniedSubscription) test(`paid subscription rejects ${label}`, () => {
  assert.equal(api.hasActiveSubscription(value(), now), false);
});

test("server user access fields map once and public identity remains separate from entitlement", () => {
  const wire = { created_at: iso(-1000), expires_at: iso(3600000), token: "server-token",
    user: { id: 42, email: "verified@example.test", name: "Public identity", provider: "google", approved: false,
      beta_position: null, deployment_mode: "production", workspace_access: true, access_expires_at: iso(300000), is_beta_user: false, plan: "pro" } };
  const mapped = api.toStoredAuthSession(wire);
  assert.equal(mapped.user.approved, false);
  assert.equal(mapped.user.workspaceAccess, true);
  assert.equal(mapped.user.accessExpiresAt, wire.user.access_expires_at);
  assert.equal(mapped.user.deploymentMode, "production");
  assert.equal(api.hasWorkspaceAccess(mapped, now), true);
  const unpaid = api.toStoredAuthSession({ ...wire, user: { ...wire.user, workspace_access: false, access_expires_at: null, plan: "none" } });
  assert.equal(unpaid.token, wire.token);
  assert.equal(api.hasWorkspaceAccess(unpaid, now), false);
});

async function browserHarness(run) {
  const previous = globalThis.window;
  const values = new Map(), events = [], handlers = new Map();
  globalThis.window = {
    localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) },
    dispatchEvent: (event) => { events.push(event.type); for (const cb of handlers.get(event.type) ?? []) cb(event); return true; },
    addEventListener: (type, cb) => handlers.set(type, [...(handlers.get(type) ?? []), cb]),
    removeEventListener: (type, cb) => handlers.set(type, (handlers.get(type) ?? []).filter((fn) => fn !== cb)),
  };
  const module = await fresh();
  try { await run({ module, values, events, handlers }); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}

test("same-id same-token access refresh notifies UI without canceling identity-owned work", async () => {
  await browserHarness(async ({ module, events }) => {
    const base = { ...session(), expiresAt: "2099-01-01T00:00:00Z", user: { ...session().user, workspaceAccess: false, accessExpiresAt: null } };
    module.setStoredAuthSession(base);
    events.length = 0;
    let notifications = 0;
    const unsubscribe = module.subscribeAuthSession(() => { notifications++; });
    module.setStoredAuthSession({ ...base, user: { ...base.user, name: "Fresh metadata", approved: false, plan: "none" } });
    assert.equal(notifications, 1);
    assert.deepEqual(events, []);
    assert.equal(module.getStoredAuthSession().user.name, "Fresh metadata");
    module.setStoredAuthSession({ ...base, token: "new-owned-token" });
    assert.equal(events.filter((name) => name === "edgelab:auth-session-change").length, 1);
    module.setStoredAuthSession({ ...base, token: "new-owned-token", user: { ...base.user, id: 43 } });
    assert.equal(events.filter((name) => name === "edgelab:auth-session-change").length, 2);
    unsubscribe();
  });
});

test("cross-tab metadata refresh preserves identity; a token rotation dispatches identity change", async () => {
  await browserHarness(async ({ module, values, events }) => {
    const base = { ...session(), expiresAt: "2099-01-01T00:00:00Z", user: { ...session().user, workspaceAccess: false, accessExpiresAt: null } };
    module.setStoredAuthSession(base);
    events.length = 0;
    let notifications = 0;
    const unsubscribe = module.subscribeAuthSession(() => { notifications++; });
    const key = "edgelab.auth.session.v1";
    function storage(next) {
      const oldValue = values.get(key), newValue = JSON.stringify(next);
      values.set(key, newValue);
      const event = new Event("storage");
      Object.assign(event, { key, oldValue, newValue });
      window.dispatchEvent(event);
    }
    storage({ ...base, user: { ...base.user, name: "Updated in another tab" } });
    assert.equal(notifications, 1);
    assert.equal(events.filter((name) => name === "edgelab:auth-session-change").length, 0);
    storage({ ...base, token: "rotated-in-other-tab" });
    assert.equal(notifications, 2);
    assert.equal(events.filter((name) => name === "edgelab:auth-session-change").length, 1);
    unsubscribe();
  });
});


for (const outcome of ["paid", "canceled", "expired", "test", "stale", "future verification", "network", "HTTP failure", "account switch", "token switch", "session expiry"]) {
  test(`CSV download ${outcome} validates current owned live subscription before creating an anchor`, async (t) => {
    await browserHarness(async ({ module, events }) => {
      const previous = { document: globalThis.document, fetch: globalThis.fetch };
      const anchors = [];
      const baseTime = Date.now();
      let clock = baseTime;
      t.mock.method(Date, "now", () => clock);
      const owned = { ...session(), expiresAt: new Date(baseTime + 3600000).toISOString(), user: { ...session().user,
        workspaceAccess: false, accessExpiresAt: null } };
      module.setStoredAuthSession(owned);
      events.length = 0;
      const status = { ...subscription(), verified_at: new Date(baseTime - 1000).toISOString(), current_period_end: new Date(baseTime + 86400000).toISOString() };
      const revoked = [];
      globalThis.document = { createElement: (tag) => { assert.equal(tag, "a"); const a = { click() { a.clicked = true; } }; anchors.push(a); return a; } };
      window.setTimeout = (callback) => { revoked.push(callback); return 1; };
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(new URL(url, "https://fixture").pathname, "/api/billing/status");
        assert.equal(init.headers.get("Authorization"), "Bearer " + owned.token);
        if (outcome === "network") throw new TypeError("Provider network unavailable");
        if (outcome === "HTTP failure") return new Response(JSON.stringify({ detail: "Billing unavailable" }), { status: 503 });
        if (outcome === "account switch") module.setStoredAuthSession({ ...owned, user: { ...owned.user, id: 43 } });
        if (outcome === "token switch") module.setStoredAuthSession({ ...owned, token: "another-token" });
        if (outcome === "session expiry") clock += 3600001;
        if (outcome === "canceled") status.status = "canceled";
        if (outcome === "expired") status.current_period_end = new Date(baseTime).toISOString();
        if (outcome === "test") status.mode = "test";
        if (outcome === "stale") status.verified_at = new Date(baseTime - 300000).toISOString();
        if (outcome === "future verification") status.verified_at = new Date(baseTime + 1).toISOString();
        return new Response(JSON.stringify(status), { status: 200, headers: { "Content-Type": "application/json" } });
      };
      try {
        await module.downloadSubscribedTextFile("owned.csv", "private,source\n1,2", "text/csv");
        assert.equal(calls, 1);
        if (outcome === "paid") {
          assert.equal(anchors.length, 1);
          assert.equal(anchors[0].clicked, true);
          assert.equal(anchors[0].download, "owned.csv");
          assert.match(anchors[0].href, /^blob:/);
          assert.equal(revoked.length, 1);
          revoked[0]();
        } else {
          assert.deepEqual(anchors, []);
          assert.equal(revoked.length, 0);
          if (!["token switch", "session expiry"].includes(outcome)) assert.ok(events.includes("edgelab:export-error"));
        }
      } finally {
        globalThis.fetch = previous.fetch;
        if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
        t.mock.restoreAll();
      }
    });
  });
}


for (const switched of [false, true]) test(`PNG async render ${switched ? "rejects an owner switch" : "retains the original paid owner"} before download`, async () => {
  await browserHarness(async ({ module }) => {
    const previous = { document: globalThis.document, fetch: globalThis.fetch, render: globalThis.__captureFixture };
    const anchors = [], observedTokens = [];
    const base = { ...session(), expiresAt: "2099-01-01T00:00:00Z" };
    module.setStoredAuthSession(base);
    const value = { ...subscription(), verified_at: new Date(Date.now() - 1000).toISOString(), current_period_end: "2099-01-01T00:00:00Z" };
    globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: (tag) => {
      assert.equal(tag, "a"); const anchor = { click() { anchor.clicked = true; } }; anchors.push(anchor); return anchor;
    } };
    globalThis.fetch = async (_url, init) => {
      observedTokens.push(init.headers.get("Authorization"));
      return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    globalThis.__captureFixture = async () => {
      // Only third-party image encoding is paused; production authorization,
      // identity storage and pre-download control flow execute unchanged.
      await Promise.resolve();
      if (switched) module.setStoredAuthSession({ ...base, token: "paid-owner-B", user: { ...base.user, id: 43 } });
      return "data:image/png;base64,owned-private-chart";
    };
    try {
      const pending = module.captureVisibleChartGridPng({ scrollWidth: 100, scrollHeight: 80 }, { layout: "single", symbol: "TEST", timeframe: "1" });
      if (switched) {
        await assert.rejects(pending, { name: "AbortError" });
        assert.deepEqual(anchors, []);
      } else {
        const result = await pending;
        assert.equal(result.width, 100);
        assert.equal(anchors.length, 1);
        assert.equal(anchors[0].clicked, true);
        assert.match(anchors[0].download, /^edgelab-test-1-single-.*\.png$/);
        assert.deepEqual(observedTokens, ["Bearer " + base.token, "Bearer " + base.token]);
      }
    } finally {
      globalThis.fetch = previous.fetch;
      if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
      if (previous.render === undefined) delete globalThis.__captureFixture; else globalThis.__captureFixture = previous.render;
    }
  });
});
