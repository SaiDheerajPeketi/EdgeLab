import { expect, test, type Page } from "@playwright/test";
import { UI_COMPATIBILITY_PATHS, UI_COMPATIBILITY_ROUTE_PARITY, UI_COMPATIBILITY_VIEWPORTS, type CompatibilityRouteParity, type UiRouteGroup } from "../frontend/src/lib/uiRollout";
import { expectStableScreenshot, installDeterminism, seedApprovedSession } from "./support/app";
import { installJournalFixture, tradeId } from "./support/compatibility-journal";

type JournalFixture = Awaited<ReturnType<typeof installJournalFixture>>;

const groups = Object.entries(UI_COMPATIBILITY_PATHS) as Array<[UiRouteGroup, readonly string[]]>;

test.describe("exhaustive compatibility route parity", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page, { rollout: "fallback" });
  });

  for (const [group, paths] of groups) {
    test(`${group} maps every nested route and survives fallback round trips`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      if (group !== "public") await seedApprovedSession(page);
      const journal = group === "journal" ? await installJournalFixture(page, { setup: false }) : null;
      let fallback = true;
      await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: {
        revision: fallback ? "compatibility-route" : "modern-route", kill_switch: fallback,
        flags: { shell: true, journal: true, settings: true, chart: true, public: true },
      } }));
      for (const path of paths) {
        const contract = UI_COMPATIBILITY_ROUTE_PARITY[path];
        expect(contract).toBeTruthy();
        expect(contract.routePath).toBe(path);
        expect(contract.requiredViewports).toEqual(UI_COMPATIBILITY_VIEWPORTS);
        expect(contract.requiredViewports).toContain(testInfo.project.name);
        fallback = true;
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[?#]|$)`));
        let boundary = page.locator(`[data-route-group="${group}"]`);
        await expect(boundary).toHaveAttribute("data-ui-version", "fallback");
        await expect(page.locator(`[data-compatibility-renderer="${group}"]`)).toBeVisible();
        await expect(page.locator("#workspace-content")).toHaveCount(0);
        if (contract.kind === "read-only") expect(contract.draftKey).toBeNull();
        await expectCompatibilityDomainState(page, group, path);
        await executeCompatibilityPrimaryAction(page, contract, journal);
        if (path === representativePath(group, paths)) await expectStableScreenshot(page, `compatibility-${group}`, { fullPage: false });
        const settingsDraft = group === "settings" ? await createUnsavedSettingsDraft(page) : null;

        fallback = false;
        await page.reload({ waitUntil: "domcontentloaded" });
        boundary = page.locator(`[data-route-group="${group}"]`);
        await expect(boundary).toHaveAttribute("data-ui-version", "v2");
        await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[?#]|$)`));
        await expectJournalWriteCanary(page, contract, "modern");

        fallback = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        boundary = page.locator(`[data-route-group="${group}"]`);
        await expect(boundary).toHaveAttribute("data-ui-version", "fallback");
        await expect(page.locator(`[data-compatibility-renderer="${group}"]`)).toBeVisible();
        await expectCompatibilityDomainState(page, group, path);
        await expectJournalWriteCanary(page, contract, "fallback");
        if (settingsDraft) {
          await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), contract.draftKey!)).toBe(settingsDraft);
          await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
        }
      }
    });

    test(`${group} preserves its active domain state from modern to fallback and back`, async ({ page }) => {
      test.setTimeout(120_000);
      if (group !== "public") await seedApprovedSession(page);
      if (group === "journal") await installJournalFixture(page, { setup: false });
      let fallback = false;
      await page.route("**/api/ui/rollout", (route) => route.fulfill({ json: {
        revision: fallback ? "rollback-domain" : "modern-domain", kill_switch: fallback,
        flags: { shell: true, journal: true, settings: true, chart: true, public: true },
      } }));
      for (const path of paths) {
        fallback = false;
        await page.goto(path, { waitUntil: "domcontentloaded" });
        let boundary = page.locator(`[data-route-group="${group}"]`);
        await expect(boundary).toHaveAttribute("data-ui-version", "v2");
        fallback = true;
        await page.reload({ waitUntil: "domcontentloaded" });
        boundary = page.locator(`[data-route-group="${group}"]`);
        await expect(boundary).toHaveAttribute("data-ui-version", "fallback");
        await expectCompatibilityDomainState(page, group, path);
        fallback = false;
        await page.reload({ waitUntil: "domcontentloaded" });
        boundary = page.locator(`[data-route-group="${group}"]`);
        await expect(boundary).toHaveAttribute("data-ui-version", "v2");
        await expect(page).toHaveURL(new RegExp(`${escapeRegex(path)}(?:[?#]|$)`));
      }
    });
  }
});

