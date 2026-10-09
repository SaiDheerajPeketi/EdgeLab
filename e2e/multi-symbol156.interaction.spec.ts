import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const artifacts = path.resolve(".artifacts/binance-panes156"), sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const files = ["e2e/multi-symbol156.config.ts", "e2e/multi-symbol156.interaction.spec.ts"];
const hashes = () => Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(file))]));
function seal() { const files = fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile());
  return { files: files.length, sha256: sha(files.sort().map(file => file + ":" + sha(fs.readFileSync(path.join("frontend/dist", file)))).join("\n")) }; }
const beforeSeal = seal(), beforeHashes = hashes(), pageErrors = new WeakMap<Page, string[]>(), sandboxErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { pageErrors.set(page, []); sandboxErrors.set(page, []); page.on("pageerror", error => {
  if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") sandboxErrors.get(page)!.push(error.message);
  else pageErrors.get(page)!.push(error.message);
}); });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await receipt(page, info, "failure", { alerts: await page.getByRole("alert").allTextContents(),
    lifecycle: await page.evaluate(() => ((window as any).__panes156Results ?? []).slice(-8).map((p: any) => ({ sessionId: p.sessionId, sequence: p.sequence,
      response: p.protocol === "pine-live-v1" ? { status: p.response?.status, error: p.response?.error, source: p.response?.result?.source } : { status: p.status, error: p.error } }))),
    drawingGesture: await page.evaluate(() => (window as any).__panes156DrawingGesture ?? null) });
  expect(pageErrors.get(page)).toEqual([]); expect(seal()).toEqual(beforeSeal); expect(hashes()).toEqual(beforeHashes);
});
async function receipt(page: Page, info: TestInfo, name: string, evidence: unknown) {
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(),
    errors: pageErrors.get(page), sandboxHarnessErrors: sandboxErrors.get(page), evidence,
    qualification: "Actual production Live workspace, toolbar, chart, editor and opaque Pine runtime. Current-time auth/storage fixtures and controlled Binance HTTP/WebSocket and normalized Journal history transport only. No chart props, worker output or timers replaced." }, null, 2));
  if (name !== "failure") await page.locator(".chart-studio-toolbar").locator("..").screenshot({ path: path.join(folder, name + ".png") });
}
async function chart(page: Page, pane = 0): Promise<Bar[]> {
  return page.evaluate(async pane => {
    const stage = document.querySelectorAll<HTMLElement>(".chart-stage")[pane]!, key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let candles: any, volume: any;
    for (let f = key ? (stage as any)[key] : null, d = 0; f && d < 64; f = f.return, d++) for (let h = f.memoizedState, n = 0; h && n < 384; h = h.next, n++) {
      const ref = h.memoizedState?.current; if (typeof ref?.seriesType !== "function") continue;
      if (ref.seriesType() === "Candlestick") candles ??= ref; if (ref.seriesType() === "Histogram") volume ??= ref;
    }
    if (!candles) throw Error("Actual production candle series unavailable");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return candles.data().map((b: any) => ({ time: Number(b.time), open: b.open, high: b.high, low: b.low, close: b.close,
      volume: volume?.data().find((p: any) => p.time === b.time)?.value ?? null }));
  }, pane);
}
async function chooseSymbol(page: Page, symbol: "BTCUSDT" | "ETHUSDT") {
  const field = page.getByRole("combobox", { name: "Chart symbol", exact: true });
  if (!await field.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await field.fill(symbol); await page.getByRole("option").filter({ hasText: symbol.replace("USDT", "/USDT") }).first().click();
  await expect(field).toHaveValue(new RegExp(symbol));
}
async function interval(page: Page, value: "1H" | "1m") {
  const button = page.getByRole("button", { name: value, exact: true }).first();
  if (!await button.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await button.click();
}
async function twoPanes(page: Page) {
  await page.locator(".chart-studio-toolbar").getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("dialog", { name: "Workspace controls", exact: true }).getByRole("radio", { name: "2 rows", exact: true }).click();
  await page.keyboard.press("Escape"); await expect(page.locator(".chart-stage")).toHaveCount(2);
}
async function drawingState(page: Page, pane = 0) {
  return page.evaluate(pane => {
    const stage = document.querySelectorAll<HTMLElement>(".chart-stage")[pane]!, key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    for (let f = key ? (stage as any)[key] : null, d = 0; f && d < 64; f = f.return, d++) {
      if (Array.isArray(f.memoizedProps?.drawings)) return structuredClone(f.memoizedProps.drawings);
    }
    throw Error("Actual drawing props unavailable");
  }, pane);
}
async function drawBtcLevel(page: Page, mobile: boolean) {
  await page.getByRole("button", { name: "Drawings", exact: true }).click();
  await page.getByRole("dialog", { name: "Drawings controls", exact: true }).getByRole("button", { name: "H-Line", exact: true }).click();
  const stage = page.locator(".chart-stage").first(), canvas = stage.locator(".chart-frame canvas").first(); await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(); expect(box).not.toBeNull();
  const x = box!.x + box!.width * .65, y = box!.y + box!.height * .22;
  const target = await page.evaluate(({ x, y, box }) => {
    const el = document.elementFromPoint(x, y); (window as any).__panes156DrawingGesture = { x, y, box, target: el?.outerHTML, events: [] };
    for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "mousedown", "mouseup", "click"]) addEventListener(type, event => {
      const e = event as MouseEvent, el = event.target as Element; (window as any).__panes156DrawingGesture.events.push({ type, x: e.clientX, y: e.clientY,
        target: el.tagName, inFrame: Boolean(el.closest(".chart-frame")), preventedAtCapture: event.defaultPrevented });
    }, { capture: true, passive: true });
    const drawingSurface = el?.tagName === "CANVAS" || (el?.matches(".cursor-crosshair") && Boolean(el.querySelector("svg clipPath")));
    return Boolean(drawingSurface && el?.closest(".chart-frame") && !el.closest('[role="group"], [role="dialog"]'));
  }, { x, y, box }); expect(target).toBe(true);
  if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await expect.poll(async () => (await drawingState(page)).filter((d: any) => d.tool === "horizontal").length).toBe(1);
  const drawings = await drawingState(page); expect(drawings[0].points[0].price).toBeGreaterThan(67000);
  await expect(stage.locator('svg line[stroke="#f59e0b"]')).toHaveCount(1);
  return drawings;
}
async function setup(page: Page) {
  const original = await liveViewportSetup(page), requests: any[] = [], events: any[] = [], sockets: any[] = [], worker: any[] = [];
  const histories = new Map<string, Bar[]>(), now = Date.now(); let eventAt = now;
  const rows = (symbol: string, interval: string) => {
    const key = symbol + ":" + interval; if (histories.has(key)) return histories.get(key)!;
    const seconds = interval === "1h" ? 3600 : 60, current = Math.floor(now / (seconds * 1000)) * seconds, base = symbol === "ETHUSDT" ? 3400 : 67500;
    const bars = Array.from({ length: 1000 }, (_, i): Bar => { const close = base + i * .05 + Math.sin(i * .23) * 5;
      return { time: current - (1000 - i) * seconds, open: close - .4, high: close + 2, low: close - 2, close, volume: (symbol === "ETHUSDT" ? 700 : 100) + i % 31 }; });
    histories.set(key, bars); return bars;
  };
  let hold: { symbol: string; interval: string; release: () => void; gate: Promise<void> } | null = null;
  await page.routeWebSocket(/data-stream\.binance\.vision\/ws\//, socket => {
    const item = { socket, url: socket.url(), openedAt: Date.now(), closedAt: null as number | null }; sockets.push(item);
    socket.onClose(() => { item.closedAt = Date.now(); });
  });
  await page.route("https://data-api.binance.vision/**", async route => {
    const url = new URL(route.request().url()); if (!url.pathname.endsWith("/klines")) return route.fallback();
    const symbol = url.searchParams.get("symbol")!, interval = url.searchParams.get("interval")!;
    if (!["BTCUSDT", "ETHUSDT"].includes(symbol) || !["1h", "1m"].includes(interval)) return route.fallback();
    const limit = Number(url.searchParams.get("limit")), end = Number(url.searchParams.get("endTime") ?? Infinity);
    const bars = rows(symbol, interval).filter(b => b.time * 1000 <= end).slice(-limit), seconds = interval === "1h" ? 3600 : 60;
    const log = { symbol, interval, limit, end: Number.isFinite(end) ? end : null, count: bars.length, held: hold?.symbol === symbol && hold?.interval === interval, aborted: false }; requests.push(log);
    if (log.held) await hold!.gate;
    try { await route.fulfill({ json: bars.map(b => [b.time * 1000, String(b.open), String(b.high), String(b.low), String(b.close), String(b.volume), (b.time + seconds) * 1000 - 1]) }); }
    catch (error) { if (!log.held) throw error; log.aborted = true; }
  });
  const instruments = ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, name: symbol, status: "TRADING", asset_class: "crypto", base_asset: symbol.slice(0, -4), quote_asset: "USDT",
    tick_size: symbol === "ETHUSDT" ? .001 : .01, min_quantity: symbol === "ETHUSDT" ? .001 : .00001, quantity_step: symbol === "ETHUSDT" ? .001 : .00001 }));
  await page.route("**/api/live/binance/instruments?**", route => route.fulfill({ json: { provider: "binance", instruments, total: 2 } }));
  await page.route("**/assets/pine-native-worker*.js", async route => { const response = await route.fetch(), bytes = await response.body();
    worker.push({ url: route.request().url(), bytes: bytes.length, sha256: sha(bytes) }); await route.fulfill({ response, body: bytes }); });
  await page.evaluate(() => { (window as any).__panes156Results = []; addEventListener("message", event => {
    const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(f => f.contentWindow === event.source && f.srcdoc.includes(`data-job="${event.data?.nonce}"`));
    if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__panes156Results.push(event.data.payload);
  }, true); });
  const active = (symbol: string, interval: string) => sockets.filter(item => item.closedAt === null && item.url.endsWith(`${symbol.toLowerCase()}@kline_${interval}`));
  const emit = (symbol: string, interval: string, close: number, volume: number) => {
    const seconds = interval === "1h" ? 3600 : 60, time = rows(symbol, interval).at(-1)!.time + seconds;
    const b = { time, open: symbol === "ETHUSDT" ? 3460 : 67600, high: Math.max(symbol === "ETHUSDT" ? 3470 : 67610, close), low: symbol === "ETHUSDT" ? 3450 : 67590, close, volume };
    const payload = { e: "kline", E: ++eventAt, s: symbol, k: { t: time * 1000, T: (time + seconds) * 1000 - 1, s: symbol, i: interval,
      o: String(b.open), h: String(b.high), l: String(b.low), c: String(close), v: String(volume), x: false } };
    const owners = active(symbol, interval); expect(owners).toHaveLength(1); owners[0].socket.send(JSON.stringify(payload)); events.push(payload); return b;
  };
  return { ...original, primaryEmit: original.emit, rows, requests, events, sockets, worker, active, emit, hold(symbol: string, interval: string) {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); hold = { symbol, interval, gate, release }; return release;
  } };
}
async function runResult(page: Page, source: string, predicate: (r: any) => boolean) {
  const read = () => page.evaluate(source => (window as any).__panes156Results.flatMap((p: any) => {
    const response = p.protocol === "pine-live-v1" ? p.response : p, r = response?.result;
    if (response?.status !== "completed" || r?.kind !== "run" || r.source !== source) return [];
    return [{ ...r, sessionId: p.sessionId, sequence: p.sequence, plots: r.plots.map((plot: any) => {
      if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
      const numbers = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
      return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? numbers[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) };
    }) }];
  }), source);
  await expect.poll(async () => (await read()).some(predicate)).toBe(true); return (await read()).findLast(predicate)!;
}
const tail = (r: any, name: string) => r.plots.find((p: any) => p.name === name).values.at(-1);
const sma = (bars: Bar[]) => bars.slice(-200).reduce((sum, b) => sum + b.close, 0) / 200;
async function attach(page: Page, source: string) {
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click(); await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
}

