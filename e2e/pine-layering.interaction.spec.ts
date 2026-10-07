import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { test as base, expect, type Page, type Locator } from "@playwright/test";

import { AUTH_SESSION_KEY, betaSessionResponse, FROZEN_TIME, gotoStable } from "./support/app";
import { prepare, fulfillReplayContext } from "./support/replay-context";

const originalBytes = fs.readFileSync(path.resolve("e2e/pine-visuals.bars.json"));
expect(createHash("sha256").update(originalBytes).digest("hex")).toBe("fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
// Constant, valid fixture candles give an independent interior occlusion oracle.
const bars = JSON.parse(originalBytes.toString()).map((bar: any) => ({ ...bar, open: 90, high: 115, low: 85, close: 110 }));
const artifacts = path.resolve(".artifacts/pine-layering50/browser");
type Harness = { origin: string; workerRequests: string[]; otherRequests: string[]; workerSha256: string; workerBytes: number };
const test = base.extend<{ harness: Harness }, { serverHarness: Harness }>({
  serverHarness: [async ({}, use) => {
    const assets = path.resolve("frontend/dist/assets");
    const workerName = fs.readdirSync(assets).find((name) => /^pine-native-worker.*\.js$/.test(name));
    if (!workerName) throw new Error("A frozen production build is required.");
    const workerPath = "/assets/" + workerName;
    const worker = fs.readFileSync(path.join(assets, workerName));
    const compiled = await build({
      entryPoints: [path.resolve("e2e/pine-layering.fixture.ts")],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "layerFixture",
      plugins: [{ name: "authentic-worker", setup(builder) {
        builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "authentic-worker" }));
        builder.onLoad({ filter: /.*/, namespace: "authentic-worker" }, () => ({ contents: "export default " + JSON.stringify(workerPath), loader: "js" }));
      } }],
    });
    const workerRequests: string[] = [];
    const otherRequests: string[] = [];
    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native Pine layering</title><style>html{background:#080d18;color:#e2e8f0;font:14px system-ui}body{margin:16px}h1{font-size:20px}h2{font-size:14px}#main,#pane{width:100%}</style><h1>Native Pine layers · actual candle overlap</h1><h2>Price chart</h2><div id="main"></div><h2>Separate Pine pane</h2><div id="pane"></div><script src="/fixture.js"></script>');
      } else if (pathname === "/fixture.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(compiled.outputFiles[0].contents);
      } else if (pathname === workerPath) {
        workerRequests.push(pathname);
        response.setHeader("Content-Type", "text/javascript");
        response.end(worker);
      } else if (pathname === "/favicon.ico") {
        response.statusCode = 204;
        response.end();
      } else {
        otherRequests.push(pathname);
        response.statusCode = 404;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server has no port.");
    try {
      await use({ origin: "http://127.0.0.1:" + address.port, workerRequests, otherRequests, workerSha256: createHash("sha256").update(worker).digest("hex"), workerBytes: worker.length });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }, { scope: "worker" }],
  harness: async ({ page, serverHarness }, use) => {
    serverHarness.workerRequests.length = 0;
    serverHarness.otherRequests.length = 0;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(serverHarness.origin);
    await use(serverHarness);
    expect(errors).toEqual([]);
    expect(serverHarness.otherRequests).toEqual([]);
    expect(serverHarness.workerRequests.length).toBeGreaterThan(0);
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  },
});

const program = (body: string, flag?: string, overlay = true, kind = "indicator") =>
  `//@version=6\n${kind}("Layer proof",overlay=${overlay}${flag === undefined ? "" : `,behind_chart=${flag}`})\n${body}`;
