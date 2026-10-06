import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { betaSessionResponse, certifyUiState, gotoStable } from "./support/app";
import { installJournalFixture, noteCanary, noteDate, reviewCanary, reviewPath, seedAccount, seedTrade } from "./support/compatibility-journal";

test.use({ video: "off" });
type State = Awaited<ReturnType<typeof installJournalFixture>>;
const dashboard = "/app/journal/dashboard";
const secondAccount = { ...seedAccount, id: seedAccount.id + 1, name: "Second dashboard desk", initial_balance: 10000 };
const editor = (page: Page) => page.getByRole("textbox", { name: "Session reflection", exact: true });
const date = (page: Page) => page.getByLabel("Date", { exact: true });
const save = (page: Page) => page.getByRole("button", { name: /^(Save note|Retry save|Retry|Saving…)$/ });
const metric = (page: Page, name: string) => page.locator("dt").filter({ hasText: new RegExp(`^${name}$`) }).locator("..").locator("dd").first();
const section = (page: Page, name: string) => page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) }).last();
const path = (day = noteDate, account: number | null = null, trade?: number) =>
  `${dashboard}#journal/dashboard?date=${day}${account == null ? "" : `&account=${account}`}${trade == null ? "" : `&trade=${trade}&return=dashboard`}`;
const expectedWrite = (body: string, day = noteDate, account: number | null = null) => ({
  method: "PUT", path: `/api/journal/daily-notes/${day}`, body: { account_id: account, body },
});
async function fixture(page: Page) {
  const state = await installJournalFixture(page);
  state.accounts.push({ ...secondAccount });
  state.tradePage = [structuredClone(seedTrade),
    { ...structuredClone(seedTrade), id: seedTrade.id + 1, symbol: "LOSSUSD", entry_time: "2026-09-15T11:00:00Z", exit_time: "2026-09-15T12:00:00Z",
      net_pnl: -50, gross_pnl: -45, quantity: 10, stop_loss: null },
    { ...structuredClone(seedTrade), id: seedTrade.id + 2, account_id: secondAccount.id, symbol: "SECONDUSD",
      entry_time: "2026-09-15T13:00:00Z", exit_time: "2026-09-15T14:00:00Z", net_pnl: 55, gross_pnl: 60, quantity: 1, planned_stop_loss: 50 },
    { ...structuredClone(seedTrade), id: seedTrade.id + 3, account_id: secondAccount.id, symbol: "FOURTHUSD",
      entry_time: "2026-09-16T09:00:00Z", exit_time: "2026-09-16T10:00:00Z", net_pnl: 5, gross_pnl: 10, quantity: 1, stop_loss: null }];
  return state;
}
async function start(page: Page, state: State, url = path(), fallback = true) {
  state.fallback = fallback;
  await gotoStable(page, url, { waitForNetworkIdle: false });
  if (await page.locator('[data-route-group="journal"]').getAttribute("data-ui-version") !== (fallback ? "fallback" : "v2")) await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function switchRenderer(page: Page, state: State, fallback: boolean, hot = false) {
  state.fallback = fallback;
  if (hot) await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  else await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function changeHash(page: Page, day: string, account: number | null = null, available = true) {
  await page.evaluate((hash) => { location.hash = hash; }, path(day, account).split("#")[1]);
  if (available) await expect(date(page)).toHaveValue(day);
}
async function complete(page: Page, count = "4", net = "$205.00") {
  await expect(page.getByRole("heading", { name: "Trading overview", exact: true })).toBeVisible();
  await expect.poll(async () => Number((await metric(page, "Trades").innerText()).replaceAll(",", ""))).toBe(Number(count.replaceAll(",", "")));
  await expect(metric(page, "Net P&L")).toHaveText(net);
}
async function saveBody(page: Page, body: string) {
  await editor(page).fill(body);
  await save(page).click();
  await expect(editor(page)).toBeEnabled();
  await expect(save(page)).toBeDisabled();
}
async function capture(page: Page, info: TestInfo, fallback: boolean) {
  if (process.env.EDGELAB_DASHBOARD_CAPTURE !== "1" || !["desktop", "mobile"].includes(info.project.name)) return;
  const target = page.getByRole("heading", { name: "Trading overview", exact: true });
  await page.evaluate(() => { window.scrollTo(0, 0); const workspace = document.querySelector<HTMLElement>("#workspace-content"); if (workspace) workspace.scrollTop = 0; });
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();
  const capturePath = `.impeccable/review/compatibility-journal-dashboard-${fallback ? "fallback" : "modern"}-${info.project.name}.png`;
  const pixels = await page.screenshot({ animations: "disabled", path: capturePath });
  const viewport = await page.evaluate(() => ({
    url: location.href, scrollY, viewport: { width: innerWidth, height: innerHeight }, documentHeight: document.documentElement.scrollHeight,
    workspace: (() => { const node = document.querySelector<HTMLElement>("#workspace-content"); return node ? {
      clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop,
    } : null; })(),
  }));
  await info.attach("compatibility-journal-dashboard-capture", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    path: capturePath, dimensions: { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) },
    renderer: fallback ? "fallback" : "modern", captureMode: "viewport from native document top with Trading overview visible", ...viewport,
  })) });
}

