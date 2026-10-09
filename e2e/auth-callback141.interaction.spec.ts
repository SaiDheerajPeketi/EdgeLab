import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { AUTH_SESSION_KEY, GOOGLE_STATE_KEY, betaSessionResponse, FROZEN_TIME } from "./support/app";

const artifacts = path.resolve(".artifacts/auth-callback141");
const now = Date.parse(FROZEN_TIME);
const ttl = 15 * 60 * 1000;
const callbackPath = "/auth/callback/google";
const share = `/shared#${"Capability141".repeat(4)}`;
const owner = (id: number, token = `callback141-owner-${id}`, paid = false) => ({
  ...betaSessionResponse, token, user: { ...betaSessionResponse.user,
    id, name: `Callback owner ${id}`, email: `callback${id}@example.com`,
    deployment_mode: "production", approved: false, is_beta_user: false,
    workspace_access: paid, access_expires_at: paid ? betaSessionResponse.expires_at : null,
    plan: paid ? "pro" : "none", provider: "google",
  },
});
type ApiSession = ReturnType<typeof owner>;
function stored(session: ApiSession) {
  const u = session.user;
  return { createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
    user: { id: u.id, email: u.email, name: u.name, provider: u.provider, approved: u.approved,
      betaPosition: u.beta_position, deploymentMode: u.deployment_mode, workspaceAccess: u.workspace_access,
      accessExpiresAt: u.access_expires_at, isBetaUser: u.is_beta_user, plan: u.plan } };
}
function distSeal() {
  const root = path.resolve("frontend/dist");
  const entries: Array<{ path: string; sha256: string; bytes: number }> = [];
  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else { const bytes = fs.readFileSync(full); entries.push({ path: path.relative(root, full),
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }); }
    }
  }
  visit(root); entries.sort((a, b) => a.path.localeCompare(b.path));
  return { files: entries.length, sha256: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}
const beforeSeal = distSeal();
const fixtures = new WeakMap<Page, Fixture>();

