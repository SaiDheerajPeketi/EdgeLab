import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { certifyUiState, gotoStable, installDeterminism, settlePage } from "./support/app";

const artifacts = path.resolve(".artifacts/landing-dimensional28");
const sculpture = (page: Page) => page.locator("[data-market-sculpture]");
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page), "Uncaught browser errors").toEqual([]); });

async function ready(page: Page) {
  const scene = sculpture(page);
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute("data-scene-status", "ready");
  await expect.poll(async () => Number(await scene.getAttribute("data-render-count"))).toBeGreaterThan(0);
  return scene;
}
async function capture(page: Page, name: string, target?: Locator, fullPage = false) {
  fs.mkdirSync(artifacts, { recursive: true });
  const widgetChrome = target && /^(workflow|replay-controls)-/.test(name)
    ? await page.addStyleTag({ content: 'header, a[href="#main-content"] { visibility: hidden !important; }' })
    : null;
  try {
    if (target) await target.screenshot({ path: path.join(artifacts, `${name}.png`), animations: "disabled" });
    else await page.screenshot({ path: path.join(artifacts, `${name}.png`), fullPage, animations: "disabled" });
  } finally { await widgetChrome?.evaluate((node) => node.remove()); }
}
async function renderedPixels(page: Page, target: Locator) {
  // Decode the browser's actual composited screenshot; WebGL need not retain its drawing buffer.
  const png = (await target.screenshot({ animations: "disabled" })).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0, pink = 0; const columns = new Set<number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (g > 75 && g > r * 1.2 && g > b * 1.02) { green++; columns.add((i / 4) % canvas.width); }
      if (r > 100 && r > g * 1.25 && b > g * 1.02) { pink++; columns.add((i / 4) % canvas.width); }
    }
    return { green, pink, columns: columns.size };
  }, png);
}
async function top(page: Page) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" })); }
async function count(scene: Locator) { return Number(await scene.getAttribute("data-render-count")); }

test("real WebGL artwork, dense working chart, branding and accessible desktop/mobile captures", async ({ page }, info) => {
  await installDeterminism(page);
  await gotoStable(page, "/");
  const scene = await ready(page), canvas = scene.locator("canvas");
  const gpu = await canvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) throw new Error("The production artwork did not create a WebGL context.");
    return { version: gl.getParameter(gl.VERSION), width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, lost: gl.isContextLost() };
  });
  expect(gpu.version).toContain("WebGL"); expect(gpu.width).toBeGreaterThan(250); expect(gpu.height).toBeGreaterThan(200); expect(gpu.lost).toBe(false);
  await expect(scene).toHaveAttribute("data-candle-count", "96");
  const pixels = await renderedPixels(page, canvas);
  expect(pixels.green).toBeGreaterThan(100); expect(pixels.pink).toBeGreaterThan(100); expect(pixels.columns).toBeGreaterThan(100);
  await capture(page, `artwork-${info.project.name}`, scene);
  const hero = page.locator("[data-landing-stage]");
  await hero.scrollIntoViewIfNeeded();
  await expect(hero.locator("canvas").first()).toBeVisible();
  const candles = Number(await hero.locator("[data-visible-candles]").getAttribute("data-visible-candles"));
  expect(candles).toBeGreaterThan(100); expect(candles).toBeLessThanOrEqual(128);
  for (const chapter of ["replay", "review", "results"]) {
    const demo = page.locator(`[data-workflow-demo="${chapter}"]`); await demo.scrollIntoViewIfNeeded();
    await expect(demo.getByLabel("Chart to review workflow").getByRole("button")).toHaveCount(3);
  }
  const attribution = page.getByRole("link", { name: /From Black and Blue/ });
  await attribution.scrollIntoViewIfNeeded(); await expect(attribution).toHaveAttribute("href", "https://blackandblue.co.in/");
  await expect(attribution).toHaveAttribute("target", "_blank"); expect(await attribution.locator("svg path").count()).toBe(2);
  await capture(page, `footer-${info.project.name}`, page.getByRole("contentinfo"));
  await certifyUiState(page);
  await top(page); await settlePage(page);
  if (info.project.name === "desktop") {
    fs.mkdirSync(path.resolve(".artifacts/landing28"), { recursive: true });
    await page.getByRole("link", { name: "EdgeLab home", exact: true }).screenshot({ path: path.resolve(".artifacts/landing28/logo.png"), animations: "disabled" });
  }
  await capture(page, `landing-${info.project.name}-viewport`); await capture(page, `landing-${info.project.name}-full`, undefined, true);
  await capture(page, `hero-${info.project.name}`, hero);
  await top(page);
  const firstView = await hero.locator("canvas").first().evaluate((node) => {
    const canvas = node as HTMLCanvasElement, box = canvas.getBoundingClientRect(), context = canvas.getContext("2d")!;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    const start = Math.max(0, Math.ceil(-box.top * canvas.height / box.height)), end = Math.min(canvas.height, Math.floor((innerHeight - box.top) * canvas.height / box.height));
    for (let y = start; y < end; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if ((pixels[i] === 38 && pixels[i + 1] === 166 && pixels[i + 2] === 154) || (pixels[i] === 239 && pixels[i + 1] === 83 && pixels[i + 2] === 80)) colored++;
    }
    return colored;
  });
  expect(firstView, "Actual candle pixels remain in the first viewport").toBeGreaterThan(20);
  const iconHref = await page.locator('link[rel="icon"]').getAttribute("href"); expect(iconHref).toContain("edgelab-favicon.svg");
  const icon = await page.request.get(iconHref!); expect(icon.ok()).toBe(true); expect(await icon.text()).toContain("<svg");
});