for (const initiallyFallback of [true, false]) for (const account of [null, seedAccount.id]) {
  test(`dashboard ${initiallyFallback ? "fallback-modern-fallback" : "modern-fallback-modern"} ${account == null ? "shared" : "account"} reflection exact PUT survives interfaces and empty-body replacement`, async ({ page }) => {
    const state = await fixture(page);
    await start(page, state, path(noteDate, account), initiallyFallback);
    await expect(editor(page)).toHaveValue(account == null ? "Seed shared day note" : "Seed account day note");
    await saveBody(page, noteCanary);
    expect(state.noteWrites).toEqual([expectedWrite(noteCanary, noteDate, account)]);
    for (const fallback of [!initiallyFallback, initiallyFallback]) {
      await switchRenderer(page, state, fallback);
      await expect(editor(page)).toHaveValue(noteCanary);
      await expect(date(page)).toHaveValue(noteDate);
      await expect(page).toHaveURL(new RegExp(`date=${noteDate}`));
    }
    await saveBody(page, "");
    expect(state.noteWrites).toEqual([expectedWrite(noteCanary, noteDate, account), expectedWrite("", noteDate, account)]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(editor(page)).toHaveValue("");
    await expect(save(page)).toBeDisabled();
  });
}

test("dashboard shared, account and date reflection drafts stay independent across reload and interface switches", async ({ page }) => {
  const state = await fixture(page);
  await start(page, state);
  await editor(page).fill("Unsaved shared dashboard reflection");
  await changeHash(page, noteDate, seedAccount.id);
  await expect(editor(page)).toHaveValue("Seed account day note");
  await editor(page).fill("Unsaved first account dashboard reflection");
  await date(page).fill("2026-09-16");
  await expect(editor(page)).toHaveValue("");
  await editor(page).fill("Unsaved next-day reflection");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editor(page)).toHaveValue("Unsaved next-day reflection");
  await switchRenderer(page, state, false);
  await expect(editor(page)).toHaveValue("Unsaved next-day reflection");
  await changeHash(page, noteDate, seedAccount.id);
  await expect(editor(page)).toHaveValue("Unsaved first account dashboard reflection");
  await page.getByRole("combobox", { name: "Account scope", exact: true }).selectOption("all");
  await changeHash(page, noteDate);
  await expect(editor(page)).toHaveValue("Unsaved shared dashboard reflection");
  await saveBody(page, "Unsaved shared dashboard reflection");
  expect(state.noteWrites).toEqual([expectedWrite("Unsaved shared dashboard reflection")]);
  await switchRenderer(page, state, true);
  await changeHash(page, noteDate, seedAccount.id);
  await expect(editor(page)).toHaveValue("Unsaved first account dashboard reflection");
});

