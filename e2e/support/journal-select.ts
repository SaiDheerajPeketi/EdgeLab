import { expect, type Locator } from "@playwright/test";

async function isNative(control: Locator) {
  return control.evaluate((node) => node.tagName === "SELECT");
}

async function openOptions(control: Locator) {
  const menuId = await control.getAttribute("aria-controls");
  if (!menuId) throw new Error("Journal combobox has no associated listbox");
  if (await control.getAttribute("aria-expanded") !== "true") await control.click();
  const menu = control.page().locator(`[id=${JSON.stringify(menuId)}]`);
  await expect(menu).toBeVisible();
  return menu;
}

export async function selectJournalOption(control: Locator, value: string, label = value) {
  if (await isNative(control)) return control.selectOption(value);
  const menu = await openOptions(control);
  await menu.getByRole("option", { name: label, exact: true }).click();
}

export async function expectJournalValue(control: Locator, value: string, label = value) {
  if (await isNative(control)) return expect(control).toHaveValue(value);
  await expect(control).toHaveText(label);
}

export async function expectJournalOption(control: Locator, label: string, present = true) {
  const native = await isNative(control);
  const menu = native ? control : await openOptions(control);
  try {
    await expect(menu.getByRole("option", { name: label, exact: true })).toHaveCount(present ? 1 : 0);
  } finally {
    if (!native) await control.press("Escape");
  }
}