async function fixture(context: BrowserContext, page: Page) {
  const a = owner(7141), b = owner(7142), oldA = owner(7141, "callback141-original-A");
  const sessions = new Map([a, b, oldA].map(value => [value.token, value]));
  const state = { a, b, oldA, sessions,
    rollout: { publicEnabled: true, reads: 0 },
    exchanges: [] as Array<{ code: string; body: unknown; completed: boolean }>,
    responses: new Map<string, ApiSession>(), held: new Set<string>(), releases: new Map<string, () => void>(),
    http: [] as Array<{ method: string; endpoint: string; authorization: string | null }>,
    errors: [] as Array<{ url: string; message: string }> };
  const watch = (target: Page) => target.on("pageerror", error => state.errors.push({ url: target.url(), message: error.message }));
  watch(page); context.on("page", watch);
  await context.addInitScript(({ fixed, key, googleKey }) => {
    Date.now = () => fixed;
    const browser = window as typeof window & { __callback141Storage?: unknown[] };
    browser.__callback141Storage = [];
    const events: unknown[] = [];
    (window as typeof window & { __callback141Events: unknown[] }).__callback141Events = events;
    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method].bind(history);
      history[method] = (data, unused, url) => {
        events.push({ kind: method, data, url: String(url), stack: new Error().stack });
        original(data, unused, url);
      };
    }
    window.addEventListener("edgelab:auth-session-change", () => {
      events.push({ kind: "auth-identity-event", auth: localStorage.getItem(key) });
    });
    const read = Storage.prototype.getItem;
    Storage.prototype.getItem = function (name) {
      const value = read.call(this, name);
      if (name === googleKey) events.push({ kind: "google-state-read", storage: this === sessionStorage ? "session" : "local", value });
      return value;
    };
    window.addEventListener("storage", event => {
      if (event.key === key) browser.__callback141Storage!.push({ oldValue: event.oldValue, newValue: event.newValue });
    });
  }, { fixed: now, key: AUTH_SESSION_KEY, googleKey: GOOGLE_STATE_KEY });
  // HTTP responses and initial/cross-tab storage are the only identity seams.
  // The production router, callback, storage subscriptions and handoff guards run unchanged.
  await context.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    const authorization = request.headers().authorization ?? null;
    state.http.push({ method: request.method(), endpoint, authorization });
    if (endpoint === "/auth/config") return route.fulfill({ json: {
      deployment_mode: "production", google_enabled: true, google_client_id: "callback141.apps.googleusercontent.com",
      google_redirect_uri: `${new URL(request.url()).origin}${callbackPath}`,
      manual_access_enabled: false, dev_auth_bypass_enabled: false,
    } });
    if (endpoint === "/auth/google/exchange") {
      expect(request.method()).toBe("POST");
      const body = request.postDataJSON();
      expect(Object.keys(body).sort()).toEqual(["code", "redirect_uri"]);
      expect(body.redirect_uri).toBe(`${new URL(request.url()).origin}${callbackPath}`);
      const receipt = { code: body.code as string, body, completed: false };
      state.exchanges.push(receipt);
      if (state.held.has(body.code)) await new Promise<void>(resolve => state.releases.set(body.code, resolve));
      const session = state.responses.get(body.code);
      expect(session, `HTTP session fixture for ${body.code}`).toBeDefined();
      await route.fulfill({ json: { session, approved: true, beta_position: null, email: session!.user.email } });
      receipt.completed = true;
      return;
    }
    if (endpoint === "/auth/session") {
      if (request.method() === "DELETE") return route.fulfill({ json: { ok: true } });
      const session = sessions.get(authorization?.replace(/^Bearer /, "") ?? "");
      return route.fulfill(session ? { json: session } : { status: 401, json: { detail: "Session expired" } });
    }
    if (endpoint === "/billing/status") return route.fulfill({ json: {
      provider: "stripe", mode: "live", configured: false, workspace_access: false,
      subscription_access: false, plan: null, status: "inactive", cadence: null,
      current_period_end: null, cancel_at_period_end: false, verified_at: null, refresh_required: false,
    } });
    if (endpoint === "/billing/catalog") return route.fulfill({ json: {
      provider: "stripe", mode: "live", enabled: false, checkout_available: false, reason: "Billing not activated",
      plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
    } });
    if (endpoint === "/ui/rollout") {
      state.rollout.reads++;
      return route.fulfill({ json: { revision: state.rollout.publicEnabled ? "callback141-modern" : "callback141-fallback", kill_switch: false,
        flags: { shell: true, journal: true, settings: true, chart: true, public: state.rollout.publicEnabled } } });
    }
    return route.fulfill({ status: 404, json: { detail: "Fixture endpoint unavailable" } });
  });
  await page.goto("/pricing");
  await expect(page.getByRole("heading").first()).toBeVisible();
  const companion = await context.newPage();
  await companion.goto("/pricing");
  const value = { ...state, companion };
  fixtures.set(page, value);
  return value;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function spa(page: Page, destination: string) {
  await page.evaluate(href => {
    const state = { ...history.state, idx: (history.state?.idx ?? 0) + 1, key: crypto.randomUUID() };
    history.pushState(state, "", href);
    dispatchEvent(new PopStateEvent("popstate", { state }));
  }, destination);
}
async function authToken(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null")?.token ?? null, AUTH_SESSION_KEY);
}
async function switchOwner(page: Page, state: Fixture, session: ApiSession | null) {
  const count = await page.evaluate(() => (window as typeof window & { __callback141Storage: unknown[] }).__callback141Storage.length);
  await state.companion.evaluate(({ key, value }) => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  }, { key: AUTH_SESSION_KEY, value: session ? stored(session) : null });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __callback141Storage: unknown[] }).__callback141Storage.length)).toBe(count + 1);
  expect(await authToken(page)).toBe(session?.token ?? null);
}
async function start(page: Page, state: Fixture, code: string, options: {
  from?: string; issuedAt?: number; pricingDestination?: string; session?: ApiSession; hold?: boolean;
} = {}) {
  const key = `callback141-${code}`;
  const from = options.from ?? "/account";
  state.responses.set(code, options.session ?? state.a);
  if (options.hold) state.held.add(code);
  await page.evaluate(({ googleKey, stateKey, fromPath, issuedAt, pricingDestination }) => {
    const payload = { state: stateKey, fromPath, issuedAt, redirectUri: `${location.origin}/auth/callback/google`,
      ...(pricingDestination ? { pricingDestination } : {}) };
    sessionStorage.setItem(googleKey, JSON.stringify(payload));
    if (fromPath.startsWith("/shared#") || pricingDestination?.startsWith("/shared#")) localStorage.removeItem(googleKey);
    else localStorage.setItem(googleKey, JSON.stringify(payload));
  }, { googleKey: GOOGLE_STATE_KEY, stateKey: key, fromPath: from,
    issuedAt: options.issuedAt ?? now, pricingDestination: options.pricingDestination });
  const url = `${callbackPath}?code=${code}&state=${key}`;
  await spa(page, url);
  if (options.hold) await expect.poll(() => state.releases.has(code)).toBe(true);
  return url;
}
async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForTimeout(150);
}
async function release(page: Page, state: Fixture, code: string) {
  state.releases.get(code)!();
  await expect.poll(() => state.exchanges.find(value => value.code === code)?.completed).toBe(true);
  await settled(page);
}
async function capture(page: Page, info: TestInfo, name: string, state: Fixture) {
  const directory = path.join(artifacts, info.project.name); fs.mkdirSync(directory, { recursive: true });
  const browser = await page.evaluate(({ authKey, googleKey }) => ({
    url: location.href, history: history.state, auth: JSON.parse(localStorage.getItem(authKey) ?? "null"),
    sessionGoogleState: sessionStorage.getItem(googleKey), durableGoogleState: localStorage.getItem(googleKey),
    storageEvents: (window as typeof window & { __callback141Storage: unknown[] }).__callback141Storage,
    events: (window as typeof window & { __callback141Events: unknown[] }).__callback141Events,
    handoffFrame: (() => {
      const frame = (window as typeof window & { __callback141Frame?: { pending: boolean; released: boolean; canceled: boolean } }).__callback141Frame;
      return frame ? { pending: frame.pending, released: frame.released, canceled: frame.canceled } : null;
    })(),
  }), { authKey: AUTH_SESSION_KEY, googleKey: GOOGLE_STATE_KEY });
  const receipt = { qualification: "Real production router/callback with controlled HTTP auth and natural cross-tab storage events; no Google-provider/backend verification claim.",
    beforeSeal, afterSeal: distSeal(), browser, exchanges: state.exchanges, rollout: state.rollout, http: state.http, pageErrors: state.errors };
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(receipt, null, 2));
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
  expect(receipt.afterSeal).toEqual(beforeSeal); expect(state.errors).toEqual([]);
  expect(browser.sessionGoogleState).toBe(null); expect(browser.durableGoogleState).toBe(null);
}

