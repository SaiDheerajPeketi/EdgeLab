import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";
import { fulfillReplayContext, prepare } from "./support/replay-context";

test.use({ video: "off" });

let fixtureScript: string;
let fixtureCss: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { ThemedSelect } from "./src/components/ThemedSelect";
      function Fixture() {
        const [revision, refresh] = useState(0);
        const [insert, setInsert] = useState(false);
        const [removed, setRemoved] = useState(false);
        const [disabled, setDisabled] = useState(false);
        const [choice, setChoice] = useState("");
        const options = [{ label: "All currencies", value: "all" }, { label: "USD", value: "usd" },
          ...(insert ? [{ label: "EUR", value: "eur" }] : []),
          ...(!removed ? [{ label: "GBP", value: "gbp" }] : []),
          { label: "Unavailable", value: "disabled", disabled: true }];
        return <main style={{ padding: 24, maxWidth: 500 }}>
          <h1>Dropdown regression fixture</h1>
          <ThemedSelect ariaLabel="Currency" defaultValue="all" options={options} disabled={disabled} onChange={setChoice} portal />
          <output aria-label="Chosen currency">{choice}</output>
          <button id="refresh" onClick={() => refresh(revision + 1)}>Refresh options</button>
          <button id="insert" onClick={() => setInsert(true)}>Insert EUR</button>
          <button id="remove" onClick={() => setRemoved(true)}>Remove GBP</button>
          <button id="disable" onClick={() => setDisabled(true)}>Disable dropdown</button>
          <button id="theme" onClick={() => {
            for (const [key, value] of Object.entries({ "--ui-inset": "rgb(240, 241, 242)", "--ui-floating": "rgb(250, 251, 252)", "--text-primary": "rgb(20, 21, 22)", "--text-secondary": "rgb(60, 61, 62)" })) document.documentElement.style.setProperty(key, value);
          }}>Change theme tokens</button>
        </main>;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    `, resolveDir: path.resolve("frontend"), loader: "tsx" },
    bundle: true, write: false, format: "iife", jsx: "automatic",
  });
  fixtureScript = bundle.outputFiles[0].text;
  const assets = path.resolve("frontend/dist/assets");
  fixtureCss = fs.readdirSync(assets).filter((name) => name.endsWith(".css")).map((name) => fs.readFileSync(path.join(assets, name), "utf8")).join("\n");
});

async function openFixture(page: Page) {
  await page.route("**/settings-menu-fixture76", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture76.css"></head><body><div id="root"></div><script src="/fixture76.js"></script></body></html>' }));
  await page.route("**/fixture76.css", (route) => route.fulfill({ contentType: "text/css", body: fixtureCss }));
  await page.route("**/fixture76.js", (route) => route.fulfill({ contentType: "text/javascript", body: fixtureScript }));
  await page.goto("/settings-menu-fixture76");
}

// Programmatic fixture controls simulate background catalog refreshes without
// a pointer event dismissing the open dropdown, as a real network refresh would.
async function backgroundUpdate(page: Page, id: string) {
  await page.evaluate((target) => document.getElementById(target)!.click(), id);
}

async function expectHighlight(page: Page, label: string) {
  const option = page.getByRole("option", { name: label, exact: true });
  await expect(option).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Currency" })).toHaveAttribute("aria-activedescendant", (await option.getAttribute("id"))!);
}

test("typeahead and highlighted value survive equivalent and reordered catalog refreshes", async ({ page }) => {
  await openFixture(page);
  const select = page.getByRole("combobox", { name: "Currency" });
  await select.press("g");
  await expectHighlight(page, "GBP");
  await backgroundUpdate(page, "refresh");
  await expectHighlight(page, "GBP");
  await backgroundUpdate(page, "insert");
  await expect(page.getByRole("option", { name: "EUR", exact: true })).toBeVisible();
  await expectHighlight(page, "GBP");
  await select.press("Enter");
  await expect(select).toHaveText("GBP");
  await expect(page.getByLabel("Chosen currency")).toHaveText("gbp");
  await backgroundUpdate(page, "refresh");
  await expect(select).toHaveText("GBP");
  await select.press("ArrowDown");
  await expectHighlight(page, "GBP");
  await backgroundUpdate(page, "remove");
  await expectHighlight(page, "All currencies");
  await select.press("Enter");
  await expect(select).toHaveText("All currencies");
});

test("shared dropdown follows theme tokens, skips disabled options and dismisses when disabled", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Change theme tokens" }).click();
  const select = page.getByRole("combobox", { name: "Currency" });
  await expect(select).toHaveCSS("background-color", "rgb(240, 241, 242)");
  await expect(select).toHaveCSS("color", "rgb(20, 21, 22)");
  await select.press("ArrowDown");
  await expect(page.getByRole("listbox")).toHaveCSS("background-color", "rgb(250, 251, 252)");
  await select.press("End");
  await expectHighlight(page, "GBP");
  await backgroundUpdate(page, "disable");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(select).toHaveAttribute("aria-expanded", "false");
  await expect(select).toBeDisabled();
});

test("settings search dismisses by Escape, outside click and blur, and mouse/keyboard results navigate", async ({ page }, info) => {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await page.route("**/api/integration-secrets", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await gotoStable(page, "/app/settings/chart", { waitForNetworkIdle: false });
  const search = page.getByRole("combobox", { name: "Search settings", exact: true });
  await search.fill("broker");
  await expect(page.getByRole("listbox")).toBeVisible();
  await search.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(search).toHaveValue("broker");
  await search.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("heading", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await search.focus();
  await expect(page.getByRole("listbox")).toBeVisible();
  const category = page.viewportSize()!.width >= 1024
    ? page.getByRole("button", { name: "Chart", exact: true })
    : page.getByRole("combobox", { name: "Settings category", exact: true });
  await category.focus();
  await expect(page.getByRole("listbox")).toBeHidden();
  await search.fill("nonsensical-search-query76");
  const empty = page.getByRole("status").filter({ hasText: "No supported setting matches" });
  await expect(empty).toBeVisible();
  await search.press("Escape");
  await expect(empty).toBeHidden();
  await search.fill("broker");
  const firstResult = page.getByRole("listbox").getByRole("button").first();
  const label = await firstResult.locator("span").first().innerText();
  await firstResult.click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await search.fill("density");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page.getByLabel("Settings density", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath("settings-search-dismissed.png"), fullPage: true });
});

test("startup ignores crowded saved panel state while restoring the saved chart", async ({ page }, info) => {
  await prepare(page);
  await fulfillReplayContext(page);
  const layout = {
    chartStyle: "candles", drawings: [], indicatorInstances: [], magnetMode: "off",
    paneLayout: "single", schemaVersion: 2, settingsDefaultsVersion: 2,
    showOrderOverlays: true, smoothCandles: false, timeframe: "5m",
    panelState: { activePanel: "review", layersPanelOpen: true, orderPanelOpen: true, sidebarCollapsed: false },
  };
  const records = [{ name: "Crowded review", revision: 0, updatedAt: new Date().toISOString(), layout }];
  // Hydrate acknowledged account storage; local migration is intentionally
  // unavailable for sessions that have already adopted account isolation.
  await page.route("**/api/app-storage/edgelab/*", async (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    const value = key === "chart-layout.v1" ? layout : key === "chart-layouts.v1" ? records : null;
    await route.fulfill({ json: { namespace: "edgelab", key, value, updated_at: new Date().toISOString() } });
  });
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-pane-grid canvas").first()).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "Journal" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Collapse chart objects" })).toBeHidden();
  await expect(page.locator(".focus-side-drawer")).toBeHidden();
  await expect(page.locator(".chart-studio-toolbar")).toBeHidden();
  expect(await page.locator(".chart-pane-grid").evaluate((element) => element.getBoundingClientRect().width / innerWidth)).toBeGreaterThan(0.7);
  await page.screenshot({ path: info.outputPath("replay-chart-clear.png"), fullPage: false });
  await page.locator("[data-chart-header-control=tools]").click();
  await page.locator(".chart-studio-toolbar").getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chart settings" });
  await expect(dialog).toBeVisible();
  // Change semantic colours on the real chart settings surface, checking that
  // its shared inputs and panels do not retain fixed dark palette colours.
  await page.evaluate(() => {
    for (const [key, value] of Object.entries({ "--ui-inset": "rgb(240, 241, 242)", "--ui-floating": "rgb(250, 251, 252)", "--text-primary": "rgb(20, 21, 22)", "--ui-selection": "rgb(220, 222, 224)" })) document.documentElement.style.setProperty(key, value);
  });
  await expect(dialog.locator(".chart-settings-popover")).toHaveCSS("background-color", "rgb(250, 251, 252)");
  await expect(dialog.locator(".chart-settings-popover")).toHaveCSS("color", "rgb(20, 21, 22)");
  await expect(dialog.locator(".input-control").first()).toHaveCSS("background-color", "rgb(240, 241, 242)");
  await expect(dialog.locator(".input-control").first()).toHaveCSS("color", "rgb(20, 21, 22)");
  const activeTab = dialog.locator(".chart-settings-nav-button-active");
  await activeTab.hover();
  await expect(activeTab).toHaveCSS("background-color", "rgb(220, 222, 224)");
  await expect(dialog.getByRole("navigation", { name: "Chart settings sections" })).toHaveCSS("display", page.viewportSize()!.width <= 720 ? "flex" : "grid");
  await page.evaluate(() => { for (const key of ["--ui-inset", "--ui-floating", "--text-primary", "--ui-selection"]) document.documentElement.style.removeProperty(key); });
  if (page.viewportSize()!.width <= 640) {
    const bounds = await dialog.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeLessThanOrEqual(8);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await page.screenshot({ path: info.outputPath("chart-settings-theme.png"), fullPage: false });
  await dialog.getByRole("button", { name: "Save Template", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Save Template", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.locator('[data-motion="workspace-panel-trigger"]').click();
  await expect(page.getByRole("tabpanel", { name: "Journal" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse workspace panel", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "Journal" })).toBeHidden();
  if (!(await page.locator(".chart-studio-toolbar").isVisible())) await page.locator("[data-chart-header-control=tools]").click();
  await page.getByRole("combobox", { name: "Saved layouts", exact: true }).click();
  await page.getByRole("option", { name: "Crowded review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Collapse chart objects" })).toBeVisible();
  await expect(page.locator(".focus-side-drawer")).toBeVisible();
});


test("invalid provider status shows Retry and recovers without blanking settings", async ({ page }) => {
  await installDeterminism(page);
  await seedApprovedSession(page);
  let invalid = true;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/integration-secrets", (route) => route.fulfill({ contentType: "application/json", body: invalid ? "{}" : "[]" }));
  await gotoStable(page, "/app/settings/data-providers", { waitForNetworkIdle: false });
  await expect(page.getByText("Connection status returned an invalid response. Retry the status check.")).toBeVisible();
  invalid = false;
  await page.getByRole("button", { name: "Retry status check" }).click();
  await expect(page.getByText("No credential records.")).toBeVisible();
  expect(errors).toEqual([]);
});
