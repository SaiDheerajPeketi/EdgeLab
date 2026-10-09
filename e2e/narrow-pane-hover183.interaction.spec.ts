import { expect, test } from "@playwright/test";
import { liveViewportSetup } from "./chart-viewport151.support";

for (const pane of [
  { trigger: "Ticket", preview: "Ticket preview" },
  { trigger: "Objects", preview: "Objects preview" },
  { trigger: "Tools", preview: "Chart tools" },
]) test(`${pane.trigger} opens on mouse hover below the desktop breakpoint`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await liveViewportSetup(page, false, "/app/replay");
  const trigger = pane.trigger === "Tools"
    ? page.locator('[data-motion="workspace-panel-trigger"]')
    : page.getByRole("button", { name: pane.trigger, exact: true }).first();
  const preview = pane.trigger === "Tools"
    ? page.getByRole("complementary", { name: pane.preview, exact: true })
    : page.getByRole("dialog", { name: pane.preview, exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  await page.locator("#workspace-content").focus();
  await expect(preview).toHaveCount(0);
  const stage = page.locator(".chart-stage").first();
  const before = await stage.boundingBox();
  await trigger.hover();
  await expect(preview).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const box = (await preview.boundingBox())!;
  expect(box.width).toBeGreaterThan(200);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1000);
  expect(box.y + box.height).toBeLessThanOrEqual(1100);
  expect(await stage.boundingBox()).toEqual(before);
  await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 8 });
  await expect(preview).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(preview).toHaveCount(0);
  expect(errors).toEqual([]);
});
