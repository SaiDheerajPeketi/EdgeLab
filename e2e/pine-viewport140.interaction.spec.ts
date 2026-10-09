import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { productSetup, editor } from "./pine-layering.product-support";

const dist = path.resolve("frontend/dist"), artifacts = path.resolve(".artifacts/pine-viewport140");
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function inventory(directory = dist): { file: string; sha256: string }[] {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const full = path.join(directory, name);
    return fs.statSync(full).isDirectory() ? inventory(full) : [{ file: path.relative(dist, full), sha256: hash(fs.readFileSync(full)) }];
  });
}
let sealed: ReturnType<typeof inventory>;
test.beforeAll(() => { sealed = inventory(); });
test.afterAll(() => {
  expect(inventory()).toEqual(sealed);
  const folder = path.join(artifacts, test.info().project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "sealed-build.json"), JSON.stringify({ files: sealed.length, unchanged: true, inventorySHA256: hash(JSON.stringify(sealed)) }, null, 2));
});
const opaqueServiceWorkerError = "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.";
test.beforeEach(({ page }) => {
  (page as any).__viewportErrors = []; (page as any).__viewportHarnessErrors = [];
  page.on("pageerror", error => (page as any)[error.message === opaqueServiceWorkerError ? "__viewportHarnessErrors" : "__viewportErrors"].push(error.message));
});
test.afterEach(({ page }) => expect((page as any).__viewportErrors).toEqual([]));