const bodies = {
  line: 'plot(100,"Line",color=#ff0000,linewidth=4)',
  area: 'plot(120,"Area",color=#ff0000,style=plot.style_area,histbase=80)',
  circle: 'plotshape(100,"Circle",style=shape.circle,location=location.absolute,color=#ff0000,size=size.large)',
  hline: 'hline(100,"Level",color=#ff0000,linewidth=4)',
  candles: 'plotcandle(80,125,75,120,title="Custom candles",color=#ff0000,wickcolor=#ff0000,bordercolor=#ff0000)',
  fill: 'a=plot(120,"Upper",display=display.none)\nb=plot(80,"Lower",display=display.none)\nfill(a,b,color=#ff0000,title="Fill")',
};
async function run(page: Page, source: string, extra: any = {}) {
  const result = await page.evaluate((input) => (window as any).layerFixture.run(input), { source, bars, ...extra });
  expect(result.completed, JSON.stringify(result)).toBe(true);
  expect(result.engine).toBe("0.11.0");
  expect(result.source).toBe(source);
  return result;
}
const probe = (page: Page, index = 130, price = 100, placement = "main", between = false, dx = 0) =>
  page.evaluate((input) => (window as any).layerFixture.probe(input.index, input.price, input.placement, input.between, input.dx), { index, price, placement, between, dx });
function rgb(actual: number[], expected: number[], label: string) {
  for (let channel = 0; channel < 3; channel++) {
    expect(Math.abs(actual[channel] - expected[channel]), label + " channel " + channel).toBeLessThanOrEqual(2);
  }
}
async function capture(page: Page, name: string, project: string, result: any, harness: Harness) {
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, name + "-" + project + ".png") });
  fs.writeFileSync(path.join(artifacts, name + "-" + project + ".json"), JSON.stringify({ workerSha256: harness.workerSha256, workerBytes: harness.workerBytes, workerRequests: harness.workerRequests, result }, null, 2));
}

test("production preparation and execution preserve literal and provisional declaration layers", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  for (const kind of ["indicator", "strategy"]) for (const flag of [undefined, "true", "false"]) {
    const source = program(bodies.line, flag, true, kind);
    for (const action of ["prepare", "run"]) {
      const response = await page.evaluate((input) => (window as any).layerFixture.execute(input), { source, bars, action });
      expect(response.completed, JSON.stringify(response)).toBe(true);
      expect(response.result.behindChart).toBe(flag !== "false");
      expect(response.result.source).toBe(source);
      evidence.push({ kind, flag: flag ?? "omitted", action, behindChart: response.result.behindChart });
    }
  }
  const alias = '//@version=6\nconst bool rear=false\nindicator("Alias",overlay=true,behind_chart=rear)\nplot(100)';
  const pending = await page.evaluate((input) => (window as any).layerFixture.execute(input), { source: alias, bars, action: "prepare" });
  expect(pending.result.behindChart).toBe(true);
  expect(pending.result.diagnostics.some((item: any) => item.code === "DECLARATION_LAYER_PENDING")).toBe(true);
  const resolved = await run(page, alias);
  expect(resolved.behindChart).toBe(false);
  for (const flag of ["1", "na", '"false"', "bar_index == 0"]) {
    const response = await page.evaluate((input) => (window as any).layerFixture.execute(input), { source: program(bodies.line, flag), bars });
    expect(response.completed).toBe(false);
    expect(response.code).toBe("UNSUPPORTED_DECLARATION_OPTION");
  }
  await capture(page, "declaration-native", info.project.name, { evidence, resolved }, harness);
});

