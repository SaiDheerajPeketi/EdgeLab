import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";

type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };
const artifacts = path.resolve(".artifacts/custom-history155"), sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const testFiles = ["e2e/custom-history155.config.ts", "e2e/custom-history155.interaction.spec.ts"];
const hashes = () => Object.fromEntries(testFiles.map(file => [file, sha(fs.readFileSync(file))]));
function seal() { const files = fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile());
  return { files: files.length, sha256: sha(files.sort().map(file => file + ":" + sha(fs.readFileSync(path.join("frontend/dist", file)))).join("\n")) }; }
const beforeSeal = seal(), beforeHashes = hashes(), errors = new WeakMap<Page, string[]>(), opaqueErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { errors.set(page, []); opaqueErrors.set(page, []); page.on("pageerror", error => {
  if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") opaqueErrors.get(page)!.push(error.message);
  else errors.get(page)!.push(error.message);
}); });
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
    const lifecycle = await page.evaluate(() => ((window as any).__history155Results ?? []).slice(-12).map((payload: any) => {
      const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
      return { sessionId: payload.sessionId, sequence: payload.sequence, status: response?.status, error: response?.error,
        audit: response?.result?.audit, source: response?.result?.source, inputs: response?.result?.inputs };
    }));
    fs.writeFileSync(path.join(folder, info.title.replace(/[^a-z0-9]+/gi, "-") + "-failure.json"), JSON.stringify({ beforeSeal, afterSeal: seal(),
      beforeHashes, afterHashes: hashes(), errors: errors.get(page), opaqueHarnessErrors: opaqueErrors.get(page), lifecycle,
      alerts: await page.getByRole("alert").allTextContents() }, null, 2));
  }
  expect(errors.get(page)).toEqual([]); expect(seal()).toEqual(beforeSeal); expect(hashes()).toEqual(beforeHashes);
});

