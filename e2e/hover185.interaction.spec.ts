import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String)
  .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const hashes = () => Object.fromEntries(["e2e/hover185.config.ts", "e2e/hover185.interaction.spec.ts"]
  .map(file => [file, hash(fs.readFileSync(file))]));

for (const kind of ["Ticket", "Objects", "Tools"]) test(`real mouse opens ${kind} on a touch-capable desktop without changing device media`, async ({ page }) => {
  const beforeSeal = seal(), beforeHashes = hashes(), pointerEvents: any[] = [], errors: string[] = [], knownSandboxErrors: string[] = [];
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") knownSandboxErrors.push(error.message);
    else errors.push(error.message);
  });
  await page.addInitScript(() => {
    (window as any).__hover185Pointers = [];
    addEventListener("pointerover", event => {
      const target = event.target as Element;
      const button = target.closest("button");
      if (button) (window as any).__hover185Pointers.push({ pointerType: event.pointerType, text: button.textContent,
        label: button.getAttribute("aria-label"), x: event.clientX, y: event.clientY });
    }, true);
  });
  const fixture = await liveViewportSetup(page, false, "/app/replay");
  const trigger = kind === "Tools" ? page.locator('[data-motion="workspace-panel-trigger"]')
    : page.getByRole("button", { name: kind, exact: true }).first();
  const preview = kind === "Tools" ? page.getByRole("complementary", { name: "Chart tools", exact: true })
    : page.getByRole("dialog", { name: `${kind} preview`, exact: true });
  const folder = path.resolve(".artifacts/hover185", kind.toLowerCase()); fs.mkdirSync(folder, { recursive: true });
  await page.mouse.move(0, 0); await page.locator("#workspace-content").focus();
  if (kind !== "Tools") await expect(preview).toHaveCount(0);
  await expect(preview).toBeHidden();
  const media = await page.evaluate(() => ({ primaryHover: matchMedia("(hover: hover)").matches,
    anyHover: matchMedia("(any-hover: hover)").matches, coarse: matchMedia("(pointer: coarse)").matches, maxTouchPoints: navigator.maxTouchPoints }));
  expect(media.maxTouchPoints).toBeGreaterThan(0);
  try {
    expect(media.primaryHover).toBe(false);
    await trigger.hover();
    pointerEvents.push(...await page.evaluate(() => (window as any).__hover185Pointers));
    expect(pointerEvents.some(event => event.pointerType === "mouse")).toBe(true);
    await expect(preview).toBeVisible();
    const box = await preview.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
    expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 80, { steps: 8 });
    await page.waitForTimeout(250); await expect(preview).toBeVisible();
    await page.screenshot({ path: path.join(folder, "mouse-preview.png") });
    await page.mouse.move(0, 0); await expect(preview).toBeHidden();
    expect(fixture.events).toEqual([]);
    expect(errors).toEqual([]);
    expect(seal()).toBe(beforeSeal); expect(hashes()).toEqual(beforeHashes);
  } finally {
    fs.writeFileSync(path.join(folder, "evidence.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(), media,
      pointerEvents: await page.evaluate(() => (window as any).__hover185Pointers), errors, knownSandboxErrors,
      qualification: "Real desktop mouse with native touch-capable browser media; no media overrides or synthetic pointer events." }, null, 2));
  }
});