test("dashboard failed reflection retains text and hot pending acknowledgement locks one write and merges saved body", async ({ page }) => {
  const state = await fixture(page);
  await start(page, state);
  state.failNote = true;
  await editor(page).fill(noteCanary);
  await save(page).click();
  await expect(page.getByText(/Save failed|could not be saved|changes are kept/).first()).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(editor(page)).toHaveValue(noteCanary);
  state.failNote = false;
  await switchRenderer(page, state, false);
  let release!: () => void;
  state.noteGate = new Promise<void>((resolve) => { release = resolve; });
  await save(page).click();
  await expect.poll(() => state.noteWrites.length).toBe(2);
  const url = page.url();
  await switchRenderer(page, state, true, true);
  await expect(editor(page)).toHaveValue(noteCanary);
  await expect(editor(page)).toBeDisabled();
  await expect(save(page)).toBeDisabled();
  expect(state.noteWrites).toHaveLength(2);
  release();
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue(noteCanary);
  await expect(save(page)).toBeDisabled();
  await expect(page).toHaveURL(url);
  expect(state.noteWrites).toEqual([expectedWrite(noteCanary), expectedWrite(noteCanary)]);
  expect(state.notes.filter((note) => note.note_date === noteDate && note.account_id == null)).toHaveLength(1);
});