test("default and explicit rear visuals remain behind candles while front visuals occlude them", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  for (const [style, body] of Object.entries(bodies)) for (const flag of [undefined, "true", "false"]) {
    const result = await run(page, program(body, flag));
    // Sample one CSS pixel inside constant line/fill intervals, away from antialiased shared edges.
    // The strict rear candle-body comparison below also proves this point is inside the primary body.
    const actual = await probe(page, 130, 100, "main", false, ["line", "fill"].includes(style) ? 1 : 0);
    if (style === "candles") {
      rgb((await probe(page, 130, 78)).rgb, [255, 0, 0], "custom lower wick interior");
    }
    rgb(actual.rgb, flag === "false" ? [255, 0, 0] : [71, 85, 105], style + " primary candle interior " + JSON.stringify(actual));
    expect(result.drawn.every((plot: any) => plot.behindChart === (flag !== "false"))).toBe(true);
    if (["area", "fill", "candles"].includes(style)) {
      rgb((await probe(page, 130, 118, "main", style === "fill")).rgb, [255, 0, 0], style + " exists outside primary body in an interval interior");
    } else if (["line", "hline"].includes(style)) {
      rgb((await probe(page, 130, 100, "main", true)).rgb, [255, 0, 0], style + " exists between candles");
    }
    evidence.push({ style, flag: flag ?? "omitted", actual, result });
  }
  await capture(page, "rear-front-overlap", info.project.name, evidence, harness);
});

test("forced pane outputs override rear metadata while ordinary outputs stay in their own pane", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  for (const body of [
    'plot(100,"Forced line",color=#ff0000,linewidth=4,force_overlay=true)',
    'plotshape(100,"Forced circle",style=shape.circle,location=location.absolute,color=#ff0000,size=size.large,force_overlay=true)',
    'plotcandle(80,125,75,120,title="Forced candles",color=#ff0000,wickcolor=#ff0000,bordercolor=#ff0000,force_overlay=true)',
    'a=plot(120,"Upper",display=display.none,force_overlay=true)\nb=plot(80,"Lower",display=display.none,force_overlay=true)\nfill(a,b,color=#ff0000,title="Forced fill")',
  ]) {
    const source = program(body + '\nplot(100,"Own pane",color=#00ff00,linewidth=4)', "true", false);
    const result = await run(page, source);
    rgb((await probe(page, 130, 100, "main", false, body.includes("Forced line") || body.includes("Forced fill") ? 1 : 0)).rgb, [255, 0, 0], "forced front candle overlap");
    rgb((await probe(page, 130, 100, "pane", false, 1)).rgb, [0, 255, 0], "ordinary separate pane");
    expect(result.drawn.filter((plot: any) => plot.overlay).every((plot: any) => plot.behindChart === false)).toBe(true);
    expect(result.drawn.find((plot: any) => plot.name === "Own pane").overlay).toBe(false);
    evidence.push(result);
  }
  await capture(page, "forced-precedence", info.project.name, evidence, harness);
});

test("background layering and primary body color remain distinct without extra numeric hosts", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  for (const flag of ["true", "false"]) {
    const background = await run(page, program('bgcolor(#ff0000,title="Background")', flag));
    rgb((await probe(page)).rgb, flag === "false" ? [255, 0, 0] : [71, 85, 105], "background candle overlap");
    rgb((await probe(page, 130, 125)).rgb, [255, 0, 0], "full-height background");
    const body = await run(page, program('barcolor(#0000ff,title="Body")', flag, false));
    rgb((await probe(page)).rgb, [0, 0, 255], "barcolor body independent of declaration layer");
    rgb((await probe(page, 130, 113)).rgb, [71, 85, 105], "original directional wick");
    expect(body.placements.main.series).toBe(0);
    expect(body.placements.pane.series).toBe(0);
    evidence.push({ flag, background, body });
  }
  await capture(page, "background-body", info.project.name, evidence, harness);
});

test("genuine input reruns change front color while preserving source values and timestamps", async ({ page, harness }, info) => {
  const source = program('shade=input.color(#ff0000,"Shade")\nplot(100,"Input line",color=shade,linewidth=4)', "false");
  const evidence: any[] = [];
  for (const shade of ["#ff0000", "#0000ff"]) {
    const result = await run(page, source, { inputs: { in_0: shade } });
    expect(result.behindChart).toBe(false);
    expect(result.inputs).toEqual({ in_0: shade });
    rgb((await probe(page, 130, 100, "main", false, 1)).rgb, shade === "#ff0000" ? [255, 0, 0] : [0, 0, 255], "input rerun candle overlap");
    expect(result.plots[0].samples.find((sample: any) => sample.index === 120).point).toMatchObject({ time: bars[120].time, value: 100 });
    evidence.push(result);
  }
  await capture(page, "input-rerun", info.project.name, evidence, harness);
});

