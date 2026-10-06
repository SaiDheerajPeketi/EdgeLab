import { expect, test, type Locator, type Page } from "@playwright/test";
import { betaSessionResponse, gotoStable, installDeterminism } from "./support/app";
import { accountCanary, accountsPath, installJournalFixture, reviewCanary, reviewPath, seedTrade, tradePath } from "./support/compatibility-journal";

test.use({ video: "off" });
type JournalState = Awaited<ReturnType<typeof installJournalFixture>>;
const fallback = (page: Page) => page.locator("#compatibility-content");
const drawer = (page: Page) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review BTCUSDT", exact: true }) });
const field = (scope: Locator, name: string) => scope.getByRole("textbox", { name, exact: true });
const hiddenStrategy = "Shared hidden execution draft";
const hiddenEntry = 125;
const finalNote = "One new modern note after metadata-only save";

async function switchRenderer(page: Page, state: JournalState, compatibility: boolean, path?: string) {
  state.fallback = compatibility;
  if (path) await gotoStable(page, path, { waitForNetworkIdle: false });
  else await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", compatibility ? "fallback" : "v2");
}

async function fillAccount(page: Page) {
  const content = fallback(page);
  for (const [name, value] of [
    ["Account name", accountCanary.name], ["Broker label", accountCanary.provider],
    ["Currency", accountCanary.currency], ["Time zone", accountCanary.timezone],
    ["Initial balance", String(accountCanary.initial_balance)], ["Account notes", accountCanary.notes],
  ]) await content.getByRole(name === "Initial balance" ? "spinbutton" : "textbox", { name, exact: true }).fill(value);
}

async function expectAccount(page: Page, compatibility: boolean) {
  const scope = compatibility ? fallback(page) : page.locator("form").filter({ has: page.getByRole("textbox", { name: "Account name", exact: true }) });
  for (const [name, value] of [
    ["Account name", accountCanary.name], ["Broker label", accountCanary.provider],
    ["Currency", accountCanary.currency], ["Time zone", accountCanary.timezone],
    ["Initial balance", String(accountCanary.initial_balance)], [compatibility ? "Account notes" : "Notes", accountCanary.notes],
  ]) await expect(scope.getByRole(compatibility && name === "Initial balance" ? "spinbutton" : "textbox", { name, exact: true })).toHaveValue(value);
}

async function fillReview(page: Page) {
  const content = fallback(page);
  await content.getByRole("checkbox", { name: "Reviewed", exact: true }).check();
  await content.getByRole("combobox", { name: "Rating", exact: true }).selectOption("4");
  await content.getByRole("combobox", { name: "Setup grade", exact: true }).selectOption("A+");
  await field(content, "Review note").fill(reviewCanary.note);
}

