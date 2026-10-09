import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { AUTH_SESSION_KEY, betaSessionResponse, FROZEN_TIME, gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/billing-recovery139");
const hostedPortal = "https://billing.stripe.com/p/session/recovery139";
const pageErrors = new WeakMap<Page, string[]>();
const inactive = () => ({ provider: "stripe", mode: "live", configured: true,
  workspace_access: false, subscription_access: false, plan: null, status: "inactive", cadence: null,
  current_period_end: null, cancel_at_period_end: false, verified_at: null, refresh_required: false });
const owner = (id = 7001, provider: "google" | "email" = "google") => ({
  ...betaSessionResponse, token: `billing-recovery139-owner-${id}`, user: {
    ...betaSessionResponse.user, id, email: `owner${id}@example.com`, provider,
    deployment_mode: "production", approved: false, is_beta_user: false,
    workspace_access: false, access_expires_at: null, plan: "none",
  },
});
function stored(session: ReturnType<typeof owner>) {
  const user = session.user;
  return { createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
    user: { id: user.id, email: user.email, name: user.name, provider: user.provider,
      approved: user.approved, betaPosition: user.beta_position, deploymentMode: user.deployment_mode,
      workspaceAccess: user.workspace_access, accessExpiresAt: user.access_expires_at,
      isBetaUser: user.is_beta_user, plan: user.plan } };
}

async function fixture(page: Page) {
  await installDeterminism(page);
  const state = { session: owner(), statusFailure: true, billing: inactive(), portalFailure: false,
    holdPortal: false, releasePortal: null as (() => void) | null, portalFinished: 0,
    statusReads: 0, portalRequests: [] as Array<{ ownerId: number; method: string; authorization: string }>,
    stripeVisits: [] as string[], exports: 0, checkouts: 0 };
  await page.addInitScript(({ key, session }) => {
    if (window === window.top) localStorage.setItem(key, JSON.stringify(session));
  }, { key: AUTH_SESSION_KEY, session: stored(state.session) });
  // Only HTTP/provider boundaries are fixtures; real AccountPage and redirect/owner guards execute.
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/config") return route.fulfill({ json: {
      deployment_mode: "production", google_enabled: true,
      google_client_id: "visual-client.apps.googleusercontent.com",
      google_redirect_uri: "http://127.0.0.1/auth/callback/google",
      manual_access_enabled: false, dev_auth_bypass_enabled: false,
    } });
    if (endpoint === "/auth/session") return route.fulfill({ json: state.session });
    if (endpoint === "/billing/status") {
      expect(request.headers().authorization).toBe(`Bearer ${state.session.token}`);
      state.statusReads++;
      return route.fulfill(state.statusFailure
        ? { status: 503, json: { detail: "Subscription service unavailable" } }
        : { json: state.billing });
    }
    if (endpoint === "/billing/portal") {
      const currentOwner = state.session;
      expect(request.method()).toBe("POST");
      expect(request.headers().authorization).toBe(`Bearer ${currentOwner.token}`);
      expect(request.postDataJSON()).toEqual({});
      state.portalRequests.push({ ownerId: currentOwner.user.id, method: request.method(), authorization: request.headers().authorization });
      if (state.holdPortal) await new Promise<void>(resolve => { state.releasePortal = resolve; });
      await route.fulfill(state.portalFailure
        ? { status: 503, json: { detail: "Billing portal unavailable. Retry shortly." } }
        : { json: { url: hostedPortal } });
      state.portalFinished++;
      return;
    }
    if (endpoint === "/app-data/export") {
      state.exports++;
      return route.fulfill({ status: 403, json: { detail: "Active subscription required" } });
    }
    if (endpoint === "/billing/checkout") {
      state.checkouts++;
      return route.fulfill({ status: 403, json: { detail: "Unverified subscription" } });
    }
    return route.fallback();
  });
  await page.route("https://billing.stripe.com/**", route => {
    state.stripeVisits.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Stripe network boundary</title><p>Hosted billing provider boundary</p>" });
  });
  return state;
}

