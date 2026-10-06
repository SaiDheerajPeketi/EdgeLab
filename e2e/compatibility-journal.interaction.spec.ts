import { expect, test, type Page } from "@playwright/test";
import { certifyUiState, gotoStable } from "./support/app";
import { accountCanary, accountsPath, installJournalFixture, reviewCanary, reviewPath, seedAccount, seedTrade, tradeId, tradePath } from "./support/compatibility-journal";

test.use({ video: "off" });

function fallbackContent(page: Page) {
  return page.locator("#compatibility-content");
}

async function fillReview(page: Page) {
  const content = fallbackContent(page);
  await content.getByLabel("Reviewed", { exact: true }).check();
  await content.getByRole("combobox", { name: "Rating", exact: true }).selectOption("4");
  await content.getByRole("combobox", { name: "Setup grade", exact: true }).selectOption("A+");
  await content.getByRole("textbox", { name: "Review note", exact: true }).fill(reviewCanary.note);
}

async function expectReviewDraft(page: Page) {
  const content = fallbackContent(page);
  await expect(content.getByLabel("Reviewed", { exact: true })).toBeChecked();
  await expect(content.getByRole("combobox", { name: "Rating", exact: true })).toHaveValue("4");
  await expect(content.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
  await expect(content.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue(reviewCanary.note);
}

async function fillAccount(page: Page) {
  const content = fallbackContent(page);
  for (const [label, value] of [
    ["Account name", accountCanary.name],
    ["Broker label", accountCanary.provider],
    ["Currency", accountCanary.currency],
    ["Time zone", accountCanary.timezone],
    ["Initial balance", String(accountCanary.initial_balance)],
    ["Account notes", accountCanary.notes],
  ]) {
    await content.getByRole(label === "Initial balance" ? "spinbutton" : "textbox", { name: label, exact: true }).fill(value);
  }
}

async function expectAccountDraft(page: Page) {
  const content = fallbackContent(page);
  for (const [label, value] of [
    ["Account name", accountCanary.name],
    ["Broker label", accountCanary.provider],
    ["Currency", accountCanary.currency],
    ["Time zone", accountCanary.timezone],
    ["Initial balance", String(accountCanary.initial_balance)],
    ["Account notes", accountCanary.notes],
  ]) {
    await expect(content.getByRole(label === "Initial balance" ? "spinbutton" : "textbox", { name: label, exact: true })).toHaveValue(value);
  }
}

test("trade review persists exact canonical values through fallback and modern reloads", async ({ page }, testInfo) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  const content = fallbackContent(page);
  await expect(content.getByRole("heading", { name: "Trade log", exact: true })).toBeVisible();
  await expect(content.getByRole("button", { name: `Review BTCUSDT trade ${tradeId}`, exact: true })).toBeVisible();
  await fillReview(page);
  await certifyUiState(page);
  if (["desktop", "mobile"].includes(testInfo.project.name)) {
    await page.evaluate(() => window.scrollTo(0, 0));
    if (testInfo.project.name === "mobile") {
      await testInfo.attach("journal-scroll-bounds", { body: JSON.stringify(await page.evaluate(() => ({
        path: location.pathname,
        viewport: { width: innerWidth, height: innerHeight },
        document: { tag: document.scrollingElement?.tagName, width: document.scrollingElement?.scrollWidth, height: document.scrollingElement?.scrollHeight },
        containers: [...document.querySelectorAll<HTMLElement>("body, #root, #compatibility-content, [role=region]")].map((node) => ({
          tag: node.tagName, id: node.id, label: node.getAttribute("aria-label"),
          width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
          overflowX: getComputedStyle(node).overflowX, overflowY: getComputedStyle(node).overflowY,
        })),
      })), null, 2), contentType: "application/json" });
    }
    await page.screenshot({ animations: "disabled", fullPage: true, path: `.impeccable/review/compatibility-journal-review-${testInfo.project.name}.png` });
  }
  await content.getByRole("button", { name: "Save review", exact: true }).scrollIntoViewIfNeeded();
  await expect(content.getByRole("button", { name: "Save review", exact: true })).toBeInViewport();
  let releaseReview!: () => void;
  state.reviewGate = new Promise<void>((resolve) => { releaseReview = resolve; });
  await content.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(content.getByRole("button", { name: /^(Save review|Saving review…|Saving…)$/ })).toBeDisabled();
  await expect(content.getByRole("textbox", { name: "Review note", exact: true })).toBeDisabled();
  await expect.poll(() => state.reviews.length).toBe(1);
  expect(state.trade).toEqual(seedTrade);
  releaseReview();
  await expect.poll(() => state.trade.reviewed).toBe(true);
  await expect(content.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("");
  expect(state.reviews).toEqual([{ body: reviewCanary, method: "PATCH", path: reviewPath }]);
  expect(state.trade.rating).toBe(4);
  expect(state.trade.setup_grade).toBe("A+");
  expect(state.trade.notes.map((note) => note.body)).toEqual([reviewCanary.note]);
  expect(state.reads).toContain(`/api/journal/trades/${tradeId}`);

  state.fallback = false;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "v2");
  const drawer = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review BTCUSDT", exact: true }) });
  await expect(drawer.getByRole("switch", { name: "Trade reviewed", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(drawer.getByRole("button", { name: "4 star rating", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
  await expect(drawer.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("");
  await expect(drawer.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);

  state.fallback = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "fallback");
  await expect(content.getByLabel("Reviewed", { exact: true })).toBeChecked();
  await expect(content.getByRole("combobox", { name: "Rating", exact: true })).toHaveValue("4");
  await expect(content.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
  await expect(content.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("");
  await expect(content.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText(reviewCanary.note);
  await expect(page).toHaveURL(new RegExp(`/app/journal/trades#journal/trades\\?trade=${tradeId}$`));
});

test("trade review server failure retains the live draft and retries the same PATCH", async ({ page }) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  await fillReview(page);
  let releaseReview!: () => void;
  state.reviewGate = new Promise<void>((resolve) => { releaseReview = resolve; });
  state.failReview = true;
  const content = fallbackContent(page);
  await content.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(content.getByRole("button", { name: /^(Save review|Saving review…|Saving…)$/ })).toBeDisabled();
  await expect.poll(() => state.reviews.length).toBe(1);
  releaseReview();
  await expect(content.getByRole("alert")).toBeVisible();
  await expect(content.getByRole("button", { name: "Save review", exact: true })).toBeEnabled();
  await expectReviewDraft(page);
  expect(state.trade).toEqual(seedTrade);
  state.failReview = false;
  state.reviewGate = null;
  await content.getByRole("button", { name: "Save review", exact: true }).click();
  await expect.poll(() => state.trade.reviewed).toBe(true);
  expect(state.reviews).toEqual([
    { body: reviewCanary, method: "PATCH", path: reviewPath },
    { body: reviewCanary, method: "PATCH", path: reviewPath },
  ]);
  await expect(content.getByRole("alert")).toHaveCount(0);
});

test("manual account creation persists its exact canonical canary across renderer reloads", async ({ page }, testInfo) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, accountsPath, { waitForNetworkIdle: false });
  const content = fallbackContent(page);
  await expect(content.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await fillAccount(page);
  await certifyUiState(page);
  if (["desktop", "mobile"].includes(testInfo.project.name)) {
    await page.evaluate(() => window.scrollTo(0, 0));
    if (testInfo.project.name === "mobile") {
      await testInfo.attach("journal-scroll-bounds", { body: JSON.stringify(await page.evaluate(() => ({
        path: location.pathname,
        viewport: { width: innerWidth, height: innerHeight },
        document: { tag: document.scrollingElement?.tagName, width: document.scrollingElement?.scrollWidth, height: document.scrollingElement?.scrollHeight },
        containers: [...document.querySelectorAll<HTMLElement>("body, #root, #compatibility-content, [role=region]")].map((node) => ({
          tag: node.tagName, id: node.id, label: node.getAttribute("aria-label"),
          width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
          overflowX: getComputedStyle(node).overflowX, overflowY: getComputedStyle(node).overflowY,
        })),
      })), null, 2), contentType: "application/json" });
    }
    await page.screenshot({ animations: "disabled", fullPage: true, path: `.impeccable/review/compatibility-journal-accounts-${testInfo.project.name}.png` });
  }
  await content.getByRole("button", { name: "Create account", exact: true }).scrollIntoViewIfNeeded();
  await expect(content.getByRole("button", { name: "Create account", exact: true })).toBeInViewport();
  let releaseAccount!: () => void;
  state.accountGate = new Promise<void>((resolve) => { releaseAccount = resolve; });
  await content.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(content.getByRole("button", { name: /^(Create account|Creating account…|Creating…)$/ })).toBeDisabled();
  await expect(content.getByLabel("Account name", { exact: true })).toBeDisabled();
  await expect.poll(() => state.creations.length).toBe(1);
  expect(state.accounts).toEqual([seedAccount]);
  releaseAccount();
  await expect.poll(() => state.accounts.length).toBe(2);
  expect(state.creations).toEqual([{ body: accountCanary, method: "POST", path: "/api/journal/accounts" }]);
  expect(state.accounts[1]).toMatchObject(accountCanary);
  await expect(content.getByText(accountCanary.name, { exact: true })).toBeVisible();

  state.fallback = false;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "v2");
  const workspace = page.getByRole("region", { name: "Journal workspace", exact: true });
  await expect(workspace.locator("p").filter({ hasText: /^UIR-83 persisted desk$/ })).toBeVisible();
  await expect(workspace.getByText("Manual Canary · EUR · Europe/Berlin · manual", { exact: true })).toBeVisible();

  state.fallback = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-route-group="journal"]')).toHaveAttribute("data-ui-version", "fallback");
  await expect(fallbackContent(page).getByText(accountCanary.name, { exact: true })).toBeVisible();
  expect(state.accounts[1]).toMatchObject(accountCanary);
  await expect(page).toHaveURL(new RegExp(`${accountsPath}$`));
});

test("manual account server failure keeps all form fields and retries one creation", async ({ page }) => {
  const state = await installJournalFixture(page);
  await gotoStable(page, accountsPath, { waitForNetworkIdle: false });
  await fillAccount(page);
  state.failAccount = true;
  let releaseAccount!: () => void;
  state.accountGate = new Promise<void>((resolve) => { releaseAccount = resolve; });
  const content = fallbackContent(page);
  await content.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(content.getByRole("button", { name: /^(Create account|Creating account…|Creating…)$/ })).toBeDisabled();
  await expect.poll(() => state.creations.length).toBe(1);
  releaseAccount();
  await expect(content.getByRole("alert")).toBeVisible();
  await expect(content.getByRole("button", { name: "Create account", exact: true })).toBeEnabled();
  await expectAccountDraft(page);
  expect(state.accounts).toEqual([seedAccount]);
  state.failAccount = false;
  state.accountGate = null;
  await content.getByRole("button", { name: "Create account", exact: true }).click();
  await expect.poll(() => state.accounts.length).toBe(2);
  expect(state.creations).toEqual([
    { body: accountCanary, method: "POST", path: "/api/journal/accounts" },
    { body: accountCanary, method: "POST", path: "/api/journal/accounts" },
  ]);
  expect(state.accounts[1]).toMatchObject(accountCanary);
  await expect(content.getByRole("alert")).toHaveCount(0);
});

test("deep-linked review resolves a trade outside the current list page", async ({ page }) => {
  const state = await installJournalFixture(page);
  state.tradePage = [];
  await gotoStable(page, tradePath, { waitForNetworkIdle: false });
  const content = fallbackContent(page);
  await expect(content.getByRole("heading", { name: "Review BTCUSDT", exact: true })).toBeVisible();
  await expect(content.getByRole("button", { name: `Review BTCUSDT trade ${tradeId}`, exact: true })).toHaveCount(0);
  await expect(content.getByRole("button", { name: "Save review", exact: true })).toBeEnabled();
  expect(state.reads).toContain("/api/journal/trades");
  expect(state.reads).toContain(`/api/journal/trades/${tradeId}`);
  await expect(page).toHaveURL(new RegExp(`/app/journal/trades#journal/trades\\?trade=${tradeId}$`));
});

test("trade pages navigate boundaries and reset when an account filter changes or clears", async ({ page }) => {
  const state = await installJournalFixture(page);
  const secondAccount = { ...seedAccount, id: seedAccount.id + 1, name: "Second page account" };
  state.accounts.push(secondAccount);
  state.tradePage = Array.from({ length: 51 }, (_, index) => ({
    ...structuredClone(seedTrade),
    id: tradeId + index,
    account_id: index === 50 ? secondAccount.id : seedAccount.id,
    symbol: index === 50 ? "LASTUSD" : "BTCUSDT",
  }));
  await gotoStable(page, "/app/journal/trades", { waitForNetworkIdle: false });
  const content = fallbackContent(page);
  const rows = content.getByRole("region", { name: "Canonical trade log", exact: true }).locator("tbody tr");
  const previous = content.getByRole("button", { name: "Previous page", exact: true });
  const next = content.getByRole("button", { name: "Next page", exact: true });
  const filter = content.getByRole("combobox", { name: "Account filter", exact: true });
  const lastTrade = content.getByRole("button", { name: `Review LASTUSD trade ${tradeId + 50}`, exact: true });
  await expect(rows).toHaveCount(50);
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(lastTrade).toHaveCount(0);

  await next.click();
  await expect(rows).toHaveCount(1);
  await expect(lastTrade).toBeVisible();
  await expect(content.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(previous).toBeEnabled();
  await expect(next).toBeDisabled();

  await previous.click();
  await expect(rows).toHaveCount(50);
  await expect(content.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(rows).toHaveCount(1);
  await expect(filter).toBeEnabled();
  await filter.selectOption(String(secondAccount.id));
  await expect(rows).toHaveCount(1);
  await expect(content.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(lastTrade).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();

  await filter.selectOption("");
  await expect(rows).toHaveCount(50);
  await expect(content.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await expect(lastTrade).toHaveCount(0);
  await expect(page).not.toHaveURL(/account=/);
});
