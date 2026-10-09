import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { AUTH_SESSION_KEY, betaSessionResponse, FROZEN_TIME, gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/account-access166");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal();
const hashes = () => Object.fromEntries(["e2e/account-access166.config.ts", "e2e/account-access166.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const beforeHashes = hashes();
const errors = new WeakMap<Page, string[]>();
const owner = (id = 7001) => ({ ...betaSessionResponse, token: `account-access166-owner-${id}`, user: {
  ...betaSessionResponse.user, id, email: `owner${id}@example.com`, provider: "google", deployment_mode: "beta", approved: false,
  beta_position: 42 as number | null, is_beta_user: true, workspace_access: false, access_expires_at: null as string | null, plan: "beta" } });
type Session = ReturnType<typeof owner>;
const stored = (session: Session) => ({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
  user: { id: session.user.id, email: session.user.email, name: session.user.name, provider: session.user.provider,
    approved: session.user.approved, betaPosition: session.user.beta_position, deploymentMode: session.user.deployment_mode,
    workspaceAccess: session.user.workspace_access, accessExpiresAt: session.user.access_expires_at, isBetaUser: session.user.is_beta_user, plan: session.user.plan } });
const inactive = () => ({ provider: "stripe", mode: "live", configured: true, subscription_access: false, workspace_access: false,
  plan: "pro", status: "inactive", cadence: "monthly", current_period_end: "2027-09-15T10:00:00Z", cancel_at_period_end: false, verified_at: FROZEN_TIME, refresh_required: false });

async function fixture(page: Page) {
  await installDeterminism(page);
  const state = { session: owner(), billing: inactive(), billingFailure: true, holdAccess: false, releaseAccess: null as (() => void) | null,
    accessFinished: 0, authReads: [] as Array<{ ownerId: number; method: string }>, billingReads: 0, portals: 0, exports: 0, downloads: [] as string[] };
  await page.addInitScript(({ key, session }) => { if (window === window.top) localStorage.setItem(key, JSON.stringify(session)); }, { key: AUTH_SESSION_KEY, session: stored(state.session) });
  page.on("download", download => state.downloads.push(download.suggestedFilename()));
  // Only HTTP and persisted identity boundaries are controlled. Actual route,
  // Account state, subscriptions, access checks and download guards execute.
  await page.route("**/api/**", async route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: "beta", google_enabled: true,
      google_client_id: "visual-client.apps.googleusercontent.com", google_redirect_uri: "http://127.0.0.1/auth/callback/google", manual_access_enabled: false, dev_auth_bypass_enabled: false } });
    if (endpoint === "/auth/session") {
      const current = structuredClone(state.session);
      expect(request.method()).toBe("GET"); expect(request.headers().authorization).toBe(`Bearer ${current.token}`);
      state.authReads.push({ ownerId: current.user.id, method: request.method() });
      if (state.holdAccess) {
        state.holdAccess = false;
        await new Promise<void>(resolve => { state.releaseAccess = resolve; });
        current.user.approved = true; current.user.workspace_access = true; current.user.access_expires_at = current.expires_at;
      }
      await route.fulfill({ json: current }); state.accessFinished++; return;
    }
    if (endpoint === "/billing/status") {
      expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`); state.billingReads++;
      return route.fulfill(state.billingFailure ? { status: 503, json: { detail: "Subscription service unavailable" } } : { json: state.billing });
    }
    if (endpoint === "/billing/portal") {
      expect(request.method()).toBe("POST"); expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`); state.portals++;
      return route.fulfill({ status: 503, json: { detail: "Billing portal unavailable. Retry shortly." } });
    }
    if (endpoint === "/app-data/export") {
      expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`); state.exports++;
      return route.fulfill({ status: 403, json: { detail: "Active subscription required" } });
    }
    return route.fallback();
  });
  return state;
}
async function changeOwner(page: Page, state: Awaited<ReturnType<typeof fixture>>) {
  state.session = owner(7002); state.session.user.beta_position = 91;
  await page.evaluate(({ key, session }) => {
    const previous = localStorage.getItem(key), next = JSON.stringify(session); localStorage.setItem(key, next);
    dispatchEvent(new StorageEvent("storage", { key, oldValue: previous, newValue: next, storageArea: localStorage }));
  }, { key: AUTH_SESSION_KEY, session: stored(state.session) });
  await expect(page.getByText("owner7002@example.com", { exact: true })).toBeVisible();
}
async function capture(page: Page, info: TestInfo, name: string, state: Awaited<ReturnType<typeof fixture>>) {
  const directory = path.join(artifacts, info.project.name); fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(),
    authReads: state.authReads, accessFinished: state.accessFinished, billingReads: state.billingReads, portals: state.portals, exports: state.exports,
    downloads: state.downloads, errors: errors.get(page), visibleText: await page.locator("body").innerText(),
    qualification: "Actual production routes and account/access/billing/download state. Only identity storage and HTTP boundaries controlled; no live merchant or backend policy certification." }, null, 2));
}
const noBetaPurchase = async (page: Page) => {
  await expect(page.getByText("Subscription required", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Choose a plan to unlock/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View plans", exact: true })).toHaveCount(0);
  await expect(page.getByText(/waitlist position|queue position|waitlisted|revoked/i)).toHaveCount(0);
};
test.beforeEach(({ page }) => { errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message)); });
test.afterEach(async ({ page }, info) => {
  expect(errors.get(page)).toEqual([]); expect(seal()).toBe(beforeSeal); expect(hashes()).toEqual(beforeHashes);
  if (info.status !== info.expectedStatus) { const directory = path.join(artifacts, info.project.name); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `failure-${info.title.replace(/[^a-z0-9]+/gi, "-")}.json`), JSON.stringify({ text: await page.locator("body").innerText(), errors: errors.get(page) }, null, 2)); }
});

test("denied beta explains approval without inferring waitlist membership and checks actual owned access independently of billing failure", async ({ page }, info) => {
  const state = await fixture(page); await gotoStable(page, "/account");
  await expect(page.getByText("Beta approval required", { exact: true }).first()).toBeVisible(); await noBetaPurchase(page);
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  const portal = page.getByRole("button", { name: "Manage billing", exact: true }); await expect(portal).toBeEnabled();
  await portal.click(); await expect(page.getByRole("alert").filter({ hasText: "Billing portal unavailable" })).toBeVisible();
  await capture(page, info, "beta-denied", state);
  const reads = state.authReads.length;
  state.session.user.approved = true; state.session.user.workspace_access = true; state.session.user.access_expires_at = state.session.expires_at;
  await page.getByRole("button", { name: "Check access", exact: true }).click();
  await expect.poll(() => state.authReads.length).toBeGreaterThan(reads);
  await expect(page.getByRole("link", { name: "Open workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  expect(state.authReads.at(-1)).toEqual({ ownerId: 7001, method: "GET" }); expect(state.portals).toBe(1); expect(state.exports).toBe(0);
  await capture(page, info, "beta-approved-refresh", state);
});

test("approved beta without workspace stays distinct and missing queue position is never invented", async ({ page }, info) => {
  const state = await fixture(page); state.session.user.approved = true; state.session.user.beta_position = null;
  await gotoStable(page, "/account"); await expect(page.getByText(/^(?:Beta access|Workspace) unavailable$/).first()).toBeVisible();
  await noBetaPurchase(page); await expect(page.getByText("Beta approval required", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/revoked|waitlisted|position/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check access", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Open workspace", exact: true })).toHaveCount(0);
  await capture(page, info, "approved-unavailable", state);
  for (const position of [0, -3]) {
    state.session.user.approved = false; state.session.user.beta_position = position;
    await page.getByRole("button", { name: "Check access", exact: true }).click();
    await expect(page.getByText("Beta approval required", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/waitlist position/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check access", exact: true })).toBeEnabled();
  }
  await capture(page, info, "nonpositive-position-hidden", state);
});

test("delayed access approval cannot replace or grant a different account", async ({ page }, info) => {
  const state = await fixture(page); await gotoStable(page, "/account");
  const check = page.getByRole("button", { name: "Check access", exact: true }); await expect(check).toBeEnabled();
  state.holdAccess = true; await check.click(); await expect.poll(() => state.releaseAccess !== null).toBe(true);
  await changeOwner(page, state); await expect(check).toBeEnabled();
  const finished = state.accessFinished; state.releaseAccess!(); await expect.poll(() => state.accessFinished).toBeGreaterThan(finished);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const identity = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), AUTH_SESSION_KEY);
  expect(identity.user.id).toBe(7002); expect(identity.user.approved).toBe(false); expect(identity.user.workspaceAccess).toBe(false);
  await expect(page.getByRole("link", { name: "Open workspace", exact: true })).toHaveCount(0);
  await noBetaPurchase(page);
  await capture(page, info, "stale-access-owner", state);
});

test("same-turn account A to B to A retires an earlier access approval", async ({ page }, info) => {
  const state = await fixture(page); await gotoStable(page, "/account");
  const check = page.getByRole("button", { name: "Check access", exact: true }); await expect(check).toBeEnabled();
  state.holdAccess = true; await check.click(); await expect.poll(() => state.releaseAccess !== null).toBe(true);
  await page.evaluate(({ key, replacement }) => {
    const original = localStorage.getItem(key)!, next = JSON.stringify(replacement);
    localStorage.setItem(key, next); dispatchEvent(new StorageEvent("storage", { key, oldValue: original, newValue: next, storageArea: localStorage }));
    localStorage.setItem(key, original); dispatchEvent(new StorageEvent("storage", { key, oldValue: next, newValue: original, storageArea: localStorage }));
  }, { key: AUTH_SESSION_KEY, replacement: stored(owner(7002)) });
  await expect(check).toBeEnabled(); const finished = state.accessFinished; state.releaseAccess!();
  await expect.poll(() => state.accessFinished).toBeGreaterThan(finished);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const identity = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), AUTH_SESSION_KEY);
  expect(identity.user.id).toBe(7001); expect(identity.user.approved).toBe(false); expect(identity.user.workspaceAccess).toBe(false);
  await expect(page.getByRole("link", { name: "Open workspace", exact: true })).toHaveCount(0);
  await noBetaPurchase(page); await capture(page, info, "stale-access-aba", state);
});

test("paid export still requires active live verification and honors a server refusal", async ({ page }, info) => {
  const state = await fixture(page); state.billingFailure = false; await gotoStable(page, "/account");
  const download = page.getByRole("button", { name: "Export data", exact: true }); await expect(download).toBeDisabled();
  expect(state.exports).toBe(0);
  state.billing = { ...inactive(), subscription_access: true, workspace_access: true, status: "active" };
  await page.getByRole("button", { name: "Refresh status", exact: true }).click(); await expect(download).toBeEnabled();
  await download.click(); await expect(page.getByRole("alert").filter({ hasText: "Active subscription required" })).toBeVisible();
  expect(state.exports).toBe(1); expect(state.downloads).toEqual([]); await noBetaPurchase(page);
  await capture(page, info, "server-refused-export", state);
});

test("genuine lazy route loading uses plain text without internal routing jargon or invented progress", async ({ page }, info) => {
  const state = await fixture(page); let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/assets/AccountPage-*.js", async route => { held = true; await gate; await route.continue(); });
  await page.goto("/account", { waitUntil: "domcontentloaded" }); await expect.poll(() => held).toBe(true);
  await expect(page.getByRole("heading", { name: "Opening EdgeLab", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/routing|auth path|route path|resolve destination|exchange code|surface transition|load surface|hand off state/i);
  await capture(page, info, "lazy-route-loading", state); release();
  await expect(page.getByRole("heading", { name: "Your EdgeLab account.", exact: true })).toBeVisible();
  await noBetaPurchase(page); await capture(page, info, "lazy-route-opened", state);
});
