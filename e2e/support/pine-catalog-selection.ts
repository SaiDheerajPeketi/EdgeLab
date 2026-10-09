import { expect, type Locator } from "@playwright/test";
import fs from "node:fs";
const catalog = JSON.parse(fs.readFileSync("frontend/src/lib/pineCatalogManifestV2.json", "utf8")) as { entries: Array<{ id: string; name: string; pineVersion: number }> };

export async function selectPineCatalogScript(browser: Locator, id: string) {
  const entry = catalog.entries.find(item => item.id === id);
  if (!entry) throw new Error(`Unknown packaged catalog ID: ${id}`);
  const trigger = browser.getByRole("combobox", { name: "Script", exact: true });
  await trigger.click();
  const menu = browser.page().getByRole("listbox", { name: "Script", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("option", { name: `${entry.name} · v${entry.pineVersion} · ${entry.pineVersion >= 5 ? "experimental" : "migration needed"}`, exact: true }).click();
  await expect(menu).toBeHidden();
}

export async function expectPineCatalogOptionCount(browser: Locator, count: number) {
  const trigger = browser.getByRole("combobox", { name: "Script", exact: true });
  await trigger.click();
  const menu = browser.page().getByRole("listbox", { name: "Script", exact: true });
  await expect(menu.getByRole("option")).toHaveCount(count);
  await trigger.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
}
