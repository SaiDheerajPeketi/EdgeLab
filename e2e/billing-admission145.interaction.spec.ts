import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AUTH_SESSION_KEY } from "./support/app";

const artifacts = path.resolve(".artifacts/billing-admission145");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function seal() {
  const entries: string[] = [];
  for (const file of fs.readdirSync("frontend/dist", { recursive: true })) {
    const relative = String(file), target = path.join("frontend/dist", relative);
    if (fs.statSync(target).isFile()) entries.push(relative + ":" + hash(fs.readFileSync(target)));
  }
  return { files: entries.length, sha256: hash(entries.sort().join("\n")) };
}
const beforeSeal = seal();
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); expect(seal()).toEqual(beforeSeal); });
const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
async function ledger(request: APIRequestContext) {
  const response = await request.get("/__fixture/ledger"); expect(response.status()).toBe(200); return response.json();
}
async function setup(page: Page, request: APIRequestContext) {
  const reset = await request.post("/__fixture/reset"); expect(reset.status()).toBe(200); const state = await reset.json();
  const auth = await request.get("/api/auth/session", { headers: headers(state.tokens[0]) }); expect(auth.status()).toBe(200);
  const session = await auth.json(); expect(session.user.provider).toBe("google"); expect(session.user.workspace_access).toBe(true);
  const serverDate = auth.headers()["date"]; expect(Number.isFinite(Date.parse(serverDate))).toBe(true);
  expect(Math.abs(Date.now() - Date.parse(serverDate))).toBeLessThan(30_000);
  // This is an actual JWT backed by a verified fixture identity and DB session.
  // Production rehydration, entitlement, billing and export routes remain real.
  await page.addInitScript(({ key, session }) => {
    const user = session.user;
    localStorage.setItem(key, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
      user: { id: user.id, email: user.email, name: user.name, provider: user.provider, approved: user.approved,
        betaPosition: user.beta_position, deploymentMode: user.deployment_mode, workspaceAccess: user.workspace_access,
        accessExpiresAt: user.access_expires_at, isBetaUser: user.is_beta_user, plan: user.plan } }));
  }, { key: AUTH_SESSION_KEY, session });
  await page.goto("/account"); await expect(page.getByText("Subscription active", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeEnabled();
  const browserNow = await page.evaluate(() => Date.now());
  expect(Math.abs(browserNow - Date.parse(serverDate))).toBeLessThan(30_000);
  return { ...state, session, clocks: { serverDate, serverNow: state.serverNow, browserNow, frozenClock: false } };
}
async function screenshot(page: Page, info: TestInfo, name: string, evidence: unknown) {
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ qualification: "Frozen production browser joined to actual FastAPI routes, JWT, temporary SQLite, real billing admission and paid export decisions. Only Stripe provider transport is a fixture; no live merchant claim.", beforeSeal, afterSeal: seal(), evidence, applicationErrors: errors.get(page) }, null, 2));
  await page.screenshot({ path: path.join(folder, name + ".png") });
}

