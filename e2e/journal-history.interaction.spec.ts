import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { betaSessionResponse, certifyUiState, gotoStable } from "./support/app";
import { installJournalFixture, seedAccount, seedTrade } from "./support/compatibility-journal";

test.use({ video: "off" });
type State = Awaited<ReturnType<typeof installJournalFixture>>;
const olderAccount = { ...seedAccount, id: seedAccount.id + 1, name: "Older loss desk" };
const header = (page: Page) => page.locator('[data-ui-surface="journal"] > header');
const metric = (page: Page, name: string) => page.locator("dt").filter({ hasText: new RegExp(`^${name}$`) }).locator("..").locator("dd").first();
const refresh = (page: Page) => page.getByRole("button", { name: "Refresh Journal", exact: true });
const scope = (page: Page) => page.getByRole("combobox", { name: "Account scope", exact: true });
const navigate = (page: Page, name: string) => header(page).getByRole("button", { name, exact: true }).click();
async function selectSymbol(page: Page, value: string) {
  const filters = page.locator("details").filter({ has: page.getByText("Analytics filters", { exact: true }) });
  if (await filters.getAttribute("open") == null) await filters.locator("summary").click();
  await page.getByRole("combobox", { name: "Symbol", exact: true }).selectOption(value);
}
const historyCursor = (state: State) => [...state.tradePage!].sort((a, b) => b.id - a.id)[499].id;

async function historyFixture(page: Page) {
  const state = await installJournalFixture(page);
  state.fallback = false;
  state.accounts.push({ ...olderAccount });
  state.trade = { ...structuredClone(seedTrade), account_id: olderAccount.id, symbol: "OLDLOSS", entry_time: "2026-09-01T09:00:00Z", exit_time: "2026-09-01T10:00:00Z", net_pnl: -750, gross_pnl: -749, commission: 1, fees: 0, strategy_name: "Older unique loss" };
  state.tradePage = [...Array.from({ length: 1050 }, (_, index) => ({
    ...structuredClone(seedTrade), id: 10_000 + index * 3, symbol: `SYM${String(index % 251).padStart(3, "0")}`,
    net_pnl: 1, gross_pnl: 2, commission: 1, fees: 0, reviewed: true, strategy_name: "Recent profitable trades",
  })), structuredClone(state.trade)];
  return state;
}
async function start(page: Page) {
  await gotoStable(page, "/app/journal/dashboard", { waitForNetworkIdle: false });
}
async function completeDashboard(page: Page, count = "1,051", net = "$300.00") {
  await expect(metric(page, "Trades")).toHaveText(count);
  await expect(metric(page, "Net P&L")).toHaveText(net);
  await expect(refresh(page)).toBeEnabled();
}
async function gateRefresh(page: Page, state: State) {
  let release!: () => void;
  state.historyGate = new Promise<void>((resolve) => { release = resolve; });
  state.historyGateBefore = historyCursor(state);
  const before = state.historyReads.length;
  await refresh(page).click();
  await expect.poll(() => state.historyReads.slice(before).some((read) => read.before === state.historyGateBefore)).toBe(true);
  return release;
}
async function captureHistory(page: Page, testInfo: TestInfo) {
  if (process.env.EDGELAB_HISTORY_CAPTURE !== "1" || !["desktop", "mobile"].includes(testInfo.project.name)) return;
  const pages = page.getByRole("navigation", { name: "Underlying trade pages", exact: true });
  await pages.scrollIntoViewIfNeeded();
  await expect(pages).toBeInViewport();
  const path = `.impeccable/review/journal-history-${testInfo.project.name}.png`;
  const pixels = await page.screenshot({ animations: "disabled", path });
  const state = await page.evaluate(() => {
    const element = document.querySelector('[aria-label="Underlying trade pages"]');
    const workspace = document.querySelector<HTMLElement>("#workspace-content");
    const rect = element?.getBoundingClientRect();
    return { url: location.href, scrollY, viewport: { width: innerWidth, height: innerHeight }, documentHeight: document.documentElement.scrollHeight,
      workspace: workspace ? { clientHeight: workspace.clientHeight, scrollHeight: workspace.scrollHeight, scrollTop: workspace.scrollTop } : null,
      pagination: { text: element?.textContent, top: rect?.top, bottom: rect?.bottom } };
  });
  await testInfo.attach("journal-history-capture", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    path, dimensions: { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) }, ...state,
  })) });
}