test("packed 20,000-bar layers decode visible samples through pan resize and disposal", async ({ page, harness }, info) => {
  const large = Array.from({ length: 20_000 }, (_, index) => ({ ...bars[index % bars.length], time: bars[0].time + index * 60 }));
  const evidence: any[] = [];
  for (const flag of ["true", "false"]) {
    const result = await run(page, program(bodies.line, flag), { bars: large, from: 19_960, to: 19_990 });
    expect(result.behindChart).toBe(flag === "true");
    expect(result.plots[0]).toMatchObject({ packed: true, bufferCount: 3, bufferBytes: 220_000 });
    expect(result.placements.main.stats.decodedSamples).toBeLessThan(256);
    rgb((await probe(page, 19_975)).rgb, flag === "false" ? [255, 0, 0] : [71, 85, 105], "packed tail overlap");
    const panned = await page.evaluate(() => (window as any).layerFixture.pan(10_000, 10_030));
    expect(panned.placements.main.stats.decodedSamples).toBeLessThan(512);
    rgb((await probe(page, 10_015)).rgb, flag === "false" ? [255, 0, 0] : [71, 85, 105], "packed middle overlap");
    const resized = await page.evaluate(() => (window as any).layerFixture.resize());
    expect(resized.placements.main.stats.cacheEntries).toBeLessThanOrEqual(8192);
    rgb((await probe(page, 10_015)).rgb, flag === "false" ? [255, 0, 0] : [71, 85, 105], "resized overlap");
    await page.evaluate(() => (window as any).layerFixture.dispose());
    rgb((await probe(page, 10_015)).rgb, [71, 85, 105], "restored primary after idempotent dispose");
    evidence.push({ result, panned, resized });
  }
  await capture(page, "packed-dispose", info.project.name, evidence, harness);
});

test("custom candle alpha absent colors and na retain genuine pane geometry", async ({ page, harness }, info) => {
  const evidence: any[] = [];
  const source = program('plotcandle(80,125,75,120,title="Pane candles",color=#ff000080,wickcolor=#0000ff,bordercolor=#00ff00)', "true", false);
  const result = await run(page, source, { autoScale: true });
  expect(result.placements.pane.range.priceRange).toEqual({ minValue: 75, maxValue: 125 });
  rgb((await probe(page, 130, 100, "pane")).rgb, [136, 12, 19], "half-alpha native candle body over pane background");
  rgb((await probe(page, 130, 78, "pane")).rgb, [0, 0, 255], "native lower wick");
  rgb((await probe(page, 130, 123, "pane")).rgb, [0, 0, 255], "native upper wick");
  evidence.push(result);
  const absent = await run(page, program('plotcandle(80,125,75,120,title="Defaults")', "false", false));
  expect(absent.plots[0].options).not.toHaveProperty("color");
  expect(absent.plots[0].samples[0].point.options).not.toHaveProperty("wickcolor");
  evidence.push(absent);
  const hidden = await run(page, program('plotcandle(80,125,75,120,title="Invisible",color=na,wickcolor=na,bordercolor=na)', "false", false));
  rgb((await probe(page, 130, 100, "pane")).rgb, [17, 24, 39], "explicit na candle body is absent");
  rgb((await probe(page, 130, 78, "pane")).rgb, [17, 24, 39], "explicit na wick is absent");
  expect(hidden.plots[0].samples[0].point.options).toMatchObject({ color: null, wickcolor: null, bordercolor: null });
  evidence.push(hidden);
  await capture(page, "candle-native-colors", info.project.name, evidence, harness);
});