test.afterEach(async ({ page }, info) => {
  const state = fixtures.get(page);
  if (state && info.status !== info.expectedStatus) {
    const directory = path.join(artifacts, info.project.name); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `failure-${info.testId.replace(/[^a-z0-9_-]/gi, "_")}.json`), JSON.stringify({
      title: info.title, url: page.url(), beforeSeal, afterSeal: distSeal(), exchanges: state.exchanges,
      http: state.http, pageErrors: state.errors,
      storage: await page.evaluate(key => ({ auth: localStorage.getItem(key),
        events: (window as typeof window & { __callback141Storage: unknown[] }).__callback141Storage,
        navigation: (window as typeof window & { __callback141Events: unknown[] }).__callback141Events }), AUTH_SESSION_KEY),
    }, null, 2));
  }
});

test("one owned exchange survives public rollout flips and preserves billing and shared destinations", async ({ context, page }, info) => {
  const state = await fixture(context, page);
  const callback = await start(page, state, "billing", { pricingDestination: share, hold: true });
  for (const enabled of [false, true]) {
    state.rollout.publicEnabled = enabled;
    // Exercise the production visibility-refresh listener; the policy itself is a real HTTP response.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const revision = enabled ? "callback141-modern" : "callback141-fallback";
    await expect(page.locator("[data-route-group='public']")).toHaveAttribute("data-ui-rollout-revision", revision);
    await expect(page.locator("[data-route-group='public']")).toHaveAttribute("data-ui-version", enabled ? "v2" : "fallback");
    await expect(page.getByRole("heading", { name: "Restoring your EdgeLab session." })).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(callback);
    expect(state.exchanges.map(value => value.code)).toEqual(["billing"]);
    expect(await authToken(page)).toBe(null);
  }
  await release(page, state, "billing");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Your EdgeLab account." })).toBeVisible();
  expect(await authToken(page)).toBe(state.a.token);
  expect(await page.evaluate(() => history.state.usr)).toEqual({ fromPath: share });
  expect(state.exchanges.map(value => value.code)).toEqual(["billing"]);
  const paid = owner(7143, "callback141-share-owner", true); state.sessions.set(paid.token, paid);
  await start(page, state, "share", { from: share, session: paid });
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).hash).toBe(share);
  await expect(page.getByRole("heading", { name: "Snapshot unavailable" })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(state.exchanges.map(value => value.code)).toEqual(["billing", "share"]);
  await capture(page, info, "destinations", state);
});

test("same-SPA consumed callback cannot restore A after real sign out or account B", async ({ context, page }, info) => {
  const state = await fixture(context, page);
  const url = await start(page, state, "consumed");
  await expect(page).toHaveURL(/\/account$/);
  const signout = page.getByRole("button", { name: "Sign out", exact: true });
  await expect(signout).toBeEnabled(); await signout.click();
  await expect.poll(() => authToken(page)).toBe(null);
  await spa(page, url);
  await expect(page).toHaveURL(/\/auth\/signin\?.*oauth-state-expired/);
  expect(await authToken(page)).toBe(null);
  await switchOwner(page, state, state.b);
  await spa(page, url);
  await expect(page).toHaveURL(/\/account$/);
  expect(await authToken(page)).toBe(state.b.token);
  expect(await page.evaluate(() => history.state.usr ?? null)).toBe(null);
  expect(state.exchanges.map(value => value.code)).toEqual(["consumed"]);
  await capture(page, info, "consumed-replay", state);
});

