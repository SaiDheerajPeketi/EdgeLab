import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { AUTH_SESSION_KEY, GOOGLE_STATE_KEY, betaSessionResponse } from "./support/app";

const artifacts = path.resolve(".artifacts/better-auth205");
const callbackPath = "/auth/callback/google";
const owner = (id: number) => ({
  ...betaSessionResponse,
  token: `better-auth205-fixture-${id}`,
  user: { ...betaSessionResponse.user, id, name: `Better Auth owner ${id}`,
    email: `auth205-${id}@example.com`, provider: "google", deployment_mode: "production",
    approved: false, workspace_access: false, access_expires_at: null, is_beta_user: false, plan: "none" },
});
type ApiSession = ReturnType<typeof owner>;
function stored(session: ApiSession) {
  const u = session.user;
  return { createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
    user: { id: u.id, email: u.email, name: u.name, provider: u.provider, approved: u.approved,
      betaPosition: u.beta_position, deploymentMode: u.deployment_mode, workspaceAccess: u.workspace_access,
      accessExpiresAt: u.access_expires_at, isBetaUser: u.is_beta_user, plan: u.plan } };
}
function seal() {
  const root = path.resolve("frontend/dist");
  const entries: Array<{ path: string; sha256: string }> = [];
  const visit = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, item.name);
      if (item.isDirectory()) visit(full);
      else entries.push({ path: path.relative(root, full).split(path.sep).join("/"),
        sha256: crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex") });
    }
  };
  visit(root);
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { files: entries.length, sha256: crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex") };
}
const initialSeal = seal();

async function fixture(context: BrowserContext, page: Page, hold: "social" | "bridge" | null = null) {
  const a = owner(7205), b = owner(7206);
  const sessions = new Map([a, b].map(session => [session.token, session]));
  const state = { a, b, sessions, social: [] as Array<Record<string, unknown>>,
    exchanges: 0, deletes: 0, completed: false, release: null as (() => void) | null,
    http: [] as Array<{ method: string; endpoint: string; authenticated: boolean }>, errors: [] as string[] };
  const watch = (target: Page) => target.on("pageerror", error => state.errors.push(error.message));
  watch(page); context.on("page", watch);
  await context.addInitScript(({ authKey }) => {
    (window as typeof window & { __auth205Storage: number }).__auth205Storage = 0;
    window.addEventListener("storage", event => {
      if (event.key === authKey || event.key === null) {
        (window as typeof window & { __auth205Storage: number }).__auth205Storage++;
      }
    });
  }, { authKey: AUTH_SESSION_KEY });
  // Only HTTP responses and actual cross-tab storage are controlled. The built
  // official Better Auth client, router, exchange and identity guards are unchanged.
  await context.route("https://accounts.google.com/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Controlled Google transport boundary</title>" }));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    const token = request.headers().authorization?.replace(/^Bearer /, "") ?? "";
    state.http.push({ method: request.method(), endpoint, authenticated: Boolean(token) });
    if (endpoint === "/auth/config") return route.fulfill({ json: {
      deployment_mode: "production", auth_provider: "better-auth", google_enabled: true,
      google_client_id: null, google_redirect_uri: null, manual_access_enabled: false, dev_auth_bypass_enabled: false,
    } });
    if (endpoint === "/better-auth/sign-in/social") {
      expect(request.method()).toBe("POST");
      const body = request.postDataJSON();
      state.social.push(body);
      expect(body.provider).toBe("google");
      expect(body.disableRedirect).toBe(true);
      const callback = new URL(body.callbackURL);
      expect(callback.origin).toBe(new URL(request.url()).origin);
      expect(callback.pathname).toBe(callbackPath);
      expect(callback.searchParams.get("better_auth")).toBe("1");
      expect(callback.searchParams.get("state")).toBeTruthy();
      if (hold === "social") await new Promise<void>(resolve => { state.release = resolve; });
      await route.fulfill({ json: { url: "https://accounts.google.com/o/oauth2/v2/auth?fixture=205", redirect: false } });
      state.completed = true;
      return;
    }
    if (endpoint === "/auth/better-auth/exchange") {
      expect(request.method()).toBe("POST");
      expect(request.postDataJSON()).toEqual({});
      // The bridge's credentials:include must carry the actual browser cookie.
      expect(request.headers().cookie ?? "").toContain("edgelab.session_token=auth205-cookie");
      state.exchanges++;
      state.completed = false;
      if (hold === "bridge") await new Promise<void>(resolve => { state.release = resolve; });
      await route.fulfill({ json: { session: a, approved: true, beta_position: null, email: a.user.email } });
      state.completed = true;
      return;
    }
    if (endpoint === "/auth/session") {
      if (request.method() === "DELETE") {
        expect(sessions.has(token)).toBe(true);
        sessions.delete(token); state.deletes++;
        return route.fulfill({ json: { ok: true } });
      }
      const session = sessions.get(token);
      return route.fulfill(session ? { json: session } : { status: 401, json: { detail: "Session expired" } });
    }
    if (endpoint === "/billing/status") return route.fulfill({ json: {
      provider: "stripe", mode: "live", configured: false, workspace_access: false,
      subscription_access: false, plan: null, status: "inactive", cadence: null,
      current_period_end: null, cancel_at_period_end: false, verified_at: null, refresh_required: false,
    } });
    if (endpoint === "/billing/catalog") return route.fulfill({ json: {
      provider: "stripe", mode: "live", enabled: false, checkout_available: false,
      plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
    } });
    if (endpoint === "/ui/rollout") return route.fulfill({ json: { revision: "auth205", kill_switch: false,
      flags: { public: true, shell: true, journal: true, settings: true, chart: true } } });
    return route.fulfill({ status: 404, json: { detail: "Unmodeled HTTP boundary" } });
  });
  await page.goto("/auth/signin?from=%2Faccount");
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await context.addCookies([{ name: "edgelab.session_token", value: "auth205-cookie", url: new URL(page.url()).origin }]);
  const companion = await context.newPage();
  await companion.goto("/privacy");
  return { ...state, companion, state };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function clickGoogle(page: Page, f: Fixture, held = false) {
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => f.state.social.length).toBe(1);
  if (held) await expect.poll(() => Boolean(f.state.release)).toBe(true);
  else await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
  return f.state.social[0].callbackURL as string;
}
async function currentId(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null")?.user.id ?? null, AUTH_SESSION_KEY);
}
async function crossTab(page: Page, f: Fixture, session: ApiSession | null) {
  const before = await page.evaluate(() => (window as typeof window & { __auth205Storage: number }).__auth205Storage);
  await f.companion.evaluate(({ key, value }) => {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  }, { key: AUTH_SESSION_KEY, value: session ? stored(session) : null });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __auth205Storage: number }).__auth205Storage)).toBeGreaterThan(before);
  expect(await currentId(page)).toBe(session?.user.id ?? null);
}
async function capture(page: Page, info: TestInfo, name: string, f: Fixture) {
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({
    build: initialSeal, url: page.url(), ownerId: await currentId(page), social: f.state.social,
    exchanges: f.state.exchanges, deletes: f.state.deletes, http: f.state.http, errors: f.state.errors,
    qualification: "Actual production UI and official Better Auth module client, controlled HTTP transport. No external Google/provider-server claim.",
  }, null, 2));
  expect(f.state.errors).toEqual([]);
  expect(seal()).toEqual(initialSeal);
}