test("independent BTC hourly and ETH minute panes preserve exact source data and native Pine metadata", async ({ page }, info) => {
  const s = await setup(page); await interval(page, "1H"); await expect.poll(() => chart(page)).toEqual(s.rows("BTCUSDT", "1h"));
  await twoPanes(page); await page.getByRole("button", { name: "Pane 2", exact: true }).click(); await chooseSymbol(page, "ETHUSDT"); await interval(page, "1m");
  await expect.poll(() => chart(page, 1)).toEqual(s.rows("ETHUSDT", "1m")); await expect.poll(() => chart(page)).toEqual(s.rows("BTCUSDT", "1h"));
  const source = '//@version=6\nindicator("Independent metadata156",overlay=true)\nlength=input.int(200,"Length")\nplot(ta.sma(close,length),"SMA",color=#ff00ff)\nplot(close,"Price",display=display.none)\nplot(syminfo.mintick,"Tick",display=display.none)\nplot(syminfo.mincontract,"Minimum",display=display.none)\nif barstate.islast\n    label.new(bar_index,high,syminfo.tickerid+"|"+syminfo.basecurrency+"|"+syminfo.currency)';
  await attach(page, source); const historic = await runResult(page, source, r => r.audit.mode === "historical");
  expect(tail(historic, "SMA")).toBeCloseTo(sma(s.rows("ETHUSDT", "1m")), 8); expect(tail(historic, "Tick")).toBe(.001); expect(tail(historic, "Minimum")).toBe(.001);
  expect(historic.labels.at(-1).text).toMatch(/ETHUSDT\|ETH\|USDT$/);
  const eth = s.emit("ETHUSDT", "1m", 3464, 819), ethChart = [...s.rows("ETHUSDT", "1m"), eth];
  await expect.poll(() => chart(page, 1)).toEqual(ethChart); const live = await runResult(page, source, r => r.sessionId && tail(r, "Price") === eth.close);
  expect(tail(live, "SMA")).toBeCloseTo(sma(ethChart), 8); expect(tail(live, "Tick")).toBe(.001); expect(live.audit.bars).toBe(1001);
  const btc = s.emit("BTCUSDT", "1h", 67606, 139); await expect.poll(() => chart(page)).toEqual([...s.rows("BTCUSDT", "1h"), btc]);
  expect(await chart(page, 1)).toEqual(ethChart); expect(s.active("BTCUSDT", "1h")).toHaveLength(1); expect(s.active("ETHUSDT", "1m")).toHaveLength(1);
  await page.getByRole("button", { name: "Pane 1", exact: true }).click();
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await checkedRun(dialog);
  const bitcoin = await runResult(page, source, r => r.audit.mode === "historical" && tail(r, "Tick") === .01);
  expect(tail(bitcoin, "SMA")).toBeCloseTo(sma([...s.rows("BTCUSDT", "1h"), btc]), 8); expect(tail(bitcoin, "Minimum")).toBe(.00001);
  expect(bitcoin.labels.at(-1).text).toMatch(/BTCUSDT\|BTC\|USDT$/); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  await receipt(page, info, "concurrent-pine", { requests: s.requests, events: s.events, sockets: s.sockets.map(({ socket, ...rest }) => rest), worker: s.worker, historic, live, bitcoin, btc: await chart(page), eth: await chart(page, 1) });
});