async function expectCompatibilityDomainState(page: Page, group: UiRouteGroup, path: string) {
  if (group === "public") await expect(page.getByRole("heading", { name: "Trade replay without losing your work" })).toBeVisible();
  else if (group === "shell") await expect(page.getByText(/Session restored for/)).toBeVisible();
  else if (group === "journal") {
    if (path === "/app/journal/accounts") {
      await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: /accounts available/ })).toBeVisible();
    } else await expect(page.getByRole("status").filter({ hasText: /recent trades available/ })).toBeVisible();
  }
  else if (group === "settings") await expect(page.getByLabel("Workspace density")).toBeVisible();
  else {
    await expect(page.locator("[data-compatibility-replay]")).not.toHaveText("Loading active replay…");
    await expect(page.locator("[data-compatibility-chart]")).not.toHaveText("Loading chart layout…");
  }
}

async function createUnsavedSettingsDraft(page: Page) {
  const density = page.getByLabel("Workspace density");
  await density.selectOption((await density.inputValue()) === "compact" ? "comfortable" : "compact");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  return page.evaluate(() => sessionStorage.getItem("edgelab.compatibility.settings-draft.v1"));
}

async function executeCompatibilityPrimaryAction(page: Page, contract: CompatibilityRouteParity, journal: JournalFixture | null) {
  if (contract.primaryAction === "refresh-journal") {
    await page.getByRole("button", { name: "Refresh journal" }).click();
    await expect(page.getByRole("status").filter({ hasText: /recent trades available/ })).toBeVisible();
  } else if (contract.primaryAction === "save-trade-review") {
    expect(journal).not.toBeNull();
    await page.getByRole("button", { name: `Review BTCUSDT trade ${tradeId}`, exact: true }).click();
    await page.getByLabel("Reviewed", { exact: true }).check();
    await page.getByRole("combobox", { name: "Rating", exact: true }).selectOption("4");
    await page.getByRole("combobox", { name: "Setup grade", exact: true }).selectOption("A+");
    await page.getByLabel("Review note", { exact: true }).fill("Rollback review canary");
    await page.getByRole("button", { name: "Save review", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Review saved$/ })).toBeVisible();
    expect(journal!.reviews.at(-1)?.body).toEqual({ reviewed: true, rating: 4, setup_grade: "A+", note: "Rollback review canary" });
    expect(journal!.trade.notes.at(-1)?.body).toBe("Rollback review canary");
  } else if (contract.primaryAction === "create-journal-account") {
    expect(journal).not.toBeNull();
    await page.getByLabel("Account name", { exact: true }).fill("Rollback manual account");
    await page.getByLabel("Broker label", { exact: true }).fill("Manual");
    await page.getByLabel("Currency", { exact: true }).fill("EUR");
    await page.getByLabel("Time zone", { exact: true }).fill("Europe/Berlin");
    await page.getByLabel("Initial balance", { exact: true }).fill("9001");
    await page.getByLabel("Account notes", { exact: true }).fill("Rollback account canary");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Account Rollback manual account created$/ })).toBeVisible();
    expect(journal!.creations.at(-1)?.body).toEqual({ name: "Rollback manual account", provider: "Manual", currency: "EUR", timezone: "Europe/Berlin", initial_balance: 9001, notes: "Rollback account canary" });
  } else if (contract.primaryAction === "save-settings") {
    const density = page.getByLabel("Workspace density");
    await density.selectOption((await density.inputValue()) === "compact" ? "comfortable" : "compact");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  } else if (contract.primaryAction === "restore-replay-layout") {
    await expect(page.locator("[data-compatibility-replay]")).not.toHaveText("Loading active replay…");
  } else {
    expect(contract.kind).toBe("read-only");
    expect(contract.draftKey).toBeNull();
  }
}

async function expectJournalWriteCanary(page: Page, contract: CompatibilityRouteParity, version: "modern" | "fallback") {
  if (contract.primaryAction === "save-trade-review") {
    if (version === "modern") {
      await expect(page.getByRole("switch", { name: "Trade reviewed", exact: true })).toBeChecked();
      await expect(page.getByRole("button", { name: "4 star rating", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
      await expect(page.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("Rollback review canary");
    } else {
      await expect(page.getByLabel("Reviewed", { exact: true })).toBeChecked();
      await expect(page.getByRole("combobox", { name: "Rating", exact: true })).toHaveValue("4");
      await expect(page.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
      await expect(page.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText("Rollback review canary");
    }
  } else if (contract.primaryAction === "create-journal-account") {
    const accounts = version === "modern" ? page.locator('[data-journal-route="journalAccounts"]') : page.getByRole("list", { name: "Journal accounts", exact: true });
    await expect(accounts.getByText("Rollback manual account", { exact: true })).toBeVisible();
    await expect(accounts).toContainText("EUR");
    await expect(accounts).toContainText("Europe/Berlin");
    if (version === "fallback") await expect(accounts).toContainText("Rollback account canary");
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function representativePath(group: UiRouteGroup, paths: readonly string[]) {
  if (group === "chart") return "/app/live";
  if (group === "settings") return "/app/settings/global";
  if (group === "journal") return "/app/journal/trades";
  return paths[0];
}
