import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { AUTH_SESSION_KEY, GOOGLE_STATE_KEY, betaSessionResponse, gotoStable, installDeterminism } from "./support/app";

const artifacts = path.resolve(".artifacts/marketing-variant157"), hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const testFiles = ["e2e/marketing-variant157.config.ts", "e2e/marketing-variant157.interaction.spec.ts", "e2e/landing-launch146.interaction.spec.ts"];
const hashes = () => Object.fromEntries(testFiles.map(file => [file, hash(fs.readFileSync(file))]));
function seal() { const files = fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort();
  return { files: files.length, sha256: hash(files.map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n")) }; }
const beforeSeal = seal(), beforeHashes = hashes(), errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message)); });
test.afterEach(async ({ page }, info) => { if (info.status !== info.expectedStatus) await capture(page, info, "failure", { url: page.url(), main: await page.locator("main").innerText() });
  expect(errors.get(page)).toEqual([]); expect(seal()).toEqual(beforeSeal); expect(hashes()).toEqual(beforeHashes); });
async function authState(page: Page) { return page.evaluate(({ auth, google }) => ({ localAuth: localStorage.getItem(auth), sessionAuth: sessionStorage.getItem(auth),
  googleState: sessionStorage.getItem(google), localGoogle: localStorage.getItem(google) }), { auth: AUTH_SESSION_KEY, google: GOOGLE_STATE_KEY }); }
async function fixture(page: Page, mode: "beta" | "production", authenticated = false) {
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  const now = new Date(), ledger: any[] = [];
  const session = { ...betaSessionResponse, token: "marketing157-google-owner", created_at: now.toISOString(), expires_at: new Date(+now + 86_400_000).toISOString(), user: {
    ...betaSessionResponse.user, approved: false, provider: "google", deployment_mode: "production", is_beta_user: false, workspace_access: false, access_expires_at: null, plan: "none" } };
  await page.addInitScript(({ authKey, googleKey, session, authenticated }) => { if (window !== window.top) return;
    localStorage.removeItem(authKey); sessionStorage.removeItem(authKey); localStorage.removeItem(googleKey); sessionStorage.removeItem(googleKey);
    if (authenticated) { const u = session.user; localStorage.setItem(authKey, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
      user: { id: u.id, email: u.email, name: u.name, provider: u.provider, approved: u.approved, betaPosition: u.beta_position,
        deploymentMode: u.deployment_mode, workspaceAccess: u.workspace_access, accessExpiresAt: u.access_expires_at, isBetaUser: u.is_beta_user, plan: u.plan } })); }
  }, { authKey: AUTH_SESSION_KEY, googleKey: GOOGLE_STATE_KEY, session, authenticated });
  await page.route("**/api/**", route => {
    const request = route.request(), endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (["/auth/config", "/auth/beta/status", "/auth/session", "/billing/catalog", "/billing/status", "/billing/checkout"].includes(endpoint)) ledger.push({ endpoint, method: request.method(), authorityMode: mode, at: Date.now() });
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: mode, google_enabled: true, google_client_id: "visual-client.apps.googleusercontent.com",
      google_redirect_uri: "http://127.0.0.1/auth/callback/google", dev_auth_bypass_enabled: false, manual_access_enabled: false } });
    if (endpoint === "/auth/beta/status") return route.fulfill({ json: { mode, seats_remaining: mode === "beta" ? 37 : 0, seats_taken: mode === "beta" ? 463 : 0, seats_total: mode === "beta" ? 500 : 0, waitlist_count: mode === "beta" ? 8 : 0 } });
    if (endpoint === "/auth/session") return route.fulfill(authenticated ? { json: session } : { status: 401, json: { detail: "Not signed in" } });
    if (endpoint === "/billing/catalog") return route.fulfill({ json: { provider: "stripe", enabled: false, mode: "live", checkout_available: false, reason: "Billing is not configured.",
      plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }] } });
    if (endpoint === "/billing/status") return route.fulfill({ json: { provider: "stripe", mode: "live", configured: false, workspace_access: false, subscription_access: false,
      plan: null, status: "inactive", cadence: null, current_period_end: null, cancel_at_period_end: false, verified_at: now.toISOString(), refresh_required: false } });
    if (endpoint === "/billing/checkout") return route.fulfill({ status: 503, json: { detail: "Checkout unavailable" } });
    return route.fallback();
  });
  return { ledger, session };
}
const heroCta = (page: Page) => page.locator('[data-landing-hero] [data-marketing-reveal="hero-actions"] a').first();
const attribution = "utm_source=blackblue&utm_campaign=launch157&ref=community";
function attributed(href: string) { const url = new URL(href, "https://edgelab.invalid"); expect(url.searchParams.get("utm_source")).toBe("blackblue"); expect(url.searchParams.get("utm_campaign")).toBe("launch157"); expect(url.searchParams.get("ref")).toBe("community"); return url; }
async function headerNav(page: Page, info: TestInfo) {
  if (info.project.name === "mobile") { await page.getByRole("button", { name: "Open navigation menu", exact: true }).click(); return page.getByRole("navigation", { name: "Mobile navigation", exact: true }); }
  return page.getByRole("navigation", { name: "Primary navigation", exact: true });
}
async function capture(page: Page, info: TestInfo, name: string, evidence: unknown) {
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(), errors: errors.get(page), evidence,
    qualification: "Actual production marketing router, links, FAQ, pricing component and authentication gateway. Only auth/beta-program/billing HTTP authority and initial identity storage are fixtures. No provider exchange or purchase attempted; presentation never grants entitlement." }, null, 2));
  await page.screenshot({ path: path.join(folder, name + ".png"), fullPage: false, animations: "allow" });
}

