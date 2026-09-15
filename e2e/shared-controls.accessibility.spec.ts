import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const harness = buildSync({
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  stdin: {
    contents: `
      import React, { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { RadioGroup, SegmentedControl, Slider, Toggle } from "./frontend/src/components/ui/Primitives";

      function Harness() {
        const [extended, setExtended] = useState(false);
        const [primary, setPrimary] = useState("market");
        const [secondary, setSecondary] = useState("limit");
        const [slippage, setSlippage] = useState(1234.5);
        const [period, setPeriod] = useState("day");
        return <main>
          <Toggle checked={extended} label="Extended hours" onChange={setExtended} />
          <RadioGroup label="Order type" value={primary} onChange={setPrimary} options={[{ label: "Market", value: "market" }, { label: "Limit", value: "limit" }]} />
          <RadioGroup label="Order type" value={secondary} onChange={setSecondary} options={[{ label: "Market", value: "market" }, { label: "Limit", value: "limit" }]} />
          <Slider label="Slippage budget" value={slippage} min={1000} max={1500} step={0.5} unit=" ms" onChange={setSlippage} />
          <SegmentedControl label="Report period" value={period} onChange={setPeriod} options={[{ label: "Day", value: "day" }, { label: "Week", value: "week" }]} />
        </main>;
      }
      createRoot(document.getElementById("root")).render(<Harness />);
    `,
    loader: "tsx",
    resolveDir: root,
    sourcefile: "shared-controls-harness.tsx",
  },
}).outputFiles[0].text;

test.describe("shared controls rendered accessibility contract", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.lang = "de-DE";
      document.documentElement.dataset.density = "touch";
      document.body.innerHTML = '<div id="root"></div>';
    });
    await page.addScriptTag({ content: harness });
  });

  test("switch keeps a stable accessible name and toggles from keyboard", async ({ page }) => {
    const control = page.getByRole("switch", { name: "Extended hours", exact: true });
    await expect(control).toHaveAttribute("aria-checked", "false");
    await control.focus();
    await page.keyboard.press("Space");
    await expect(control).toHaveAttribute("aria-checked", "true");
    await expect(control).toHaveAccessibleName("Extended hours");
    const box = await control.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });

  test("repeated radio labels remain separate keyboard groups", async ({ page }) => {
    const groups = page.getByRole("group", { name: "Order type" });
    await expect(groups).toHaveCount(2);
    const firstNames = await groups.nth(0).getByRole("radio").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).name));
    const secondNames = await groups.nth(1).getByRole("radio").evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).name));
    expect(new Set(firstNames).size).toBe(1);
    expect(new Set(secondNames).size).toBe(1);
    expect(firstNames[0]).not.toBe(secondNames[0]);
    const firstMarket = groups.nth(0).getByRole("radio", { name: "Market" });
    await firstMarket.focus();
    await page.keyboard.press("ArrowDown");
    await expect(groups.nth(0).getByRole("radio", { name: "Limit" })).toBeChecked();
    await expect(groups.nth(1).getByRole("radio", { name: "Limit" })).toBeChecked();
  });

  test("slider and segmented control expose values and keyboard state", async ({ page }) => {
    const slider = page.getByRole("slider", { name: "Slippage budget" });
    await expect(slider).toHaveAttribute("aria-valuetext", "1.234,5 ms");
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuetext", "1.235 ms");
    const week = page.getByRole("button", { name: "Week" });
    await week.focus();
    await page.keyboard.press("Enter");
    await expect(week).toHaveAttribute("aria-pressed", "true");
    const box = await week.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});