test("pane symbol ownership discards held old history and global selection retains an unrelated native feed", async ({ page }, info) => {
  const s = await setup(page); await interval(page, "1H"); await expect.poll(() => chart(page)).toEqual(s.rows("BTCUSDT", "1h"));
  const btcDrawing = await drawBtcLevel(page, info.project.name === "mobile");
  const chooser = page.getByRole("combobox", { name: "Chart symbol", exact: true }), menu = page.getByRole("listbox", { name: "Chart symbols", exact: true });
  await chooser.fill("ETHUSDT"); await expect(menu).toBeVisible(); await chooser.press("Escape");
  await expect(menu).toHaveCount(0); await expect(chooser).toHaveValue("BTCUSDT"); await expect(chooser).toBeFocused();
  if (info.project.name === "mobile") await chooser.tap(); else await chooser.click();
  await expect(menu).toBeVisible(); await chooser.press("Escape"); await expect(menu).toHaveCount(0); await expect(chooser).toBeFocused();
  await chooser.fill("ETHUSDT"); await expect(menu).toBeVisible(); await chooser.press("Tab");
  await expect(menu).toHaveCount(0); await expect(chooser).not.toBeFocused(); await expect(chooser).toHaveValue("BTCUSDT");
  await chooser.fill("ETHUSDT"); await expect(menu).toBeVisible(); await page.getByRole("button", { name: "1H", exact: true }).first().click();
  await expect(menu).toHaveCount(0); await expect(chooser).toHaveValue("BTCUSDT");
  await chooser.fill("ETHUSDT"); await expect(menu).toBeVisible(); await chooser.press("Enter");
  await expect(menu).toHaveCount(0); await expect(chooser).toBeFocused(); await expect.poll(() => chart(page)).toEqual(s.rows("ETHUSDT", "1h"));
  if (info.project.name === "mobile") await chooser.tap(); else await chooser.click();
  await expect(menu).toBeVisible(); await chooser.press("Escape"); await expect(menu).toHaveCount(0); await expect(chooser).toBeFocused();
  await chooser.fill("BTCUSDT"); await chooser.press("Enter"); await expect(menu).toHaveCount(0); await expect(chooser).toBeFocused();
  await expect.poll(() => chart(page)).toEqual(s.rows("BTCUSDT", "1h")); await expect.poll(() => drawingState(page)).toEqual(btcDrawing);
  await twoPanes(page); await page.getByRole("button", { name: "Pane 2", exact: true }).click(); await chooseSymbol(page, "ETHUSDT"); await interval(page, "1m");
  await expect.poll(() => chart(page, 1)).toEqual(s.rows("ETHUSDT", "1m"));
  await page.getByRole("button", { name: "Pane 1", exact: true }).click(); const release = s.hold("ETHUSDT", "1h"); await chooseSymbol(page, "ETHUSDT");
  await expect.poll(() => drawingState(page)).toEqual([]); await expect(page.locator('.chart-stage').first().locator('svg line[stroke="#f59e0b"]')).toHaveCount(0);
  await expect.poll(() => s.requests.some(r => r.held)).toBe(true); await chooseSymbol(page, "BTCUSDT");
  await expect.poll(() => chart(page)).toEqual(s.rows("BTCUSDT", "1h")); await expect.poll(() => drawingState(page)).toEqual(btcDrawing);
  await expect(page.locator('.chart-stage').first().locator('svg line[stroke="#f59e0b"]')).toHaveCount(1);
  release(); await page.waitForTimeout(200); expect(await chart(page)).toEqual(s.rows("BTCUSDT", "1h"));
  await page.getByRole("button", { name: "Pane 2", exact: true }).click(); await chooseSymbol(page, "BTCUSDT"); await interval(page, "1H");
  await expect.poll(() => chart(page, 1)).toEqual(s.rows("BTCUSDT", "1h")); const preserved = s.active("BTCUSDT", "1h")[0]; expect(preserved).toBeTruthy();
  await page.getByRole("button", { name: "Pane 1", exact: true }).click(); await chooseSymbol(page, "ETHUSDT");
  await expect.poll(() => chart(page)).toEqual(s.rows("ETHUSDT", "1h"));
  await expect.poll(() => drawingState(page)).toEqual([]); await expect(page.locator('.chart-stage').first().locator('svg line[stroke="#f59e0b"]')).toHaveCount(0);
  const btcRequests = s.requests.filter(r => r.symbol === "BTCUSDT" && r.interval === "1h").length;
  await page.locator("tbody tr").filter({ hasText: "ETHUSDT" }).first().click();
  await expect(page.locator('[data-ui-surface="chart-live"]')).toHaveAttribute("data-active-symbol", "ETHUSDT");
  expect(s.active("BTCUSDT", "1h")[0]).toBe(preserved); expect(preserved.closedAt).toBeNull();
  expect(s.requests.filter(r => r.symbol === "BTCUSDT" && r.interval === "1h")).toHaveLength(btcRequests);
  const btc = s.emit("BTCUSDT", "1h", 67607, 127); await expect.poll(() => chart(page, 1)).toEqual([...s.rows("BTCUSDT", "1h"), btc]);
  await receipt(page, info, "ownership", { requests: s.requests, events: s.events, sockets: s.sockets.map(({ socket, ...rest }) => rest), preserved: preserved.url, btcDrawing,
    drawingGesture: await page.evaluate(() => (window as any).__panes156DrawingGesture), ethDrawings: await drawingState(page), primary: await chart(page), secondary: await chart(page, 1) });
});