async function switchOwner(page: Page, state: Awaited<ReturnType<typeof fixture>>, provider: "google" | "email" = "google") {
  state.session = owner(7002, provider);
  await page.evaluate(({ key, session }) => {
    const previous = localStorage.getItem(key);
    const next = JSON.stringify(session);
    localStorage.setItem(key, next);
    dispatchEvent(new StorageEvent("storage", { key, oldValue: previous, newValue: next, storageArea: localStorage }));
  }, { key: AUTH_SESSION_KEY, session: stored(state.session) });
  await expect(page.getByText("owner7002@example.com", { exact: true })).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string, state: Awaited<ReturnType<typeof fixture>>) {
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  const json = path.join(directory, `${name}.json`);
  fs.writeFileSync(json, JSON.stringify({ statusReads: state.statusReads, portalRequests: state.portalRequests,
    portalFinished: state.portalFinished, stripeVisits: state.stripeVisits, exports: state.exports,
    checkouts: state.checkouts, pageErrors: pageErrors.get(page), qualification: "Production route with HTTP/provider seams; no live Stripe merchant claim." }, null, 2));
  await info.attach(name, { path: json, contentType: "application/json" });
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
}

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
});
test.afterEach(({ page }) => expect(pageErrors.get(page)).toEqual([]));

test("status failure retains owned portal recovery and distinct retry errors while export remains closed", async ({ page }, info) => {
  const state = await fixture(page);
  await gotoStable(page, "/account");
  await expect(page.getByText("Subscription status unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Subscription service unavailable");
  const portal = page.getByRole("button", { name: "Manage billing", exact: true });
  await expect(portal).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  await portal.scrollIntoViewIfNeeded();
  const box = await portal.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);

  state.portalFailure = true;
  await portal.click();
  await expect(page.getByRole("alert").filter({ hasText: "Billing portal unavailable" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Subscription service unavailable" })).toBeVisible();
  await expect(page.getByText("Subscription status unavailable", { exact: true })).toBeVisible();
  await expect(portal).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  expect(state.portalRequests).toHaveLength(1);
  await capture(page, info, "portal-retry", state);

  state.portalFailure = false;
  await Promise.all([page.waitForURL(hostedPortal), portal.click()]);
  expect(state.portalRequests.map(request => request.ownerId)).toEqual([7001, 7001]);
  expect(state.stripeVisits).toEqual([hostedPortal]);
  expect(state.exports).toBe(0);
  expect(state.checkouts).toBe(0);
});

test("held portal response cannot redirect a replacement account or overwrite its status error", async ({ page }, info) => {
  const state = await fixture(page);
  await gotoStable(page, "/account");
  const portal = page.getByRole("button", { name: "Manage billing", exact: true });
  await expect(portal).toBeEnabled();
  state.holdPortal = true;
  await portal.click();
  await expect.poll(() => state.releasePortal !== null).toBe(true);
  await expect(page.getByRole("button", { name: "Opening billing…", exact: true })).toBeDisabled();
  await switchOwner(page, state);
  await expect(portal).toBeEnabled();
  await expect.poll(() => state.statusReads).toBeGreaterThanOrEqual(2);
  state.releasePortal!();
  await expect.poll(() => state.portalFinished).toBe(1);
  await page.waitForTimeout(500);
  expect(new URL(page.url()).pathname).toBe("/account");
  expect(state.stripeVisits).toEqual([]);
  expect(state.portalRequests.map(request => request.ownerId)).toEqual([7001]);
  await expect(page.getByRole("alert")).toHaveText("Subscription service unavailable");
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  await capture(page, info, "stale-owner", state);
});

test("known unconfigured billing and non-Google identity keep portal and export disabled", async ({ page }, info) => {
  const state = await fixture(page);
  state.statusFailure = false;
  state.billing.configured = false;
  await gotoStable(page, "/account");
  const portal = page.getByRole("button", { name: "Manage billing", exact: true });
  await expect(portal).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  await switchOwner(page, state, "email");
  await expect(page.getByRole("alert")).toContainText("Sign in with Google");
  await expect(portal).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  expect(state.portalRequests).toEqual([]);
  expect(state.exports).toBe(0);
  expect(state.checkouts).toBe(0);
  await capture(page, info, "ineligible", state);
});