test("real status quota returns429 before billing work while owned portal and other account remain usable", async ({ page, request }, info) => {
  const state = await setup(page, request), statuses: number[] = [];
  for (let i = 0; i < 31; i++) {
    const response = await request.get("/api/billing/status", { headers: headers(state.tokens[0]) }); statuses.push(response.status());
    if (response.status() === 429) { expect(Number(response.headers()["retry-after"])).toBeGreaterThan(0); break; }
    expect(response.status()).toBe(200);
  }
  expect(statuses.at(-1)).toBe(429);
  const before = await ledger(request);
  const blocked = await request.get("/api/billing/status", { headers: headers(state.tokens[0]) }); expect(blocked.status()).toBe(429);
  const statusDenial = await blocked.json(); expect(statusDenial.detail).toMatch(/billing|request|limit|try/i);
  const denied = await ledger(request); expect(denied.providerCalls).toEqual(before.providerCalls); expect(denied.billingSqlCount).toBe(before.billingSqlCount);
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByText("Subscription status unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText(statusDenial.detail);
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  const portal = page.getByRole("button", { name: "Manage billing", exact: true }); await expect(portal).toBeEnabled();
  const uiDenied = await ledger(request); expect(uiDenied.providerCalls).toEqual(denied.providerCalls); expect(uiDenied.billingSqlCount).toBe(denied.billingSqlCount);
  const other = await request.get("/api/billing/status", { headers: headers(state.tokens[1]) }); expect(other.status()).toBe(200);
  const otherPortal = await request.post("/api/billing/portal", { headers: headers(state.tokens[1]), data: {} }); expect(otherPortal.status()).toBe(200);
  const stripeVisits: string[] = [];
  await page.route("https://billing.stripe.com/**", route => { stripeVisits.push(route.request().url()); return route.fulfill({ contentType: "text/html", body: "<title>Stripe transport boundary145</title>" }); });
  await screenshot(page, info, "status-quota-recovery", { clocks: state.clocks, statuses, before, denied, uiDenied, otherStatus: other.status(), ledger: await ledger(request) });
  await Promise.all([page.waitForURL("https://billing.stripe.com/**"), portal.click()]);
  expect(stripeVisits).toHaveLength(1);
  const final = await ledger(request), calls = final.providerCalls.filter((call: any[]) => call[0] === "portal");
  expect(calls.map((call: any[]) => call[1].customer)).toEqual(["cus_billing145_2", "cus_billing145_1"]);
  fs.writeFileSync(path.join(artifacts, info.project.name, "status-quota-final-ledger.json"), JSON.stringify(final, null, 2));
});

test("real shared action quota and stale paid export fail closed, then verified export contains only its owner", async ({ page, request }, info) => {
  const state = await setup(page, request), admitted: number[] = [];
  for (let i = 0; i < 6; i++) {
    const portal = i % 2 === 0;
    const response = await request.post(portal ? "/api/billing/portal" : "/api/billing/checkout", {
      headers: headers(state.tokens[0]), data: portal ? {} : { plan: "pro", cadence: "monthly" },
    });
    expect(response.status()).toBe(portal ? 200 : 409); admitted.push(response.status());
  }
  const before = await ledger(request);
  const blocked = await request.post("/api/billing/portal", { headers: headers(state.tokens[0]), data: {} }); expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
  const denied = await ledger(request); expect(denied.providerCalls).toEqual(before.providerCalls); expect(denied.billingSqlCount).toBe(before.billingSqlCount);
  const actionDenial = await blocked.json(); expect(actionDenial.detail).toMatch(/billing|request|limit|try/i);
  const uiBlocked = page.waitForResponse(response => new URL(response.url()).pathname === "/api/billing/portal");
  await page.getByRole("button", { name: "Manage billing", exact: true }).click(); expect((await uiBlocked).status()).toBe(429);
  await expect(page.getByRole("alert")).toHaveText(actionDenial.detail);
  const uiDenied = await ledger(request); expect(uiDenied.providerCalls).toEqual(denied.providerCalls); expect(uiDenied.billingSqlCount).toBe(denied.billingSqlCount);
  const other = await request.post("/api/billing/portal", { headers: headers(state.tokens[1]), data: {} }); expect(other.status()).toBe(200);
  const downloads: string[] = []; page.on("download", download => downloads.push(download.suggestedFilename()));
  await request.post("/__fixture/provider", { data: { outage: true, expireOwner: state.owners[0] } });
  const rejected = page.waitForResponse(response => new URL(response.url()).pathname === "/api/app-data/export");
  await page.getByRole("button", { name: "Export data", exact: true }).click(); const exportResponse = await rejected;
  expect(exportResponse.status()).toBe(403); expect(await exportResponse.json()).toMatchObject({ detail: "Data export requires an active subscription" });
  await expect(page.getByRole("alert")).toHaveText("Data export requires an active subscription"); expect(downloads).toEqual([]);
  await screenshot(page, info, "stale-export-rejected", { clocks: state.clocks, admitted, before, denied, uiDenied, exportStatus: exportResponse.status(), ledger: await ledger(request), downloads });
  await request.post("/__fixture/provider", { data: { outage: false } });
  await page.getByRole("button", { name: "Refresh status", exact: true }).click(); await expect(page.getByText("Subscription active", { exact: true })).toBeVisible();
  const downloaded = page.waitForEvent("download"); await page.getByRole("button", { name: "Export data", exact: true }).click();
  const bytes = fs.readFileSync((await (await downloaded).path())!); const bundle = JSON.parse(bytes.toString("utf8"));
  expect(bundle.app).toBe("edgelab");
  expect(bundle.tables.app_storage.map((row: any) => row.value)).toContainEqual({ owner: 1, private: "owner-1-only" });
  expect(bytes.toString("utf8")).not.toContain("owner-2-only"); expect(downloads).toEqual(["edgelab-data.json"]);
  await screenshot(page, info, "paid-export-recovered", { clocks: state.clocks, admitted, denied, bundle, downloadSha256: hash(bytes), ledger: await ledger(request) });
});