test("dashboard hand-calculated KPIs, equity, risk, calendar and nine comparison lenses retain selected accounts", async ({ page }, info) => {
  const state = await fixture(page);
  await start(page, state);
  await complete(page);
  for (const [name, value] of [["Gross P&L", "$225.00"], ["Balance", "$35,205.00"], ["Costs", "$20.00"],
    ["Profit factor", "5.10"], ["Win rate", "75.0%"], ["Drawdown", "$50.00"], ["Stop coverage", "50%"], ["Oversized trades", "1"], ["Discipline score", "63/100"], ["Planned-stop adherence", "100%"], ["Size after losses", "0"]]) {
    await expect(metric(page, name)).toHaveText(value);
  }
  await expect(page.getByRole("img", { name: "Equity moved from 35195.00 to 35205.00", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edge Score", exact: true })).toBeVisible();
  await expect(section(page, "Edge Score").getByText(/^83(?:\/100)?$/)).toBeVisible();
  await expect(page.getByRole("grid", { name: "Recent trading days", exact: true }).getByRole("gridcell")).toHaveCount(42);
  await expect(page.getByRole("gridcell", { name: noteDate, exact: true })).toHaveAttribute("aria-selected", "true");
  const comparison = section(page, "Account comparison");
  await expect(comparison).toContainText("No implicit FX conversion");
  await expect(comparison).toContainText("$145.00");
  await expect(comparison).toContainText("$60.00");
  for (const lens of ["Direction", "Market", "Symbol", "Time", "Hold", "Size", "Tag", "Rating", "Strategy"]) {
    await expect(comparison.getByRole("rowheader", { name: lens, exact: true })).toHaveCount(1);
  }
  await page.getByRole("combobox", { name: "First comparison account", exact: true }).selectOption(String(secondAccount.id));
  await page.getByRole("combobox", { name: "Second comparison account", exact: true }).selectOption(String(seedAccount.id));
  await capture(page, info, true);
  await certifyUiState(page);
  await switchRenderer(page, state, false);
  await complete(page);
  await expect(page.getByRole("combobox", { name: "First comparison account", exact: true })).toHaveValue(String(secondAccount.id));
  await expect(page.getByRole("combobox", { name: "Second comparison account", exact: true })).toHaveValue(String(seedAccount.id));
  await expect(page.getByRole("img", { name: "Second dashboard desk equity curve in USD", exact: true })).toBeVisible();
  await capture(page, info, false);
  await certifyUiState(page);
});

async function largeHistory(page: Page) {
  const state = await fixture(page);
  state.accounts[1].initial_balance = 25000;
  state.trade = { ...structuredClone(seedTrade), account_id: secondAccount.id, symbol: "OLDLOSS", quantity: 100, stop_loss: null,
    entry_time: "2026-09-01T09:00:00Z", exit_time: "2026-09-01T10:00:00Z", net_pnl: -750, gross_pnl: -749, commission: 1, fees: 0 };
  state.tradePage = [...Array.from({ length: 1050 }, (_, index) => ({
    ...structuredClone(seedTrade), id: 10000 + index * 3, symbol: `RECENT${index}`, quantity: 1,
    net_pnl: 1, gross_pnl: 2, commission: 1, fees: 0,
  })), structuredClone(state.trade)];
  return state;
}

test("dashboard complete1051 history affects older-loss metrics, equity, risk, comparison and bounded recent/pending rows", async ({ page }) => {
  const state = await largeHistory(page);
  await start(page, state);
  await complete(page, "1,051", "$300.00");
  await expect(metric(page, "Drawdown")).toHaveText("$750.00");
  await expect(metric(page, "Oversized trades")).toHaveText("1");
  await expect(page.getByRole("img", { name: "Equity moved from 49250.00 to 50300.00", exact: true })).toBeVisible();
  expect(new Set(state.historyReads.flatMap(({ ids }) => ids)).size).toBe(1051);
  expect(state.backfills).toBe(0);
  await expect(section(page, "Recent trades").locator("[data-trade-id]")).toHaveCount(8);
  await expect(section(page, "Review queue").locator("[data-trade-id]")).toHaveCount(12);
  await expect(section(page, "Review queue").getByText(/1,?051 awaiting review/)).toBeVisible();
  await expect(section(page, "Account comparison")).toContainText("-$750.00");
  await switchRenderer(page, state, false);
  await complete(page, "1,051", "$300.00");
  await expect(metric(page, "Drawdown")).toHaveText("$750.00");
});

test("dashboard first later-page failure exposes no performance, retry completes and failed refresh keeps complete results", async ({ page }) => {
  const state = await largeHistory(page);
  state.failHistoryLater = true;
  await start(page, state);
  await expect(page.getByRole("alert").filter({ hasText: "Complete history page unavailable" })).toBeVisible();
  await expect(metric(page, "Trades")).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  state.failHistoryLater = false;
  await page.getByRole("button", { name: /^Refresh [Jj]ournal$/, exact: true }).click();
  await complete(page, "1,051", "$300.00");
  state.failHistoryLater = true;
  await page.getByRole("button", { name: /^Refresh [Jj]ournal$/, exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Complete history page unavailable" })).toBeVisible();
  await complete(page, "1,051", "$300.00");
  await expect(editor(page)).toBeEnabled();
});

test("dashboard mounted explicit dates and unavailable account scope never save to a normalized or unowned context", async ({ page }) => {
  const state = await fixture(page);
  await start(page, state, path(noteDate, seedAccount.id));
  await editor(page).fill("Owned date draft");
  await changeHash(page, "2026-09-16", seedAccount.id);
  await expect(editor(page)).toHaveValue("");
  await changeHash(page, noteDate, seedAccount.id);
  await expect(editor(page)).toHaveValue("Owned date draft");
  for (const fallback of [true, false]) {
    if (!fallback) await switchRenderer(page, state, false);
    await page.evaluate((hash) => { location.hash = hash; }, path("2026-02-30", seedAccount.id).split("#")[1]);
    await expect(page.getByRole("alert").filter({ hasText: /valid date|unavailable/ })).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
    await expect(save(page)).toHaveCount(0);
    await expect(metric(page, "Net P&L")).toHaveCount(0);
    await changeHash(page, noteDate, 999999, false);
    await expect(page.getByRole("alert").filter({ hasText: /account|scope/ })).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
    await expect(save(page)).toHaveCount(0);
    await expect(metric(page, "Net P&L")).toHaveCount(0);
    await changeHash(page, noteDate, seedAccount.id);
    await expect(editor(page)).toHaveValue("Owned date draft");
    await expect(editor(page)).toBeEnabled();
  }
  expect(state.noteWrites).toHaveLength(0);
});

test("dashboard canonical trade review preserves explicit reflection date and account on save and close", async ({ page }) => {
  const state = await fixture(page);
  await start(page, state, path(noteDate, seedAccount.id));
  await page.getByRole("button", { name: `Review BTCUSDT trade ${seedTrade.id}`, exact: true }).first().click();
  const form = page.getByRole("form", { name: "Review BTCUSDT", exact: true });
  await form.getByRole("checkbox", { name: "Reviewed", exact: true }).check();
  await form.getByRole("combobox", { name: "Rating", exact: true }).selectOption("4");
  await form.getByRole("combobox", { name: "Setup grade", exact: true }).selectOption("A+");
  await form.getByRole("textbox", { name: "Review note", exact: true }).fill(reviewCanary.note);
  await form.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("");
  expect(state.reviews).toEqual([{ method: "PATCH", path: reviewPath, body: reviewCanary }]);
  await form.getByRole("button", { name: "Close review", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`date=${noteDate}.*account=${seedAccount.id}`));
  await expect(page).not.toHaveURL(/trade=/);
  await expect(editor(page)).toHaveValue("Seed account day note");
  await start(page, state, path(noteDate, seedAccount.id, seedTrade.id), false);
  const drawer = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review BTCUSDT", exact: true }) });
  await expect(drawer.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);
  const selectedUrl = page.url();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(drawer.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);
  await expect(page).toHaveURL(selectedUrl);
  await switchRenderer(page, state, true, true);
  await expect(form.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);
  await expect(page).toHaveURL(selectedUrl);
  await switchRenderer(page, state, false, true);
  await expect(drawer.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);
  await expect(page).toHaveURL(selectedUrl);
  await drawer.getByRole("button", { name: /^Close review and return to / }).click();
  await expect(page).toHaveURL(new RegExp(`date=${noteDate}.*account=${seedAccount.id}`));
  await expect(page).not.toHaveURL(/trade=/);
  await expect(editor(page)).toHaveValue("Seed account day note");
});

test("dashboard mixed or funded-empty foreign currencies and trade/account currency mismatch withhold monetary conclusions", async ({ page }) => {
  const state = await fixture(page);
  state.accounts.push({ ...seedAccount, id: seedAccount.id + 2, name: "Empty funded EUR desk", currency: "EUR", initial_balance: 9000 });
  state.accounts.push({ ...seedAccount, id: seedAccount.id + 3, name: "Empty funded JPY desk", currency: "JPY", initial_balance: 100000 });
  await start(page, state);
  for (const fallback of [true, false]) {
    if (!fallback) await switchRenderer(page, state, false);
    await expect(metric(page, "Net P&L")).toHaveText("Separate currencies");
    await expect(metric(page, "Balance")).toHaveText("Separate currencies");
    await expect(metric(page, "Profit factor")).toHaveText("Separate currencies");
    await expect(section(page, "Edge Score")).toContainText(/same currency|one currency|Separate currencies/);
    await expect(section(page, "Equity curve").getByRole("img")).toHaveCount(0);
  }
  state.accounts = state.accounts.slice(0, 2);
  state.trade.currency = "JPY";
  await start(page, state);
  const comparison = section(page, "Account comparison");
  const firstColumn = comparison.locator("div").filter({ has: page.getByRole("combobox", { name: "First comparison account", exact: true }) }).last();
  const secondColumn = comparison.locator("div").filter({ has: page.getByRole("combobox", { name: "Second comparison account", exact: true }) }).last();
  await expect(firstColumn).toContainText("Separate currencies");
  await expect(firstColumn.locator("dt").filter({ hasText: /^Profit factor$/ }).locator("..").locator("dd")).toHaveText("Separate currencies");
  await expect(firstColumn.getByRole("img")).toHaveCount(0);
  await expect(secondColumn).toContainText("$60.00");
  await start(page, state, path(noteDate, seedAccount.id));
  await expect(metric(page, "Net P&L")).toHaveText("Separate currencies");
  await expect(metric(page, "Profit factor")).toHaveText("Separate currencies");
  await expect(section(page, "Edge Score")).toContainText(/same currency|one currency|Separate currencies/);
  await switchRenderer(page, state, false);
  await expect(metric(page, "Net P&L")).toHaveText("Separate currencies");
  await expect(metric(page, "Profit factor")).toHaveText("Separate currencies");
});

test("the bare Journal route preserves its incumbent modern dashboard alias and generic fallback boundary", async ({ page }) => {
  const state = await fixture(page);
  await start(page, state, "/app/journal", false);
  await expect(page.getByRole("heading", { name: "Trading overview", exact: true })).toBeVisible();
  await switchRenderer(page, state, true);
  await expect(page.getByRole("status").filter({ hasText: /recent trades available/ })).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Trading overview", exact: true })).toHaveCount(0);
});

test("previous unscoped dashboard reflection is recovered read-only without overwriting canonical scoped notes", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Legacy reflection recovery is independent of viewport.");
  const state = await fixture(page);
  await start(page, state, path(noteDate, seedAccount.id));
  const previous = { __schemaVersion: 1, value: { date: noteDate, body: "Earlier editor private reflection" } };
  await page.evaluate(async (draft) => {
    const modulePath = "/src/lib/navigationState.ts";
    const { updateNavigationState } = await import(modulePath);
    updateNavigationState("journal:dashboard", { draft });
  }, previous);
  await page.reload({ waitUntil: "domcontentloaded" });
  for (const fallback of [true, false]) {
    if (!fallback) await switchRenderer(page, state, false);
    await expect(page.getByRole("textbox", { name: "Recovered reflection", exact: true })).toHaveValue(previous.value.body);
    await expect(page.getByRole("textbox", { name: "Recovered reflection", exact: true })).toHaveAttribute("readonly", "");
    await expect(editor(page)).toHaveValue("Seed account day note");
  }
  expect(state.noteWrites).toHaveLength(0);
});

test("mounted dashboard owner change drops private notes, comparison selectors and canonical account cache", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Mounted owner isolation is independent of viewport.");
  const state = await fixture(page);
  let owner = betaSessionResponse.user.id;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ...betaSessionResponse, user: { ...betaSessionResponse.user, id: owner } } }));
  await start(page, state);
  await editor(page).fill("Owner one dashboard draft");
  let release!: () => void;
  state.noteGate = new Promise<void>((resolve) => { release = resolve; });
  await save(page).click();
  await expect.poll(() => state.noteWrites.length).toBe(1);
  owner++;
  state.tradePage = [];
  state.accountPage = [{ ...seedAccount, id: 90001, name: "Owner two dashboard account" }];
  state.notePage = [];
  await page.evaluate(async (session) => {
    const modulePath = "/src/lib/authSession.ts";
    const { setStoredAuthSession } = await import(modulePath);
    setStoredAuthSession(session);
  }, { createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at, token: `dashboard-owner-${owner}`,
    user: { approved: true, betaPosition: null, email: betaSessionResponse.user.email, id: owner,
      isBetaUser: true, name: "Second dashboard owner", plan: "beta", provider: "google" } });
  await complete(page, "0", "$0.00");
  await expect(editor(page)).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "First comparison account", exact: true })).toHaveCount(0);
  await expect(page.getByText(secondAccount.name, { exact: true })).toHaveCount(0);
  const response = page.waitForResponse((result) => new URL(result.url()).pathname === `/api/journal/daily-notes/${noteDate}` && result.request().method() === "PUT");
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(editor(page)).toHaveValue("");
  await expect(save(page)).toBeDisabled();
  expect(state.noteWrites).toEqual([expectedWrite("Owner one dashboard draft")]);
});

