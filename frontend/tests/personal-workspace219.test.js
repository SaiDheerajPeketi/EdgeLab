import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundles = new Map();
let instance = 0;
async function fresh(mode) {
  if (!bundles.has(mode)) {
    const result = await build({ bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "silent",
      banner: { js: `import {createRequire} from "node:module"; const require=createRequire(${JSON.stringify(import.meta.url)});` },
      define: { "import.meta.env": JSON.stringify({ VITE_DEPLOYMENT_MODE: mode }), "process.env.NODE_ENV": '\"production\"' },
      stdin: { loader: "tsx", resolveDir: root, contents: `export * from "./frontend/src/lib/authSession.ts";
        export * from "./frontend/src/lib/deploymentMode.ts"; export * from "./frontend/src/lib/billing.ts"; export * from "./frontend/src/lib/marketingCta.ts";
        import React from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {MemoryRouter} from "react-router-dom";
        import {AuthSignInPage} from "./frontend/src/pages/AuthSignInPage.tsx"; import {AccountPage} from "./frontend/src/pages/AccountPage.tsx";
        export const markup = (page) => renderToStaticMarkup(React.createElement(MemoryRouter, {initialEntries:[page === "account" ? "/account" : "/auth/signin"]}, React.createElement(page === "account" ? AccountPage : AuthSignInPage)));` },
    });
    bundles.set(mode, result.outputFiles[0].text);
  }
  return import(`data:text/javascript;base64,${Buffer.from(bundles.get(mode)).toString("base64")}#${++instance}`);
}
const owner = () => ({ createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), token: "local-owner-A",
  user: { id: 219, email: "developer@localhost.edgelab", name: "Personal workspace", provider: "email", approved: true, betaPosition: null,
    deploymentMode: "personal", workspaceAccess: true, accessExpiresAt: new Date(Date.now() + 3600000).toISOString(), isBetaUser: false, plan: "personal" } });
const response = value => ({ token: value.token, created_at: value.createdAt, expires_at: value.expiresAt,
  user: { id: value.user.id, email: value.user.email, name: value.user.name, provider: value.user.provider, approved: value.user.approved, beta_position: null,
    deployment_mode: value.user.deploymentMode, workspace_access: value.user.workspaceAccess, access_expires_at: value.user.accessExpiresAt,
    is_beta_user: value.user.isBetaUser, plan: value.user.plan } });
const active = () => ({ provider: "stripe", mode: "live", configured: true, workspace_access: true, subscription_access: true, plan: "pro", status: "active",
  cadence: "monthly", current_period_end: new Date(Date.now() + 3600000).toISOString(), cancel_at_period_end: false, verified_at: new Date().toISOString(), refresh_required: false });

async function harness(mode, run) {
  const saved = { window: globalThis.window, fetch: globalThis.fetch };
  const target = new EventTarget(), values = new Map(), calls = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
  globalThis.window = { localStorage: storage, sessionStorage: storage, dispatchEvent: event => target.dispatchEvent(event),
    addEventListener: (...args) => target.addEventListener(...args), removeEventListener: (...args) => target.removeEventListener(...args) };
  const module = await fresh(mode), state = { session: response(owner()), billing: active(), before: null };
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url), "http://fixture.test").pathname.replace(/^\/api/, "");
    calls.push({ path, authorization: new Headers(init.headers).get("authorization") });
    if (state.before) await state.before(module, init);
    if (path === "/auth/session") return Response.json(state.session);
    if (path === "/billing/status") return Response.json(state.billing);
    throw new Error(`Unexpected network boundary ${path}`);
  };
  try { await run({ module, state, calls }); }
  finally { if (saved.window === undefined) delete globalThis.window; else globalThis.window = saved.window; globalThis.fetch = saved.fetch; }
}

test("deployment defaults stay production and personal explicitly selects local presentation", () => harness("personal", async ({ module }) => {
  for (const value of [undefined, "", "unknown"]) assert.equal(module.resolveDeploymentMode(value), "production");
  assert.equal(module.resolveDeploymentMode(" Personal "), "personal");
  assert.deepEqual(module.buildMarketingCta({ search: "", seatsRemaining: 0 }), { href: "/app", label: "Open workspace", waitlist: false });
  assert.equal(module.marketingPresentationFromSearch("?variant=personal"), "production");
}));