// Independent chronological OHLCV grouping. An incomplete leading bucket is
// omitted only when its first actual constituent starts after the bucket open.
function aggregate(source: Bar[], seconds: number) {
  const groups = new Map<number, Bar[]>();
  for (const bar of source) { const time = Math.floor(bar.time / seconds) * seconds; groups.set(time, [...(groups.get(time) ?? []), bar]); }
  return [...groups].filter(([time, bars], index) => index > 0 || bars[0].time === time).map(([time, bars]) => ({ time,
    open: bars[0].open, high: Math.max(...bars.map(bar => bar.high)), low: Math.min(...bars.map(bar => bar.low)),
    close: bars.at(-1)!.close, volume: bars.reduce((sum, bar) => sum + bar.volume, 0) }));
}
async function chart(page: Page, pane = 0) {
  return page.evaluate(async pane => {
    const stage = document.querySelectorAll<HTMLElement>(".chart-stage")[pane]!, key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let candles: any, volume: any;
    for (let fiber = key ? (stage as any)[key] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
        const ref = hook.memoizedState?.current; if (typeof ref?.seriesType !== "function") continue;
        if (ref.seriesType() === "Candlestick") candles ??= ref;
        if (ref.seriesType() === "Histogram") volume ??= ref;
      }
    }
    if (!candles) throw Error("Actual production candle series unavailable");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return candles.data().map((bar: any) => ({ time: Number(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      volume: volume?.data().find((point: any) => point.time === bar.time)?.value ?? null }));
  }, pane) as Promise<Bar[]>;
}
async function custom(page: Page, value: string) {
  const field = page.getByRole("textbox", { name: "Custom timeframe", exact: true });
  if (!await field.isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await field.fill(value); await page.getByRole("button", { name: "Apply custom timeframe", exact: true }).click();
}
async function setup(page: Page, timeframe: "3H" | "7m", malformed = false, rich = false) {
  const state = await liveViewportSetup(page), baseSeconds = timeframe === "3H" ? 3600 : 60;
  const seconds = timeframe === "3H" ? 10800 : 420, interval = timeframe === "3H" ? "1h" : "1m", nominal = timeframe === "3H" ? 3000 : 7000;
  const cap = nominal + seconds / baseSeconds - 1;
  const now = Date.now(), currentBase = Math.floor(now / (baseSeconds * 1000)) * baseSeconds, currentChart = Math.floor(currentBase / seconds) * seconds;
  const origin = currentChart - (rich ? 6000 : nominal) * baseSeconds + baseSeconds;
  const available = Array.from({ length: (currentBase - origin) / baseSeconds }, (_, index): Bar => {
    const close = 67500 + index * .013 + Math.sin(index * .19) * 11;
    return { time: origin + index * baseSeconds, open: close + (index % 2 ? -1 : 1), high: close + 3, low: close - 3, close, volume: 10 + index % 17 };
  });
  const source = available.slice(-cap), expected = aggregate(source, seconds), requests: any[] = [], sockets: any[] = [], socketHistory: any[] = [], events: any[] = [], workerReceipts: any[] = [];
  await page.routeWebSocket(/data-stream\.binance\.vision\/ws\//, socket => { sockets.push(socket);
    const receipt = { url: socket.url(), openedAt: Date.now(), closedAt: null as number | null }; socketHistory.push(receipt);
    socket.onClose(() => { receipt.closedAt = Date.now(); const i = sockets.indexOf(socket); if (i >= 0) sockets.splice(i, 1); }); });
  await page.route("https://data-api.binance.vision/**", async route => {
    const url = new URL(route.request().url()); if (!url.pathname.endsWith("/klines") || url.searchParams.get("interval") !== interval) return route.fallback();
    const limit = Number(url.searchParams.get("limit")), endTime = url.searchParams.has("endTime") ? Number(url.searchParams.get("endTime")) : Infinity;
    expect(limit).toBeGreaterThan(0); expect(limit).toBeLessThanOrEqual(1000); expect(url.searchParams.get("symbol")).toBe("BTCUSDT");
    const bars = available.filter(bar => bar.time * 1000 <= endTime).slice(-limit);
    const rows = bars.map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), (bar.time + baseSeconds) * 1000 - 1]);
    if (malformed && Number.isFinite(endTime) && rows.length > 1) rows[1] = [...rows[0]];
    requests.push({ interval, limit, endTime: Number.isFinite(endTime) ? endTime : null, count: rows.length,
      first: rows[0]?.[0], last: rows.at(-1)?.[0], malformed: malformed && Number.isFinite(endTime) });
    return route.fulfill({ json: rows });
  });
  await page.route("**/assets/pine-native-worker*.js", async route => { const response = await route.fetch(), bytes = await response.body();
    workerReceipts.push({ url: route.request().url(), bytes: bytes.length, sha256: sha(bytes) }); await route.fulfill({ response, body: bytes }); });
  await page.evaluate(() => {
    (window as any).__history155Results = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(frame => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__history155Results.push(event.data.payload);
    }, true);
  });
  await custom(page, timeframe);
  if (!malformed) await expect.poll(() => chart(page)).toEqual(expected);
  let eventTime = now;
  const emit = (time: number, close: number, confirmed = false, volume = 31) => {
    const bar: Bar = { time, open: 67560, high: Math.max(67565, close), low: Math.min(67555, close), close, volume };
    const payload = { e: "kline", E: ++eventTime, s: "BTCUSDT", k: { t: time * 1000, T: (time + baseSeconds) * 1000 - 1,
      i: interval, s: "BTCUSDT", o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), v: String(volume), x: confirmed } };
    events.push(payload); const owners = sockets.filter(socket => socket.url().endsWith(`btcusdt@kline_${interval}`));
    expect(owners).toHaveLength(1); owners[0].send(JSON.stringify(payload)); return bar;
  };
  return { ...state, source, available, expected, requests, sockets, socketHistory, events, workerReceipts, emit, currentBase, currentChart, seconds, baseSeconds, cap, interval };
}
async function result(page: Page, source: string, predicate: (result: any) => boolean) {
  const read = () => page.evaluate(source => (window as any).__history155Results.flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    return [{ ...result, sessionId: payload.sessionId, sequence: payload.sequence, plots: result.plots.map((plot: any) => {
      if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
      const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
      return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) };
    }) }];
  }), source);
  await expect.poll(async () => (await read()).some(predicate)).toBe(true); return (await read()).findLast(predicate)!;
}
const tail = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).values.at(-1);
const sma = (bars: Bar[], length: number) => bars.slice(-length).reduce((sum, bar) => sum + bar.close, 0) / length;
async function save(page: Page, info: TestInfo, name: string, state: Awaited<ReturnType<typeof setup>>, evidence: unknown) {
  const folder = path.join(artifacts, info.project.name); fs.mkdirSync(folder, { recursive: true });
  const filename = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, bytes = fs.readFileSync(path.join("frontend/dist/assets", filename));
  if (state.workerReceipts.length) expect(state.workerReceipts.every(receipt => receipt.bytes === bytes.length && receipt.sha256 === sha(bytes))).toBe(true);
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(),
    requests: state.requests, events: state.events, socketHistory: state.socketHistory, sourceRows: state.source.length, availableRows: state.available.length,
    errors: errors.get(page), opaqueHarnessErrors: opaqueErrors.get(page), workerReceipts: state.workerReceipts, evidence,
    qualification: "Actual production app/chart/editor/opaque Pine worker. Existing current-time auth/storage fixtures and controlled paginated Binance HTTP/raw WebSocket transport only. Candle timestamps are independently grouped; no synthetic constituent, chart/controller replacement, Pine result or timer acceleration." }, null, 2));
  await page.locator(".chart-stage").first().screenshot({ path: path.join(folder, name + ".png") });
}

