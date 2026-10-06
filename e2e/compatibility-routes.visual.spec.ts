import { expect, test, type Page } from "@playwright/test";
import { UI_COMPATIBILITY_PATHS, UI_COMPATIBILITY_ROUTE_PARITY, UI_COMPATIBILITY_VIEWPORTS, type CompatibilityRouteParity, type UiRouteGroup } from "../frontend/src/lib/uiRollout";
import { expectStableScreenshot, installDeterminism, seedApprovedSession } from "./support/app";
import { installJournalFixture, noteDate, seedAccount, tradeId } from "./support/compatibility-journal";
import { installJournalSettingsFixture, journalDefaultsCanary, journalSettingsPatchPath } from "./support/compatibility-journal-settings";
import { BACKTEST_DEFAULTS, BACKTEST_KEYS, type BacktestField } from "../frontend/src/lib/backtestSettingsModel";

type JournalFixture = Awaited<ReturnType<typeof installJournalFixture>>;
type JournalSettingsFixture = Awaited<ReturnType<typeof installJournalSettingsFixture>>;

const groups = Object.entries(UI_COMPATIBILITY_PATHS) as Array<[UiRouteGroup, readonly string[]]>;

test.describe("exhaustive compatibility route parity", () => {
  test.beforeEach(async ({ page }) => {
    await installDeterminism(page, { rollout: "fallback" });
    let chart = { presets: { namespace: "edgelab", key: "chart-settings-presets.v1", value: [{ name: "Settings default", settings: { textSize: 12 }, updatedAt: "2026-09-15T12:00:00Z" }], updated_at: "2026-09-15T12:00:00Z" }, active: { namespace: "edgelab", key: "active-chart-settings-preset.v1", value: "Settings default", updated_at: "2026-09-15T12:00:00Z" } };
    await page.route("**/api/settings/chart", async (route) => {
      if (route.request().method() === "PATCH") chart = { ...chart, presets: { ...chart.presets, value: [{ ...chart.presets.value[0], settings: { ...chart.presets.value[0].settings, ...route.request().postDataJSON() } }] } };
      await route.fulfill({ json: chart });
    });
    const values = new Map(Object.entries(BACKTEST_KEYS).map(([field, key]) => [key, BACKTEST_DEFAULTS[field as BacktestField]]));
    await page.route("**/api/app-storage/edgelab/order-*.v1", async (route) => {
      const key = new URL(route.request().url()).pathname.split("/").at(-1)!;
      expect(values.has(key)).toBe(true);
      if (route.request().method() === "PUT") values.set(key, route.request().postDataJSON().value);
      await route.fulfill({ json: { namespace: "edgelab", key, value: values.get(key), updated_at: "2026-09-15T12:00:00Z" } });
    });
  });

  for (const [group, paths] of groups) {
    test(`${group} maps every nested route and survives fallback round trips`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      if (group !== "public") await seedApprovedSession(page);
      const journal = group === "journal" ? await installJournalFixture(page, { setup: false }) : null;
      const journalSettings = group === "journal" || group === "settings" ? await installJournalSettingsFixture(page, { setup: false }) : null;
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
        await executeCompatibilityPrimaryAction(page, contract, journal, journalSettings);
        if (path === representativePath(group, paths)) await expectStableScreenshot(page, `compatibility-${group}`, { fullPage: false });
        const settingsDraft = contract.primaryAction === "save-settings" ? await createUnsavedSettingsDraft(page) : null;

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
      if (group === "journal" || group === "settings") await installJournalSettingsFixture(page, { setup: false });
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
  if (["/app/settings/chart", "/app/settings/appearance"].includes(path)) {
    await expect(page.getByLabel("Text size", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Grid", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Workspace density", { exact: true })).toHaveCount(0);
  } else if (path === "/app/settings/backtest") {
    await expect(page.getByLabel("Sizing mode", { exact: true })).toBeEnabled();
    await expect(page.getByRole("switch", { name: "Require chart-line confirmation", exact: true })).toBeVisible();
    await expect(page.getByLabel("Workspace density", { exact: true })).toHaveCount(0);
  } else if (isJournalSettings(path)) {
    await expect(page.getByLabel("Currency", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Review note template", exact: true })).toBeVisible();
    await expect(page.getByLabel("Workspace density", { exact: true })).toHaveCount(0);
  } else if (group === "public") await expect(page.getByRole("heading", { name: "Trade replay without losing your work" })).toBeVisible();
  else if (group === "shell") await expect(page.getByText(/Session restored for/)).toBeVisible();
  else if (group === "journal") {
    if (path === "/app/journal/dashboard") {
      await expect(page.getByRole("heading", { name: "Trading overview", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Session reflection", exact: true })).toBeVisible();
    } else if (path === "/app/journal/accounts") {
      await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: /accounts available/ })).toBeVisible();
    } else if (path === "/app/journal/analytics" || path === "/app/journal/reports") {
      await expect(page.getByRole("heading", { name: "Performance breakdown", exact: true })).toBeVisible();
      await expect(page.getByText(/matching trades ·/)).toBeVisible();
    } else if (path === "/app/journal/notes" || path === "/app/journal/calendar") {
      await expect(page.getByRole("heading", { name: path.endsWith("/notes") ? "Daily notes" : "Day review", exact: true }).last()).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Daily note", exact: true })).toBeVisible();
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

async function executeCompatibilityPrimaryAction(page: Page, contract: CompatibilityRouteParity, journal: JournalFixture | null, journalSettings: JournalSettingsFixture | null) {
  if (contract.primaryAction === "refresh-journal") {
    await page.getByRole("button", { name: "Refresh journal" }).click();
    await expect(page.getByRole("status").filter({ hasText: /recent trades available/ })).toBeVisible();
  } else if (contract.primaryAction === "save-trade-review") {
    expect(journal).not.toBeNull();
    if (contract.routePath === "/app/journal/analytics" || contract.routePath === "/app/journal/reports") {
      await page.getByRole("tab", { name: "Symbol", exact: true }).click();
      await page.getByRole("button", { name: "Select BTCUSDT segment", exact: true }).click();
      await page.getByRole("button", { name: "View underlying trades", exact: true }).click();
    }
    await page.getByRole("button", { name: `Review BTCUSDT trade ${tradeId}`, exact: true }).click();
    const form = page.getByRole("form", { name: "Review BTCUSDT", exact: true });
    await form.getByLabel("Reviewed", { exact: true }).check();
    await form.getByRole("combobox", { name: "Rating", exact: true }).selectOption("4");
    await form.getByRole("combobox", { name: "Setup grade", exact: true }).selectOption("A+");
    await form.getByLabel("Review note", { exact: true }).fill("Rollback review canary");
    await form.getByRole("button", { name: "Save review", exact: true }).click();
    await expect(form.getByRole("status").filter({ hasText: /^Review saved$/ })).toBeVisible();
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
  } else if (contract.primaryAction === "save-daily-note") {
    expect(journal).not.toBeNull();
    const isDashboard = contract.routePath === "/app/journal/dashboard";
    const surface = isDashboard ? "dashboard" : contract.routePath.endsWith("/calendar") ? "calendar" : "notes";
    const account = isDashboard ? seedAccount.id : null;
    await page.goto(`${contract.routePath}#journal/${surface}?date=${noteDate}${account == null ? "" : `&account=${account}`}`, { waitUntil: "domcontentloaded" });
    const body = `Rollback daily-note canary ${contract.routePath}`;
    const editor = page.getByRole("textbox", { name: isDashboard ? "Session reflection" : "Daily note", exact: true });
    await editor.fill(body);
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(editor).toBeEnabled();
    await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeDisabled();
    expect(journal!.noteWrites.at(-1)).toEqual({ method: "PUT", path: `/api/journal/daily-notes/${noteDate}`, body: { account_id: account, body } });
  } else if (contract.primaryAction === "save-journal-settings") {
    expect(journalSettings).not.toBeNull();
    await page.getByLabel("Currency", { exact: true }).fill(journalDefaultsCanary.default_currency);
    await page.getByLabel("Broker label", { exact: true }).fill(journalDefaultsCanary.default_broker);
    await page.getByRole("combobox", { name: "Default entry type", exact: true }).selectOption(journalDefaultsCanary.default_entry_type);
    await page.getByRole("switch", { name: "Require account for taken trades", exact: true }).setChecked(false);
    await page.getByRole("button", { name: "Apply journal defaults", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Journal defaults saved$/ })).toBeVisible();
    expect(journalSettings!.writes.at(-1)).toEqual({ owner: journalSettings!.owner, method: "PATCH", path: journalSettingsPatchPath, body: journalDefaultsCanary });
  } else if (contract.primaryAction === "save-chart-settings") {
    const input = page.getByLabel("Text size", { exact: true });
    await input.fill((await input.inputValue()) === "16" ? "15" : "16");
    await page.getByRole("button", { name: contract.routePath.endsWith("/appearance") ? "Apply palette preset" : "Apply as active preset", exact: true }).click();
    await expect(page.locator('[data-setting-control="chart-preset"],[data-setting-control="palette-preview"]').getByRole("status")).toHaveText("Saved");
  } else if (contract.primaryAction === "save-backtest-settings") {
    await page.getByLabel("Default quantity", { exact: true }).fill("2500");
    await expect(page.locator('[data-setting-control="default-quantity"]').getByRole("status")).toHaveText("Saved");
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
  if (contract.primaryAction === "save-chart-settings") {
    await expect(page.getByLabel("Text size", { exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: contract.routePath.endsWith("/appearance") ? "Apply palette preset" : "Apply as active preset", exact: true })).toBeDisabled();
  } else if (contract.primaryAction === "save-backtest-settings") {
    await expect(page.getByLabel("Default quantity", { exact: true })).toHaveValue("2500");
    await expect(page.getByLabel("Default quantity", { exact: true })).toBeEnabled();
  } else if (contract.primaryAction === "save-journal-settings") {
    await expect(page.getByLabel("Currency", { exact: true })).toHaveValue(journalDefaultsCanary.default_currency);
    await expect(page.getByLabel("Broker label", { exact: true })).toHaveValue(journalDefaultsCanary.default_broker);
    await expect(page.getByRole("combobox", { name: "Default entry type", exact: true })).toHaveValue(journalDefaultsCanary.default_entry_type);
    await expect(page.getByRole("switch", { name: "Require account for taken trades", exact: true })).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Apply journal defaults", exact: true })).toBeDisabled();
  } else if (contract.primaryAction === "save-trade-review") {
    if (version === "modern") {
      await expect(page.getByRole("switch", { name: "Trade reviewed", exact: true })).toBeChecked();
      await expect(page.getByRole("button", { name: "4 star rating", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
      await expect(page.getByRole("textbox", { name: "Review note", exact: true })).toHaveValue("");
      await expect(page.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText("Rollback review canary");
    } else {
      const form = page.getByRole("form", { name: "Review BTCUSDT", exact: true });
      await expect(form.getByLabel("Reviewed", { exact: true })).toBeChecked();
      await expect(form.getByRole("combobox", { name: "Rating", exact: true })).toHaveValue("4");
      await expect(form.getByRole("combobox", { name: "Setup grade", exact: true })).toHaveValue("A+");
      await expect(form.getByRole("list", { name: "Saved trade notes", exact: true })).toContainText("Rollback review canary");
    }
  } else if (contract.primaryAction === "save-daily-note") {
    const isDashboard = contract.routePath === "/app/journal/dashboard";
    await expect(page.getByRole("textbox", { name: isDashboard ? "Session reflection" : "Daily note", exact: true })).toHaveValue(`Rollback daily-note canary ${contract.routePath}`);
    await expect(page.getByLabel("Date", { exact: true })).toHaveValue(noteDate);
    if (isDashboard) await expect(page).toHaveURL(new RegExp(`account=${seedAccount.id}`));
    else await expect(page.getByRole("combobox", { name: "Note scope", exact: true })).toHaveValue("all");
    await expect(page.getByRole("button", { name: "Save note", exact: true })).toBeDisabled();
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

function isJournalSettings(path: string) {
  return path === "/app/journal/settings" || path === "/app/settings/journal";
}
