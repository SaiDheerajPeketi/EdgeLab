import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createDemoMarket, generateDemoBars } from "../frontend/src/lib/demoMarket";
import { certifyUiState, gotoStable, installDeterminism } from "./support/app";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/landing-sculpture60");
const expectedBars = generateDemoBars(createDemoMarket({ seed: 81 }), 96).bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
const sceneFor = (page: Page) => page.locator("[data-market-sculpture]");

async function prepare(page: Page, denyWebGL = false, reducedMotion = true) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await installDeterminism(page, { motionLock: false, freezeTime: false });
  await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
  if (denyWebGL) {
    // Explicit browser capability seam: reject only native WebGL requests.
    // The production Three/SVG renderer, DOM, timers and 2D Canvas stay intact.
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      (window as any).__deniedWebGL60 = 0;
      HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: any[]) {
        if (/^(webgl2?|experimental-webgl)$/.test(kind)) {
          (window as any).__deniedWebGL60++;
          return null;
        }
        return (original as any).call(this, kind, ...args);
      } as typeof original;
    });
  }
  await page.route("**/api/billing/catalog", route => route.fulfill({ json: {
    provider: "stripe", enabled: false, mode: "live", checkout_available: false,
    reason: "Billing is not configured.",
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }],
  } }));
  return errors;
}

async function softwareData(projection: Locator) {
  return projection.evaluate(svg => {
    const bodies = [...svg.querySelectorAll<SVGGraphicsElement>('[data-scene-layer="body"][data-candle-index]')];
    const unique = new Map<number, Record<string, number>>();
    for (const body of bodies) {
      const data = body.dataset;
      const index = Number(data.candleIndex);
      const value = Object.fromEntries(["time", "open", "high", "low", "close"].map(key => [key, Number(data[key])])) as Record<string, number>;
      const previous = unique.get(index);
      if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error("One candle's rendered faces disagree on OHLC.");
      unique.set(index, value);
    }
    const bounds = bodies.map(body => body.getBoundingClientRect());
    const rect = svg.getBoundingClientRect();
    return {
      bars: [...unique.entries()].sort(([a], [b]) => a - b).map(([, value]) => value),
      bodyFaces: bodies.length,
      wicks: svg.querySelectorAll('[data-scene-layer="wick"][data-candle-index]').length,
      volumes: svg.querySelectorAll('[data-scene-layer="volume"][data-candle-index]').length,
      width: rect.width, height: rect.height,
      modelWidth: Math.max(...bounds.map(b => b.right)) - Math.min(...bounds.map(b => b.left)),
      modelHeight: Math.max(...bounds.map(b => b.bottom)) - Math.min(...bounds.map(b => b.top)),
      geometry: bodies.map(body => body.getAttribute("points") ?? body.getAttribute("d")),
      wickGeometry: [...svg.querySelectorAll('[data-scene-layer="wick"][data-candle-index]')].map(node => ({
        index: Number(node.getAttribute("data-candle-index")), path: node.getAttribute("d")!,
      })),
      depths: [...svg.querySelectorAll("[data-depth]")].map(node => Number(node.getAttribute("data-depth"))),
      viewBox: (svg as SVGSVGElement).viewBox.baseVal ? {
        width: (svg as SVGSVGElement).viewBox.baseVal.width,
        height: (svg as SVGSVGElement).viewBox.baseVal.height,
      } : null,
      camera: (svg.getAttribute("data-camera") ?? "0,0").split(",").map(Number),
    };
  });
}

