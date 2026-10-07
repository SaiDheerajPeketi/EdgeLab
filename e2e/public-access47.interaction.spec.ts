import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { AUTH_SESSION_KEY, betaSessionResponse, expectStableScreenshot, expectCertifiedScreenshot, certifyUiState, FROZEN_TIME, gotoStable, installDeterminism, seedApprovedSession, seedChartLayout } from "./support/app";
import { fulfillReplayContext, replayState } from "./support/replay-context";

const artifactDir = ".artifacts/public-access47/browser";
const tableNames = ["dataset_settings", "dataset_assets", "dataset_timeframes", "app_storage", "playbooks", "backtest_sessions", "positions", "orders", "trades", "executions", "trade_notes", "journal_accounts", "journal_import_runs", "canonical_trades", "canonical_executions", "journal_tags", "canonical_trade_tags", "canonical_trade_notes", "canonical_trade_screenshots", "journal_daily_notes", "journal_import_rows", "journal_import_diagnostics", "journal_backfill_checkpoints"];
const bundle = { app: "edgelab", version: 1, exported_at: FROZEN_TIME,
  tables: Object.fromEntries(tableNames.map((name) => [name, name === "app_storage" ? [{ id: 7, user_id: 7001, namespace: "workspace", key: "layout", value: { original: "owned" } }] : []])) };
const live = () => ({ provider: "stripe", mode: "live", configured: true, subscription_access: true, workspace_access: true,
  plan: "pro", status: "active", cadence: "monthly", current_period_end: "2027-09-15T10:00:00Z", cancel_at_period_end: false, verified_at: FROZEN_TIME, refresh_required: false });

async function fixture(page: Page, kind: "unpaid" | "paid" | "error" | "beta" = "unpaid") {
  await installDeterminism(page);
  await seedApprovedSession(page);
  const session = { ...betaSessionResponse, user: { ...betaSessionResponse.user,
    deployment_mode: kind === "beta" ? "beta" : "production", approved: kind === "beta",
    is_beta_user: kind === "beta", workspace_access: kind === "paid" || kind === "beta",
    access_expires_at: kind === "paid" ? new Date(Date.parse(FROZEN_TIME) + 300000).toISOString() : kind === "beta" ? betaSessionResponse.expires_at : null,
    plan: kind === "paid" ? "pro" : kind === "beta" ? "beta" : "none" } };
  const state = { session, billing: kind === "paid" ? live() : { ...live(), workspace_access: false, subscription_access: false, plan: null, status: "inactive" },
    billingError: kind === "error", exportError: false, fallback: false, allFlagsOff: false, exports: 0, billingReads: 0, downloads: [] as string[], errors: [] as string[] };
  page.on("pageerror", (error) => state.errors.push(error.message));
  page.on("download", (download) => state.downloads.push(download.suggestedFilename()));
  await page.addInitScript(({ key, session }) => {
    if (window !== window.top) return;
    const user = session.user;
    localStorage.setItem(key, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
      user: { id: user.id, email: user.email, name: user.name, provider: user.provider, approved: user.approved, betaPosition: user.beta_position,
        deploymentMode: user.deployment_mode, workspaceAccess: user.workspace_access, accessExpiresAt: user.access_expires_at,
        isBetaUser: user.is_beta_user, plan: user.plan } }));
  }, { key: AUTH_SESSION_KEY, session });
  const storage = new Map<string, unknown>();
  const receipts = new Map<string, Record<string, unknown>>();
  const apiHandler: Parameters<Page["route"]>[1] = async (route) => {
    const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const reservation = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (reservation) {
      expect(route.request().headers().authorization).toBe(`Bearer ${state.session.token}`);
      const [, id, action] = reservation;
      if (action === "reserve") receipts.set(id, { operation_id: id, ...route.request().postDataJSON(), status: "reserved", http_status: null, result: null, created_at: FROZEN_TIME, completed_at: null });
      expect(receipts.has(id)).toBe(true);
      return route.fulfill({ json: receipts.get(id) });
    }
    const bound = route.request().headers()["x-edgelab-operation-id"];
    if (bound) {
      expect(receipts.get(bound)).toMatchObject({ method: route.request().method(), path: endpoint, status: "reserved" });
      Object.assign(receipts.get(bound)!, { status: "completed", http_status: 200, completed_at: FROZEN_TIME });
    }
    const key = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (key) {
      const decoded = decodeURIComponent(key);
      if (route.request().method() === "PUT") storage.set(decoded, route.request().postDataJSON().value);
      return route.fulfill({ json: { namespace: "edgelab", key: decoded, value: storage.get(decoded) ?? null, updated_at: FROZEN_TIME } });
    }
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: session.user.deployment_mode, google_enabled: true,
      google_client_id: "visual-client.apps.googleusercontent.com", google_redirect_uri: "http://127.0.0.1/auth/callback/google", manual_access_enabled: false, dev_auth_bypass_enabled: false } });
    if (endpoint === "/auth/session") return route.fulfill({ json: state.session });
    if (endpoint === "/ui/rollout") return route.fulfill({ json: { revision: "access47", kill_switch: state.fallback, flags: { shell: !state.allFlagsOff, journal: !state.allFlagsOff, settings: !state.allFlagsOff, chart: !state.allFlagsOff, public: !state.allFlagsOff } } });
    if (endpoint === "/billing/status") {
      expect(route.request().headers().authorization).toBe(`Bearer ${state.session.token}`);
      state.billingReads++;
      return route.fulfill(state.billingError ? { status: 503, json: { detail: "Subscription service unavailable" } } : { json: state.billing });
    }
    if (endpoint === "/app-data/export") {
      state.exports++;
      expect(route.request().headers().authorization).toBe(`Bearer ${state.session.token}`);
      return route.fulfill(state.exportError ? { status: 403, json: { detail: "Active subscription required" } } : { json: bundle });
    }
    return route.fallback();
  };
  await page.route("**/api/**", apiHandler);
  return Object.assign(state, { moveApiHandlerLast: async () => {
    await page.unroute("**/api/**", apiHandler);
    await page.route("**/api/**", apiHandler);
  } });
}