test("ready null-client-ID uses official social client, owned bridge and signout", async ({ context, page }, info) => {
  const f = await fixture(context, page);
  const callback = await clickGoogle(page, f);
  await page.goto(callback);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  expect(await currentId(page)).toBe(f.a.user.id);
  expect(f.state.exchanges).toBe(1);
  await capture(page, info, "bridge-account", f);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/signin/);
  expect(await currentId(page)).toBeNull();
  expect(f.state.deletes).toBe(1);
  await page.goto(callback);
  await expect(page).toHaveURL(/\/auth\/signin/);
  expect(f.state.exchanges).toBe(1);
  expect(await currentId(page)).toBeNull();
  await capture(page, info, "consumed-after-signout", f);
});

test("held official social request cannot redirect after cross-tab owner ABA", async ({ context, page }, info) => {
  const f = await fixture(context, page, "social");
  await clickGoogle(page, f, true);
  await crossTab(page, f, f.b);
  await crossTab(page, f, null);
  f.state.release!();
  await expect.poll(() => f.state.completed).toBe(true);
  await page.waitForTimeout(250);
  expect(new URL(page.url()).pathname).toBe("/auth/signin");
  expect(f.state.exchanges).toBe(0);
  expect(await currentId(page)).toBeNull();
  await capture(page, info, "social-owner-aba", f);
});

test("held Better Auth bridge cannot write its old owner after cross-tab ABA", async ({ context, page }, info) => {
  const f = await fixture(context, page, "bridge");
  const callback = await clickGoogle(page, f);
  await page.goto(callback);
  await expect.poll(() => Boolean(f.state.release)).toBe(true);
  await crossTab(page, f, f.b);
  await crossTab(page, f, null);
  f.state.release!();
  await expect.poll(() => f.state.completed).toBe(true);
  await expect(page).toHaveURL(/\/auth\/signin/);
  expect(await currentId(page)).toBeNull();
  expect(f.state.exchanges).toBe(1);
  await capture(page, info, "bridge-owner-aba", f);
});

test("provider denial returns to owned callback without exchange and permits retry", async ({ context, page }, info) => {
  const f = await fixture(context, page);
  const callback = await clickGoogle(page, f);
  const errorCallback = f.state.social[0].errorCallbackURL;
  expect(errorCallback, "Official client must give provider errors an owned application return URL").toBe(callback);
  const denied = new URL(errorCallback as string);
  denied.searchParams.set("error", "access_denied");
  await page.goto(denied.href);
  await expect(page).toHaveURL(/\/auth\/signin/);
  expect(f.state.exchanges).toBe(0);
  expect(await currentId(page)).toBeNull();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await capture(page, info, "provider-denial-retry", f);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect.poll(() => f.state.social.length).toBe(2);
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
  expect(f.state.social[1].callbackURL).not.toBe(callback);
});
