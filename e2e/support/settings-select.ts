import { expect, type Locator } from "@playwright/test";
import { SETTINGS_CATEGORIES } from "../../frontend/src/components/settings/settingsCatalog";

const labels: Record<string, Record<string, string>> = {
  "Settings category": Object.fromEntries(SETTINGS_CATEGORIES.map(({ id, label }) => [id, label])),
  "Default entry type": { TAKEN: "Taken", MISSED: "Missed" },
  "Settings density": { comfortable: "Comfortable", compact: "Compact" },
  Hours: { "12-hour": "12-hour", "24-hour": "24-hour" },
  "Date format": { "dd MMM yy": "31 Dec 26", "MMM dd yyyy": "Dec 31 2026", "yyyy-MM-dd": "2026-12-31" },
  Grid: { both: "Horizontal and vertical", horizontal: "Horizontal", vertical: "Vertical", none: "None" },
  "Sizing mode": { quantity: "Fixed quantity", risk: "Percent risk" },
  "Risk basis": { CURRENT_BALANCE: "Current balance", INITIAL_BALANCE: "Initial balance" },
  "Commission mode": { NONE: "None", FIXED: "Fixed", PERCENT: "Percent" },
  "Fee mode": { NONE: "None", FIXED: "Fixed", PERCENT: "Percent" },
  Instrument: { eurusd: "Euro dollar · EURUSD", gbpusd: "Pound dollar · GBPUSD" },
};
async function labelFor(control: Locator, value: string) {
  const name = await control.getAttribute("aria-label");
  const label = labels[name ?? ""]?.[value];
  if (!label) throw new Error(`Missing settings option label: ${name} / ${value}`);
  return label;
}
export async function selectSettingsOption(control: Locator, value: string) {
  if (await control.evaluate((node) => node.tagName === "SELECT")) return control.selectOption(value);
  const label = await labelFor(control, value);
  const menuId = await control.getAttribute("aria-controls");
  await control.click();
  await control.page().locator(`[id="${menuId}"]`).getByRole("option", { name: label, exact: true }).click();
}
export async function expectSettingsValue(control: Locator, value: string) {
  if (await control.evaluate((node) => node.tagName !== "BUTTON")) return expect(control).toHaveValue(value);
  await expect(control).toHaveText(await labelFor(control, value));
}
export async function settingsValue(control: Locator) {
  if (await control.evaluate((node) => node.tagName !== "BUTTON")) return control.inputValue();
  const name = await control.getAttribute("aria-label");
  const text = (await control.innerText()).trim();
  const entry = Object.entries(labels[name ?? ""] ?? {}).find(([, label]) => label === text);
  if (!entry) throw new Error(`Unknown settings selection: ${name} / ${text}`);
  return entry[0];
}