function independentPoint(index: number, price: number, width: number, height: number, yaw: number, pitch: number) {
  const low = Math.min(...expectedBars.map(bar => bar.low));
  const high = Math.max(...expectedBars.map(bar => bar.high));
  const distance = Math.max(20, 29 * height / width);
  const angle = 0.28 + yaw;
  const camera = [Math.sin(angle) * distance, distance * 0.34 + pitch * 6, Math.cos(angle) * distance];
  const vector = [0 - camera[0], -0.8 - camera[1], 0 - camera[2]];
  const norm = Math.hypot(...vector);
  const forward = vector.map(value => value / norm);
  const rightNorm = Math.hypot(-forward[2], forward[0]);
  const right = [-forward[2] / rightNorm, 0, forward[0] / rightNorm];
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const x = (index - 47.5) * 0.18;
  const z = Math.sin(index * 0.055) * 1.75;
  const relative = [x * Math.cos(-0.08) + z * Math.sin(-0.08) - camera[0],
    (price - (low + high) / 2) * 8 / (high - low) - camera[1],
    -x * Math.sin(-0.08) + z * Math.cos(-0.08) - camera[2]];
  const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const focal = height / (2 * Math.tan(36 * Math.PI / 360));
  return [width / 2 + dot(relative, right) * focal / dot(relative, forward),
    height / 2 - dot(relative, up) * focal / dot(relative, forward)];
}