for (const timeframe of ["3H", "7m"] as const) test(`custom ${timeframe} keeps deep native history and genuine Pine SMA inputs through live constituent updates`, async ({ page }, info) => {
  const state = await setup(page, timeframe), initial = await chart(page);
  expect(initial.length).toBeGreaterThanOrEqual(999); expect(initial.length).toBeLessThanOrEqual(1000);
  expect(state.source[0].time % state.seconds).not.toBe(0); expect(initial[0].time).toBeGreaterThan(state.source[0].time);
  expect(state.requests.length).toBe(Math.ceil(state.source.length / 1000) + (state.source.length % 1000 === 0 ? 1 : 0));
  expect(state.requests.reduce((count, request) => count + request.count, 0)).toBe(state.source.length);
  for (let i = 1; i < state.requests.length; i++) expect(state.requests[i].endTime).toBe(state.requests[i - 1].first - 1);
  const text = `//@version=6\nindicator("Custom history155 ${timeframe}",overlay=true)\nlength=input.int(200,"Length",minval=1,maxval=400)\nplot(ta.sma(close,length),"SMA",color=#ff00ff,linewidth=3)\nplot(close,"Price",display=display.none)\nplot(bar_index,"Index",display=display.none)\nplot(barstate.isconfirmed?1:0,"Confirmed",display=display.none)\na=request.security_lower_tf(syminfo.tickerid,"${timeframe === "3H" ? "60" : "1"}",close)\nplot(array.size(a),"Children",display=display.none)\nplot(array.size(a)>0?array.get(a,array.size(a)-1):na,"Last child",display=display.none)`;
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(text); await checkedRun(dialog);
  const historic200 = await result(page, text, result => result.audit.mode === "historical" && result.inputs.in_0 === 200);
  expect(historic200.audit.bars).toBe(initial.length); expect(tail(historic200, "SMA")).toBeCloseTo(sma(initial, 200), 8);
  await dialog.getByLabel("Length", { exact: true }).fill("300"); await dialog.getByRole("button", { name: "Run", exact: true }).click();
  const historic300 = await result(page, text, result => result.audit.mode === "historical" && result.inputs.in_0 === 300);
  expect(tail(historic300, "SMA")).toBeCloseTo(sma(initial, 300), 8);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === text && script.inputs.in_0 === 300)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  let current = state.emit(state.currentBase, 67561, false, 31);
  let actualSource = [...state.source, current], expected = aggregate(actualSource, state.seconds);
  await expect.poll(() => chart(page)).toEqual(expected);
  const live = await result(page, text, result => result.sessionId && tail(result, "Price") === 67561);
  expect(live.inputs.in_0).toBe(300); expect(live.audit.bars).toBe(expected.length); expect(tail(live, "SMA")).toBeCloseTo(sma(expected, 300), 8);
  expect(tail(live, "Children")).toBe(actualSource.filter(bar => bar.time >= state.currentChart).length);
  expect(tail(live, "Last child")).toBe(67561); expect(tail(live, "Confirmed")).toBe(0);
  current = state.emit(state.currentBase, 67562, false, 37); actualSource = [...state.source, current]; expected = aggregate(actualSource, state.seconds);
  await expect.poll(() => chart(page)).toEqual(expected);
  const tick = await result(page, text, result => result.sessionId === live.sessionId && result.sequence > live.sequence && tail(result, "Price") === 67562);
  expect(tick.audit.bars).toBe(live.audit.bars); expect(tail(tick, "SMA")).toBeCloseTo(sma(expected, 300), 8); expect(tail(tick, "Confirmed")).toBe(0);
  let closed: any;
  for (let time = state.currentBase; time < state.currentChart + state.seconds; time += state.baseSeconds) {
    const bar = state.emit(time, 67570 + (time - state.currentBase) / state.baseSeconds, true, 43);
    actualSource = actualSource.filter(item => item.time !== time); actualSource.push(bar); expected = aggregate(actualSource, state.seconds);
    await expect.poll(() => chart(page)).toEqual(expected);
    closed = await result(page, text, result => result.sessionId === live.sessionId && tail(result, "Last child") === bar.close && tail(result, "Confirmed") === (time + state.baseSeconds === state.currentChart + state.seconds ? 1 : 0));
  }
  expect(tail(closed, "SMA")).toBeCloseTo(sma(expected, 300), 8);
  expect(tail(closed, "Children")).toBe(state.seconds / state.baseSeconds); expect(tail(closed, "Confirmed")).toBe(1);
  await save(page, info, timeframe, state, { initial, historic200, historic300, live, tick, closed, finalChart: expected });
});