function source(name: string, overlay = true, strategy = false) {
  return `//@version=6
${strategy ? "strategy" : "indicator"}("${name}",overlay=${overlay},behind_chart=false)
left=chart.left_visible_bar_time
right=chart.right_visible_bar_time
shown=not na(left) and not na(right) and time>=left and time<=right
var float total=0
var int count=0
if shown
    total+=close
    count+=1
plot(left,"Left",display=display.none)
plot(right,"Right",display=display.none)
plot(count,"Count",display=display.none)
plot(total,"Total",display=display.none)
plot(shown?close:na,"Visible close",color=#ff00ff,linewidth=3)
if barstate.isfirst
    label.new(bar_index,close,"Left:"+str.tostring(left),style=label.style_none,textcolor=#ffffff)
var panel=table.new(position.top_right,1,1)
if barstate.islast
    table.cell(panel,0,0,"Count:"+str.tostring(count),text_color=#ffffff,bgcolor=#192333)
${strategy ? 'if time==left\n    strategy.entry("Window",strategy.long)\nif time==right\n    strategy.close("Window")' : ""}`;
}
const ordinary = '//@version=6\nindicator("Ordinary viewport140",overlay=true)\nplot(ta.sma(close,3),"Ordinary close",color=#00ffff)';
async function add(page: Page, text: string, state: Awaited<ReturnType<typeof productSetup>>, inputValues: Record<string, string> = {}) {
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption(text.includes("\nstrategy(") ? "pine-strategy" : "pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(text);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  for (const [label, value] of Object.entries(inputValues)) {
    await dialog.getByLabel(label, { exact: true }).fill(value); await dialog.getByLabel(label, { exact: true }).press("Enter");
  }
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.source === text)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
}
async function frame(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function chart(page: Page, range?: { from: number; to: number }, remember = false) {
  return page.evaluate(async ({ range, remember }) => {
    const stage = document.querySelector(".chart-stage")!;
    const key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let api: any, candles: any; const refs: any[] = [];
    for (let fiber = key ? (stage as any)[key] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
        const ref = hook.memoizedState?.current; if (!ref) continue;
        refs.push(ref);
        if (!api && typeof ref.timeScale === "function" && typeof ref.addCandlestickSeries === "function") api = ref;
        if (!candles && typeof ref.seriesType === "function" && ref.seriesType() === "Candlestick") candles = ref;
      }
    }
    if (!api || !candles) throw new Error("Actual production chart/candle refs unavailable");
    if (range) {
      api.timeScale().setVisibleLogicalRange(range);
      // LWC applies public range mutations during its next render frame.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    const installations: any[] = [];
    const collect = (value: any, depth: number) => {
      if (!value || depth > 3) return;
      if (value.primitive?.plots?.some((plot: any) => plot.name === "Ordinary close" || plot.name === "Ordinary ticks") && !installations.includes(value)) installations.push(value);
      if (value instanceof Set || value instanceof Map) for (const item of value.values()) collect(item, depth + 1);
      else if (value.installed || value.installation) collect(value.installed ?? value.installation, depth + 1);
    };
    for (const ref of refs) collect(ref, 0);
    const owner = (window as any).__viewport140Identity;
    if (remember) (window as any).__viewport140Identity = { api, candles, installations: installations.slice(), series: installations.flatMap(item => item.series) };
    const rows = candles.data().map(({ time, open, high, low, close }: any) => ({ time, open, high, low, close }));
    const logical = api.timeScale().getVisibleLogicalRange();
    // Independent oracle from authored candle coordinates, not the product's
    // viewport normalization helper or requested logical range alone.
    const visible = logical ? rows.filter((row: any) => {
      const x = api.timeScale().timeToCoordinate(row.time), index = x === null ? null : api.timeScale().coordinateToLogical(x);
      // Loaded centers have integral logical coordinates; the endpoint candles
      // intersecting a fractional viewport are included by floor/ceil policy.
      return index !== null && Math.round(index) >= Math.floor(logical.from) && Math.round(index) <= Math.ceil(logical.to);
    }) : [];
    const identity = { chart: !owner || owner.api === api, candles: !owner || owner.candles === candles,
      installationCount: installations.length, installationCountUnchanged: !owner || owner.installations.length === installations.length,
      installations: !owner || owner.installations.every((item: any) => installations.includes(item)),
      series: !owner || owner.series.every((item: any) => installations.some(i => i.series.includes(item))) };
    return { rows, logical, time: api.timeScale().getVisibleRange(), visible, identity,
      viewport: visible.length ? { from: visible[0].time, to: visible.at(-1).time } : null,
      ordinaryInstallations: installations.length,
      identitiesUnchanged: !owner || owner.api === api && owner.candles === candles && owner.installations.length === installations.length
        && owner.installations.every((item: any) => installations.includes(item)) && owner.series.every((item: any) => installations.some(i => i.series.includes(item))) };
  }, { range, remember });
}
async function stableChart(page: Page) {
  let previous = "", unchangedSince = 0;
  await expect.poll(async () => {
    const current = JSON.stringify((await chart(page)).logical);
    if (current !== previous) { previous = current; unchangedSince = Date.now(); return false; }
    return Date.now() - unchangedSince >= 200;
  }, { intervals: [100], timeout: 10_000 }).toBe(true);
  return chart(page);
}
async function results(page: Page, text: string) {
  return page.evaluate(source => ((window as any).__layerResults ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    const plots = result.plots.map((plot: any) => {
      if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
      const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
      return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null) };
    });
    return [{ ...result, plots, sessionId: payload.sessionId, sequence: payload.sequence }];
  }), text);
}
const values = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).values;
async function current(page: Page, text: string, expected: Awaited<ReturnType<typeof chart>>, after = 0) {
  const left = expected.viewport ? expected.viewport.from * 1000 : null, right = expected.viewport ? expected.viewport.to * 1000 : null;
  const match = (result: any) => values(result, "Left").every((value: any) => value === left)
    && values(result, "Right").every((value: any) => value === right) && result.audit.bars === expected.rows.length;
  try { await expect.poll(async () => (await results(page, text)).slice(after).some(match)).toBe(true); }
  catch (error) {
    const folder = path.join(artifacts, test.info().project.name); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `getter-failure-${Date.now()}.json`), JSON.stringify({ expected, actual: await chart(page), genuineResults: await results(page, text) }, null, 2));
    throw error;
  }
  const result = (await results(page, text)).slice(after).findLast(match);
  expect(result.usesVisibleRange).toBe(true);
  const visible = new Set(expected.visible.map((bar: any) => bar.time));
  expect(values(result, "Visible close")).toEqual(expected.rows.map((bar: any) => visible.has(bar.time) ? bar.close : null));
  let count = 0, total = 0;
  const counts = expected.rows.map((bar: any) => { if (visible.has(bar.time)) count++; return count; });
  const totals = expected.rows.map((bar: any) => { if (visible.has(bar.time)) total += bar.close; return total; });
  expect(values(result, "Count")).toEqual(counts);
  values(result, "Total").forEach((value: number, i: number) => expect(value).toBeCloseTo(totals[i], 7));
  expect(result.labels).toHaveLength(1); expect(result.labels[0].x).toBe(0); expect(result.labels[0].y).toBe(expected.rows[0].close);
  if (left !== null) expect(Number(result.labels[0].text.slice(5))).toBe(left);
  expect(result.tables[0].cells[0][0].text).toBe(`Count:${count}`);
  return result;
}
async function save(page: Page, info: TestInfo, name: string, state: Awaited<ReturnType<typeof productSetup>>, evidence: unknown) {
  const workerName = fs.readdirSync(path.join(dist, "assets")).find(name => /^pine-native-worker.*\.js$/.test(name))!, bytes = fs.readFileSync(path.join(dist, "assets", workerName));
  expect(state.workerReceipts.length).toBeGreaterThan(0); expect(state.workerReceipts.every(item => item.sha256 === hash(bytes) && item.bytes === bytes.length)).toBe(true);
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${name}.json`), JSON.stringify({ scope: "Actual production app/LWC/native worker; API/auth/provider seams only", workerName, workerSHA256: hash(bytes), workerReceipts: state.workerReceipts, evidence, errors: (page as any).__viewportErrors, opaquePlaywrightHarnessErrors: (page as any).__viewportHarnessErrors }, null, 2));
  await page.screenshot({ path: path.join(folder, `${name}.png`) });
  await page.locator(".chart-stage").first().screenshot({ path: path.join(folder, `${name}-chart.png`) });
  const panes = page.getByRole("region", { name: / native Pine pane$/ });
  for (let i = 0; i < await panes.count(); i++) await panes.nth(i).screenshot({ path: path.join(folder, `${name}-native-pane-${i + 1}.png`) });
}

test("saved main viewport recalculates full history and drawings through pan zoom resize without disturbing an ordinary study", async ({ page }, info) => {
  const state = await productSetup(page), text = source("Viewport140 main");
  await add(page, ordinary, state); await add(page, text, state);
  await expect.poll(async () => (await chart(page)).ordinaryInstallations).toBe(1);
  const baseline = await chart(page, { from: 20, to: 45 }); await current(page, text, baseline);
  await chart(page, undefined, true);
  const ordinaryCount = (await results(page, ordinary)).length, evidence: any[] = [];
  for (const range of [{ from: 40, to: 65 }, { from: 48, to: 58 }]) {
    const expected = await chart(page, range), result = await current(page, text, expected); await frame(page);
    const actual = await chart(page); expect(actual.logical).toEqual(expected.logical); expect(actual.identitiesUnchanged).toBe(true);
    await expect(page.locator('.chart-stage [data-pine-table-position="top_right"]')).toHaveText(`Count:${expected.visible.length}`);
    evidence.push({ chart: actual, result });
  }
  const size = page.viewportSize()!; await page.setViewportSize({ width: Math.max(320, size.width - 70), height: size.height }); await frame(page);
  const resized = await chart(page), resizeResult = await current(page, text, resized); await frame(page);
  expect((await chart(page)).logical).toEqual(resized.logical); expect((await chart(page)).identitiesUnchanged).toBe(true);
  expect((await results(page, ordinary)).length).toBe(ordinaryCount); evidence.push({ chart: resized, result: resizeResult });
  await save(page, info, "main-pan-zoom-resize", state, evidence);
});

test("native pane and historical strategy consume the main viewport and recalculate full execution", async ({ page }, info) => {
  const state = await productSetup(page), pane = source("Viewport140 pane", false), strategy = source("Viewport140 strategy", false, true);
  await add(page, pane, state); await add(page, strategy, state);
  const evidence: any[] = [];
  for (const range of [{ from: 20, to: 30 }, { from: 50, to: 60 }]) {
    const expected = await chart(page, range), paneResult = await current(page, pane, expected), strategyResult = await current(page, strategy, expected);
    expect(strategyResult.audit.mode).toBe("historical"); expect(strategyResult.strategy.closedTrades).toHaveLength(1);
    const trade = strategyResult.strategy.closedTrades[0];
    expect(trade.entry_bar_index).toBe(range.from + 1); expect(trade.exit_bar_index).toBe(range.to + 1);
    for (const name of ["Viewport140 pane", "Viewport140 strategy"]) {
      const region = page.getByRole("region", { name: `${name} native Pine pane`, exact: true });
      await expect(region.locator('[data-pine-table-position="top_right"]')).toHaveText(`Count:${expected.visible.length}`);
      await expect(region.locator("canvas").first()).toBeVisible();
    }
    expect((await chart(page)).logical).toEqual(expected.logical); evidence.push({ expected, paneResult, strategyResult });
  }
  await save(page, info, "pane-strategy", state, evidence);
});

async function hold(page: Page, text: string) {
  await page.evaluate(text => {
    const state = { source: text, held: null as MessageEvent | null, enabled: true }; (window as any).__viewport140Hold = state;
    addEventListener("message", event => {
      const actual = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(frame => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      const response = event.data?.payload?.protocol === "pine-live-v1" ? event.data.payload.response : event.data?.payload;
      if (actual && event.origin === "null" && event.data?.type === "result" && state.enabled && response?.status === "completed"
        && response.result?.kind === "run" && response.result.source === state.source) { state.held = event; state.enabled = false; event.stopImmediatePropagation(); }
    }, true);
  }, text);
}
async function release(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__viewport140Hold, event = state.held as MessageEvent;
    const connected = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].some(frame => frame.contentWindow === event.source);
    state.held = null; state.enabled = false;
    window.dispatchEvent(new MessageEvent("message", { data: event.data, origin: event.origin, source: event.source, ports: event.ports }));
    return { connected, nonce: event.data.nonce };
  });
}
test("stale completions and legacy failed metadata recover to the actual returned viewport without disturbing an ordinary study", async ({ page }, info) => {
  const state = await productSetup(page), text = source("Viewport140 stale"); await add(page, ordinary, state); await add(page, text, state);
  const returned = await chart(page, { from: 20, to: 35 }); await current(page, text, returned);
  await hold(page, text); await chart(page, { from: 40, to: 50 });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewport140Hold.held))).toBe(true);
  const newer = await chart(page, { from: 65, to: 75 }), latest = await current(page, text, newer);
  const stale = await release(page); expect(stale.connected).toBe(false); await frame(page);
  expect((await chart(page)).logical).toEqual(newer.logical);
  await expect(page.locator('[data-pine-table-position="top_right"]')).toHaveText(`Count:${newer.visible.length}`);
  await hold(page, text); await chart(page, { from: 10, to: 18 });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__viewport140Hold.held))).toBe(true);
  if (!await page.getByRole("button", { name: "Studies", exact: true }).isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: "Studies", exact: true }).click();
  const row = page.locator(".native-study-chip").filter({ hasText: "Viewport140 stale" }).first();
  await row.getByRole("button", { name: "Remove Viewport140 stale", exact: true }).click();
  await page.getByRole("button", { name: "Close studies controls", exact: true }).click();
  const removed = await release(page); expect(removed.connected).toBe(false); await frame(page);
  await expect(page.locator('[data-pine-table-position="top_right"]')).toHaveCount(0);
  await expect(page.locator(".chart-study-pill").filter({ hasText: "Viewport140 stale" })).toHaveCount(0);
  const cutoff = returned.rows.at(-7)!.time * 1000;
  const recoverySource = `//@version=6\nindicator("Viewport140 legacy recovery",overlay=true)\nn=input.int(2,"Multiplier")\nif na(chart.left_visible_bar_time) or chart.left_visible_bar_time<${cutoff}\n    runtime.error("Choose a later window140")\nplot(chart.left_visible_bar_time,"Left",display=display.none)\nplot(chart.right_visible_bar_time,"Right",display=display.none)\nplot(time>=chart.left_visible_bar_time and time<=chart.right_visible_bar_time ? close*n : na,"Recovery",color=#00ff00)`;
  await add(page, recoverySource, state, { Multiplier: "4" });
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByPlaceholder("Layout name", { exact: true }).fill("Viewport140 legacy persistence");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => [ordinary, recoverySource].every(source => state.storage.get("chart-layout.v1")?.indicatorInstances?.some((item: any) => item.customScriptSource === source))).toBe(true);
  const preparedBefore = structuredClone(state.storage.get("custom-indicator-scripts.v1").find((item: any) => item.source === recoverySource));
  expect(preparedBefore.pinePrepared.usesVisibleRange).toBe(true); expect(preparedBefore.inputs.in_0).toBe(4);
  const strip = (value: any): number => {
    if (!value || typeof value !== "object") return 0;
    let count = 0;
    if (value.source === recoverySource && value.language === "pine" && value.kind === "prepare" && "usesVisibleRange" in value) { delete value.usesVisibleRange; count++; }
    for (const nested of Object.values(value)) count += strip(nested);
    return count;
  };
  let stripped = 0;
  for (const [key, value] of state.storage) { const legacy = structuredClone(value); stripped += strip(legacy); state.storage.set(key, legacy); }
  expect(stripped).toBeGreaterThan(0);
  const strippedLocal = await page.evaluate(source => {
    const strip = (value: any): number => {
      if (!value || typeof value !== "object") return 0;
      let count = 0;
      if (value.source === source && value.language === "pine" && value.kind === "prepare" && "usesVisibleRange" in value) { delete value.usesVisibleRange; count++; }
      for (const nested of Object.values(value)) count += strip(nested);
      return count;
    };
    let count = 0;
    for (const key of Object.keys(localStorage)) {
      try { const value = JSON.parse(localStorage.getItem(key)!); const changed = strip(value); if (changed) { localStorage.setItem(key, JSON.stringify(value)); count += changed; } } catch {}
    }
    return count;
  }, recoverySource);
  const persistedLayout = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith("edgelab.chart-layout.v1.user-")));
  // The shared test seed resets layout on reload; restore the actual persisted
  // values after that seed, as the existing persistence acceptance does.
  await page.addInitScript(entries => { if (window === window.top) for (const [key, value] of entries) localStorage.setItem(key, value!); }, persistedLayout);
  await page.reload(); await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  await expect.poll(async () => (await chart(page)).ordinaryInstallations).toBe(1);
  await chart(page, undefined, true);
  const ordinaryBeforeError = (await results(page, ordinary)).length;
  await expect(page.getByText(/Choose a later window140/).first()).toBeVisible();
  const legacyFailed = await chart(page);
  expect((await chart(page)).identitiesUnchanged).toBe(true);
  const legacyReturned = await chart(page, { from: returned.rows.length - 5, to: returned.rows.length - 1 });
  await expect.poll(async () => (await results(page, recoverySource)).some(result => result.inputs.in_0 === 4
    && values(result, "Left").every((value: any) => value === legacyReturned.viewport!.from * 1000))).toBe(true);
  const recovered = (await results(page, recoverySource)).findLast(result => result.inputs.in_0 === 4
    && values(result, "Left").every((value: any) => value === legacyReturned.viewport!.from * 1000));
  const selected = new Set(legacyReturned.visible.map((bar: any) => bar.time));
  expect(values(recovered, "Recovery")).toEqual(legacyReturned.rows.map((bar: any) => selected.has(bar.time) ? bar.close * 4 : null));
  expect(recovered.usesVisibleRange).toBe(true); expect(recovered.audit.bars).toBe(legacyReturned.rows.length);
  expect(values(recovered, "Right").every((value: any) => value === legacyReturned.viewport!.to * 1000)).toBe(true);
  await expect(page.getByText(/Choose a later window140/)).toHaveCount(0);
  expect((await chart(page)).identitiesUnchanged).toBe(true); expect((await results(page, ordinary)).length).toBe(ordinaryBeforeError);
  const fallback = await page.evaluate(source => ((window as any).__layerResults ?? []).map((payload: any) => payload.protocol === "pine-live-v1" ? payload.response : payload)
    .filter((response: any) => response.status === "completed" && response.result.kind === "prepare" && response.result.source === source), recoverySource);
  expect(fallback.length).toBeGreaterThan(0); expect(fallback.every((response: any) => response.result.usesVisibleRange === true)).toBe(true);
  await save(page, info, "stale-legacy-recovery", state, { emptyScrollLimitation: "Pinned LWC retains two numeric points at scroll bounds. Explicit-null execution is independently verified by the genuine worker suite; this app case uses a reachable authored range cutoff.", returned, newer, latest, stale, removed, legacy: { cutoff, preparedBefore, stripped, strippedLocal, legacyFailed, legacyReturned, recovered, ordinaryBeforeError, ordinaryAfterError: (await results(page, ordinary)).length, ordinaryIdentitiesUnchanged: (await chart(page)).identitiesUnchanged, genuinePrepareFallback: fallback } });
});

