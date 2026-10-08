import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  AUTH_SESSION_KEY, GOOGLE_STATE_KEY, betaSessionResponse,
  certifyUiState, gotoStable, installDeterminism,
} from "./support/app";

const sentinel = "private-marker-67";
const liveCatalog = {
  provider: "stripe", enabled: true, mode: "live", checkout_available: true, reason: null,
  plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
};
const inactive = {
  provider: "stripe", mode: "live", configured: true, workspace_access: false,
  subscription_access: false, plan: null, status: "inactive", cadence: null,
  current_period_end: null, cancel_at_period_end: false, verified_at: null, refresh_required: false,
};
type Session = typeof betaSessionResponse;

async function fixture(page: Page) {
  await installDeterminism(page, { rollout: "fallback", devAuth: true });
  const state = {
    session: null as Session | null,
    bypass: 0,
    exchanges: [] as unknown[],
    checkouts: [] as unknown[],
    errors: [] as string[],
    assets: [] as string[],
    oauth: "",
  };
  page.on("pageerror", error => state.errors.push(error.message));
  page.on("request", request => {
    if (request.url().includes("/assets/")) state.assets.push(new URL(request.url()).pathname);
  });
  await page.route("https://accounts.google.com/**", route => {
    state.oauth = route.request().url();
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Google provider boundary</title>" });
  });
  await page.route("https://checkout.stripe.com/**", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Stripe provider boundary</title>",
  }));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/config") return route.fulfill({ json: {
      deployment_mode: "beta", google_enabled: true, manual_access_enabled: false,
      dev_auth_bypass_enabled: true, google_client_id: "fallback67.apps.googleusercontent.com",
      google_redirect_uri: new URL("/auth/callback/google", request.url()).href,
    } });
    if (endpoint === "/auth/session") return route.fulfill(state.session
      ? { json: state.session } : { status: 401, json: { detail: "Sign in required" } });
    if (endpoint === "/auth/dev/bypass") {
      expect(request.method()).toBe("POST");
      state.bypass++;
      state.session = { ...betaSessionResponse, user: { ...betaSessionResponse.user, provider: "email" } } as Session;
      return route.fulfill({ json: { session: state.session, program: { mode: "beta", seats_total: 500, seats_taken: 137, seats_remaining: 363, waitlist_count: 27 } } });
    }
    if (endpoint === "/auth/google/exchange") {
      expect(request.method()).toBe("POST");
      expect(request.postDataJSON()).toEqual({ code: "network-code-67", redirect_uri: new URL("/auth/callback/google", request.url()).href });
      state.exchanges.push(request.postDataJSON());
      state.session = betaSessionResponse;
      return route.fulfill({ json: { session: state.session, program: { mode: "beta", seats_total: 500, seats_taken: 137, seats_remaining: 363, waitlist_count: 27 } } });
    }
    if (endpoint === "/billing/catalog") return route.fulfill({ json: liveCatalog });
    if (endpoint === "/billing/status") {
      expect(request.headers().authorization).toBe(`Bearer ${state.session!.token}`);
      return route.fulfill({ json: inactive });
    }
    if (endpoint === "/billing/checkout") {
      expect(request.method()).toBe("POST");
      expect(request.headers().authorization).toBe(`Bearer ${state.session!.token}`);
      state.checkouts.push(request.postDataJSON());
      return route.fulfill({ json: { url: "https://checkout.stripe.com/c/pay/cs_live_fallback67" } });
    }
    return route.fallback();
  });
  return state;
}

async function identity(page: Page, session: Session | null) {
  await page.evaluate(({ key, value }) => {
    const oldValue = localStorage.getItem(key);
    if (!value) localStorage.removeItem(key);
    else {
      const u = value.user;
      localStorage.setItem(key, JSON.stringify({
        createdAt: value.created_at, expiresAt: value.expires_at, token: value.token,
        user: { id: u.id, email: u.email, name: u.name, provider: u.provider, approved: u.approved,
          betaPosition: u.beta_position, deploymentMode: u.deployment_mode, workspaceAccess: u.workspace_access,
          accessExpiresAt: u.access_expires_at, isBetaUser: u.is_beta_user, plan: u.plan },
      }));
    }
    dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: localStorage.getItem(key), storageArea: localStorage }));
  }, { key: AUTH_SESSION_KEY, value: session });
}

async function cleanPresentation(page: Page) {
  const presentation = await page.evaluate(() => ({
    text: document.body.innerText,
    title: document.title,
    attributes: [...document.querySelectorAll("*")].flatMap(node => [...node.attributes]
      .filter(attribute => attribute.name.startsWith("aria-") || attribute.name === "title" || attribute.name.startsWith("data-"))
      .map(attribute => attribute.value)),
  }));
  expect(JSON.stringify(presentation)).not.toContain(sentinel);
  expect(presentation.text).not.toMatch(/Pre-redesign|Compatibility policy|Deep link|policy:\s*preserve/i);
}

async function capture(page: Page, info: TestInfo, name: string) {
  if (process.env.EDGELAB_PUBLIC67_CAPTURE_ONLY && process.env.EDGELAB_PUBLIC67_CAPTURE_ONLY !== name) return;
  await certifyUiState(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await cleanPresentation(page);
  const directory = path.resolve(".artifacts/public67/browser", info.project.name);
  await fs.mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true, scale: "css" });
}