test("dashboard selected-account scope persists its exact canonical storage value and survives both interfaces", async ({ page }) => {
  const state = await fixture(page);
  let stored: { mode: string; accountIds: number[] } = { mode: "all", accountIds: [] };
  const writes: Array<{ value: typeof stored }> = [];
  await page.route("**/api/app-storage/edgelab/journal-account-scope.v1", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      writes.push(payload);
      stored = payload.value;
    }
    await route.fulfill({ json: { namespace: "edgelab", key: "journal-account-scope.v1", value: stored, updated_at: seedTrade.updated_at } });
  });
  await start(page, state);
  await complete(page);
  await page.getByRole("combobox", { name: "Account scope", exact: true }).selectOption("SELECTED");
  await page.getByRole("checkbox", { name: new RegExp(secondAccount.name) }).check();
  await page.getByRole("checkbox", { name: new RegExp(seedAccount.name) }).uncheck();
  await expect.poll(() => stored).toEqual({ mode: "selected", accountIds: [secondAccount.id] });
  expect(writes.at(-1)).toEqual({ value: { mode: "selected", accountIds: [secondAccount.id] } });
  await expect(metric(page, "Net P&L")).toHaveText("$60.00");
  await switchRenderer(page, state, false);
  await expect(page.getByRole("combobox", { name: "Account scope", exact: true })).toHaveValue(String(secondAccount.id));
  await expect(metric(page, "Net P&L")).toHaveText("$60.00");
  await page.getByRole("combobox", { name: "Account scope", exact: true }).selectOption("all");
  await expect.poll(() => stored).toEqual({ mode: "all", accountIds: [] });
  await switchRenderer(page, state, true);
  await complete(page);
  await expect(editor(page)).toHaveValue("Seed shared day note");
});

