import { expect, test, type Locator } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { gotoStable, installDeterminism, seedApprovedSession } from "./support/app";

// Contrasting semantic palettes test inheritance, not an application theme chooser.
const palettes = {
  light: { primary: "#172635", secondary: "#405162", surface: "#f5eee3", inset: "#e3d8c8", floating: "#faf3e8", selection: "#c2d5e6", focus: "#653b83", profit: "#17603a", loss: "#91243a", warning: "#77501a" },
  dark: { primary: "#edf4fa", secondary: "#c6d7e5", surface: "#152330", inset: "#0c1720", floating: "#233647", selection: "#354e66", focus: "#a7dfff", profit: "#a0edbe", loss: "#ffb0c1", warning: "#ffcf88" },
};
const rgb = (hex: string) => `rgb(${[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(", ")})`;

async function colors(locator: Locator) {
  return locator.evaluate(node => {
    const styles = getComputedStyle(node);
    return { color: styles.color, background: styles.backgroundColor };
  });
}

for (const [name, palette] of Object.entries(palettes)) {
  test(`${name} journal notes and review preserve readable themes, drafts and nested choices`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await installDeterminism(page);
    await seedApprovedSession(page);
    await gotoStable(page, "/app/journal/notes", { waitForNetworkIdle: false });
    const heading = page.getByRole("heading", { name: "Daily notes", exact: true });
    await expect(heading).toBeVisible();
    await page.evaluate(palette => {
      const tokens = {
        "--ui-canvas": palette.surface, "--ui-surface": palette.surface,
        "--ui-modal": palette.surface, "--ui-floating": palette.floating,
        "--ui-inset": palette.inset, "--ui-raised": palette.inset,
        "--ui-hover": palette.selection, "--ui-selection": palette.selection,
        "--text-primary": palette.primary, "--text-secondary": palette.secondary,
        "--text-accent": palette.focus, "--ui-focus": palette.focus,
        "--ui-border-subtle": palette.secondary, "--ui-border-strong": palette.secondary,
        "--profit-text": palette.profit, "--loss-text": palette.loss,
        "--warning-text": palette.warning,
      };
      for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value);
    }, palette);
    expect((await colors(heading)).color).toBe(rgb(palette.primary));
    const note = page.getByRole("textbox", { name: "Daily note", exact: true });
    await expect(note).toBeVisible();
    expect(await colors(note)).toEqual({ color: rgb(palette.primary), background: rgb(palette.inset) });
    const folder = path.join(".artifacts/journal-theme193", info.project.name, name);
    fs.mkdirSync(folder, { recursive: true });
    await page.screenshot({ path: path.join(folder, "notes.png") });

    const scope = page.getByRole("combobox", { name: "Note scope", exact: true });
    await scope.scrollIntoViewIfNeeded();
    await scope.focus();
    await scope.press("ArrowDown");
    const scopeMenu = page.getByRole("listbox", { name: "Note scope", exact: true });
    await expect(scopeMenu).toBeVisible();
    expect(await colors(scopeMenu)).toEqual({ color: rgb(palette.primary), background: rgb(palette.floating) });
    await scope.press("Escape");
    await expect(scopeMenu).toBeHidden();
    await expect(scope).toBeFocused();

    await page.getByRole("button", { name: /^Open BTCUSDT trade,/ }).click();
    const drawer = page.locator("[data-journal-review-drawer]");
    await expect(drawer).toBeVisible();
    const title = drawer.getByRole("heading", { name: "Review BTCUSDT", exact: true });
    expect((await colors(title)).color).toBe(rgb(palette.primary));
    expect((await colors(drawer)).background).toBe(rgb(palette.surface));
    expect((await colors(drawer.locator("footer"))).background).toBe(rgb(palette.surface));
    const reviewNote = drawer.getByRole("textbox", { name: "Review note", exact: true });
    await reviewNote.fill("193 owned review draft");
    const grade = drawer.getByRole("combobox", { name: "Setup grade", exact: true });
    await grade.scrollIntoViewIfNeeded();
    await grade.focus();
    await grade.press("ArrowDown");
    const gradeMenu = page.getByRole("listbox", { name: "Setup grade", exact: true });
    await expect(gradeMenu).toBeVisible();
    expect(await colors(gradeMenu)).toEqual({ color: rgb(palette.primary), background: rgb(palette.floating) });
    await grade.press("Escape");
    await expect(gradeMenu).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(grade).toBeFocused();
    await grade.click();
    await gradeMenu.getByRole("option", { name: "B", exact: true }).click();
    await expect(grade).toContainText("B");
    await expect(reviewNote).toHaveValue("193 owned review draft");
    const reviewed = drawer.getByRole("switch", { name: "Trade reviewed", exact: true });
    const initial = await reviewed.getAttribute("aria-checked");
    await reviewed.focus();
    await reviewed.press("Space");
    await expect(reviewed).toHaveAttribute("aria-checked", initial === "true" ? "false" : "true");
    const box = await reviewed.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    await title.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(folder, "review.png") });
    await drawer.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(heading).toBeVisible();
    expect(errors).toEqual([]);
    fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ qualification: "Actual product components with API fixture seams and explicitly injected semantic palettes; no browser theme chooser claim.", errors, grade: "B", reviewedTarget: box, draftRetained: true }, null, 2));
  });
}