test("malformed older provider page fails custom history closed instead of showing a partial deep chart", async ({ page }, info) => {
  const state = await setup(page, "3H", true);
  await expect.poll(() => state.requests.some(request => request.malformed)).toBe(true);
  await expect(page.locator(".chart-stage")).toContainText(/invalid|unavailable|could not|retry|consecutive/i);
  expect(await chart(page)).toEqual([]); expect(state.requests.every(request => request.limit <= 1000)).toBe(true);
  await save(page, info, "malformed-page", state, { chart: await chart(page), requests: state.requests });
});

test("shared 3H and 5H panes upgrade one native source capacity and retain it on a covered decrease", async ({ page }, info) => {
  const state = await setup(page, "3H", false, true), original = await chart(page);
  expect(state.requests.reduce((count, request) => count + request.count, 0)).toBe(3002);
  expect(state.socketHistory).toHaveLength(1);
  const toolbar = page.locator(".chart-studio-toolbar");
  await toolbar.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("dialog", { name: "Workspace controls", exact: true }).getByRole("radio", { name: "2 rows", exact: true }).click();
  await page.keyboard.press("Escape"); await expect(page.locator(".chart-stage")).toHaveCount(2);
  await page.getByRole("button", { name: "Pane 2", exact: true }).click(); await custom(page, "5H");
  const expandedSource = state.available.slice(-5004), three = aggregate(expandedSource, 10800), five = aggregate(expandedSource, 18000);
  await expect.poll(() => chart(page, 0)).toEqual(three); await expect.poll(() => chart(page, 1)).toEqual(five);
  expect(state.socketHistory).toHaveLength(2); expect(state.socketHistory[0].closedAt).not.toBeNull(); expect(state.sockets).toHaveLength(1);
  expect(state.requests.reduce((count, request) => count + request.count, 0)).toBe(3002 + 5004);
  const requestCount = state.requests.length, socketCount = state.socketHistory.length;
  const current = state.emit(state.currentBase, 67583, false, 41), updatedSource = [...expandedSource, current];
  await expect.poll(() => chart(page, 0)).toEqual(aggregate(updatedSource, 10800));
  await expect.poll(() => chart(page, 1)).toEqual(aggregate(updatedSource, 18000));
  await custom(page, "3H"); await expect.poll(() => chart(page, 1)).toEqual(aggregate(updatedSource, 10800));
  await page.waitForTimeout(250); expect(state.requests.length).toBe(requestCount); expect(state.socketHistory.length).toBe(socketCount); expect(state.sockets).toHaveLength(1);
  await save(page, info, "shared-capacity", state, { original, three, five, requestCount, socketCount,
    finalPrimary: await chart(page), finalSecondary: await chart(page, 1) });
});