test("personal workspace requires both build and server mode, personal plan, local provider, access and unexpired leases", () => harness("personal", async ({ module }) => {
  const value = owner();
  assert.equal(module.hasWorkspaceAccess(value), true);
  assert.equal(module.isPersonalWorkspaceSession(value, Date.now(), "production"), false);
  for (const patch of [{ deploymentMode: "production" }, { plan: "pro" }, { provider: "google" }, { workspaceAccess: false }, { isBetaUser: true }, { accessExpiresAt: null }, { accessExpiresAt: new Date(Date.now() - 1).toISOString() }]) {
    assert.equal(module.hasWorkspaceAccess({ ...value, user: { ...value.user, ...patch } }), false);
  }
  assert.equal(module.hasWorkspaceAccess({ ...value, expiresAt: new Date(Date.now() - 1).toISOString() }), false);
}));

test("personal text/chart export authorization checks the server and never billing", () => harness("personal", async ({ module, calls }) => {
  const value = owner(); module.setStoredAuthSession(value);
  const verified = await module.requireActiveExportSubscription();
  assert.equal(verified.user.plan, "personal");
  assert.deepEqual(calls, [{ path: "/auth/session", authorization: "Bearer local-owner-A" }]);
}));

for (const patch of [{ workspace_access: false }, { plan: "none" }, { deployment_mode: "beta" }, { provider: "google" }, { access_expires_at: null }]) {
  test(`server refuses personal export access ${JSON.stringify(patch)}`, () => harness("personal", async ({ module, state, calls }) => {
    module.setStoredAuthSession(owner()); state.session.user = { ...state.session.user, ...patch };
    await assert.rejects(module.requireActiveExportSubscription());
    assert.equal(module.isPersonalWorkspaceSession(module.getStoredAuthSession()), false);
    assert.deepEqual(calls.map(call => call.path), ["/auth/session"]);
  }));
}
for (const transition of ["different owner", "A to B to A"]) {
  test(`personal reconciliation discards ${transition} responses`, () => harness("personal", async ({ module, state }) => {
    const A = owner(); module.setStoredAuthSession(A);
    state.before = async () => { module.setStoredAuthSession({ ...A, token: "local-owner-B", user: { ...A.user, id: 220 } }); if (transition === "A to B to A") module.setStoredAuthSession(A); };
    await assert.rejects(module.requireActiveExportSubscription(), error => error.name === "AbortError");
    assert.equal(module.getStoredAuthSession().token, transition === "A to B to A" ? A.token : "local-owner-B");
  }));
}

test("expired and missing personal sessions fail before exporting", () => harness("personal", async ({ module, calls }) => {
  await assert.rejects(module.requireActiveExportSubscription(), /local workspace session/);
  module.setStoredAuthSession({ ...owner(), expiresAt: new Date(Date.now() - 1).toISOString() });
  await assert.rejects(module.requireActiveExportSubscription()); assert.equal(calls.length, 0);
}));

test("production cannot use a personal session to bypass verified live paid exports", () => harness("production", async ({ module, calls }) => {
  module.setStoredAuthSession(owner()); assert.equal(module.hasWorkspaceAccess(module.getStoredAuthSession()), false);
  await assert.rejects(module.requireActiveExportSubscription(), /Google/); assert.equal(calls.length, 0);
}));
for (const mode of ["beta", "production"]) {
  test(`${mode} exports still require live active verified billing`, () => harness(mode, async ({ module, state, calls }) => {
    const value = owner(); module.setStoredAuthSession({ ...value, user: { ...value.user, provider: "google", deploymentMode: mode, plan: mode === "beta" ? "beta" : "pro", isBetaUser: mode === "beta" } });
    await module.requireActiveExportSubscription(); assert.deepEqual(calls.map(call => call.path), ["/billing/status"]);
    state.billing.mode = "test"; state.billing.workspace_access = false;
    await assert.rejects(module.requireActiveExportSubscription(), /active paid subscription/);
    state.billing = active(); state.billing.verified_at = new Date(Date.now() - 300001).toISOString();
    await assert.rejects(module.requireActiveExportSubscription(), /active paid subscription/);
  }));
}

test("personal sign-in and account markup contain local controls without purchase prompts", () => harness("personal", async ({ module, calls }) => {
  const signin = module.markup("signin"); assert.ok(signin.includes("Your personal workspace.")); assert.ok(!/Google|Stripe|subscription|waitlist|Seats/i.test(signin));
  module.setStoredAuthSession(owner()); const account = module.markup("account");
  assert.ok(account.includes("Local workspace")); assert.ok(account.includes("Export data")); assert.ok(account.includes("Sign out"));
  assert.ok(!/Stripe|subscription|View plans|Manage billing/i.test(account)); assert.equal(calls.length, 0);
}));