test("scene chapters, real rendered perspective, keyboard arrows and Home reset", async ({ page }, info) => {
  await installDeterminism(page); await gotoStable(page, "/"); const scene = await ready(page);
  const rotate = scene.getByRole("group", { name: "Rotate the market scene", exact: true });
  const initial = await scene.locator("canvas").screenshot(); const before = await count(scene);
  await rotate.focus(); await page.keyboard.press("ArrowRight");
  await expect(scene).toHaveAttribute("data-camera", "0.08,0.00"); await expect.poll(() => count(scene)).toBeGreaterThan(before);
  expect((await scene.locator("canvas").screenshot()).equals(initial)).toBe(false);
  await page.keyboard.press("ArrowUp"); await expect(scene).toHaveAttribute("data-camera", "0.08,-0.06");
  await page.keyboard.press("Home"); await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  await scene.getByRole("button", { name: "Rotate scene left", exact: true }).click(); await expect(scene).toHaveAttribute("data-camera", "-0.08,0.00");
  await scene.getByRole("button", { name: "Reset scene view", exact: true }).click(); await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  if (info.project.name === "desktop") {
    const box = await scene.locator("canvas").boundingBox(); expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 35, box!.y + box!.height / 2 + 20, { steps: 4 }); await page.mouse.up();
    await expect(scene).not.toHaveAttribute("data-camera", "0.00,0.00");
    const dragged = await scene.locator("canvas").screenshot(); expect(dragged.equals(initial)).toBe(false);
    await scene.getByRole("button", { name: "Reset scene view", exact: true }).click(); await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  }
  for (const name of ["Decisions", "Review", "Price"]) {
    await scene.getByRole("button", { name, exact: true }).click(); await expect(scene.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(scene.getByRole("heading", { level: 2 })).toBeVisible(); await capture(page, `scene-${info.project.name}-${name.toLowerCase()}`, scene);
  }
  await certifyUiState(page);
});

test("normal scroll renders on demand, pauses offscreen, resizes and disposes on navigation", async ({ page }) => {
  await installDeterminism(page, { motionLock: false }); await page.emulateMedia({ reducedMotion: "no-preference" });
  await gotoStable(page, "/"); const scene = await ready(page);
  const before = await count(scene); await page.evaluate(() => window.scrollBy(0, 70)); await expect.poll(() => count(scene)).toBeGreaterThan(before);
  await page.locator("#faq").scrollIntoViewIfNeeded(); await expect(scene).toHaveAttribute("data-scene-active", "false");
  const paused = await count(scene); await page.evaluate(() => window.scrollBy(0, 30)); await page.waitForTimeout(200); expect(await count(scene)).toBe(paused);
  await scene.scrollIntoViewIfNeeded(); await expect(scene).toHaveAttribute("data-scene-active", "true"); await expect.poll(() => count(scene)).toBeGreaterThan(paused);
  const width = await scene.locator("canvas").evaluate((node) => (node as HTMLCanvasElement).width);
  await page.setViewportSize({ width: page.viewportSize()!.width > 1000 ? 1100 : page.viewportSize()!.width - 30, height: page.viewportSize()!.height });
  await expect.poll(() => scene.locator("canvas").evaluate((node) => (node as HTMLCanvasElement).width)).not.toBe(width);
  await page.emulateMedia({ reducedMotion: "reduce" }); await ready(page);
  await page.waitForTimeout(100); const still = await count(scene); await page.evaluate(() => window.scrollBy(0, 20)); await page.waitForTimeout(250); expect(await count(scene)).toBe(still);
  await scene.locator("canvas").evaluate((node) => {
    const canvas = node as HTMLCanvasElement, gl = canvas.getContext("webgl2")!;
    const observation = { canvas, gl, lost: false }; (window as any).__marketSceneObservation = observation;
    canvas.addEventListener("webglcontextlost", () => { observation.lost = true; });
  });
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/); await expect(scene).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => { const v = (window as any).__marketSceneObservation; return v.lost && !v.canvas.isConnected && v.gl.isContextLost(); })).toBe(true);
});