test("an aligned shallow developing custom candle waits then recovers Pine on the first next-bucket event", async ({ page }, info) => {
  const state = await setup(page, "3H"), text = '//@version=6\nindicator("Shallow recovery155",overlay=true)\nlength=input.int(2,"Length")\nplot(ta.sma(close,length),"SMA",color=#ff00ff)\nplot(close,"Price",display=display.none)\nplot(bar_index,"Index",display=display.none)';
  const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(text); await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((script: any) => script.source === text)).toBe(true);
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  const bucket = Math.floor(state.currentBase / 18000) * 18000;
  let shallow = Array.from({ length: (state.currentBase - bucket) / 3600 + 1 }, (_, index): Bar => ({ time: bucket + index * 3600,
    open: 67540, high: 67555, low: 67535, close: 67545 + index, volume: 19 + index }));
  const shallowRequests: any[] = [];
  await page.route("https://data-api.binance.vision/**", route => {
    const url = new URL(route.request().url()); if (!url.pathname.endsWith("/klines") || url.searchParams.get("interval") !== "1h") return route.fallback();
    shallowRequests.push({ interval: "1h", limit: Number(url.searchParams.get("limit")), rows: shallow.length });
    return route.fulfill({ json: shallow.map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), (bar.time + 3600) * 1000 - 1]) });
  });
  await custom(page, "5H"); await expect.poll(() => chart(page)).toEqual(aggregate(shallow, 18000));
  let current = state.emit(state.currentBase, 67561, false, 31);
  shallow = [...shallow.filter(bar => bar.time < state.currentBase), current];
  await expect.poll(() => chart(page)).toEqual(aggregate(shallow, 18000)); await page.waitForTimeout(250);
  const liveResponses = () => page.evaluate(() => ((window as any).__history155Results ?? []).filter((payload: any) => payload.protocol === "pine-live-v1")
    .map((payload: any) => ({ sessionId: payload.sessionId, status: payload.response?.status, error: payload.response?.error, source: payload.response?.result?.source })));
  expect((await liveResponses()).filter((response: any) => response.source === text)).toEqual([]);
  expect((await liveResponses()).filter((response: any) => response.status === "failed")).toEqual([]);
  for (let time = state.currentBase; time < bucket + 18000; time += 3600) {
    current = state.emit(time, 67570 + (time - state.currentBase) / 3600, true, 43);
    shallow = [...shallow.filter(bar => bar.time !== time), current]; await expect.poll(() => chart(page)).toEqual(aggregate(shallow, 18000));
  }
  expect((await liveResponses()).filter((response: any) => response.status === "failed")).toEqual([]);
  const closedChart = aggregate(shallow, 18000);
  expect(closedChart).toHaveLength(1);
  current = state.emit(bucket + 18000, 67589, false, 47); shallow.push(current);
  const expected = aggregate(shallow, 18000); await expect.poll(() => chart(page)).toEqual(expected);
  const recovered = await result(page, text, result => result.sessionId && result.audit.bars === 2 && tail(result, "Price") === 67589);
  expect(tail(recovered, "SMA")).toBeCloseTo(sma(expected, 2), 8); expect(tail(recovered, "Index")).toBe(1);
  expect((await liveResponses()).filter((response: any) => response.status === "failed")).toEqual([]);
  await save(page, info, "shallow-recovery", state, { shallowRequests, closedChart, expected, recovered, liveResponses: await liveResponses() });
});
