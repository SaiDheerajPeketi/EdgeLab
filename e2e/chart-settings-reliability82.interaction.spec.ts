import { expect, test, type Page } from "@playwright/test";
import { gotoStable } from "./support/app";
import { fulfillReplayContext, prepare } from "./support/replay-context";

test.use({ video: "off" });

async function openSettings(page: Page) {
  if (!(await page.locator(".chart-studio-toolbar").isVisible())) await page.locator("[data-chart-header-control=tools]").click();
  await page.locator(".chart-studio-toolbar").getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Chart settings", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function setup(page: Page) {
  await prepare(page);
  await fulfillReplayContext(page);
  const presets = [
    { name: "Morning", settings: { textSize: 12, watermarkText: "Morning" }, updatedAt: "2026-09-15T10:00:00Z" },
    { name: "Evening", settings: { textSize: 16, watermarkText: "Evening" }, updatedAt: "2026-09-15T11:00:00Z" },
  ];
  const values: Record<string, unknown> = { "chart-settings-presets.v1": presets, "active-chart-settings-preset.v1": "Morning" };
  await page.route("**/api/settings/chart/templates", async (route) => {
    const { action, name, settings } = route.request().postDataJSON();
    const current = values["chart-settings-presets.v1"] as typeof presets;
    if (action === "save") values["chart-settings-presets.v1"] = [{ name, settings, updatedAt: "2026-10-08T12:00:00Z" }, ...current.filter((entry) => entry.name !== name)];
    if (action === "delete") values["chart-settings-presets.v1"] = current.filter((entry) => entry.name !== name);
    values["active-chart-settings-preset.v1"] = action === "delete" ? (values["active-chart-settings-preset.v1"] === name ? (values["chart-settings-presets.v1"] as typeof presets)[0]?.name ?? null : values["active-chart-settings-preset.v1"]) : name;
    const item = (key: string) => ({ namespace: "edgelab", key, value: values[key], updated_at: "2026-10-08T12:00:00Z" });
    await route.fulfill({ json: { active: item("active-chart-settings-preset.v1"), presets: item("chart-settings-presets.v1") } });
  });
  await page.route("**/api/app-storage/edgelab/*", async (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    if (route.request().method() === "PUT") values[key] = route.request().postDataJSON().value;
    await route.fulfill({ json: { namespace: "edgelab", key, value: values[key] ?? null, updated_at: "2026-09-15T10:30:00Z" } });
  });
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-pane-grid canvas").first()).toBeVisible();
  const dialog = await openSettings(page);
  await dialog.getByRole("button", { name: /^Morning (Active|Modified|Use)$/ }).click();
  return { dialog, values };
}

test("typing an existing template name cannot activate it or delete it", async ({ page }, info) => {
  const { dialog, values } = await setup(page);
  const status = dialog.locator(".chart-settings-template-status strong");
  await expect(status).toHaveText("Morning");
  await dialog.getByRole("textbox", { name: "Template name", exact: true }).fill("Evening");
  await expect(status).toHaveText("Morning");
  await expect(dialog.getByRole("button", { name: "Evening Use", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toHaveAttribute("title", "Delete Morning");
  await dialog.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(dialog.getByLabel("Text size", { exact: true })).toHaveValue("12");
  const colorControls = await dialog.locator(".chart-settings-color-field .themed-color-picker").evaluateAll((controls) => controls.map((control) => {
    const bounds = control.getBoundingClientRect();
    return [...control.querySelectorAll("button, input")].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.left >= bounds.left && rect.right <= bounds.right;
    });
  }));
  expect(colorControls.every(Boolean)).toBe(true);
  await dialog.getByLabel("Text size", { exact: true }).fill("14");
  await expect(status).toHaveText("Morning · Modified");
  await page.screenshot({ path: info.outputPath("chart-template-modified.png") });
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Evening Use", exact: true })).toBeVisible();
  await expect(status).toHaveText("Unsaved");
  await expect(dialog.getByLabel("Text size", { exact: true })).toHaveValue("14");
  await expect.poll(() => (values["chart-settings-presets.v1"] as Array<{ name: string }>).map((value) => value.name)).toEqual(["Evening"]);
});

test("background template acknowledgements preserve an unfinished name through closing and reopening", async ({ page }) => {
  const { dialog, values } = await setup(page);
  const name = dialog.getByRole("textbox", { name: "Template name", exact: true });
  await name.fill("My new template");
  await page.evaluate(async () => {
    const modulePath = "/src/lib/serverStorage.ts";
    const storage = await import(modulePath);
    const presets = storage.getCachedAppStorageItem("chart-settings-presets.v1", []);
    await storage.saveAppStorageItem("chart-settings-presets.v1", [...presets, { name: "Background", settings: { textSize: 13 }, updatedAt: "2026-09-15T12:00:00Z" }]);
  });
  await expect(dialog.getByRole("button", { name: "Background Use", exact: true })).toBeVisible();
  await expect(name).toHaveValue("My new template");
  await dialog.getByRole("button", { name: "Close chart settings", exact: true }).click();
  const reopened = await openSettings(page);
  await expect(reopened.getByRole("textbox", { name: "Template name", exact: true })).toHaveValue("My new template");
  await reopened.getByRole("button", { name: "Save Template", exact: true }).click();
  await expect(reopened).toBeHidden();
  await expect.poll(() => (values["chart-settings-presets.v1"] as Array<{ name: string }>).some((value) => value.name === "My new template")).toBe(true);
  await expect.poll(() => values["active-chart-settings-preset.v1"]).toBe("My new template");
  const saved = await openSettings(page);
  await expect(saved.locator(".chart-settings-template-status strong")).toHaveText("My new template");
});