async function measurementBounds(projection: Locator) {
  const labels = await projection.evaluate(svg => {
    const view = (svg as SVGSVGElement).viewBox.baseVal;
    const host = svg.closest("[data-market-sculpture]")!;
    const captions = [...host.querySelectorAll("span")]
      .filter(node => node.textContent === "FIRST CANDLE" || node.textContent === "LAST CANDLE")
      .map(node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    return [...svg.querySelectorAll<SVGGraphicsElement>('[data-scene-layer="measurement"] text')].map(node => {
      const box = node.getBBox();
      const screen = node.getBoundingClientRect();
      return { text: node.textContent, metadata: { ...node.dataset }, x: box.x, y: box.y,
        right: box.x + box.width, bottom: box.y + box.height, width: view.width, height: view.height,
        overlapsCaption: captions.some(rect => screen.left < rect.right && screen.right > rect.left
          && screen.top < rect.bottom && screen.bottom > rect.top) };
    });
  });
  expect(labels).toHaveLength(10);
  expect(labels.filter(label => label.metadata.measurement === "price")).toHaveLength(5);
  expect(labels.filter(label => label.metadata.measurement === "time")).toHaveLength(5);
  expect(labels.slice(5).map(label => label.text)).toEqual(["01", "24", "48", "72", "96"]);
  for (const label of labels) {
    expect(label.x, `${label.text} left`).toBeGreaterThanOrEqual(8);
    expect(label.y, `${label.text} top`).toBeGreaterThanOrEqual(8);
    expect(label.right, `${label.text} right`).toBeLessThanOrEqual(label.width - 8);
    expect(label.bottom, `${label.text} footer clearance`).toBeLessThanOrEqual(label.height - 36);
    expect(label.overlapsCaption, `${label.text} endpoint caption`).toBe(false);
  }
  return labels;
}

async function fixedSoftware(projection: Locator) {
  await expect(projection).toBeVisible();
  const data = await softwareData(projection);
  expect(data.bars).toEqual(expectedBars);
  expect(data.bodyFaces).toBe(96 * 3);
  expect(data.wicks).toBe(96);
  expect(data.volumes).toBe(96 * 3);
  expect(data.geometry.every(value => value && !/NaN|Infinity/.test(value))).toBe(true);
  expect(data.depths.every((depth, index) => index === 0 || data.depths[index - 1] >= depth)).toBe(true);
  for (const wick of data.wickGeometry) {
    const actual = wick.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const bar = expectedBars[wick.index];
    const expected = [bar.high, bar.low].flatMap(price => independentPoint(wick.index, price,
      data.viewBox!.width, data.viewBox!.height, data.camera[0], data.camera[1]));
    expect(actual).toHaveLength(4);
    for (let index = 0; index < 4; index++) expect(Math.abs(actual[index] - expected[index])).toBeLessThanOrEqual(0.00051);
  }
  expect(data.modelWidth / data.width).toBeGreaterThan(0.55);
  expect(data.modelHeight / data.height).toBeGreaterThan(0.25);
  return { ...data, labels: await measurementBounds(projection) };
}

async function coverage(page: Page, target: Locator) {
  const bitmap = await target.screenshot({ animations: "allow" });
  return page.evaluate(async imageBytes => {
    const image = new Image();
    image.src = "data:image/png;base64," + imageBytes;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let green = 0, rose = 0;
    for (let index = 0; index < rgba.length; index += 4) {
      const [r, g, b] = rgba.slice(index, index + 3);
      if (g > 75 && g > r * 1.2 && g > b * 1.02) green++;
      if (r > 100 && r > g * 1.25 && b > g * 1.02) rose++;
    }
    return { width: canvas.width, height: canvas.height, green, rose };
  }, bitmap.toString("base64"));
}

async function controls(page: Page, scene: Locator, software: boolean, hasTouch: boolean) {
  const projection = scene.locator("[data-market-projection]");
  const original = software ? await softwareData(projection) : null;
  const rotate = scene.getByRole("group", { name: "Rotate the market scene", exact: true });
  await rotate.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(scene).toHaveAttribute("data-camera", "-0.08,0.00");
  if (original) expect((await softwareData(projection)).geometry).not.toEqual(original.geometry);
  await page.keyboard.press("Home");
  await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  if (original) expect((await softwareData(projection)).geometry).toEqual(original.geometry);
  for (const name of ["Decisions", "Review", "Price"]) {
    const button = scene.getByRole("button", { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    if (hasTouch) await button.tap();
    else await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(scene).toHaveAttribute("data-chapter", name.toLowerCase());
    if (software) {
      expect((await softwareData(projection)).bars).toEqual(expectedBars);
      if (name === "Price") {
        await expect(projection.locator('[data-decision="entry"], [data-decision="exit"]')).toHaveCount(0);
      } else {
        await expect(projection.locator('[data-decision="entry"]')).toHaveAttribute("data-candle-index", "43");
        await expect(projection.locator('[data-decision="exit"]')).toHaveAttribute("data-candle-index", "81");
      }
      await expect(projection.locator('[data-decision="review-trail"]')).toHaveCount(name === "Review" ? 1 : 0);
    }
  }
  const right = scene.getByRole("button", { name: "Rotate scene right", exact: true });
  if (hasTouch) await right.tap();
  else await right.click();
  await expect(scene).toHaveAttribute("data-camera", "0.08,0.00");
  await scene.getByRole("button", { name: "Reset scene view", exact: true }).click();
  await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  for (const button of await scene.getByRole("button").all()) {
    const rect = await button.boundingBox();
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  const extremeViews = [];
  if (software) {
    for (const [horizontal, vertical, expected] of [
      ["ArrowLeft", "ArrowUp", "-0.42,-0.30"],
      ["ArrowLeft", "ArrowDown", "-0.42,0.30"],
      ["ArrowRight", "ArrowUp", "0.42,-0.30"],
      ["ArrowRight", "ArrowDown", "0.42,0.30"],
    ]) {
      await rotate.focus();
      await page.keyboard.press("Home");
      for (let index = 0; index < 6; index++) await page.keyboard.press(horizontal);
      for (let index = 0; index < 5; index++) await page.keyboard.press(vertical);
      await expect(scene).toHaveAttribute("data-camera", expected);
      const measured = await fixedSoftware(projection);
      extremeViews.push({ view: expected, labels: measured.labels });
    }
    await page.keyboard.press("Home");
    await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  }
  if (!hasTouch) {
    await rotate.scrollIntoViewIfNeeded();
    const rect = (await rotate.boundingBox())!;
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[aria-label="Rotate the market scene"]'), start)).toBe(true);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 20, { steps: 4 });
    await page.mouse.up();
    await expect(scene).not.toHaveAttribute("data-camera", "0.00,0.00");
    await scene.getByRole("button", { name: "Reset scene view", exact: true }).click();
    await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  }
  return { original, extremeViews, final: software ? await softwareData(projection) : null };
}

async function unmount(page: Page, scene: Locator, webGL: boolean) {
  await scene.evaluate((node, webGL) => {
    const canvas = node.querySelector("canvas");
    (window as any).__retiredSculpture60 = {
      host: node, canvas,
      gl: webGL && canvas ? canvas.getContext("webgl2") ?? canvas.getContext("webgl") : null,
    };
  }, webGL);
  await page.getByRole("link", { name: "View plans", exact: true }).first().click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(scene).toHaveCount(0);
  const before = await page.evaluate(() => {
    const old = (window as any).__retiredSculpture60;
    return { connected: old.host.isConnected, canvasConnected: old.canvas?.isConnected ?? false, lost: old.gl?.isContextLost() ?? null, renders: old.host.dataset.renderCount ?? null };
  });
  expect(before.connected).toBe(false);
  expect(before.canvasConnected).toBe(false);
  if (webGL) expect(before.lost).toBe(true);
  await page.setViewportSize({ width: page.viewportSize()!.width - 16, height: page.viewportSize()!.height });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).__retiredSculpture60.host.dataset.renderCount ?? null)).toBe(before.renders);
  return before;
}

async function receipt(page: Page, info: TestInfo, name: string, data: unknown, errors: string[], target: Locator) {
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  await target.screenshot({ path: path.join(folder, name + ".png"), animations: "allow" });
  const assetNames = fs.readdirSync(path.join(root, "frontend/dist/assets")).filter(file => /^(LandingPage-|MarketSculpture-|market-3d-|marketScene|demoMarket-|index-).*\.(js|css)$/.test(file));
  const assets = assetNames.map(name => {
    const bytes = fs.readFileSync(path.join(root, "frontend/dist/assets", name));
    return { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  expect(errors).toEqual([]);
  const sourceNames = [
    "frontend/src/components/marketing/MarketSculpture.tsx",
    "frontend/src/components/marketing/MarketSculptureProjection.tsx",
    "frontend/src/lib/marketSculptureGeometry.ts",
    "frontend/src/lib/demoMarket.ts",
    "frontend/src/pages/LandingPage.tsx",
  ];
  const sources = sourceNames.map(name => ({ name, sha256: createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex") }));
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ data, errors, viewport: page.viewportSize(), reducedMotion: await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), assets, sources }, null, 2));
}

test("startup without WebGL keeps immediate fixed OHLC projection and working reduced-motion controls", async ({ page }, info) => {
  const errors = await prepare(page, true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route("**/assets/market-3d-*.js", async route => {
    held = true;
    await gate;
    await route.continue();
  });
  await gotoStable(page, "/", { waitForNetworkIdle: false });
  const initial = page.locator("[data-market-projection]").first();
  await initial.scrollIntoViewIfNeeded();
  await expect.poll(() => held).toBe(true);
  await expect(sceneFor(page)).toHaveAttribute("data-scene-status", "loading");
  const loading = await fixedSoftware(initial);
  const folder = path.join(artifacts, info.project.name);
  fs.mkdirSync(folder, { recursive: true });
  await initial.screenshot({ path: path.join(folder, "initial-loading-projection.png"), animations: "allow" });
  release();
  const scene = sceneFor(page);
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute("data-scene-status", "fallback");
  expect(await page.evaluate(() => (window as any).__deniedWebGL60)).toBeGreaterThan(0);
  const rendered = await fixedSoftware(scene.locator("[data-market-projection]"));
  const pixels = await coverage(page, scene.locator("[data-market-projection]"));
  expect(pixels.green).toBeGreaterThan(500);
  expect(pixels.rose).toBeGreaterThan(500);
  const interaction = await controls(page, scene, true, !!info.project.use.hasTouch);
  await certifyUiState(page);
  await receipt(page, info, "startup-no-webgl", { loading, rendered, pixels, interaction, capabilitySeam: "Native HTMLCanvasElement.getContext rejects only webgl/webgl2; no renderer replacement." }, errors, scene);
  if (info.project.name === "user1280") {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(folder, "hero-user1280-no-webgl.png"), animations: "allow" });
  }
  const cleanup = await unmount(page, scene, false);
  fs.writeFileSync(path.join(folder, "startup-cleanup.json"), JSON.stringify(cleanup, null, 2));
  expect(errors).toEqual([]);
});

test("native WebGL context loss preserves prices and gives the same functional software scene", async ({ page }, info) => {
  const errors = await prepare(page);
  await gotoStable(page, "/");
  const scene = sceneFor(page);
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute("data-scene-status", "ready");
  const native = await scene.locator("canvas").evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) throw new Error("Actual WebGL context unavailable.");
    const extension = gl.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Actual browser context-loss extension unavailable.");
    const before = { version: gl.getParameter(gl.VERSION), lost: gl.isContextLost(), width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
    (window as any).__lostWebGL60 = gl;
    extension.loseContext();
    return before;
  });
  expect(native.lost).toBe(false);
  await expect(scene).toHaveAttribute("data-scene-status", "fallback");
  expect(await page.evaluate(() => (window as any).__lostWebGL60.isContextLost())).toBe(true);
  await expect(scene.locator("canvas")).toHaveCount(0);
  const rendered = await fixedSoftware(scene.locator("[data-market-projection]"));
  const interaction = await controls(page, scene, true, !!info.project.use.hasTouch);
  const pixels = await coverage(page, scene.locator("[data-market-projection]"));
  expect(pixels.green).toBeGreaterThan(500);
  expect(pixels.rose).toBeGreaterThan(500);
  await certifyUiState(page);
  await receipt(page, info, "native-context-loss", { native, rendered, interaction, pixels }, errors, scene);
  const cleanup = await unmount(page, scene, false);
  fs.writeFileSync(path.join(artifacts, info.project.name, "context-loss-cleanup.json"), JSON.stringify(cleanup, null, 2));
  expect(errors).toEqual([]);
});

