import { expect, test } from "@playwright/test";
import { liveViewportSetup } from "./chart-viewport151.support";

test("real Replay arrows and document/window keyboard targets remain owned and safe", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await liveViewportSetup(page, false, "/app/replay");
  const bar = page.locator(".replay-current-bar");
  await expect(bar).toHaveText("Bar 599");
  await page.locator("body").click({ position: { x: 3, y: 3 } });
  await page.keyboard.press("ArrowLeft");
  await expect(bar).toHaveText("Bar 598");
  const documentHandled = await page.evaluate(() => !document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ArrowRight" })));
  expect(documentHandled).toBe(true);
  await expect(bar).toHaveText("Bar 599");
  const windowHandled = await page.evaluate(() => !window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "ArrowLeft" })));
  expect(windowHandled).toBe(true);
  await expect(bar).toHaveText("Bar 598");
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "KeyK", ctrlKey: true, key: "k" })));
  const palette = page.getByRole("dialog", { name: "EdgeLab command palette", exact: true });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  await expect(bar).toHaveText("Bar 598");
  expect(errors).toEqual([]);
  await info.attach("actual-Replay-keyboard", { body: JSON.stringify({ errors, naturalArrowLeft: "599→598", documentArrowRight: "598→599", windowArrowLeft: "599→598", documentHandled, windowHandled }), contentType: "application/json" });
});

test("non-chart native scroll and text keys do not issue Replay mutations", async ({ page }, info) => {
  const errors: string[] = [], mutations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /^\/api\/backtests\/\d+\/(advance(?:-compact)?|jump)$/.test(path)) mutations.push(path);
  });
  const state = await liveViewportSetup(page);
  for (const [path, label] of [["/app/journal/finance", "Income and expense history"], ["/app/position-size", "Position size lot ladder"], ["/app/results/trades", "Trade log table"]]) {
    await state.waitForAccountWrites();
    await page.goto(path);
    const region = page.getByRole("region", { name: label, exact: true });
    await expect(region).toBeAttached();
    if (await region.evaluate(node => node.scrollWidth > node.clientWidth)) {
      await region.focus();
      await expect(region).toBeFocused();
      const before = await region.evaluate(node => node.scrollLeft);
      await region.press("ArrowRight");
      await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBeGreaterThan(before);
    }
    if (path === "/app/journal/finance") {
      const name = page.getByRole("textbox", { name: "Account name", exact: true });
      await name.fill("Safe");
      await name.press("1");
      await name.press("Space");
      await expect(name).toHaveValue("Safe1 ");
    }
  }
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
  await info.attach("actual-nonchart-keyboard", { body: JSON.stringify({ errors, mutations }), contentType: "application/json" });
});


test("Resume latest session owns the Replay route through browser history and reload", async ({ page }, info) => {
  const errors: string[] = [];
  const sessionReads: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/backtests/4101") sessionReads.push(path);
  });
  // Only successful HTTP state/bar responses are controlled. The real gateway,
  // replay selection, operation admission and router perform the transition.
  const state = await liveViewportSetup(page, false, "/app/replay");
  await state.waitForAccountWrites();
  await page.goto("/app");
  const resume = page.getByRole("button", { name: "Resume latest session", exact: true });
  await expect(resume).toBeEnabled();
  const beforeResume = sessionReads.length;
  await resume.click();
  await expect(page).toHaveURL(/\/app\/replay$/);
  await expect(page.locator(".replay-current-bar")).toHaveText("Bar 599");
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  expect(sessionReads.length).toBeGreaterThan(beforeResume);
  await state.waitForAccountWrites();
  await page.goBack();
  await expect(page).toHaveURL(/\/app$/);
  await expect(resume).toBeEnabled();
  await page.goForward();
  await expect(page).toHaveURL(/\/app\/replay$/);
  await expect(page.locator(".replay-current-bar")).toHaveText("Bar 599");
  await state.waitForAccountWrites();
  await page.reload();
  await expect(page).toHaveURL(/\/app\/replay$/);
  await expect(page.locator(".replay-current-bar")).toHaveText("Bar 599");
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
  await info.attach("actual-Resume-navigation", {
    body: JSON.stringify({ errors, sessionReads, route: "/app → /app/replay → Back /app → Forward /app/replay → Reload /app/replay" }),
    contentType: "application/json",
  });
});