test("complete history includes older losses in dashboard, account comparison, analytics, filters and review queue", async ({ page }) => {
  const state = await historyFixture(page);
  await start(page);
  await completeDashboard(page);
  expect(state.historyReads.map((read) => read.ids.length)).toEqual(expect.arrayContaining([500, 51]));
  expect(new Set(state.historyReads.flatMap((read) => read.ids)).size).toBe(1051);
  await expect(page.getByText("1 awaiting review", { exact: true })).toBeVisible();
  await navigate(page, "Accounts & imports");
  const older = page.locator("div.grid").filter({ has: page.getByText(olderAccount.name, { exact: true }) }).last();
  await expect(older).toContainText("-$750.00");
  await expect(older).toContainText("0.0%");
  await navigate(page, "Analytics");
  await expect(page.getByText(/1,051 matching trades/)).toBeVisible();
  await page.getByRole("tab", { name: "Symbol", exact: true }).click();
  await selectSymbol(page, "OLDLOSS");
  await expect(page.getByText(/^1 matching trades ·/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Select OLDLOSS segment", exact: true })).toBeVisible();
  await navigate(page, "Trades");
  await selectSymbol(page, "ALL");
  await page.getByRole("checkbox", { name: "Review queue", exact: true }).check();
  await expect(page.getByRole("table", { name: "Journal trades", exact: true }).locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("table", { name: "Journal trades", exact: true })).toContainText("OLDLOSS");
  await selectSymbol(page, "OLDLOSS");
  await expect(page.getByRole("combobox", { name: "Symbol", exact: true })).toHaveValue("OLDLOSS");
});

test("later-page failure never exposes initial partial metrics, retry completes, and failed refresh keeps the complete snapshot", async ({ page }) => {
  const state = await historyFixture(page);
  state.failHistoryLater = true;
  await start(page);
  await expect(page.getByRole("heading", { name: "Journal could not update", exact: true })).toBeVisible();
  await expect(metric(page, "Trades")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Trading overview", exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Queue clear\./)).toHaveCount(0);
  await expect(page.getByText(/^\d+ awaiting review$/)).toHaveCount(0);
  await expect(page.getByText("Load complete Journal history to see the review queue.", { exact: true })).toBeVisible();
  state.failHistoryLater = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await completeDashboard(page);
  await expect.poll(() => state.backfills).toBe(1);
  state.failHistoryLater = true;
  await refresh(page).click();
  await expect(page.getByRole("heading", { name: "Journal could not update", exact: true })).toBeVisible();
  await completeDashboard(page);
  expect(state.backfills).toBe(1);
  state.failHistoryLater = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await completeDashboard(page);
  await expect(page.getByRole("heading", { name: "Journal could not update", exact: true })).toHaveCount(0);
});

test("analytics bounds252 symbol segments and1051 underlying trades, resets filter/dimension contexts and exposes page controls", async ({ page }, testInfo) => {
  await historyFixture(page);
  await start(page);
  await completeDashboard(page);
  await navigate(page, "Analytics");
  await page.getByRole("tab", { name: "Symbol", exact: true }).click();
  const segments = page.getByRole("navigation", { name: "Performance segment pages", exact: true });
  await expect(segments).toContainText("Page 1 of 3");
  await expect(segments).toContainText("252 segments");
  await expect(page.getByRole("button", { name: /^Select .* segment$/ })).toHaveCount(100);
  await segments.getByRole("button", { name: "Next 100 segments", exact: true }).click();
  await expect(segments).toContainText("Page 2 of 3");
  await segments.getByRole("button", { name: "Next 100 segments", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Select .* segment$/ })).toHaveCount(52);
  await expect(segments).toContainText("Page 3 of 3");
  await page.getByRole("tab", { name: "Direction", exact: true }).click();
  await page.getByRole("tab", { name: "Symbol", exact: true }).click();
  await expect(segments).toContainText("Page 1 of 3");
  await selectSymbol(page, "OLDLOSS");
  await expect(segments).toHaveCount(0);
  await selectSymbol(page, "ALL");
  await expect(segments).toContainText("Page 1 of 3");
  await page.getByRole("tab", { name: "Direction", exact: true }).click();
  await page.getByRole("button", { name: "Select Long segment", exact: true }).click();
  await page.getByRole("button", { name: "View underlying trades", exact: true }).click();
  const underlying = page.locator('section[aria-labelledby="drilldown-heading"]');
  const pages = page.getByRole("navigation", { name: "Underlying trade pages", exact: true });
  await expect(pages).toContainText("Page 1 of 11");
  await expect(pages).toContainText("1,051 trades");
  await expect(underlying.locator('button').filter({ hasText: /SYM|OLDLOSS/ })).toHaveCount(100);
  await pages.getByRole("button", { name: "Next 100 trades", exact: true }).click();
  await expect(pages).toContainText("Page 2 of 11");
  await captureHistory(page, testInfo);
  await certifyUiState(page);
  for (let index = 2; index < 11; index++) await pages.getByRole("button", { name: "Next 100 trades", exact: true }).click();
  await expect(pages).toContainText("Page 11 of 11");
  await expect(underlying.locator('button').filter({ hasText: /SYM|OLDLOSS/ })).toHaveCount(51);
  await expect(underlying).toContainText("OLDLOSS");
  await page.getByRole("button", { name: "Back to breakdown", exact: true }).click();
  await page.getByRole("button", { name: "View underlying trades", exact: true }).click();
  await expect(pages).toContainText("Page 1 of 11");
});

test("archived older foreign-currency accounts retain metadata, withheld mixed totals and correct scoped currency", async ({ page }) => {
  const state = await historyFixture(page);
  state.accounts[1] = { ...state.accounts[1], status: "ARCHIVED", currency: "EUR", name: "Archived euro loss desk" };
  state.trade = { ...state.trade, currency: "EUR" };
  await start(page);
  await expect(metric(page, "Trades")).toHaveText("1,051");
  await expect(metric(page, "Net P&L")).toHaveText("Separate currencies");
  expect(state.accountReads).toContain("true");
  await expect(scope(page).locator(`option[value="${olderAccount.id}"]`)).toContainText("Archived euro loss desk");
  await navigate(page, "Analytics");
  await expect(page.locator("[data-analytics-mixed-currency]")).toContainText("USD, EUR");
  await scope(page).selectOption(String(olderAccount.id));
  await expect(page.getByText(/^1 matching trades ·/)).toBeVisible();
  await expect(page.locator("[data-analytics-mixed-currency]")).toHaveCount(0);
  await navigate(page, "Overview");
  await expect(metric(page, "Trades")).toHaveText("1");
  await expect(metric(page, "Net P&L")).toHaveText("-€750.00");
});

test("late history pages preserve confirmed earlier-page reviews and superseded refreshes cannot roll newer data back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Mounted race is independent of viewport.");
  const state = await historyFixture(page);
  await start(page);
  await completeDashboard(page);
  const failed: string[] = [];
  page.on("requestfailed", (request) => { if (request.url().includes("/journal/trades?") && request.url().includes("order=id")) failed.push(request.url()); });
  const release = await gateRefresh(page, state);
  await page.getByRole("button", { name: /^OLDLOSS Pending/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("switch", { name: "Trade reviewed", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Review note", exact: true }).fill("Confirmed while a later history page is pending");
  await dialog.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  release();
  state.historyGate = null;
  await completeDashboard(page);
  await expect(page.getByText("0 awaiting review", { exact: true })).toBeVisible();

  const releaseOld = await gateRefresh(page, state);
  await navigate(page, "Trades");
  await selectSymbol(page, "OLDLOSS");
  await page.getByRole("table", { name: "Journal trades", exact: true }).getByRole("button", { name: "OLDLOSS", exact: true }).click();
  await expect(dialog.getByRole("switch", { name: "Trade reviewed", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText("Confirmed while a later history page is pending");
  state.trade = { ...state.trade, net_pnl: -900, updated_at: "2026-09-16T12:00:00Z" };
  state.historyGate = null;
  await dialog.getByRole("textbox", { name: "New tag name", exact: true }).fill("Starts a newer complete load");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(() => failed.length).toBeGreaterThan(0);
  await expect(refresh(page)).toBeEnabled();
  await dialog.getByRole("button", { name: /^Close review and return to / }).click();
  await navigate(page, "Overview");
  await completeDashboard(page, "1,051", "$150.00");
  releaseOld();
  await completeDashboard(page, "1,051", "$150.00");
});

test("a scope changed during history remains selected even while its remote PUT is pending", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Scope revision race is independent of viewport.");
  const state = await historyFixture(page);
  let releasePut!: () => void;
  const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
  let stored = { mode: "all", accountIds: [] as number[] };
  let pendingPuts = 0;
  await page.route("**/api/app-storage/edgelab/journal-account-scope.v1", async (route) => {
    if (route.request().method() === "PUT") {
      pendingPuts++;
      const payload = route.request().postDataJSON();
      await putGate;
      stored = payload.value;
    }
    await route.fulfill({ json: { namespace: "edgelab", key: "journal-account-scope.v1", value: stored, updated_at: "2026-09-15T12:00:00Z" } });
  });
  await start(page);
  await completeDashboard(page);
  const release = await gateRefresh(page, state);
  await scope(page).selectOption(String(olderAccount.id));
  await expect.poll(() => pendingPuts).toBe(1);
  await expect(metric(page, "Trades")).toHaveText("1");
  release();
  state.historyGate = null;
  await expect(refresh(page)).toBeEnabled();
  await expect(scope(page)).toHaveValue(String(olderAccount.id));
  await expect(metric(page, "Net P&L")).toHaveText("-$750.00");
  releasePut();
  await expect.poll(() => stored).toEqual({ mode: "selected", accountIds: [olderAccount.id] });
});

test("owner changes clear mounted canonical history and abort an old owner's active page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Owner remount privacy is independent of viewport.");
  const state = await historyFixture(page);
  let owner = betaSessionResponse.user.id;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ...betaSessionResponse, user: { ...betaSessionResponse.user, id: owner } } }));
  await start(page);
  await completeDashboard(page);
  const failed: string[] = [];
  page.on("requestfailed", (request) => { if (request.url().includes("/journal/trades?") && request.url().includes("order=id")) failed.push(request.url()); });
  const release = await gateRefresh(page, state);
  owner++;
  state.tradePage = [];
  state.accountPage = [{ ...seedAccount, id: 90_001, name: "Owner two account" }];
  state.notePage = [];
  await page.evaluate(async (session) => {
    const modulePath = "/src/lib/authSession.ts";
    const { setStoredAuthSession } = await import(modulePath);
    setStoredAuthSession(session);
  }, { createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at, token: `owner-${owner}`,
    user: { approved: true, betaPosition: null, email: betaSessionResponse.user.email, id: owner, isBetaUser: true, name: "Second owner", plan: "beta", provider: "google" } });
  await expect(metric(page, "Trades")).toHaveText("0");
  await expect(scope(page)).toContainText("Owner two account");
  await expect(scope(page)).not.toContainText(olderAccount.name);
  await expect.poll(() => failed.length).toBeGreaterThan(0);
  release();
  await expect(metric(page, "Trades")).toHaveText("0");
  await expect(page.getByText("OLDLOSS", { exact: true })).toHaveCount(0);
});