test("late dashboard reflection acknowledgement cannot replace the newly selected date-account draft or URL", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Delayed shared-key acknowledgements are independent of viewport.");
  const state = await fixture(page);
  await start(page, state, path(noteDate, seedAccount.id), false);
  let release!: () => void;
  state.noteGate = new Promise<void>((resolve) => { release = resolve; });
  await editor(page).fill("Saved first-date first-account reflection");
  await save(page).click();
  await expect.poll(() => state.noteWrites.length).toBe(1);
  await switchRenderer(page, state, true, true);
  await expect(editor(page)).toBeDisabled();
  await changeHash(page, "2026-09-16", secondAccount.id);
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue("");
  await editor(page).fill("New date-account draft remains local");
  const url = page.url();
  const response = page.waitForResponse((result) => new URL(result.url()).pathname === `/api/journal/daily-notes/${noteDate}` && result.request().method() === "PUT");
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(editor(page)).toHaveValue("New date-account draft remains local");
  await expect(save(page)).toBeEnabled();
  await expect(page).toHaveURL(url);
  await changeHash(page, noteDate, seedAccount.id);
  await expect(editor(page)).toHaveValue("Saved first-date first-account reflection");
  await expect(save(page)).toBeDisabled();
  await changeHash(page, "2026-09-16", secondAccount.id);
  await expect(editor(page)).toHaveValue("New date-account draft remains local");
  expect(state.noteWrites).toEqual([expectedWrite("Saved first-date first-account reflection", noteDate, seedAccount.id)]);
});

test("dashboard accepted non-ISO currency remains readable in both calendar and performance views", async ({ page }) => {
  const state = await fixture(page);
  for (const account of state.accounts) account.currency = "USDT";
  state.trade.currency = "USDT";
  for (const trade of state.tradePage!) trade.currency = "USDT";
  await start(page, state);
  for (const fallback of [true, false]) {
    if (!fallback) await switchRenderer(page, state, false);
    await expect(metric(page, "Net P&L")).toContainText("USDT");
    await expect(page.getByRole("gridcell", { name: noteDate, exact: true })).toContainText(/(?:200(?:\.00)? USDT|USDT 200(?:\.00)?)/);
    await expect(editor(page)).toBeEnabled();
    await expect(date(page)).toHaveValue(noteDate);
  }
});