test("ready native WebGL retains actual rendering controls resizing and cleanup", async ({ page }, info) => {
  const errors = await prepare(page);
  await gotoStable(page, "/");
  const scene = sceneFor(page);
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute("data-scene-status", "ready");
  await expect(scene).toHaveAttribute("data-candle-count", "96");
  await expect(scene.locator("[data-market-projection]")).toHaveCount(0);
  const canvas = scene.locator("canvas");
  const before = await coverage(page, canvas);
  expect(before.green).toBeGreaterThan(500);
  expect(before.rose).toBeGreaterThan(500);
  const bitmap = await canvas.screenshot({ animations: "allow" });
  const interaction = await controls(page, scene, false, !!info.project.use.hasTouch);
  await scene.getByRole("button", { name: "Rotate scene right", exact: true }).click();
  await expect.poll(async () => (await canvas.screenshot({ animations: "allow" })).equals(bitmap)).toBe(false);
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: originalViewport.width === 1440 ? 1000 : originalViewport.width - 16, height: originalViewport.height });
  await expect.poll(async () => (await coverage(page, canvas)).width).not.toBe(before.width);
  await page.setViewportSize(originalViewport);
  await expect.poll(async () => (await coverage(page, canvas)).width).toBe(before.width);
  await scene.getByRole("button", { name: "Reset scene view", exact: true }).click();
  await expect(scene).toHaveAttribute("data-camera", "0.00,0.00");
  await certifyUiState(page);
  await receipt(page, info, "native-webgl-ready", { before, interaction, originalViewport }, errors, scene);
  if (info.project.name === "user1280") {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(artifacts, info.project.name, "hero-user1280.png"), animations: "allow" });
  }
  const cleanup = await unmount(page, scene, true);
  fs.writeFileSync(path.join(artifacts, info.project.name, "webgl-cleanup.json"), JSON.stringify(cleanup, null, 2));
  expect(errors).toEqual([]);
});