async function productSetup(page: Page) {
  await prepare(page);
  await fulfillReplayContext(page);
  const accessExpiry = new Date(Date.parse(FROZEN_TIME) + 300_000).toISOString();
  const session = { ...betaSessionResponse, user: { ...betaSessionResponse.user, provider: "google", deployment_mode: "production", workspace_access: true, access_expires_at: accessExpiry, is_beta_user: false, plan: "pro" } };
  const storage = new Map<string, any>();
  const receipts = new Map<string, any>();
  const workerReceipts: any[] = [];
  await page.route("**/assets/pine-native-worker*.js", async (route) => {
    const response = await route.fetch();
    const bytes = await response.body();
    workerReceipts.push({ url: route.request().url(), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    await route.fulfill({ response, body: bytes });
  });
  await page.addInitScript(({ session, key }) => {
    if (window !== window.top) return;
    const user = session.user;
    localStorage.setItem(key, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token, user: {
      id: user.id, email: user.email, name: user.name, provider: user.provider, approved: user.approved, betaPosition: user.beta_position,
      deploymentMode: user.deployment_mode, workspaceAccess: user.workspace_access, accessExpiresAt: user.access_expires_at, isBetaUser: user.is_beta_user, plan: user.plan,
    } }));
    (window as any).__layerResults = [];
    addEventListener("message", (event) => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find((item) => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__layerResults.push(event.data.payload);
    }, true);
  }, { session, key: AUTH_SESSION_KEY });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") return route.fulfill({ json: session });
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: "production", google_enabled: true, manual_access_enabled: false, dev_auth_bypass_enabled: false } });
    if (endpoint === "/billing/status") return route.fulfill({ json: { provider: "stripe", mode: "live", configured: true, workspace_access: true, subscription_access: true, plan: "pro", status: "active", cadence: "monthly", current_period_end: "2027-09-15T10:00:00Z", verified_at: FROZEN_TIME, refresh_required: false, cancel_at_period_end: false } });
    const operation = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (operation) {
      expect(request.headers().authorization).toBe(`Bearer ${session.token}`);
      const [, id, action] = operation;
      if (action === "reserve") receipts.set(id, { operation_id: id, ...request.postDataJSON(), status: "reserved", http_status: null, result: null, created_at: FROZEN_TIME, completed_at: null });
      expect(receipts.has(id)).toBe(true);
      return route.fulfill({ json: receipts.get(id) });
    }
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound) {
      expect(receipts.get(bound)).toMatchObject({ method: request.method(), path: endpoint, status: "reserved" });
      Object.assign(receipts.get(bound), { status: "completed", http_status: 200, completed_at: FROZEN_TIME });
    }
    const encoded = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (encoded) {
      const key = decodeURIComponent(encoded);
      if (request.method() === "PUT") storage.set(key, structuredClone(request.postDataJSON().value));
      return route.fulfill({ json: { namespace: "edgelab", key, value: storage.get(key) ?? null, updated_at: FROZEN_TIME } });
    }
    return route.fallback();
  });
  await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  return { storage, workerReceipts };
}
async function editor(page: Page) {
  const trigger = page.getByRole("button", { name: "Editor", exact: true });
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await trigger.click();
  return page.getByRole("dialog", { name: "EdgeLab indicator editor" });
}
async function checkedRun(dialog: Locator) {
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeHidden();
}
async function observed(page: Page, source: string, color: string) {
  await expect.poll(() => page.evaluate(({ source, color }) => (window as any).__layerResults.some((response: any) => response.status === "completed" && response.result.kind === "run" && response.result.source === source && response.result.inputs.in_0 === color), { source, color })).toBe(true);
  return page.evaluate(({ source, color }) => [...(window as any).__layerResults].reverse().find((response: any) => response.status === "completed" && response.result.kind === "run" && response.result.source === source && response.result.inputs.in_0 === color).result, { source, color });
}
async function productPixels(page: Page) {
  return page.locator(".chart-stage").first().evaluate((stage) => {
    const canvas = [...stage.querySelectorAll("canvas")].filter((item) => item.getBoundingClientRect().height > 80).sort((a, b) => b.width - a.width)[0];
    if (!canvas) throw new Error("Actual primary candle canvas missing.");
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, blue = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] === 255 && data[index + 1] === 0 && data[index + 2] === 0) red++;
      if (data[index] === 0 && data[index + 1] === 0 && data[index + 2] === 255) blue++;
    }
    return { red, blue, width: canvas.width, height: canvas.height };
  });
}

