import { expect, test, type Page } from "@playwright/test";

const key = "edgelab.auth.session.v1";
const owner = (id = 219) => ({ created_at: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), token: `personal-${id}`,
  user: { id, name: "Personal workspace", email: "developer@localhost.edgelab", provider: "email", approved: true, beta_position: null,
    deployment_mode: "personal", workspace_access: true, access_expires_at: new Date(Date.now() + 3600000).toISOString(), is_beta_user: false, plan: "personal" } });
const stored = (session: ReturnType<typeof owner>) => ({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token,
  user: { ...session.user, deploymentMode: session.user.deployment_mode, workspaceAccess: session.user.workspace_access, accessExpiresAt: session.user.access_expires_at,
    isBetaUser: session.user.is_beta_user, betaPosition: session.user.beta_position } });
const tables = ["dataset_settings", "dataset_assets", "dataset_timeframes", "app_storage", "playbooks", "backtest_sessions", "positions", "orders", "trades", "executions", "trade_notes", "journal_accounts", "journal_import_runs", "canonical_trades", "canonical_executions", "journal_tags", "canonical_trade_tags", "canonical_trade_notes", "canonical_trade_screenshots", "journal_daily_notes", "journal_import_rows", "journal_import_diagnostics", "journal_backfill_checkpoints"];
const bundle = () => ({ app: "edgelab", version: 1, exported_at: new Date().toISOString(), tables: Object.fromEntries(tables.map(table => [table, []])) });
async function fixture(page: Page, signedIn = false) {
  const state = { session: owner(), enabled: true, bypass: 0, billing: 0, exports: 0, holdBypass: false, holdExport: false, release: null as (() => void) | null, finished: 0 };
  if (signedIn) await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key, value: stored(state.session) });
  await page.route("**/api/**", async route => {
    const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (endpoint.startsWith("/billing/")) { state.billing++; return route.fulfill({ status: 503, json: { detail: "Unexpected billing call" } }); }
    if (endpoint === "/ui/rollout") return route.fulfill({ json: { revision: "personal219", kill_switch: false, flags: { public: true, shell: false, chart: false, journal: false, settings: false } } });
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: "personal", google_enabled: false, google_client_id: null, google_redirect_uri: null, manual_access_enabled: false, dev_auth_bypass_enabled: state.enabled } });
    if (endpoint === "/auth/beta/status") return route.fulfill({ json: { mode: "personal", seats_total: 500, seats_taken: 0, seats_remaining: 500, waitlist_count: 0 } });
    if (endpoint === "/auth/dev/bypass") {
      expect(route.request().method()).toBe("POST"); state.bypass++;
      if (state.holdBypass) await new Promise<void>(resolve => { state.release = resolve; });
      await route.fulfill({ json: { session: state.session, program: { mode: "personal", seats_total: 500, seats_taken: 0, seats_remaining: 500, waitlist_count: 0 } } }); state.finished++; return;
    }
    if (endpoint === "/auth/session") {
      if (route.request().method() === "DELETE") return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: state.session });
    }
    if (endpoint === "/app-data/export") {
      state.exports++; expect(route.request().headers().authorization).toBe(`Bearer ${state.session.token}`);
      if (state.holdExport) await new Promise<void>(resolve => { state.release = resolve; });
      await route.fulfill({ json: bundle() }); state.finished++; return;
    }
    return route.fulfill({ json: {} });
  });
  return state;
}
async function noPurchase(page: Page) {
  await expect(page.locator("main")).not.toContainText(/Google|Stripe|subscription|waitlist|seats|View plans/i);
}

test("personal pricing opens local sign-in and an owned local workspace", async ({ page }) => {
  const state = await fixture(page); await page.goto("/pricing");
  await expect(page).toHaveURL(/\/auth\/signin/); await noPurchase(page);
  await expect(page.getByRole("button", { name: "Open workspace", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Open workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Workspace home", exact: true })).toBeVisible();
  expect(state.bypass).toBe(1); expect(state.billing).toBe(0);
});

test("local access follows server config and cannot start when disabled", async ({ page }) => {
  const state = await fixture(page); state.enabled = false; await page.goto("/auth/signin");
  await expect(page.getByRole("button", { name: "Open workspace", exact: true })).toBeDisabled();
  await expect(page.getByText(/Local workspace access is unavailable/)).toBeVisible(); await noPurchase(page);
  expect(state.bypass).toBe(0); expect(state.billing).toBe(0);
});

test("delayed local sign-in cannot overwrite an anonymous A to B to A transition", async ({ page }) => {
  const state = await fixture(page); state.holdBypass = true; await page.goto("/auth/signin");
  await page.getByRole("button", { name: "Open workspace", exact: true }).click(); await expect.poll(() => state.release !== null).toBe(true);
  await page.evaluate(async value => {
    const path = "/src/lib/authSession.ts"; const auth = await import(path);
    auth.setStoredAuthSession(value); auth.clearStoredAuthSession();
  }, stored({ ...owner(220), user: { ...owner(220).user, workspace_access: false } }));
  state.release!(); await expect.poll(() => state.finished).toBe(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  await expect(page.getByRole("button", { name: "Open workspace", exact: true })).toBeEnabled();
  expect(state.billing).toBe(0);
});

test("personal account exports owned JSON and rechecks server revocation without billing", async ({ page }) => {
  const state = await fixture(page, true); await page.goto("/account"); await noPurchase(page);
  const exportButton = page.getByRole("button", { name: "Export data", exact: true }); await expect(exportButton).toBeEnabled();
  const download = page.waitForEvent("download"); await exportButton.click(); expect((await download).suggestedFilename()).toBe("edgelab-data.json");
  expect(state.exports).toBe(1); state.session.user.workspace_access = false;
  await exportButton.click(); await expect(page.getByRole("alert").filter({ hasText: /local workspace session/ })).toBeVisible();
  await expect(exportButton).toBeDisabled(); expect(state.exports).toBe(1); expect(state.billing).toBe(0);
});

test("personal settings export keeps account generation barriers across A to B to A", async ({ page }) => {
  const state = await fixture(page, true); state.holdExport = true; const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.goto("/app/settings/storage"); await expect(page.getByRole("heading", { name: "Storage settings", exact: true })).toBeVisible();
  await noPurchase(page); const exportButton = page.getByRole("button", { name: "Download export", exact: true }); await expect(exportButton).toBeEnabled();
  await exportButton.click(); await expect.poll(() => state.release !== null).toBe(true);
  await page.evaluate(async value => {
    const path = "/src/lib/authSession.ts"; const auth = await import(path), original = auth.getStoredAuthSession();
    auth.setStoredAuthSession(value); auth.setStoredAuthSession(original);
  }, stored(owner(220)));
  state.release!(); await expect.poll(() => state.finished).toBe(1);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(downloads).toEqual([]); expect(state.billing).toBe(0);
});

test("denied personal workspace returns to local sign-in without pricing", async ({ page }) => {
  const state = await fixture(page, true); state.session.user.workspace_access = false;
  await page.goto("/app/settings/storage"); await expect(page).toHaveURL(/\/auth\/signin/);
  await expect(page.getByRole("heading", { name: "Your personal workspace.", exact: true })).toBeVisible();
  await noPurchase(page); expect(state.billing).toBe(0);
});