async function accountCapture(page: Page, name: string) {
  await expect(page.getByRole("heading", { name: "Your EdgeLab account." })).toBeVisible();
  await expectStableScreenshot(page, name);
}

test("Account unpaid identity keeps recovery and subscription actions available", async ({ page }) => {
  const state = await fixture(page);
  await gotoStable(page, "/account");
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "View plans", exact: true })).toBeVisible();
  await accountCapture(page, "account-unpaid");
  expect(state.exports).toBe(0); expect(state.downloads).toEqual([]); expect(state.errors).toEqual([]);
});

test("Account active paid subscription downloads owned JSON and expires after its verification lease", async ({ page }) => {
  const state = await fixture(page, "paid");
  await gotoStable(page, "/account");
  const button = page.getByRole("button", { name: "Export data", exact: true });
  await expect(button).toBeEnabled();
  await accountCapture(page, "account-paid");
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(JSON.parse(fs.readFileSync((await download.path())!, "utf8"))).toEqual(bundle);
  expect(state.exports).toBe(1);
  await page.evaluate((value) => { Date.now = () => value; }, Date.parse(FROZEN_TIME) + 300001);
  await expect(button).toBeDisabled();
  expect(state.exports).toBe(1); expect(state.errors).toEqual([]);
});

test("Account billing unavailable shows a recoverable error and never creates a download", async ({ page }) => {
  const state = await fixture(page, "error");
  await gotoStable(page, "/account");
  await expect(page.getByRole("alert")).toContainText("Subscription service unavailable");
  await expect(page.getByText("Subscription status unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("Choose a plan to unlock your workspace and data exports.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  await accountCapture(page, "account-billing-error");
  state.billingError = false;
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.exports).toBe(0); expect(state.downloads).toEqual([]); expect(state.errors).toEqual([]);
});

test("Account rollback retains unpaid billing recovery", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "The route exception is exercised once; all three sizes cover Account controls separately.");
  const state = await fixture(page);
  state.fallback = true; state.allFlagsOff = true;
  await gotoStable(page, "/account");
  await expect(page.getByRole("heading", { name: "Your EdgeLab account." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export data", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: "View plans", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeEnabled();
  await certifyUiState(page);
  expect(state.exports).toBe(0); expect(state.errors).toEqual([]);
});

test("Paid export gates across modern and compatibility Settings, CSV and PNG", async ({ page }, info) => {
  const state = await fixture(page, "beta");
  for (const fallback of [false, true]) {
    state.fallback = fallback; state.billing = { ...live(), workspace_access: false, subscription_access: false, plan: null, status: "inactive" };
    await gotoStable(page, "/app/settings/storage");
    await expect(page.locator('[data-route-group="settings"]')).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
    const button = page.getByRole("button", { name: "Download export", exact: true });
    await expect(button).toBeDisabled();
    const manage = page.getByRole("link", { name: "Manage subscription", exact: true });
    await expect(manage).toBeVisible();
    expect((await manage.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText("Data exports require an active paid subscription.", { exact: false }).first()).toBeVisible();
    state.billing = live();
    await page.reload();
    await expect(button).toBeEnabled();
    state.exportError = true;
    await button.click();
    await expect(page.getByRole("alert")).toContainText("Active subscription required");
    state.exportError = false;
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(JSON.parse(fs.readFileSync((await download.path())!, "utf8"))).toEqual(bundle);
  }
  await seedChartLayout(page, "single");
  await fulfillReplayContext(page);
  state.fallback = false;
  state.billing = { ...live(), workspace_access: false, subscription_access: false, plan: null, status: "inactive" };
  const closedTrade = { id: 4701, session_id: 4101, status: "CLOSED", side: "LONG", entry_time: "2026-09-15T08:05:00Z", entry_offset: 1, entry_price: 67500, quantity: 2, remaining_quantity: 0, stop_loss: 67400, take_profit: 67700, exit_time: "2026-09-15T08:20:00Z", exit_offset: 4, exit_price: 67700, gross_pnl: 400, realized_pnl: 395, r_multiple: 2, commission_mode: "FIXED", commission_value: 5, commission_amount: 5, fee_mode: "NONE", fee_value: 0, fee_amount: 0, strategy_name: "Paid CSV receipt", playbook_id: null, notes: "Original owned trade", mistake_tags: ["fixture-original"], emotional_state: null, screenshot_url: null };
  let replayReads = 0;
  await page.route("**/api/backtests/latest", (route) => { replayReads++; return route.fulfill({ json: { ...replayState(), trades: [closedTrade] } }); });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    (window as unknown as { exportFailures: string[] }).exportFailures = [];
    window.addEventListener("edgelab:export-error", (event) => (window as unknown as { exportFailures: string[] }).exportFailures.push((event as CustomEvent).detail));
  });
  await state.moveApiHandlerLast();
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect.poll(() => replayReads).toBeGreaterThan(0);
  await expect(page.getByText("Session #4101", { exact: true })).toBeVisible();
  await page.locator("#workspace-content").getByRole("button", { name: "Results", exact: true }).click();
  const csv = page.getByRole("button", { name: "CSV", exact: true });
  await expect(csv).toBeEnabled();
  const beforeCsv = state.downloads.length;
  await csv.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { exportFailures: string[] }).exportFailures)).toContain("Data exports require an active paid subscription. Manage your subscription in Account.");
  expect(state.downloads.length).toBe(beforeCsv);
  state.billing = live();
  const [csvDownload] = await Promise.all([page.waitForEvent("download"), csv.click()]);
  const csvText = fs.readFileSync((await csvDownload.path())!, "utf8");
  expect(csvText).toContain("Trade ID,Exit Time,Side,Quantity,Entry,Exit");
  expect(csvText).toContain("4701,2026-09-15T08:20:00Z,LONG,2,67500,67700");
  expect(csvText).toContain("Paid CSV receipt,fixture-original");
  state.billing = { ...live(), workspace_access: false, subscription_access: false, plan: null, status: "inactive" };
  await page.locator("#workspace-content").getByRole("button", { name: "Results", exact: true }).click();
  await page.locator("#workspace-content").getByRole("button", { name: "Tools", exact: true }).first().click();
  const capture = page.getByRole("button", { name: "Capture PNG", exact: true }).first();
  await expect(capture).toBeVisible();
  const before = state.downloads.length;
  await capture.click();
  await expect(page.getByRole("button", { name: "Retry PNG", exact: true }).first()).toBeVisible();
  expect(state.downloads.length).toBe(before);
  state.billing = live();
  const [png] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Retry PNG", exact: true }).first().click()]);
  expect(fs.readFileSync((await png.path())!).subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  fs.mkdirSync(artifactDir, { recursive: true });
  await expectCertifiedScreenshot(page, page.locator(".chart-stage").first(), "chart-export.png", { animations: "disabled" });
  expect(state.errors).toEqual([]);
});