test("saved native layer metadata survives reload and actual inputs Hide Show Remove", async ({ page }, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const context = await productSetup(page);
  const source = program('shade=input.color(#ff0000,"Shade")\nplot((open+close)/2,"Front mean",color=shade,linewidth=4)', "false").replace("Layer proof", "Saved layers");
  let dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await checkedRun(dialog);
  const initial = await observed(page, source, "#FF0000FF");
  expect(initial.behindChart).toBe(false);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => context.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === source)).toBe(true);
  const saved = structuredClone(context.storage.get("custom-indicator-scripts.v1").find((script: any) => script.source === source));
  expect(saved.pinePrepared.behindChart).toBe(false);
  await page.reload();
  dialog = await editor(page);
  await dialog.getByLabel("Script library", { exact: true }).selectOption(saved.id);
  await expect(dialog.getByLabel("EdgeLab indicator source", { exact: true })).toHaveValue(source);
  await checkedRun(dialog);
  expect((await observed(page, source, "#FF0000FF")).behindChart).toBe(false);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const row = page.locator(".native-study-chip").filter({ hasText: "Saved layers" }).first();
  await expect(row).toBeVisible();
  await expect.poll(async () => (await productPixels(page)).red).toBeGreaterThan(0);
  await row.getByRole("button", { name: "Inputs for Saved layers", exact: true }).click();
  await row.getByRole("textbox", { name: "Shade", exact: true }).fill("#0000ff");
  const edited = await observed(page, source, "#0000ff");
  expect(edited.behindChart).toBe(false);
  await expect.poll(async () => (await productPixels(page)).blue).toBeGreaterThan(0);
  await row.getByRole("button", { name: "Close inputs for Saved layers", exact: true }).click();
  await page.getByRole("button", { name: "Objects", exact: true }).first().click();
  const object = page.locator(".indicator-object-row").filter({ hasText: saved.name }).first();
  await object.getByRole("button", { name: /^On: Hide / }).click();
  await expect.poll(async () => (await productPixels(page)).blue).toBe(0);
  await object.getByRole("button", { name: /^Off: Show / }).click();
  await expect.poll(async () => (await productPixels(page)).blue).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Collapse chart objects", exact: true }).click();
  await row.getByRole("button", { name: "Remove Saved layers", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await productPixels(page)).blue).toBe(0);
  expect(context.storage.get("custom-indicator-scripts.v1").find((script: any) => script.id === saved.id)).toEqual(saved);
  const workerName = fs.readdirSync("frontend/dist/assets").find((name) => /^pine-native-worker.*\.js$/.test(name))!;
  const worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  const workerSha256 = createHash("sha256").update(worker).digest("hex");
  expect(context.workerReceipts.length).toBeGreaterThan(0);
  for (const receipt of context.workerReceipts) {
    expect(receipt.sha256).toBe(workerSha256);
    expect(receipt.bytes).toBe(worker.length);
  }
  expect(errors).toEqual([]);
  await capture(page, "saved-layer-product", info.project.name, { initial, edited, saved, workerReceipts: context.workerReceipts, pixels: await productPixels(page), errors }, { origin: page.url(), workerSha256, workerBytes: worker.length, workerRequests: context.workerReceipts.map((item) => item.url), otherRequests: [] });
});