test("a real Journal focus keeps historical BTC data while an independent ETH pane receives live prices", async ({ page }, info) => {
  const s = await setup(page); await interval(page, "1H"); await expect.poll(() => chart(page)).toEqual(s.rows("BTCUSDT", "1h")); await twoPanes(page);
  await page.getByRole("button", { name: "Pane 2", exact: true }).click(); await chooseSymbol(page, "ETHUSDT"); await interval(page, "1m");
  await expect.poll(() => chart(page, 1)).toEqual(s.rows("ETHUSDT", "1m")); await page.getByRole("button", { name: "Pane 1", exact: true }).click(); await interval(page, "1m");
  const normalized: any[] = []; let focused: Bar[] = [];
  await page.route("**/api/market-data/**", route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname;
    if (p.endsWith("/instruments")) return route.fulfill({ json: [{ id: 1, canonical_symbol: "BTCUSDT", display_name: "BTCUSDT", asset_class: "crypto", instrument_type: "SPOT", exchange: "BINANCE", currency: "USD", timezone: "UTC", tick_size: .01, active: true, identifiers: [{ provider: "BINANCE", provider_symbol: "BTCUSDT" }] }] });
    if (p.endsWith("/subscriptions")) return route.fulfill({ json: { ...request.postDataJSON(), subscription_id: "journal156", queued_events: 0, dropped_events: 0 } });
    if (p.includes("/subscriptions/")) return route.fulfill({ json: { ok: true } });
    if (p.endsWith("/candles")) {
      normalized.push(url.toString()); const from = Date.parse(url.searchParams.get("from_at")!) / 1000, to = Date.parse(url.searchParams.get("to_at")!) / 1000, seconds = Number(url.searchParams.get("interval_seconds"));
      expect(Number.isFinite(from)).toBe(true); expect(to).toBeLessThan(Date.now() / 1000 - 86400);
      focused = Array.from({ length: Math.ceil((to - from) / seconds) }, (_, i) => ({ time: from + i * seconds, open: 67900 + i, high: 67903 + i, low: 67898 + i, close: 67901 + i, volume: 33 + i }));
      return route.fulfill({ json: focused.map(b => ({ instrument_id: 1, interval_seconds: seconds, start_at: new Date(b.time * 1000).toISOString(), end_at: new Date((b.time + seconds) * 1000).toISOString(), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, provider: "BINANCE", complete: true })) });
    }
    return route.fallback();
  });
  await page.locator('[data-motion="workspace-panel-trigger"]').click();
  const journal = page.getByRole("tabpanel", { name: "Journal", exact: true }); await journal.getByRole("button").filter({ hasText: "BTCUSDT" }).first().click();
  await page.getByRole("button", { name: "Show on chart", exact: true }).click(); await expect.poll(() => normalized.length).toBeGreaterThan(0);
  await expect.poll(() => chart(page)).toEqual(focused); const before = await chart(page), ethOwner = s.active("ETHUSDT", "1m")[0]; expect(ethOwner).toBeTruthy();
  const eth = s.emit("ETHUSDT", "1m", 3469, 831); s.primaryEmit(600, 67609, false, 151);
  await expect.poll(() => chart(page, 1)).toEqual([...s.rows("ETHUSDT", "1m"), eth]); expect(await chart(page)).toEqual(before); expect(ethOwner.closedAt).toBeNull();
  await receipt(page, info, "journal-focus", { normalized, requests: s.requests, events: s.events, focused: before, finalFocused: await chart(page), eth: await chart(page, 1) });
});