test("launch and beta marketing follow their public variant while real beta admission and attribution remain authoritative", async ({ page }, info) => {
  const state = await fixture(page, "beta"); await gotoStable(page, "/?" + attribution); const before = await authState(page);
  await expect(heroCta(page)).toHaveText(/View plans/); const href = await heroCta(page).getAttribute("href"); expect(attributed(href!).pathname).toBe("/pricing");
  const nav = await headerNav(page, info); if (info.project.name === "mobile") {
    await expect(nav.getByRole("link", { name: "View plans", exact: true })).toHaveAttribute("href", href!); await nav.getByRole("link", { name: "View plans", exact: true }).click();
  } else { await expect(page.locator("header").getByRole("link", { name: "View plans", exact: true })).toHaveAttribute("href", href!); await heroCta(page).click(); }
  await expect(page.getByRole("heading", { name: "One workspace. Every decision.", exact: true })).toBeVisible(); attributed(page.url());
  await expect(page.locator("#pricing")).not.toContainText("Test the core workflow free."); await page.getByRole("button", { name: "How does billing work?", exact: true }).click();
  await expect(page.getByRole("region", { name: "How does billing work?", exact: true })).toContainText("active paid subscription");
  await capture(page, info, "launch-pricing", { href, url: page.url(), before, after: await authState(page), ledger: state.ledger }); expect(await authState(page)).toEqual(before);
  await gotoStable(page, "/?variant=beta&" + attribution); await expect(heroCta(page)).toHaveText(/Join beta/);
  await (await headerNav(page, info)).getByRole("link", { name: "FAQ", exact: true }).click();
  await page.getByRole("button", { name: "What happens during beta?", exact: true }).click(); await expect(page.getByRole("region", { name: "What happens during beta?", exact: true })).toContainText("Approved users");
  const betaNav = await headerNav(page, info); const pricing = betaNav.getByRole("link", { name: "Pricing", exact: true });
  expect(new URL((await pricing.getAttribute("href"))!, page.url()).searchParams.get("variant")).toBe("beta"); await pricing.click();
  expect(new URL(page.url()).searchParams.get("variant")).toBe("beta"); await expect(page.locator("#pricing")).toContainText("Test the core workflow free.");
  await gotoStable(page, "/pricing?variant=beta&" + attribution); await expect(page.getByRole("heading", { name: "Current access, without fine print.", exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Beta seat capacity", exact: true })).toHaveAttribute("aria-valuenow", "463");
  const home = page.getByRole("link", { name: "EdgeLab home", exact: true }); await expect(home).toHaveAttribute("href", "/?variant=beta");
  await capture(page, info, "beta-pricing", { url: page.url(), ledger: state.ledger, before, after: await authState(page) }); await home.click();
  await expect(heroCta(page)).toHaveText(/Join beta/);
  await page.getByRole("navigation", { name: "Footer navigation", exact: true }).getByRole("link", { name: "Privacy", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe("/privacy"); expect(new URL(page.url()).searchParams.has("variant")).toBe(false);
  await expect(page.locator("main h1")).toContainText(/Privacy/i); await expect(page.getByRole("status").filter({ hasText: "Private beta" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "EdgeLab home", exact: true })).toHaveAttribute("href", "/");
  const legalCta = info.project.name === "mobile" ? (await headerNav(page, info)).getByRole("link", { name: "View plans", exact: true }) : page.locator("header").getByRole("link", { name: "View plans", exact: true });
  await expect(legalCta).toHaveAttribute("href", "/pricing");
  expect(await authState(page)).toEqual(before); await capture(page, info, "default-legal-presentation", { url: page.url(), before, after: await authState(page) });
  // Public logo navigation preserves the chosen variant; acquisition parameters
  // remain an explicit CTA contract rather than spreading through every link.
  await gotoStable(page, "/?variant=beta&" + attribution);
  const betaHref = await heroCta(page).getAttribute("href"); const gateway = new URL(betaHref!, page.url());
  expect(gateway.pathname).toBe("/auth/signin"); expect(gateway.searchParams.has("variant")).toBe(false); attributed(gateway.searchParams.get("from")!);
  await heroCta(page).click(); await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Current beta access", exact: true })).toBeVisible(); await expect(page.locator("main")).toContainText("37 seats open"); expect(await authState(page)).toEqual(before);
  await capture(page, info, "beta-auth-authority", { betaHref, url: page.url(), before, after: await authState(page), ledger: state.ledger });
  await gotoStable(page, "/?variant=unknown&" + attribution); await expect(heroCta(page)).toHaveText(/View plans/); await expect(page.locator('[data-marketing-variant]')).toHaveAttribute("data-marketing-variant", "production");
  expect(attributed((await heroCta(page).getAttribute("href"))!).searchParams.has("variant")).toBe(false); expect(await authState(page)).toEqual(before);
});

test("a beta preview cannot advertise seats or change a production authentication gateway", async ({ page }, info) => {
  const state = await fixture(page, "production"); await gotoStable(page, "/?variant=beta&" + attribution); const before = await authState(page);
  await expect(heroCta(page)).toHaveText(/View plans/); await expect(page.locator('[data-marketing-variant]')).toHaveAttribute("data-marketing-variant", "beta");
  await expect(page.locator("main")).not.toContainText(/Join beta|Join waitlist|0 seats|0\/0|Test the core workflow free\./);
  await heroCta(page).click(); await expect(page.getByRole("heading", { name: "One workspace. Every decision.", exact: true })).toBeVisible(); attributed(page.url());
  await gotoStable(page, "/pricing?variant=beta&" + attribution); await expect(page.locator("#pricing")).not.toContainText(/Test the core workflow free\.|seats open|0\/0/);
  await expect(page.getByRole("progressbar", { name: "Beta seat capacity", exact: true })).toHaveCount(0); await expect(page.getByTestId("pro-pricing")).toBeVisible();
  await expect(page.locator("#pricing")).toContainText(/beta.*(?:closed|unavailable)|(?:closed|unavailable).*beta/i);
  await page.getByRole("button", { name: "What happens during beta?", exact: true }).click(); await expect(page.getByRole("region", { name: "What happens during beta?", exact: true })).toContainText("Approved users");
  await capture(page, info, "production-beta-preview", { url: page.url(), before, after: await authState(page), ledger: state.ledger });
  const signIn = page.getByTestId("pro-pricing").getByRole("link", { name: "Sign in with Google", exact: true }), signInUrl = new URL((await signIn.getAttribute("href"))!, page.url());
  expect(signInUrl.pathname).toBe("/auth/signin"); const returnPath = signInUrl.searchParams.get("from")!, pricingReturn = attributed(returnPath);
  expect(pricingReturn.pathname).toBe("/pricing"); expect(pricingReturn.searchParams.get("variant")).toBe("beta"); expect(pricingReturn.searchParams.get("cadence")).toBe("monthly");
  await signIn.click(); expect(await page.evaluate(() => history.state?.usr?.fromPath)).toBe(returnPath);
  await expect(page.getByRole("heading", { name: "Your access", exact: true })).toBeVisible(); await expect(page.locator("main")).toContainText("Active paid subscription");
  await expect(page.locator("main")).not.toContainText("Current beta access"); expect(await authState(page)).toEqual(before);
  await capture(page, info, "production-auth-authority", { url: page.url(), returnPath, routeState: await page.evaluate(() => history.state?.usr), before, after: await authState(page), ledger: state.ledger });
});

test("public variants retain verified owner and real unavailable checkout instead of activating billing", async ({ page }, info) => {
  const state = await fixture(page, "production", true); await gotoStable(page, "/pricing?" + attribution);
  const pricing = page.getByTestId("pro-pricing"), checkout = pricing.getByRole("button", { name: "Checkout unavailable", exact: true });
  await expect(checkout).toBeDisabled(); const before = await authState(page); expect(JSON.parse(before.localAuth!).user).toMatchObject({ provider: "google", deploymentMode: "production", workspaceAccess: false, plan: "none" });
  for (const variant of ["production", "beta"]) {
    await gotoStable(page, "/pricing?" + (variant === "beta" ? "variant=beta&" : "") + attribution);
    await expect(checkout).toBeDisabled(); await expect(pricing).toContainText("Paid checkout is not available yet; no subscription can be purchased here.");
    await pricing.getByRole("radio", { name: "Yearly", exact: true }).click(); await expect(pricing.getByRole("radio", { name: "Yearly", exact: true })).toBeChecked(); await expect(pricing).toContainText("$290 USD billed yearly.");
    expect(new URL(page.url()).searchParams.get("cadence")).toBe("annual"); expect(new URL(page.url()).searchParams.get("variant")).toBe(variant === "beta" ? "beta" : null);
    await expect(checkout).toBeDisabled(); expect(await authState(page)).toEqual(before); attributed(page.url());
    await capture(page, info, variant + "-checkout-unavailable", { url: page.url(), before, after: await authState(page), ledger: state.ledger });
  }
  expect(state.ledger.some(entry => entry.endpoint === "/billing/checkout")).toBe(false); expect(state.ledger.filter(entry => entry.endpoint === "/billing/status").length).toBeGreaterThan(0);
});