async function expectReview(page: Page, compatibility: boolean, note = reviewCanary.note) {
  const scope = compatibility ? fallback(page) : drawer(page);
  if (compatibility) {
    await expect(scope.getByRole("checkbox", { name: "Reviewed", exact: true })).toBeChecked();
    await expect(scope.getByRole("combobox", { name: "Rating", exact: true })).toHaveValue("4");
  } else {
    await expect(scope.getByRole("switch", { name: "Trade reviewed", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(scope.getByRole("button", { name: "4 star rating", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(scope.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
  await expect(field(scope, "Review note")).toHaveValue(note);
}

test("manual account draft survives reloads and renderer switches, retains hidden color, and clears after creation", async ({ page }) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, accountsPath, { waitForNetworkIdle: false });
  await fillAccount(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectAccount(page, true);
  await switchRenderer(page, state, false);
  await expectAccount(page, false);
  await page.getByLabel("Color", { exact: true }).fill("#abcdef");
  await switchRenderer(page, state, true);
  await expectAccount(page, true);
  await fallback(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => state.accounts.length).toBe(2);
  await expect(field(fallback(page), "Account name")).toHaveValue("");
  expect(state.creations.map(({ body }) => body)).toEqual([{ ...accountCanary, color: "#abcdef" }]);
  await switchRenderer(page, state, false);
  await page.getByRole("button", { name: "Add manual account", exact: true }).click();
  await expect(field(page.locator("form"), "Account name")).toHaveValue("");
  await expect(field(page.locator("form"), "Notes")).toHaveValue("");
  await expect(page.getByLabel("Color", { exact: true })).toHaveValue("#67e8f9");
});

test("metadata-only fallback save preserves hidden edits for a focused execution PATCH and one new note", async ({ page }, testInfo) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  await fillReview(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectReview(page, true);
  await switchRenderer(page, state, false);
  await expectReview(page, false);
  await field(drawer(page), "Strategy").fill(hiddenStrategy);
  await field(drawer(page), "Entry price").fill(String(hiddenEntry));
  await switchRenderer(page, state, true);
  await expectReview(page, true);
  await fallback(page).getByRole("button", { name: "Save review", exact: true }).click();
  await expect(field(fallback(page), "Review note")).toHaveValue("");
  expect(state.reviews.map(({ body }) => body)).toEqual([reviewCanary]);
  expect(state.trade.entry_price).toBe(seedTrade.entry_price);
  expect(state.trade.strategy_name).toBe(seedTrade.strategy_name);
  expect(state.trade.notes.map(({ body }) => body)).toEqual([reviewCanary.note]);

  await switchRenderer(page, state, false);
  await expectReview(page, false, "");
  await expect(field(drawer(page), "Strategy")).toHaveValue(hiddenStrategy);
  await expect(field(drawer(page), "Entry price")).toHaveValue(String(hiddenEntry));
  await expect(drawer(page).getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);
  if (["desktop", "mobile"].includes(testInfo.project.name)) {
    await page.evaluate(() => window.scrollTo(0, 0));
    const savedNotes = drawer(page).getByRole("list", { name: "Saved trade notes", exact: true });
    await savedNotes.scrollIntoViewIfNeeded();
    await drawer(page).getByRole("button", { name: "Save review", exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(savedNotes).toBeInViewport();
    await expect(drawer(page).getByRole("button", { name: "Save review", exact: true })).toBeInViewport();
    await page.screenshot({ animations: "disabled", fullPage: false, path: `.impeccable/review/compatibility-journal-review-modern-${testInfo.project.name}.png` });
  }
  await drawer(page).getByRole("button", { name: "Save review", exact: true }).click();
  await expect(drawer(page)).toHaveCount(0);
  expect(state.reviews).toHaveLength(2);
  expect(state.reviews[1]).toEqual({
    method: "PATCH", path: reviewPath, body: { entry_price: hiddenEntry, strategy_name: hiddenStrategy },
  });
  expect(state.trade.notes.map(({ body }) => body)).toEqual([reviewCanary.note]);
  await switchRenderer(page, state, false, tradePath);
  await expect(drawer(page).getByRole("button", { name: "Save review", exact: true })).toBeDisabled();
  await field(drawer(page), "Review note").fill(finalNote);
  await drawer(page).getByRole("button", { name: "Save review", exact: true }).click();
  await expect(drawer(page)).toHaveCount(0);
  expect(state.reviews[2]).toEqual({ method: "PATCH", path: reviewPath, body: { note: finalNote } });
  expect(state.trade.notes.map(({ body }) => body)).toEqual([reviewCanary.note, finalNote]);
  await switchRenderer(page, state, false, tradePath);
  await expectReview(page, false, "");
  await expect(field(drawer(page), "Strategy")).toHaveValue(hiddenStrategy);
  await expect(field(drawer(page), "Entry price")).toHaveValue(String(hiddenEntry));
  await expect(drawer(page).getByRole("button", { name: "Save review", exact: true })).toBeDisabled();
  await expect(drawer(page).getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(finalNote);
});

test("rejected account creation preserves all draft fields through reload and retries one creation", async ({ page }) => {
  const state = await installJournalFixture(page);
  state.failAccount = true;
  await gotoStable(page, accountsPath, { waitForNetworkIdle: false });
  await fillAccount(page);
  await fallback(page).getByRole("button", { name: "Create account", exact: true }).click();
  await expect(fallback(page).getByRole("alert")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectAccount(page, true);
  expect(state.accounts).toHaveLength(1);
  state.failAccount = false;
  await switchRenderer(page, state, false);
  await expectAccount(page, false);
  await expect(page.locator('[data-journal-route="journalAccounts"]').getByText("UIR-83 seed account", { exact: true })).toBeVisible();
  const accountReads = state.reads.filter((path) => path === "/api/journal/accounts").length;
  state.failAccountRead = true;
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => state.accounts.length).toBe(2);
  await expect(field(page.locator("form"), "Account name")).toHaveCount(0);
  expect(state.creations.map(({ body }) => body)).toEqual([accountCanary, { ...accountCanary, color: "#67e8f9" }]);
  expect(state.reads.filter((path) => path === "/api/journal/accounts")).toHaveLength(accountReads);
  state.failAccountRead = false;
  await switchRenderer(page, state, true);
  await expect(field(fallback(page), "Account name")).toHaveValue("");
  await expect(field(fallback(page), "Account notes")).toHaveValue("");
});

test("rejected review save preserves its draft through reload and retry adds its note once", async ({ page }) => {
  const state = await installJournalFixture(page);
  state.failReview = true;
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  await fillReview(page);
  await fallback(page).getByRole("button", { name: "Save review", exact: true }).click();
  await expect(fallback(page).getByRole("alert")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectReview(page, true);
  expect(state.trade).toEqual(seedTrade);
  state.failReview = false;
  await fallback(page).getByRole("button", { name: "Save review", exact: true }).click();
  await expect(field(fallback(page), "Review note")).toHaveValue("");
  expect(state.reviews.map(({ body }) => body)).toEqual([reviewCanary, reviewCanary]);
  expect(state.trade.notes.map(({ body }) => body)).toEqual([reviewCanary.note]);
  await switchRenderer(page, state, false);
  await expectReview(page, false, "");
  await expect(drawer(page).getByRole("button", { name: "Save review", exact: true })).toBeDisabled();
});

test("modern review close keeps unsaved changes while explicit Cancel discards them", async ({ page }) => {
  const state = await installJournalFixture(page);
  await switchRenderer(page, state, false, tradePath);
  await field(drawer(page), "Strategy").fill(hiddenStrategy);
  await field(drawer(page), "Review note").fill(reviewCanary.note);
  await drawer(page).getByRole("button", { name: /^Close review and return to / }).click();
  await expect(drawer(page)).toHaveCount(0);
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  await expect(field(drawer(page), "Strategy")).toHaveValue(hiddenStrategy);
  await expect(field(drawer(page), "Review note")).toHaveValue(reviewCanary.note);
  await drawer(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(drawer(page)).toHaveCount(0);
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  await expect(field(drawer(page), "Strategy")).toHaveValue(seedTrade.strategy_name!);
  await expect(field(drawer(page), "Review note")).toHaveValue("");
  await expect(drawer(page).getByRole("button", { name: "Save review", exact: true })).toBeDisabled();
  expect(state.reviews).toEqual([]);
});


async function installOwnerFixture(page: Page) {
  await installDeterminism(page, { rollout: "fallback" });
  const state = await installJournalFixture(page, { setup: false });
  let owner = betaSessionResponse.user.id;
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    ...betaSessionResponse, token: `draft-owner-${owner}`, user: { ...betaSessionResponse.user, id: owner },
  } }));
  await gotoStable(page, "/", { waitForNetworkIdle: false });
  async function changeOwner(id: number) {
    owner = id;
    state.accountPage = id === betaSessionResponse.user.id ? null : [];
    await page.evaluate(async (session) => {
      const modulePath = "/src/lib/authSession.ts";
      const { setStoredAuthSession } = await import(modulePath);
      setStoredAuthSession(session);
    }, {
      createdAt: betaSessionResponse.created_at, expiresAt: betaSessionResponse.expires_at,
      token: `draft-owner-${id}`, user: {
        approved: true, betaPosition: null, email: betaSessionResponse.user.email, id,
        isBetaUser: true, name: betaSessionResponse.user.name, plan: "beta", provider: "google",
      },
    });
  }
  await changeOwner(betaSessionResponse.user.id);
  return { state, changeOwner };
}

test("mounted review drafts stay isolated by trade and signed-in owner", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Owner/trade boundary covered once; shared regressions cover all viewports");
  const { state, changeOwner } = await installOwnerFixture(page);
  const secondId = seedTrade.id + 1;
  state.tradePage = [structuredClone(seedTrade), { ...structuredClone(seedTrade), id: secondId, symbol: "ETHUSDT" }];
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  await field(fallback(page), "Review note").fill(reviewCanary.note);
  await fallback(page).getByRole("button", { name: "Close review", exact: true }).click();
  await fallback(page).getByRole("button", { name: `Review ETHUSDT trade ${secondId}`, exact: true }).click();
  await expect(field(fallback(page), "Review note")).toHaveValue("");
  await fallback(page).getByRole("button", { name: "Close review", exact: true }).click();
  await fallback(page).getByRole("button", { name: `Review BTCUSDT trade ${seedTrade.id}`, exact: true }).click();
  await expect(field(fallback(page), "Review note")).toHaveValue(reviewCanary.note);
  await changeOwner(betaSessionResponse.user.id + 1);
  await expect(field(fallback(page), "Review note")).toHaveValue("");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(field(fallback(page), "Review note")).toHaveValue("");
  await changeOwner(betaSessionResponse.user.id);
  await expect(field(fallback(page), "Review note")).toHaveValue(reviewCanary.note);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(field(fallback(page), "Review note")).toHaveValue(reviewCanary.note);
  expect(state.reviews).toEqual([]);
});


test("late modern review acknowledgement clears the mounted fallback draft without changing its deep link", async ({ page }) => {
  const state = await installJournalFixture(page);
  await switchRenderer(page, state, false, tradePath);
  await drawer(page).getByRole("switch", { name: "Trade reviewed", exact: true }).click();
  await drawer(page).getByRole("button", { name: "4 star rating", exact: true }).click();
  await drawer(page).getByRole("combobox", { name: "Setup grade", exact: true }).selectOption("A+");
  await field(drawer(page), "Review note").fill(reviewCanary.note);
  let release!: () => void;
  state.reviewGate = new Promise<void>((resolve) => { release = resolve; });
  await drawer(page).getByRole("button", { name: "Save review", exact: true }).click();
  await expect.poll(() => state.reviews.length).toBe(1);
  const url = page.url();
  state.fallback = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "fallback");
  await expect(field(fallback(page), "Review note")).toHaveValue(reviewCanary.note);
  await expect(field(fallback(page), "Review note")).toBeDisabled();
  await expect(fallback(page).getByRole("checkbox", { name: "Reviewed", exact: true })).toBeDisabled();
  await expect(fallback(page).getByRole("combobox", { name: "Rating", exact: true })).toBeDisabled();
  await expect(fallback(page).getByRole("combobox", { name: "Setup grade", exact: true })).toBeDisabled();
  await expect(fallback(page).getByRole("button", { name: /^(Save review|Saving review…|Saving…)$/ })).toBeDisabled();
  expect(state.reviews).toHaveLength(1);
  release();
  await expectReview(page, true, "");
  await expect(fallback(page).getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);
  await expect(page).toHaveURL(url);
  expect(state.reviews.map(({ body }) => body)).toEqual([reviewCanary]);
  expect(state.trade.notes.map(({ body }) => body)).toEqual([reviewCanary.note]);
});

test("late modern account creation acknowledgement clears the mounted fallback draft", async ({ page }) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, accountsPath, { waitForNetworkIdle: false });
  await fillAccount(page);
  await switchRenderer(page, state, false);
  await expectAccount(page, false);
  let release!: () => void;
  state.accountGate = new Promise<void>((resolve) => { release = resolve; });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => state.creations.length).toBe(1);
  const url = page.url();
  state.fallback = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "fallback");
  await expectAccount(page, true);
  await expect(field(fallback(page), "Account name")).toBeDisabled();
  await expect(field(fallback(page), "Account notes")).toBeDisabled();
  await expect(fallback(page).getByRole("spinbutton", { name: "Initial balance", exact: true })).toBeDisabled();
  await expect(fallback(page).getByRole("button", { name: /^(Create account|Creating account…|Creating…)$/ })).toBeDisabled();
  expect(state.creations).toHaveLength(1);
  release();
  await expect(field(fallback(page), "Account name")).toHaveValue("");
  await expect(field(fallback(page), "Account notes")).toHaveValue("");
  await expect(fallback(page).getByRole("list", { name: "Journal accounts", exact: true })).toContainText(accountCanary.name);
  await expect(page).toHaveURL(url);
  expect(state.creations.map(({ body }) => body)).toEqual([{ ...accountCanary, color: "#67e8f9" }]);
  expect(state.accounts).toHaveLength(2);
});


test("a canonical account created by one owner disappears from the mounted next owner's empty account list", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Mounted canonical-cache owner boundary covered once");
  const { state, changeOwner } = await installOwnerFixture(page);
  await switchRenderer(page, state, false, accountsPath);
  await page.getByRole("button", { name: "Add manual account", exact: true }).click();
  await field(page.locator("form"), "Account name").fill(accountCanary.name);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const createdAccount = page.locator('[data-journal-route="journalAccounts"]').getByText(accountCanary.name, { exact: true });
  await expect(createdAccount).toBeVisible();
  await expect(field(page.locator("form"), "Account name")).toHaveCount(0);
  const reads = state.reads.filter((path) => path === "/api/journal/accounts").length;
  await changeOwner(betaSessionResponse.user.id + 1);
  await expect.poll(() => state.reads.filter((path) => path === "/api/journal/accounts").length).toBeGreaterThan(reads);
  await expect(createdAccount).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Account scope", exact: true }).getByRole("option", { name: /UIR-83 persisted desk/ })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${accountsPath}$`));
  await changeOwner(betaSessionResponse.user.id);
  await expect(createdAccount).toBeVisible();
  expect(state.creations).toHaveLength(1);
});