test("natural software perspective and finite text motion settle after scroll stops and reenter", async ({ page }, info) => {
  const errors = await prepare(page, true, false);
  await gotoStable(page, "/");
  const scene = sceneFor(page);
  await scene.scrollIntoViewIfNeeded();
  await expect(scene).toHaveAttribute("data-scene-status", "fallback");
  await expect(scene).toHaveAttribute("data-scene-active", "true");
  const projection = scene.locator("[data-market-projection]");
  await page.waitForTimeout(900);
  const first = await fixedSoftware(projection);
  const sceneTop = await scene.evaluate(node => node.getBoundingClientRect().top + window.scrollY);
  const height = page.viewportSize()!.height;
  const beforeScrollY = await page.evaluate(() => window.scrollY);
  await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), sceneTop + height * 0.1);
  expect(await page.evaluate(() => window.scrollY)).not.toBe(beforeScrollY);
  await expect.poll(async () => (await softwareData(projection)).camera).not.toEqual(first.camera);
  const stopped = await fixedSoftware(projection);
  const expectedScroll = await scene.evaluate(node => Math.max(-1, Math.min(1,
    (innerHeight * 0.45 - node.getBoundingClientRect().top) / innerHeight)));
  expect(stopped.camera).toEqual([expectedScroll * 0.13, expectedScroll * 0.15]);
  await page.waitForTimeout(900);
  expect((await softwareData(projection)).geometry).toEqual(stopped.geometry);

  const text = page.locator("#how-it-works [data-flow-row] h3").first();
  const textTop = await text.evaluate(node => node.getBoundingClientRect().top + window.scrollY);
  const textState = () => text.evaluate(node => {
    const style = getComputedStyle(node);
    return { opacity: Number(style.opacity), y: new DOMMatrixReadOnly(style.transform).m42 };
  });
  const positions = [];
  // Cross each actual ScrollTrigger boundary, then stop well before the tween duration.
  await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), textTop - height * 1.05);
  await expect.poll(textState).toEqual({ opacity: 0, y: 28 });
  await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), textTop - height * 0.7);
  await expect.poll(textState).toEqual({ opacity: 1, y: 0 });
  positions.push(await textState());
  await page.waitForTimeout(400);
  expect(await textState()).toEqual(positions[0]);
  await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), textTop + height * 0.3);
  await expect.poll(textState).toEqual({ opacity: 0, y: 28 });
  positions.push(await textState());
  await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), textTop - height * 0.7);
  await expect.poll(textState).toEqual({ opacity: 1, y: 0 });
  positions.push(await textState());

  const sceneBottom = await scene.evaluate(node => node.getBoundingClientRect().bottom + window.scrollY);
  await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), sceneBottom + 100);
  expect(await scene.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThan(0);
  await expect(scene).toHaveAttribute("data-scene-active", "false");
  const offscreen = await softwareData(projection);
  await page.evaluate(() => window.scrollBy({ top: 50, behavior: "instant" }));
  await page.waitForTimeout(400);
  expect((await softwareData(projection)).geometry).toEqual(offscreen.geometry);
  await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), sceneTop - height * 0.4);
  await expect(scene).toHaveAttribute("data-scene-active", "true");
  await expect.poll(async () => (await softwareData(projection)).camera).not.toEqual(offscreen.camera);
  const resumed = await fixedSoftware(projection);
  await page.waitForTimeout(400);
  expect((await softwareData(projection)).geometry).toEqual(resumed.geometry);
  const review = scene.getByRole("button", { name: "Review", exact: true });
  if (info.project.use.hasTouch) await review.tap();
  else await review.click();
  await expect(scene).toHaveAttribute("data-chapter", "review");
  expect((await softwareData(projection)).bars).toEqual(expectedBars);
  await expect(projection.locator('[data-decision="review-trail"]')).toHaveCount(1);
  await receipt(page, info, "natural-software-scroll", { first, stopped, offscreen, resumed, positions,
    capabilitySeam: "Only native WebGL getContext is unavailable; native clock, GSAP, IntersectionObserver and SVG rendering are unchanged." }, errors, scene);
  expect(errors).toEqual([]);
});