async function liveSetup(page: Page) {
  const sockets: any[] = [], events: any[] = [];
  const start = Date.parse("2026-09-15T08:30:00Z") / 1000;
  const history = Array.from({ length: 120 }, (_, i) => ({ time: start + i * 60, open: 67500 + i / 10 - 1, high: 67500 + i / 10 + 2, low: 67500 + i / 10 - 2, close: 67500 + i / 10, volume: 10 }));
  await page.routeWebSocket(/data-stream\.binance\.vision/, socket => { sockets.push(socket); socket.onClose(() => { const i = sockets.indexOf(socket); if (i >= 0) sockets.splice(i, 1); }); });
  const state = await productSetup(page, { target: "/app/live", keepBinanceWebSocket: true, beforeNavigate: async () => {
    await page.route("**/api/live/binance/instruments?**", route => route.fulfill({ json: { provider: "binance", instruments: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, name: symbol, status: "TRADING", asset_class: "crypto", base_asset: symbol.slice(0, -4), quote_asset: "USDT", tick_size: .01, min_quantity: .00001, quantity_step: .00001 })), total: 2 } }));
    await page.route("https://data-api.binance.vision/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/klines")) return route.fulfill({ json: url.searchParams.has("endTime") ? [] : history.map(b => [b.time * 1000, String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume), b.time * 1000 + 59999]) });
      if (url.pathname.endsWith("/ticker/24hr")) return route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, lastPrice: "67511.9", priceChange: "1", priceChangePercent: ".1", highPrice: "67600", lowPrice: "67400", volume: "1000", quoteVolume: "67500000", openPrice: "67500", closeTime: Date.parse("2026-09-15T10:30:00Z") })) });
      return route.fulfill({ json: { symbols: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, status: "TRADING", baseAsset: symbol.slice(0, -4), quoteAsset: "USDT" })) } });
    });
  } });
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  const minute = page.getByRole("button", { name: "1m", exact: true }).first(); if (await minute.isVisible()) await minute.click();
  let eventTime = Date.parse("2026-09-15T10:30:00Z");
  const emit = (i: number, close: number, confirmed: boolean) => {
    const bar = { time: start + i * 60, open: 67512, high: Math.max(67514, close + 1), low: Math.min(67510, close - 1), close, volume: 15 };
    const event = { stream: "btcusdt@kline_1m", data: { e: "kline", E: ++eventTime, s: "BTCUSDT", k: { t: bar.time * 1000, T: bar.time * 1000 + 59999, i: "1m", s: "BTCUSDT", o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), v: String(bar.volume), x: confirmed } } };
    events.push(event); for (const socket of sockets) if (socket.url().includes("btcusdt@kline_1m")) socket.send(JSON.stringify(event));
  };
  return { state, history, events, emit };
}
const ordinaryLive = '//@version=6\nindicator("Ordinary live viewport140",overlay=true)\nvarip int ticks=0\nticks+=1\nplot(ticks,"Ticks",display=display.none)\nplot(67500+ticks/10,"Ordinary ticks",color=#00ffff)';
test("persistent live viewport rebuilds only its dependent owner and keeps ordinary tick state through close append", async ({ page }, info) => {
  const { state, events, emit } = await liveSetup(page);
  const dependent = source("Viewport140 live"); await add(page, ordinaryLive, state); await add(page, dependent, state);
  emit(120, 67520, false);
  await expect.poll(async () => (await results(page, ordinaryLive)).some(result => result.sessionId && result.sequence >= 1)).toBe(true);
  const first = (await results(page, ordinaryLive)).findLast(result => result.sessionId && result.sequence >= 1);
  await expect.poll(async () => (await results(page, dependent)).some(result => result.sessionId && result.sequence >= 1)).toBe(true);
  const beforeDependent = (await results(page, dependent)).findLast(result => result.sessionId);
  await expect.poll(async () => (await chart(page)).ordinaryInstallations).toBe(1);
  const expected = await chart(page, { from: 80, to: 110 }), changed = await current(page, dependent, expected);
  expect(changed.sessionId).toBe(beforeDependent.sessionId); expect(changed.sequence).toBeGreaterThan(beforeDependent.sequence);
  expect((await results(page, ordinaryLive)).at(-1).sessionId).toBe(first.sessionId);
  await chart(page, undefined, true);
  const zoomed = await chart(page, { from: 85, to: 105 }); await current(page, dependent, zoomed);
  expect((await chart(page)).identitiesUnchanged).toBe(true);
  emit(120, 67524, false);
  await expect.poll(async () => (await results(page, ordinaryLive)).some(result => result.sessionId === first.sessionId && result.sequence > first.sequence)).toBe(true);
  const tick = (await results(page, ordinaryLive)).findLast(result => result.sessionId === first.sessionId);
  expect(values(tick, "Ticks").at(-1)).toBe(values(first, "Ticks").at(-1) + 1);
  const tickView = await stableChart(page); await current(page, dependent, tickView);
  expect((await chart(page)).logical).toEqual(tickView.logical);
  emit(120, 67524, true);
  await expect.poll(async () => (await results(page, ordinaryLive)).some(result => result.sessionId === first.sessionId && result.sequence > tick.sequence)).toBe(true);
  const confirmedView = await stableChart(page); await current(page, dependent, confirmedView);
  emit(121, 67525, false);
  await expect.poll(async () => (await chart(page)).rows.length).toBe(122);
  const appendView = await stableChart(page), appended = await current(page, dependent, appendView);
  expect((await chart(page)).logical).toEqual(appendView.logical);
  await expect.poll(async () => (await results(page, ordinaryLive)).some(result => result.sessionId === first.sessionId && result.audit.bars === 122)).toBe(true);
  const ordinaryLast = (await results(page, ordinaryLive)).findLast(result => result.sessionId === first.sessionId);
  expect(values(ordinaryLast, "Ticks").at(-1)).toBe(values(tick, "Ticks").at(-1) + 2);
  await save(page, info, "live-viewport", state, { liveFollowPolicy: "Provider changes invoke the existing LWC scrollToRealTime animation; compare recalculation against its actual settled range.", expected, first, changed, tick, tickView, confirmedView, appendView, appended, ordinaryLast, providerEvents: events });
});