// API/provider boundaries only; the production router, auth state, callback and checkout UI are unchanged.
test("Kill-switch public routes use canonical prices and legal pages without loading the 3D landing", async ({ page }, info) => {
  const state = await fixture(page);
  await gotoStable(page, `/?private=${sentinel}#${sentinel}`);
  await expect(page.locator('[data-compatibility-renderer="public"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: /Make every trade/ })).toBeVisible();
  await expect(page.locator("canvas, [data-market-projection]")).toHaveCount(0);
  expect(state.assets.filter(asset => /market-3d|marketSceneThree|MarketSculpture/.test(asset))).toEqual([]);
  await capture(page, info, "fallback-home");
  await page.getByRole("link", { name: "View pricing and access", exact: true }).click();
  const pro = page.getByTestId("pro-pricing");
  await expect(pro.getByText("$29", { exact: true })).toBeVisible();
  await expect(pro.getByRole("radio", { name: "Monthly" })).toBeChecked();
  await expect(pro.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", /from=%2Fpricing%3Fcadence%3Dmonthly/);
  await pro.getByRole("radio", { name: "Yearly" }).click();
  await expect(pro.getByText(/\$290 USD billed yearly/)).toBeVisible();
  await expect(pro.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", /from=%2Fpricing%3Fcadence%3Dannual/);
  await capture(page, info, "fallback-pricing");
  expect(state.checkouts).toEqual([]);
  for (const legal of ["privacy", "terms"]) {
    await gotoStable(page, `/${legal}`);
    await expect(page.getByRole("heading", { level: 1, name: legal === "privacy" ? "Privacy Policy" : "Terms of Use" })).toBeVisible();
    await expect(page.getByText(/Stripe/).first()).toBeVisible();
    await capture(page, info, `fallback-${legal}`);
  }
  await gotoStable(page, "/index.html");
  await expect(page).toHaveURL(/\/$/);
  await gotoStable(page, `/unknown67?private=${sentinel}#${sentinel}`);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await cleanPresentation(page);
  expect(state.errors).toEqual([]);
});

test("Fallback authentication preserves bypass return and Google billing callback ownership", async ({ page }, info) => {
  const state = await fixture(page);
  await gotoStable(page, "/auth/signin?from=%2Fapp");
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await capture(page, info, "fallback-signin");
  await page.getByRole("button", { name: "Local development sign-in", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('[data-compatibility-renderer="shell"]')).toBeVisible();
  expect(state.bypass).toBe(1);
  await capture(page, info, "private-header");
  await gotoStable(page, "/auth/signin?from=%2Fapp");
  await expect(page).toHaveURL(/\/app$/);
  state.session = { ...betaSessionResponse, user: { ...betaSessionResponse.user, approved: false, workspace_access: false, plan: "none" } } as Session;
  await identity(page, state.session);
  await gotoStable(page, "/app");
  await expect(page).toHaveURL(/\/auth\/signin\?/);
  await expect(page.getByRole("button", { name: /Google/ })).toBeVisible();
  state.session = { ...betaSessionResponse, user: { ...betaSessionResponse.user, provider: "email" } } as Session;
  await identity(page, state.session);
  await gotoStable(page, "/auth/signin?from=%2Fpricing%3Fcadence%3Dannual");
  await expect(page).toHaveURL(/\/auth\/signin\?/);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect.poll(() => state.oauth).not.toBe("");
  const oauth = new URL(state.oauth);
  expect(oauth.searchParams.get("response_type")).toBe("code");
  const origin = new URL(info.project.use.baseURL as string || "http://127.0.0.1:45367").origin;
  await page.goto(`${origin}/auth/callback/google?code=network-code-67&state=${encodeURIComponent(oauth.searchParams.get("state")!)}`);
  await expect(page).toHaveURL(/\/pricing\?cadence=annual$/);
  expect(state.exchanges).toHaveLength(1);
  expect(await page.evaluate(key => sessionStorage.getItem(key), GOOGLE_STATE_KEY)).toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), GOOGLE_STATE_KEY)).toBeNull();
  const pro = page.getByTestId("pro-pricing");
  await expect(pro.getByRole("radio", { name: "Yearly" })).toBeChecked();
  await pro.getByRole("button", { name: "Continue to checkout", exact: true }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_live_fallback67");
  expect(state.checkouts).toEqual([{ plan: "pro", cadence: "annual" }]);
  expect(state.errors).toEqual([]);
});

test("Fallback redirects and account recovery keep private URL details out of presentation", async ({ page }, info) => {
  const state = await fixture(page);
  await gotoStable(page, "/");
  state.session = betaSessionResponse;
  await identity(page, state.session);
  await gotoStable(page, `/app?private=${sentinel}#${sentinel}`);
  await expect(page.locator('[data-compatibility-renderer="shell"]')).toBeVisible();
  await cleanPresentation(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#compatibility-content")).toBeFocused();
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
  await gotoStable(page, "/workspace");
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Workspace home" })).toBeVisible();
  state.session = null;
  await identity(page, null);
  await gotoStable(page, "/account");
  await expect(page).toHaveURL(/\/auth\/signin\?/);
  state.session = { ...betaSessionResponse, user: { ...betaSessionResponse.user, approved: false, workspace_access: false, deployment_mode: "production", plan: "none" } } as Session;
  await identity(page, state.session);
  await gotoStable(page, "/account");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeVisible();
  await expect(page.locator("[data-compatibility-renderer]")).toHaveCount(0);
  expect(state.errors).toEqual([]);
  const directory = path.resolve(".artifacts/public67/browser", info.project.name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "route-receipt.json"), JSON.stringify({ project: info.project.name, pageErrors: state.errors, bypassRequests: state.bypass, sourceBoundary: "API-only controlled auth/billing responses; no token output", checked: ["workspace redirect", "account exemption", "200% root font scale", "keyboard skip", "no private URL presentation"] }, null, 2));
});
