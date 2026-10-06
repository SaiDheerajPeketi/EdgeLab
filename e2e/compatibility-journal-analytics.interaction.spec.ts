import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { betaSessionResponse, certifyUiState, gotoStable } from "./support/app";
import { installJournalFixture, reviewCanary, reviewPath, seedAccount, seedTrade } from "./support/compatibility-journal";

test.use({ video: "off" });
type State = Awaited<ReturnType<typeof installJournalFixture>>;
const routes = ["/app/journal/analytics", "/app/journal/reports"] as const;
const dimensions = ["Market", "Symbol", "Direction", "Duration", "Size", "Strategy", "Tag", "Rating", "Grade", "Weekday", "Time of day", "Account"];
const boundary = (page: Page) => page.locator('[data-route-group="journal"]');
const review = (page: Page, fallback: boolean) => fallback ? page.getByRole("form", { name: "Review BTCUSDT", exact: true }) : page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review BTCUSDT", exact: true }) });
const drill = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Underlying trades", exact: true }) }).last();
const matching = (page: Page, count: number) => page.getByText(new RegExp(`^${count.toLocaleString()} matching trades ·`));
const saved = "Analytics canonical review canary";
async function start(page: Page, state: State, path: string, fallback = true) {
  state.fallback = fallback;
  await gotoStable(page, path, { waitForNetworkIdle: false });
  await expect(boundary(page)).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function switchRenderer(page: Page, state: State, fallback: boolean, hot = false) {
  state.fallback = fallback;
  if (hot) await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  else await page.reload({ waitUntil: "domcontentloaded" });
  await expect(boundary(page)).toHaveAttribute("data-ui-version", fallback ? "fallback" : "v2");
}
async function filters(page: Page) {
  const details = page.locator("details").filter({ has: page.getByText("Analytics filters", { exact: true }) });
  if (await details.getAttribute("open") == null) await details.locator("summary").click();
}
async function select(page: Page, label: string, value: string) {
  await filters(page);
  await page.getByRole("combobox", { name: label, exact: true }).selectOption(value);
}
async function openSeed(page: Page, fallback: boolean) {
  await page.getByRole("tab", { name: "Symbol", exact: true }).click();
  await page.getByRole("button", { name: "Select BTCUSDT segment", exact: true }).click();
  await page.getByRole("button", { name: "View underlying trades", exact: true }).click();
  const row = fallback ? drill(page).getByRole("button", { name: `Review BTCUSDT trade ${seedTrade.id}`, exact: true }) : drill(page).locator(`button[data-trade-id="${seedTrade.id}"]`);
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(review(page, fallback).getByRole("textbox", { name: "Review note", exact: true })).toBeVisible();
}
async function fillReview(page: Page, fallback: boolean, note = saved) {
  const form = review(page, fallback);
  if (fallback) {
    await form.getByRole("checkbox", { name: "Reviewed", exact: true }).check();
    await form.getByRole("combobox", { name: "Rating", exact: true }).selectOption("4");
  } else {
    await form.getByRole("switch", { name: "Trade reviewed", exact: true }).check();
    await form.getByRole("button", { name: "4 star rating", exact: true }).click();
  }
  await form.getByRole("combobox", { name: "Setup grade", exact: true }).selectOption("A+");
  await form.getByRole("textbox", { name: "Review note", exact: true }).fill(note);
}
async function assertSaved(page: Page, fallback: boolean, note = saved) {
  const form = review(page, fallback);
  if (fallback) {
    await expect(form.getByRole("checkbox", { name: "Reviewed", exact: true })).toBeChecked();
    await expect(form.getByRole("combobox", { name: "Rating", exact: true })).toHaveValue("4");
  } else {
    await expect(form.getByRole("switch", { name: "Trade reviewed", exact: true })).toBeChecked();
    await expect(form.getByRole("button", { name: "4 star rating", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(form.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
  await expect(form.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("");
  await expect(form.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(note);
}
async function largeHistory(page: Page) {
  const state = await installJournalFixture(page);
  state.trade = { ...structuredClone(seedTrade), symbol: "OLDLOSS", account_id: seedAccount.id + 1,
    entry_time: "2026-09-01T09:00:00Z", exit_time: "2026-09-01T10:00:00Z", net_pnl: -750, gross_pnl: -749, commission: 1, fees: 0 };
  state.accounts.push({ ...seedAccount, id: seedAccount.id + 1, name: "Older loss desk" });
  state.tradePage = [...Array.from({ length: 1050 }, (_, index) => ({
    ...structuredClone(seedTrade), id: 10000 + index * 3, symbol: `SYM${String(index % 251).padStart(3, "0")}`,
    reviewed: true, net_pnl: 1, gross_pnl: 2, commission: 1, fees: 0,
  })), structuredClone(state.trade)];
  return state;
}
async function capture(page: Page, info: TestInfo, route: string) {
  if (process.env.EDGELAB_ANALYTICS_CAPTURE !== "1" || !["desktop", "mobile"].includes(info.project.name)) return;
  const heading = page.getByRole("heading", { name: "Performance breakdown", exact: true });
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toBeInViewport();
  const path = `.impeccable/review/compatibility-journal-${route.endsWith("/reports") ? "reports" : "analytics"}-${info.project.name}.png`;
  const pixels = await page.screenshot({ animations: "disabled", path });
  const state = await page.evaluate(() => ({
    url: location.href, scrollY, viewport: { width: innerWidth, height: innerHeight },
    documentHeight: document.documentElement.scrollHeight,
    workspace: (() => { const element = document.querySelector<HTMLElement>("#workspace-content"); return element ? {
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
    } : null; })(),
  }));
  await info.attach("compatibility-journal-analytics-capture", { contentType: "application/json", body: Buffer.from(JSON.stringify({
    path, dimensions: { width: pixels.readUInt32BE(16), height: pixels.readUInt32BE(20) },
    captureMode: "viewport after native scroll to performance breakdown", ...state,
  })) });
}

for (const path of routes) {
  for (const initiallyFallback of [true, false]) {
    test(`${path} ${initiallyFallback ? "fallback-modern-fallback" : "modern-fallback-modern"} preserves filtered exact rows and canonical review`, async ({ page }) => {
      const state = await installJournalFixture(page);
      state.tradePage = [structuredClone(seedTrade), { ...structuredClone(seedTrade), id: seedTrade.id + 1, symbol: "ETHUSDT", reviewed: true }];
      await start(page, state, path, initiallyFallback);
      await select(page, "Symbol", "BTCUSDT");
      await expect(matching(page, 1)).toBeVisible();
      await openSeed(page, initiallyFallback);
      await fillReview(page, initiallyFallback);
      await review(page, initiallyFallback).getByRole("button", { name: "Save review", exact: true }).click();
      if (initiallyFallback) await expect(review(page, true).getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("");
      else await expect(review(page, false)).toHaveCount(0);
      await expect.poll(() => state.trade.notes.length).toBe(1);
      expect(state.reviews).toEqual([{ method: "PATCH", path: reviewPath, body: { ...reviewCanary, note: saved } }]);
      for (const fallback of [!initiallyFallback, initiallyFallback]) {
        await switchRenderer(page, state, fallback);
        if (new URLSearchParams(new URL(page.url()).hash.split("?")[1]).has("trade")) {
          await assertSaved(page, fallback);
          await review(page, fallback).getByRole("button", { name: fallback ? "Close review" : /^Close review and return to / }).click();
          await expect(review(page, fallback).getByRole("textbox", { name: "Review note", exact: true })).toHaveCount(0);
        }
        await expect(matching(page, 1)).toBeVisible();
        await filters(page);
        await expect(page.getByRole("combobox", { name: "Symbol", exact: true })).toHaveValue("BTCUSDT");
        await expect(page.getByRole("tab", { name: "Symbol", exact: true })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("button", { name: "Select BTCUSDT segment", exact: true })).toHaveAttribute("aria-pressed", "true");
        await expect(drill(page)).toContainText("BTCUSDT");
        if (await review(page, fallback).getByRole("textbox", { name: "Review note", exact: true }).count() === 0) {
          const row = fallback ? drill(page).getByRole("button", { name: `Review BTCUSDT trade ${seedTrade.id}`, exact: true }) : drill(page).locator(`button[data-trade-id="${seedTrade.id}"]`);
          await row.click();
        }
        await assertSaved(page, fallback);
        expect(state.trade.notes).toHaveLength(1);
      }
    });
  }

  test(`${path} restores every filter, account scope and all twelve dimensions across renderers`, async ({ page }) => {
    const state = await installJournalFixture(page);
    const tag = { id: 91001, name: "Patient setup", category: "SETUP" as const, color: null, archived_at: null, created_at: seedTrade.created_at };
    state.tags.push(tag);
    state.trade = { ...state.trade, rating: 3, tags: [tag] };
    state.tradePage = [structuredClone(state.trade), { ...structuredClone(seedTrade), id: seedTrade.id + 1, symbol: "ETHUSDT", side: "SHORT" }];
    await start(page, state, path);
    await page.getByRole("combobox", { name: "Account scope", exact: true }).selectOption("SELECTED");
    await expect(page.getByRole("checkbox", { name: new RegExp(seedAccount.name) })).toBeChecked();
    for (const [label, value] of [["Account", String(seedAccount.id)], ["Market", "Crypto"], ["Symbol", "BTCUSDT"],
      ["Strategy", seedTrade.strategy_name!], ["Direction", "LONG"], ["Rating", "3"]]) await select(page, label, value);
    await page.getByLabel("From", { exact: true }).fill("2026-09-15");
    await page.getByLabel("To", { exact: true }).fill("2026-09-15");
    await page.getByRole("checkbox", { name: tag.name, exact: true }).check();
    await expect(matching(page, 1)).toBeVisible();
    for (const dimension of dimensions) {
      await page.getByRole("tab", { name: dimension, exact: true }).click();
      await expect(page.getByRole("table", { name: `${dimension} performance breakdown`, exact: true }).locator("tbody tr")).toHaveCount(1);
    }
    await switchRenderer(page, state, false);
    await expect(page.getByRole("tab", { name: "Account", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("combobox", { name: "Account scope", exact: true })).toHaveValue(String(seedAccount.id));
    await filters(page);
    for (const [label, value] of [["Account", String(seedAccount.id)], ["Market", "Crypto"], ["Symbol", "BTCUSDT"],
      ["Strategy", seedTrade.strategy_name!], ["Direction", "LONG"], ["Rating", "3"]]) await expect(page.getByRole("combobox", { name: label, exact: true })).toHaveValue(value);
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-09-15");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-09-15");
    await expect(page.getByRole("checkbox", { name: tag.name, exact: true })).toBeChecked();
    await expect(matching(page, 1)).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await switchRenderer(page, state, true);
    await expect(matching(page, 2)).toBeVisible();
    await filters(page);
    await expect(page.getByRole("combobox", { name: "Symbol", exact: true })).toHaveValue("ALL");
    await expect(page.getByRole("checkbox", { name: tag.name, exact: true })).not.toBeChecked();
  });

  test(`${path} failed review retains its draft and a hot rollback locks one pending canonical write`, async ({ page }) => {
    const state = await installJournalFixture(page);
    await start(page, state, path);
    await openSeed(page, true);
    await fillReview(page, true);
    state.failReview = true;
    await review(page, true).getByRole("button", { name: "Save review", exact: true }).click();
    await expect(review(page, true).getByRole("alert")).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(review(page, true).getByRole("textbox", { name: "Review note", exact: true })).toHaveValue(saved);
    state.failReview = false;
    await switchRenderer(page, state, false);
    let release!: () => void;
    state.reviewGate = new Promise<void>((resolve) => { release = resolve; });
    await review(page, false).getByRole("button", { name: "Save review", exact: true }).click();
    await expect.poll(() => state.reviews.length).toBe(2);
    const url = page.url();
    await switchRenderer(page, state, true, true);
    await expect(review(page, true).getByRole("textbox", { name: "Review note", exact: true })).toHaveValue(saved);
    await expect(review(page, true).getByRole("textbox", { name: "Review note", exact: true })).toBeDisabled();
    await expect(review(page, true).getByRole("button", { name: /^(Save review|Saving review…|Saving…)$/ })).toBeDisabled();
    expect(state.reviews).toHaveLength(2);
    release();
    await assertSaved(page, true);
    await expect(page).toHaveURL(url);
    expect(state.reviews.map(({ body }) => body)).toEqual([{ ...reviewCanary, note: saved }, { ...reviewCanary, note: saved }]);
    expect(state.trade.notes.map(({ body }) => body)).toEqual([saved]);
  });

  test(`${path} complete history includes an older loser and bounds segment and exact underlying pages`, async ({ page }, info) => {
    const state = await largeHistory(page);
    await start(page, state, path);
    await expect(matching(page, 1051)).toBeVisible();
    expect(new Set(state.historyReads.flatMap(({ ids }) => ids)).size).toBe(1051);
    await expect(page.getByRole("heading", { name: "Position mix", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weak spots and strengths", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Symbol", exact: true }).click();
    const segments = page.getByRole("navigation", { name: "Performance segment pages", exact: true });
    await expect(segments).toContainText("Page 1 of 3");
    await expect(page.getByRole("button", { name: /^Select .* segment$/ })).toHaveCount(100);
    await segments.getByRole("button", { name: "Next 100 segments", exact: true }).click();
    await expect(segments).toContainText("Page 2 of 3");
    await select(page, "Symbol", "OLDLOSS");
    await expect(matching(page, 1)).toBeVisible();
    const row = page.getByRole("table", { name: "Symbol performance breakdown", exact: true }).locator("tbody tr");
    await expect(row).toContainText("-$750.00");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("tab", { name: "Direction", exact: true }).click();
    await page.getByRole("button", { name: "Select Long segment", exact: true }).click();
    await page.getByRole("button", { name: "View underlying trades", exact: true }).click();
    const pages = page.getByRole("navigation", { name: "Underlying trade pages", exact: true });
    await expect(pages).toContainText("Page 1 of 11");
    await expect(drill(page).locator("button[data-trade-id]")).toHaveCount(100);
    await pages.getByRole("button", { name: "Next 100 trades", exact: true }).click();
    await expect(pages).toContainText("Page 2 of 11");
    const ids = await drill(page).locator("button[data-trade-id]").evaluateAll((rows) => rows.map((row) => Number(row.getAttribute("data-trade-id"))));
    expect(new Set(ids).size).toBe(100);
    expect(ids.every((id) => state.tradePage!.some((trade) => trade.id === id))).toBe(true);
    await page.getByRole("button", { name: "Back to breakdown", exact: true }).click();
    await capture(page, info, path);
    await certifyUiState(page);
    await switchRenderer(page, state, false);
    await expect(matching(page, 1051)).toBeVisible();
    await expect(page.getByRole("tab", { name: "Direction", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Select Long segment", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test(`${path} initial later-page failure hides partial analytics and failed refresh preserves complete results`, async ({ page }) => {
    const state = await largeHistory(page);
    state.failHistoryLater = true;
    await start(page, state, path);
    await expect(page.getByRole("alert").filter({ hasText: "Complete history page unavailable" })).toBeVisible();
    await expect(page.getByText(/matching trades/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Performance breakdown", exact: true })).toHaveCount(0);
    state.failHistoryLater = false;
    await page.getByRole("button", { name: /^Refresh [Jj]ournal$/, exact: true }).click();
    await expect(matching(page, 1051)).toBeVisible();
    state.failHistoryLater = true;
    await page.getByRole("button", { name: /^Refresh [Jj]ournal$/, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Complete history page unavailable" })).toBeVisible();
    await expect(matching(page, 1051)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Performance breakdown", exact: true })).toBeVisible();
    state.failHistoryLater = false;
    await page.getByRole("button", { name: /^Refresh [Jj]ournal$/, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Complete history page unavailable" })).toHaveCount(0);
    await switchRenderer(page, state, false);
    await expect(matching(page, 1051)).toBeVisible();
  });

  test(`${path} mixed-currency analytics withholds money totals and restores an archived account scope`, async ({ page }) => {
    const state = await installJournalFixture(page);
    state.accounts.push({ ...seedAccount, id: seedAccount.id + 1, name: "Archived euro desk", currency: "EUR", status: "ARCHIVED" });
    state.tradePage = [structuredClone(seedTrade), { ...structuredClone(seedTrade), id: seedTrade.id + 1, account_id: seedAccount.id + 1, currency: "EUR", symbol: "EURUSD" }];
    await start(page, state, path);
    await expect(page.getByText(/P&L totals are withheld/)).toBeVisible();
    const rows = page.getByRole("table", { name: "Market performance breakdown", exact: true });
    await expect(rows).not.toContainText("$195");
    await expect(rows.locator("tbody tr").first().locator("td").nth(6)).toHaveText("Separate currencies");
    const weak = page.locator("section").filter({ has: page.getByRole("heading", { name: "Weak spots and strengths", exact: true }) }).last();
    await expect(weak.locator("button")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Account scope", exact: true }).selectOption("SELECTED");
    await page.getByRole("checkbox", { name: /Archived euro desk/ }).check();
    await page.getByRole("checkbox", { name: new RegExp(seedAccount.name) }).uncheck();
    await expect(matching(page, 1)).toBeVisible();
    await expect(rows).toContainText("€195.00");
    await expect(rows.locator("tbody tr").first().locator("td").nth(6)).not.toHaveText("Separate currencies");
    await expect.poll(() => weak.locator("button").count()).toBeGreaterThan(0);
    await switchRenderer(page, state, false);
    await expect(page.getByRole("combobox", { name: "Account scope", exact: true })).toHaveValue(String(seedAccount.id + 1));
    await expect(matching(page, 1)).toBeVisible();
    await expect(page.getByText(/P&L totals are withheld/)).toHaveCount(0);
  });
}

test("fallback analytics owner switch aborts pending history and isolates private filter context", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Mounted owner privacy and cancellation are independent of viewport.");
  const state = await largeHistory(page);
  let owner = betaSessionResponse.user.id;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: { ...betaSessionResponse, user: { ...betaSessionResponse.user, id: owner } } }));
  await start(page, state, "/app/journal/analytics");
  await expect(matching(page, 1051)).toBeVisible();
  await select(page, "Symbol", "OLDLOSS");
  await expect(matching(page, 1)).toBeVisible();
  let release!: () => void;
  state.historyGate = new Promise<void>((resolve) => { release = resolve; });
  state.historyGateBefore = [...state.tradePage!].sort((a, b) => b.id - a.id)[499].id;
  const failures: string[] = [];
  page.on("requestfailed", (request) => { if (request.url().includes("order=id")) failures.push(request.url()); });
  await page.getByRole("button", { name: /^Refresh [Jj]ournal$/, exact: true }).click();
  await expect.poll(() => state.historyReads.some(({ before }) => before === state.historyGateBefore)).toBe(true);
  owner++;
  state.tradePage = [];
  state.accountPage = [{ ...seedAccount, id: 90001, name: "Owner two analytics desk" }];
  state.notePage = [];
  await page.evaluate(async (session) => {
    const modulePath = "/src/lib/authSession.ts";
    const { setStoredAuthSession } = await import(modulePath);
    setStoredAuthSession(session);
  }, { createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at, token: `analytics-owner-${owner}`,
    user: { approved: true, betaPosition: null, email: betaSessionResponse.user.email, id: owner,
      isBetaUser: true, name: "Second analytics owner", plan: "beta", provider: "google" } });
  await expect(matching(page, 0)).toBeVisible();
  await page.getByRole("combobox", { name: "Account scope", exact: true }).selectOption("SELECTED");
  await expect(page.getByRole("checkbox", { name: /Owner two analytics desk/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Older loss desk/ })).toHaveCount(0);
  await filters(page);
  await expect(page.getByRole("combobox", { name: "Symbol", exact: true })).toHaveValue("ALL");
  await expect(page.getByText("OLDLOSS", { exact: true })).toHaveCount(0);
  await expect.poll(() => failures.length).toBeGreaterThan(0);
  release();
  await expect(matching(page, 0)).toBeVisible();
  await expect(page.getByText("OLDLOSS", { exact: true })).toHaveCount(0);
});

test("mounted analytics hash dimensions override restored state in both interfaces", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Mounted URL priority is independent of viewport.");
  const state = await installJournalFixture(page);
  await start(page, state, "/app/journal/analytics#journal/analytics?segment=symbol");
  await expect(page.getByRole("tab", { name: "Symbol", exact: true })).toHaveAttribute("aria-selected", "true");
  for (const fallback of [true, false]) {
    if (!fallback) await switchRenderer(page, state, false);
    await page.evaluate(() => { location.hash = "#journal/analytics?segment=direction"; });
    await expect(page.getByRole("tab", { name: "Direction", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Symbol", exact: true }).click();
    await expect(page).toHaveURL(/segment=symbol/);
    await page.evaluate(() => { location.hash = "#journal/analytics?segment=account"; });
    await expect(page.getByRole("tab", { name: "Account", exact: true })).toHaveAttribute("aria-selected", "true");
  }
});

test("initial incomplete history gates review and a late stale point response cannot undo a hot saved review", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Delayed response ordering is independent of viewport.");
  const state = await largeHistory(page);
  state.trade.symbol = "BTCUSDT";
  state.pointTrade = structuredClone(state.trade);
  let releaseHistory!: () => void;
  state.historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  state.historyGateBefore = [...state.tradePage!].sort((a, b) => b.id - a.id)[499].id;
  await start(page, state, `/app/journal/analytics#journal/analytics?trade=${seedTrade.id}&segment=symbol&return=analytics`, false);
  await expect.poll(() => state.historyReads.some(({ before }) => before === state.historyGateBefore)).toBe(true);
  await expect.poll(() => state.reads.includes(`/api/journal/trades/${seedTrade.id}`)).toBe(true);
  await expect(page.getByRole("textbox", { name: "Review note", exact: true })).toHaveCount(0);
  releaseHistory();
  state.historyGate = null;
  await expect(matching(page, 1051)).toBeVisible();
  await fillReview(page, false, "Saved before stale point response");
  let releaseReview!: () => void;
  let releasePoint!: () => void;
  state.reviewGate = new Promise<void>((resolve) => { releaseReview = resolve; });
  state.pointTradeGate = new Promise<void>((resolve) => { releasePoint = resolve; });
  const before = state.reads.filter((read) => read === `/api/journal/trades/${seedTrade.id}`).length;
  await review(page, false).getByRole("button", { name: "Save review", exact: true }).click();
  await expect.poll(() => state.reviews.length).toBe(1);
  const url = page.url();
  await switchRenderer(page, state, true, true);
  await expect.poll(() => state.reads.filter((read) => read === `/api/journal/trades/${seedTrade.id}`).length).toBeGreaterThan(before);
  await expect(review(page, true).getByRole("textbox", { name: "Review note", exact: true })).toBeDisabled();
  releaseReview();
  await assertSaved(page, true, "Saved before stale point response");
  const pointResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/journal/trades/${seedTrade.id}` && response.request().method() === "GET");
  releasePoint();
  state.pointTradeGate = null;
  const staleResponse = await pointResponse;
  expect((await staleResponse.json()).reviewed).toBe(false);
  await staleResponse.finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await assertSaved(page, true, "Saved before stale point response");
  await expect(page).toHaveURL(url);
  expect(state.reviews).toHaveLength(1);
  expect(state.trade.notes.map(({ body }) => body)).toEqual(["Saved before stale point response"]);
});