test("failed live viewport owners recover both open and confirmed tails without synthetic ticks or resetting ordinary state", async ({ page }, info) => {
  const { state, history, events, emit } = await liveSetup(page), cutoff = history[70].time * 1000;
  const dependent = source("Viewport140 live recovery").replace('shown=not na(left)', `if na(left) or left<${cutoff}\n    runtime.error("Choose later live window140")\nshown=not na(left)`)
    + '\nplot(barstate.isrealtime?1:0,"Realtime",display=display.none)\nplot(barstate.isconfirmed?1:0,"Confirmed",display=display.none)\nvarip int pulse=0\npulse+=1\nplot(pulse,"Pulse",display=display.none)';
  await add(page, ordinaryLive, state); await add(page, dependent, state);
  emit(120, 67520, false);
  await expect.poll(async () => (await results(page, ordinaryLive)).some(result => result.sessionId && result.sequence >= 1)).toBe(true);
  const ordinarySession = (await results(page, ordinaryLive)).at(-1).sessionId;
  await stableChart(page);
  const initial = await current(page, dependent, await chart(page, { from: 80, to: 95 }));
  await expect.poll(async () => (await chart(page)).ordinaryInstallations).toBe(1);
  await chart(page, undefined, true);
  const evidence: any[] = [];
  let previous = initial;
  for (const confirmed of [false, true]) {
    if (confirmed) {
      const prior = (await results(page, ordinaryLive)).at(-1);
      emit(120, 67520, true);
      await expect.poll(async () => (await results(page, ordinaryLive)).some(result => result.sessionId === ordinarySession && result.sequence > prior.sequence)).toBe(true);
      await stableChart(page);
    }
    // A real confirmation changes the ordinary plotted values. Compare the
    // same installation only across the following no-feed error/range cycle.
    await chart(page, undefined, true);
    const ordinaryBefore = (await results(page, ordinaryLive)).at(-1), eventsBefore = events.length;
    const failedView = await chart(page, { from: 20, to: 40 });
    await expect(page.getByText(/Choose later live window140/).first()).toBeVisible();
    const completionsBeforeReturn = (await results(page, dependent)).length;
    const returned = await chart(page, { from: confirmed ? 85 : 80, to: confirmed ? 105 : 95 });
    const recovered = await current(page, dependent, returned, completionsBeforeReturn);
    expect(recovered.sessionId).not.toBe(previous.sessionId);
    expect(recovered.sequence).toBe(confirmed ? 0 : 1);
    expect(recovered.audit.bars).toBe(returned.rows.length);
    expect(values(recovered, "Realtime")).toEqual(returned.rows.map((_, i) => !confirmed && i === returned.rows.length - 1 ? 1 : 0));
    expect(values(recovered, "Confirmed")).toEqual(returned.rows.map((_, i) => confirmed || i < returned.rows.length - 1 ? 1 : 0));
    expect(values(recovered, "Pulse").at(-1)).toBe(returned.rows.length);
    await expect(page.getByText(/Choose later live window140/)).toHaveCount(0);
    const ordinaryAfter = (await results(page, ordinaryLive)).at(-1);
    expect(ordinaryAfter.sessionId).toBe(ordinarySession); expect(ordinaryAfter.sequence).toBe(ordinaryBefore.sequence);
    expect(values(ordinaryAfter, "Ticks")).toEqual(values(ordinaryBefore, "Ticks"));
    const ownerAfter = await chart(page);
    if (!ownerAfter.identitiesUnchanged) {
      const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `recovery-identity-failure-${Date.now()}.json`), JSON.stringify({ confirmed, initial, failedView, returned, recovered, ordinaryBefore, ordinaryAfter, ownerAfter, providerEvents: events }, null, 2));
    }
    expect(events.length).toBe(eventsBefore); expect(ownerAfter.identitiesUnchanged).toBe(true);
    expect((await chart(page)).logical).toEqual(returned.logical);
    evidence.push({ confirmed, failedView, returned, recovered, ordinaryBefore, ordinaryAfter, providerEventsBefore: eventsBefore }); previous = recovered;
  }
  emit(121, 67525, false);
  await expect.poll(async () => (await chart(page)).rows.length).toBe(122);
  const appended = await current(page, dependent, await stableChart(page));
  expect(appended.sessionId).toBe(previous.sessionId);
  expect(values(appended, "Pulse").at(-1)).toBe(122);
  expect(values(appended, "Realtime").at(-1)).toBe(1); expect(values(appended, "Confirmed").at(-1)).toBe(0);
  await expect.poll(async () => (await results(page, ordinaryLive)).some(result => result.sessionId === ordinarySession && result.audit.bars === 122)).toBe(true);
  await save(page, info, "live-failure-recovery", state, { cutoff, initial, evidence, appended, providerEvents: events, ordinarySession });
});