test("leaving the mounted journal aborts its unfinished history page", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Unmount cancellation is independent of viewport.");
  const state = await historyFixture(page);
  await start(page);
  await completeDashboard(page);
  const failed: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/journal/trades?") && request.url().includes("order=id")) failed.push(request.url());
  });
  const release = await gateRefresh(page, state);
  await page.getByRole("button", { name: "Trade live: Live markets", exact: true }).click();
  await expect(page.locator('[data-ui-surface="journal"]')).toHaveCount(0);
  await expect.poll(() => failed.length).toBeGreaterThan(0);
  release();
  await expect(page.locator('[data-ui-surface="journal"]')).toHaveCount(0);
});


test("a confirmed account during the initial history scan cannot expose partial metrics or onboarding", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Atomic first snapshot state is independent of viewport.");
  const state = await historyFixture(page);
  state.accounts = state.accounts.slice(0, 1);
  let release!: () => void;
  state.historyGate = new Promise<void>((resolve) => { release = resolve; });
  state.historyGateBefore = historyCursor(state);
  await start(page);
  await expect.poll(() => state.historyReads.some((read) => read.before === state.historyGateBefore)).toBe(true);
  const created = await page.evaluate(async () => {
    const modulePath = "/src/lib/journalApi.ts";
    const { createJournalAccount } = await import(modulePath);
    return createJournalAccount({ name: "Late confirmed account", currency: "USD", timezone: "UTC" });
  });
  expect(created.name).toBe("Late confirmed account");
  expect(state.creations).toHaveLength(1);
  await expect(page.getByRole("status", { name: "Loading Journal", exact: true })).toBeVisible();
  await expect(metric(page, "Trades")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Trading overview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import sample trades", exact: true })).toHaveCount(0);
  release();
  state.historyGate = null;
  await completeDashboard(page);
  await expect(scope(page)).toContainText("Late confirmed account");
});