test("held exchange rejects replacement and both natural cross-tab ABA transitions", async ({ context, page }, info) => {
  const state = await fixture(context, page);
  for (const [code, initial, transitions, final] of [
    ["replace", null, [state.b], state.b],
    ["account-aba", state.oldA, [state.b, state.oldA], state.oldA],
    ["anonymous-aba", null, [state.b, null], null],
  ] as const) {
    await spa(page, "/pricing");
    if (await authToken(page) !== (initial?.token ?? null)) await switchOwner(page, state, initial);
    await start(page, state, code, { hold: true, from: "/pricing", pricingDestination: share });
    for (const next of transitions) await switchOwner(page, state, next);
    await release(page, state, code);
    expect(await authToken(page)).toBe(final?.token ?? null);
    await expect(page).toHaveURL(final ? /\/account$/ : /\/auth\/signin/);
    expect(await page.evaluate(() => history.state.usr ?? null)).toBe(null);
    expect(page.url()).not.toContain("Capability141");
  }
  expect(state.exchanges.map(value => value.code)).toEqual(["replace", "account-aba", "anonymous-aba"]);
  await capture(page, info, "owner-and-aba", state);
});

test("pending callback route leave and reentry consumes state without resurrecting old work", async ({ context, page }, info) => {
  const state = await fixture(context, page);
  const url = await start(page, state, "route-leave", { hold: true });
  await spa(page, "/pricing");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await spa(page, url);
  await expect(page).toHaveURL(/\/auth\/signin\?.*oauth-state-expired/);
  await release(page, state, "route-leave");
  expect(await authToken(page)).toBe(null);
  await expect(page).toHaveURL(/\/auth\/signin\?.*oauth-state-expired/);
  expect(state.exchanges.map(value => value.code)).toEqual(["route-leave"]);
  await capture(page, info, "route-reentry", state);
});

test("expired state and an exchange crossing its TTL cannot write a session", async ({ context, page }, info) => {
  const state = await fixture(context, page);
  await start(page, state, "already-expired", { issuedAt: now - ttl - 1 });
  await expect(page).toHaveURL(/\/auth\/signin\?.*oauth-state-expired/);
  expect(state.exchanges).toEqual([]);
  await start(page, state, "expires-held", { hold: true });
  await page.evaluate(value => { Date.now = () => value; }, now + ttl + 1);
  await release(page, state, "expires-held");
  await expect(page).toHaveURL(/\/auth\/signin\?.*oauth-state-expired/);
  expect(await authToken(page)).toBe(null);
  expect(state.exchanges.map(value => value.code)).toEqual(["expires-held"]);
  await capture(page, info, "ttl", state);
});

test("account transition after actual session write fences the held animation-frame handoff", async ({ context, page }, info) => {
  const state = await fixture(context, page);
  await page.evaluate(({ key, token }) => {
    const originalSet = Storage.prototype.setItem;
    const nativeFrame = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    let armed = false;
    const probe = { pending: false, released: false, canceled: false, id: 0,
      callback: null as FrameRequestCallback | null,
      release() {
        this.released = true;
        if (!this.canceled && this.callback) nativeFrame(this.callback);
      } };
    (window as typeof window & { __callback141Frame?: typeof probe }).__callback141Frame = probe;
    Storage.prototype.setItem = function (name, value) {
      originalSet.call(this, name, value);
      if (this === localStorage && name === key && JSON.parse(value)?.token === token) armed = true;
    };
    window.requestAnimationFrame = callback => {
      if (armed && location.pathname === "/auth/callback/google" && !probe.pending) {
        armed = false; probe.pending = true; probe.callback = callback;
        probe.id = nativeFrame(() => {}); return probe.id;
      }
      return nativeFrame(callback);
    };
    window.cancelAnimationFrame = id => {
      if (id === probe.id && probe.pending) probe.canceled = true;
      nativeCancel(id);
    };
  }, { key: AUTH_SESSION_KEY, token: state.a.token });
  const url = await start(page, state, "frame-held", { from: "/pricing", pricingDestination: share });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __callback141Frame: { pending: boolean } }).__callback141Frame.pending)).toBe(true);
  expect(await authToken(page)).toBe(state.a.token);
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(url);
  await switchOwner(page, state, state.b);
  await page.evaluate(() => (window as typeof window & { __callback141Frame: { release(): void } }).__callback141Frame.release());
  await settled(page);
  expect(await authToken(page)).toBe(state.b.token);
  await expect(page).toHaveURL(/\/account$/);
  expect(await page.evaluate(() => history.state.usr ?? null)).toBe(null);
  expect(page.url()).not.toContain("Capability141");
  expect(state.exchanges.map(value => value.code)).toEqual(["frame-held"]);
  await capture(page, info, "post-write-frame", state);
});
