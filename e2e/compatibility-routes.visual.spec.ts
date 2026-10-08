import { expectSettingsValue, selectSettingsOption, settingsValue } from "./support/settings-select";
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
    // Model the real reservation/recovery boundary alongside domain fixtures.
    // A successful fixture response alone must not bypass receipt validation.
    const receipts = new Map<string, { operation_id: string; method: string; path: string; status: string; http_status: number | null; result: null; created_at: string; completed_at: string | null }>();
    const completions = new Map<string, { promise: Promise<void>; resolve: () => void }>();
    page.on("response", (response) => {
      const request = response.request();
      const id = request.headers()["x-edgelab-operation-id"];
      if (!id) return;
      const receipt = receipts.get(id);
      expect(receipt).toBeTruthy();
      expect(receipt!.method).toBe(request.method());
      expect(receipt!.path).toBe(new URL(request.url()).pathname.replace(/^\/api/, ""));
      Object.assign(receipt!, { status: "completed", http_status: response.status(), completed_at: "2026-09-15T10:00:01Z" });
      completions.get(id)!.resolve();
    });
    await page.route("**/api/app-data/operations/**", async (route) => {
      const match = new URL(route.request().url()).pathname.match(/\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
      expect(match).not.toBeNull();
      expect(route.request().method()).toBe("POST");
      const [, id, action] = match!;
      if (action === "reserve") {
        expect(receipts.has(id)).toBe(false);
        const body = route.request().postDataJSON() as { method: string; path: string };
        expect(Object.keys(body).sort()).toEqual(["method", "path"]);
        receipts.set(id, { operation_id: id, ...body, status: "reserved", http_status: null, result: null, created_at: "2026-09-15T10:00:00Z", completed_at: null });
        let resolve!: () => void;
        const promise = new Promise<void>((complete) => { resolve = complete; });
        completions.set(id, { promise, resolve });
      }
      expect(receipts.has(id)).toBe(true);
      // Recovery waits for the matching mutation response, never an invented success.
      if (action === "recover") await completions.get(id)!.promise;
      await route.fulfill({ json: receipts.get(id) });
    });
    let chart = { presets: { namespace: "edgelab", key: "chart-settings-presets.v1", value: [{ name: "Settings default", settings: { textSize: 12 }, updatedAt: "2026-09-15T12:00:00Z" }], updated_at: "2026-09-15T12:00:00Z" }, active: { namespace: "edgelab", key: "active-chart-settings-preset.v1", value: "Settings default", updated_at: "2026-09-15T12:00:00Z" } };
    await page.route("**/api/settings/chart", async (route) => {
      if (route.request().method() === "PATCH") chart = { ...chart, presets: { ...chart.presets, value: [{ ...chart.presets.value[0], settings: { ...chart.presets.value[0].settings, ...route.request().postDataJSON() } }] } };
      await route.fulfill({ json: chart });
    });
    let preferences = { density: "comfortable", includeDiagnosticsByDefault: true };
    await page.route("**/api/app-storage/edgelab/settings-center.v1", (route) => route.fulfill({ json: { namespace: "edgelab", key: "settings-center.v1", value: preferences, updated_at: "2026-09-15T12:00:00Z" } }));
    await page.route("**/api/settings/preferences", (route) => {
      preferences = { ...preferences, ...route.request().postDataJSON() };
      return route.fulfill({ json: { namespace: "edgelab", key: "settings-center.v1", value: preferences, updated_at: "2026-09-15T12:00:00Z" } });
    });
    await page.route("**/api/quant/models", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/auth/session", async (route) => {
      if (route.request().method() === "DELETE") await route.fulfill({ status: 503, json: { detail: "Revocation unavailable" } });
      else await route.fallback();
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
      // Exercise failed sign-out after verifying the other settings saves.
      const orderedPaths = [...paths.filter((path) => path !== "/app/settings/account"), ...paths.filter((path) => path === "/app/settings/account")];
      for (const path of orderedPaths) {
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
  if (path === "/app/settings/storage") {
    await expect(page.getByRole("heading", { level: 1, name: "Storage settings", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Portable data", exact: true })).toBeVisible();
    await expect(page.getByLabel("Workspace density")).toHaveCount(0);
  } else if (["/app/settings", "/app/settings/global"].includes(path)) {
    await expect(page.locator("#setting-regional-format")).toContainText("Interface formatting locale");
    await expect(page.getByLabel("Workspace density")).toHaveCount(0);
  } else if (path === "/app/settings/ai") {
    await expect(page.locator("#setting-ai-routing")).toContainText("The server returned no configured models.");
  } else if (path === "/app/settings/account") {
    await expect(page.getByRole("button", { name: "End session and sign out" })).toBeEnabled();
  } else if (path === "/app/settings/privacy-security") {
    await expect(page.getByRole("switch", { name: "Include diagnostics by default" })).toBeEnabled();
    await expect(page.locator("#setting-device-permissions")).toContainText("restricted EdgeLab indicator language");
  } else if (["/app/settings/chart", "/app/settings/appearance"].includes(path)) {
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
  } else if (group === "public") {
    const heading = path === "/pricing" ? /Current access, without fine print|One workspace. Every decision/ : path === "/privacy" ? "Privacy Policy" : path === "/terms" ? "Terms of Use" : path === "/auth/signin" ? "Continue to EdgeLab." : /Make every trade.*worth reviewing/;
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText(/Pre-redesign|Compatibility interface active|policy compatibility-route/)).toHaveCount(0);
  }
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
  await selectSettingsOption(density, (await settingsValue(density)) === "compact" ? "comfortable" : "compact");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
  return page.evaluate(() => sessionStorage.getItem("edgelab.compatibility.settings-draft.v1"));
}

async function executeCompatibilityPrimaryAction(page: Page, contract: CompatibilityRouteParity, journal: JournalFixture | null, journalSettings: JournalSettingsFixture | null) {
  if (contract.primaryAction === "end-session") {
    await page.getByRole("button", { name: "End session and sign out" }).click();
    await expect(page.locator("#setting-current-session").getByRole("alert")).toContainText("You remain signed in");
    await expect(page).toHaveURL(/\/app\/settings\/account$/);
  } else if (contract.primaryAction === "save-diagnostic-preference") {
    const diagnostic = page.getByRole("switch", { name: "Include diagnostics by default" });
    await diagnostic.setChecked(false);
    await expect(page.locator("#setting-diagnostic-sharing").getByRole("status")).toHaveText("Saved");
  } else if (contract.primaryAction === "refresh-journal") {
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
    await selectSettingsOption(page.getByRole("combobox", { name: "Default entry type", exact: true }), journalDefaultsCanary.default_entry_type);
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
    await selectSettingsOption(density, (await settingsValue(density)) === "compact" ? "comfortable" : "compact");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
  } else if (contract.primaryAction === "restore-replay-layout") {
    await expect(page.locator("[data-compatibility-replay]")).not.toHaveText("Loading active replay…");
  } else if (contract.primaryAction === "replace-account-data") {
    // Full staged import and failure recovery run in the dedicated transfer gate.
    expect(contract.kind).toBe("writable");
    expect(contract.canarySpec).toBe("e2e/compatibility-settings.interaction.spec.ts");
    await expect(page.getByRole("button", { name: "Import JSON bundle", exact: true })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Manage subscription", exact: true })).toHaveAttribute("href", "/account");
  } else if (contract.primaryAction === "begin-checkout" || contract.primaryAction === "begin-signin") {
    // Mutating auth/checkout canaries run against exact provider fixtures in their
    // dedicated suite; this route round-trip checks their canonical UI survives.
    expect(contract.kind).toBe("shared-domain");
    expect(contract.canarySpec).toBe("e2e/public-fallback67.interaction.spec.ts");
    await expect(page.getByRole("main")).toBeVisible();
  } else {
    expect(contract.kind).toBe("read-only");
    expect(contract.draftKey).toBeNull();
  }
}

async function expectJournalWriteCanary(page: Page, contract: CompatibilityRouteParity, version: "modern" | "fallback") {
  if (contract.primaryAction === "save-diagnostic-preference") {
    await expect(page.getByRole("switch", { name: "Include diagnostics by default" })).not.toBeChecked();
    await expect(page.locator("#setting-diagnostic-sharing")).toContainText("Effective: Excluded by default");
  } else if (contract.primaryAction === "end-session") {
    await expect(page.getByRole("button", { name: "End session and sign out" })).toBeEnabled();
  } else if (contract.primaryAction === "save-chart-settings") {
    await expect(page.getByLabel("Text size", { exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: contract.routePath.endsWith("/appearance") ? "Apply palette preset" : "Apply as active preset", exact: true })).toBeDisabled();
  } else if (contract.primaryAction === "save-backtest-settings") {
    await expect(page.getByLabel("Default quantity", { exact: true })).toHaveValue("2500");
    await expect(page.getByLabel("Default quantity", { exact: true })).toBeEnabled();
  } else if (contract.primaryAction === "save-journal-settings") {
    await expect(page.getByLabel("Currency", { exact: true })).toHaveValue(journalDefaultsCanary.default_currency);
    await expect(page.getByLabel("Broker label", { exact: true })).toHaveValue(journalDefaultsCanary.default_broker);
    await expectSettingsValue(page.getByRole("combobox", { name: "Default entry type", exact: true }), journalDefaultsCanary.default_entry_type);
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