test("actual WebGL context loss exposes readable fallback and keeps chart/journal usable", async ({ page }, info) => {
  await installDeterminism(page); await gotoStable(page, "/"); const scene = await ready(page);
  await scene.locator("canvas").evaluate((node) => {
    const gl = (node as HTMLCanvasElement).getContext("webgl2")!; const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Installed Chromium does not expose the native context-loss extension."); extension.loseContext();
  });
  await expect(scene).toHaveAttribute("data-scene-status", "fallback"); await expect(scene.getByText(/The 3D view is unavailable on this device/)).toBeVisible();
  await capture(page, `fallback-${info.project.name}`, scene);
  const hero = page.locator("[data-landing-stage]"); await hero.scrollIntoViewIfNeeded();
  await hero.getByLabel("Chart to review workflow").getByRole("button").nth(1).click(); await expect(hero.getByText("Review Notes", { exact: true })).toBeVisible();
  await hero.getByLabel("Chart to review workflow").getByRole("button").first().click(); await expect(hero.locator("canvas").first()).toBeVisible();
  await certifyUiState(page);
});

test("workflow chapters contain responsive working replay, journal selection and review controls", async ({ page }, info) => {
  await installDeterminism(page); await gotoStable(page, "/");
  for (const chapter of ["replay", "review", "results"]) {
    const demo = page.locator(`[data-workflow-demo="${chapter}"]`); await demo.scrollIntoViewIfNeeded();
    const buttons = demo.getByLabel("Chart to review workflow").getByRole("button");
    await expect(buttons.nth(chapter === "replay" ? 0 : chapter === "review" ? 1 : 2)).toHaveAttribute("aria-current", "step");
    if (chapter === "replay") await expect(demo.locator("canvas").first()).toBeVisible();
    if (chapter === "review") {
      await expect(demo.getByText("Review Notes", { exact: true })).toBeVisible();
      const reviews = demo.getByRole("button", { name: "Review", exact: true });
      await reviews.first().click(); const firstTrade = await demo.getByRole("heading", { name: /^Trade #/ }).textContent();
      await reviews.last().click(); await expect(demo.getByRole("heading", { name: /^Trade #/ })).not.toHaveText(firstTrade!);
    }
    await capture(page, `workflow-${info.project.name}-${chapter}`, demo);
    const clipped = await demo.locator("h3, [data-scenario-pill]").evaluateAll((nodes) => nodes.filter((node) => { const b = node.getBoundingClientRect(); return b.left < -1 || b.right > innerWidth + 1; }).map((node) => node.textContent)); expect(clipped).toEqual([]);
    await buttons.first().focus(); await page.keyboard.press("Tab"); await expect(buttons.nth(1)).toBeFocused(); await page.keyboard.press("Enter");
    await expect(buttons.nth(1)).toHaveAttribute("aria-current", "step"); await expect(demo.getByText("Review Notes", { exact: true })).toBeVisible();
    await buttons.nth(2).click(); await expect(buttons.nth(2)).toHaveAttribute("aria-current", "step");
    await buttons.first().click(); await expect(demo.locator("canvas").first()).toBeVisible();
  }
  await certifyUiState(page);
});


test("manual replay buttons and keyboard range change actual candles under reduced motion", async ({ page }, info) => {
  await installDeterminism(page); await gotoStable(page, "/");
  for (const demo of [page.locator("[data-landing-stage]"), page.locator('[data-workflow-demo="replay"]')]) {
    await demo.scrollIntoViewIfNeeded(); const state = demo.locator("[data-replay-cursor]");
    const slider = demo.getByRole("slider", { name: "Replay position", exact: true });
    await expect(slider).toHaveValue("112"); await expect(demo.getByRole("button", { name: /^(Play|Pause) replay$/ })).toBeDisabled();
    const initial = await demo.locator("canvas").first().screenshot();
    await demo.getByRole("button", { name: "Previous candle", exact: true }).click(); await expect(state).toHaveAttribute("data-replay-cursor", "111"); await expect(slider).toHaveValue("111");
    await demo.getByRole("button", { name: "Next candle", exact: true }).click(); await expect(state).toHaveAttribute("data-replay-cursor", "112");
    await slider.focus(); await page.keyboard.press("Home"); await expect(state).toHaveAttribute("data-replay-cursor", "0");
    await expect(demo.getByRole("button", { name: "Previous candle", exact: true })).toBeDisabled();
    await expect.poll(() => demo.locator("[data-visible-candles]").getAttribute("data-visible-candles")).toBe("1");
    expect((await demo.locator("canvas").first().screenshot()).equals(initial)).toBe(false);
    await page.keyboard.press("End"); await expect(state).toHaveAttribute("data-replay-cursor", (await slider.getAttribute("max"))!);
    await expect(demo.getByRole("button", { name: "Next candle", exact: true })).toBeDisabled();
    await page.keyboard.press("ArrowLeft"); await expect(demo.getByRole("button", { name: "Next candle", exact: true })).toBeEnabled();
    await slider.fill("112"); await expect(state).toHaveAttribute("data-replay-cursor", "112");
    await capture(page, `replay-controls-${info.project.name}-${await demo.getAttribute("data-workflow-demo") ?? "hero"}`, demo);
  }
  await certifyUiState(page);
});

test("autoplay pause persists offscreen and play resumes from the chosen candle", async ({ page }) => {
  await installDeterminism(page, { motionLock: false }); await page.emulateMedia({ reducedMotion: "no-preference" }); await gotoStable(page, "/");
  const hero = page.locator("[data-landing-stage]"), state = hero.locator("[data-replay-cursor]");
  const cursor = async () => Number(await state.getAttribute("data-replay-cursor"));
  await hero.scrollIntoViewIfNeeded(); await hero.getByRole("button", { name: "Pause replay", exact: true }).click();
  const slider = hero.getByRole("slider", { name: "Replay position", exact: true }); await slider.fill("120");
  await expect(state).toHaveAttribute("data-replay-cursor", "120"); await page.waitForTimeout(600); expect(await cursor()).toBe(120);
  await page.locator("#faq").scrollIntoViewIfNeeded(); await page.waitForTimeout(400); expect(await cursor()).toBe(120);
  await hero.scrollIntoViewIfNeeded(); await page.waitForTimeout(400); expect(await cursor()).toBe(120); await expect(hero.getByRole("button", { name: "Play replay", exact: true })).toBeVisible();
  await hero.getByRole("button", { name: "Play replay", exact: true }).click(); await expect.poll(cursor).toBeGreaterThan(120);
  await hero.getByRole("button", { name: "Pause replay", exact: true }).click(); const paused = await cursor(); expect(paused).toBeGreaterThan(120); await page.waitForTimeout(400); expect(await cursor()).toBe(paused);
  const workflow = page.locator('[data-workflow-demo="replay"]'); await workflow.scrollIntoViewIfNeeded(); await expect(workflow.getByRole("button", { name: "Play replay", exact: true })).toBeVisible();
  const workflowState = workflow.locator("[data-replay-cursor]"); await expect(workflowState).toHaveAttribute("data-replay-cursor", "112"); await page.waitForTimeout(400); await expect(workflowState).toHaveAttribute("data-replay-cursor", "112");
});

test("production brand vectors render at favicon, small icon and header sizes", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Vector sizing is independent of the viewport.");
  await installDeterminism(page); await gotoStable(page, "/");
  const mark = new URL("/brand/edgelab-mark.svg", page.url()).href;
  const mono = new URL("/brand/edgelab-mark-mono.svg", page.url()).href;
  for (const url of [mark, mono]) { const response = await page.request.get(url); expect(response.ok()).toBe(true); expect(await response.text()).toContain("<svg"); }
  await page.setContent(`<main style="background:#050a10;color:#f4f7fa;padding:32px;display:flex;gap:32px;font:14px sans-serif">${[16, 32, 44].map((size) => `<figure><img alt="EdgeLab ${size}px mark" width="${size}" height="${size}" src="${mark}"><figcaption>${size}px</figcaption></figure>`).join("")}<figure style="background:#ffffff;color:#050a10;padding:12px;border-radius:6px"><img alt="Monochrome EdgeLab mark" width="44" height="44" src="${mono}"><figcaption>Mono</figcaption></figure></main>`);
  for (const image of await page.getByRole("img").all()) {
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  await capture(page, "brand-sizes", page.locator("main"));
});
