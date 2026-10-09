import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor, checkedRun } from "./pine-layering.product-support";
import { AUTH_SESSION_KEY } from "./support/app";

const name = "Native lower calculation168";
const source = `//@version=6
indicator("${name}",overlay=false,timeframe="1",timeframe_gaps=false)
length=input.int(2,"Length",minval=1,maxval=5)
varip int ticks=0
ticks+=1
plot(ta.sma(close,length),"Calculation SMA",color=#00ffff)
plot(close,"Calculation close",display=display.none)
plot(timeframe.multiplier,"Calculation minutes",display=display.none)
plot(barstate.isconfirmed?1:0,"Calculation confirmed",display=display.none)
plot(ticks,"Ticks",display=display.none)`;
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal();
const hashes = () => Object.fromEntries(["e2e/pine-live-calculation168.config.ts", "e2e/pine-live-calculation168.spec.ts"].map(file => [file, hash(fs.readFileSync(file))]));
const beforeHashes = hashes();

async function results(page: Page) {
  return page.evaluate(source => ((window as any).__calculation168 ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload, result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    return [{ sessionId: payload.sessionId ?? null, sequence: payload.sequence ?? null, inputs: result.inputs, audit: result.audit,
      plots: result.plots.map((plot: any) => {
        if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value) };
        const values = new Float64Array(response.buffers[plot.packed.values]), kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
        return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, i) => kinds[i] === 4 ? values[i] : kinds[i] === 3 ? true : kinds[i] === 2 ? false : null).filter((_, i) => kinds[i] !== 0) };
      }) }];
  }), source);
}
const tail = (result: any, plot: string) => result.plots.find((item: any) => item.name === plot).values.at(-1);
async function observed(page: Page, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await results(page)).some(predicate)).toBe(true);
  return (await results(page)).findLast(predicate)!;
}
async function quiet(page: Page, sessionId: string, sequence: number) {
  await expect.poll(() => page.evaluate(({ sessionId, sequence }) => (window as any).__calculation168.some((payload: any) => payload.sessionId === sessionId && payload.response?.ack?.streams?.some((stream: any) => stream.symbol === "BINANCE:BTCUSDT" && stream.timeframe === "1" && stream.sequence >= sequence)), { sessionId, sequence })).toBe(true);
}
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const folder = path.resolve(".artifacts/pine-live-calculation168", info.project.name); fs.mkdirSync(folder, { recursive: true });
  const lifecycle = await page.evaluate(() => ((window as any).__calculation168 ?? []).map((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    return { sessionId: payload.sessionId, sequence: payload.sequence, status: response?.status, inputs: response?.result?.inputs, error: response?.error, ack: response?.ack };
  }));
  fs.writeFileSync(path.join(folder, "failure.json"), JSON.stringify({ lifecycle, results: await results(page), text: await page.locator("body").innerText() }, null, 2));
});

test("native five-minute chart acquires actual same-market minutes for declaration calculations and retires their owners", async ({ page }, info) => {
  const errors: string[] = [], harnessErrors: string[] = [], workers: any[] = [], native: any[] = [], primary: any[] = [], closed: number[] = [], events: any[] = [], requests: any[] = [];
  page.on("pageerror", error => {
    if (error.message === "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag.") harnessErrors.push(error.message);
    else errors.push(error.message);
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    (window as any).__calculation168 = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__calculation168.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body(); workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  const state = await liveViewportSetup(page), base = Math.floor((state.history.at(-1)!.time + 60) / 300) * 300;
  // The simulated provider starts at the opening of its current native5m bar.
  // Each dated M1 row becomes available only when its authored event closes.
  const minutes = state.history.filter(bar => bar.time < base).map(bar => ({ ...bar }));
  const complete = (minutesPerBar: number) => {
    const groups = new Map<number, typeof minutes>();
    for (const bar of minutes) { const time = Math.floor(bar.time / (minutesPerBar * 60)) * minutesPerBar * 60; groups.set(time, [...(groups.get(time) ?? []), bar]); }
    return [...groups].filter(([time, bars]) => bars.length === minutesPerBar && bars.every((bar, index) => bar.time === time + index * 60))
      .map(([time, bars]) => ({ time, open: bars[0].open, high: Math.max(...bars.map(bar => bar.high)), low: Math.min(...bars.map(bar => bar.low)), close: bars.at(-1)!.close, volume: bars.reduce((sum, bar) => sum + bar.volume, 0) }));
  };
  const primaryHistory = complete(5);
  const historicalSma = (count: number) => minutes.slice(-count).reduce((sum, bar) => sum + bar.close, 0) / count;
  const developingSma = (timeframe: number, count: number, close: number) => {
    const values = complete(timeframe).slice(-(count - 1)).map(bar => bar.close); return (values.reduce((sum, value) => sum + value, 0) + close) / count;
  };
  await page.routeWebSocket(/(?:data-stream\.binance\.vision|stream\.binance\.com(?::9443)?)\/ws\/btcusdt@kline_5m$/, socket => {
    primary.push(socket); events.push({ kind: "primary-socket", url: socket.url() }); socket.onClose(() => events.push({ kind: "primary-close" }));
  });
  await page.routeWebSocket(/(?:data-stream\.binance\.vision|stream\.binance\.com(?::9443)?)\/ws\/btcusdt@kline_1m$/, socket => {
    native.push(socket); events.push({ kind: "native-socket", index: native.length - 1, url: socket.url() });
    socket.onClose(() => { closed.push(native.indexOf(socket)); events.push({ kind: "native-close", index: native.indexOf(socket) }); });
  });
  await page.route("https://data-api.binance.vision/**", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/klines") || url.searchParams.get("symbol") !== "BTCUSDT") return route.fallback();
    const interval = url.searchParams.get("interval"), dated = url.searchParams.has("endTime");
    if (interval !== "5m" && !(interval === "1m" && dated)) return route.fallback();
    const headers = route.request().headers(); requests.push({ url: url.toString(), nativeSockets: native.length, noAuthorization: !headers.authorization, noCookie: !headers.cookie });
    const from = Number(url.searchParams.get("startTime") ?? 0), to = Number(url.searchParams.get("endTime") ?? Number.MAX_SAFE_INTEGER), limit = Number(url.searchParams.get("limit") ?? 1000);
    const rows = (interval === "5m" ? primaryHistory : minutes).filter(bar => bar.time * 1000 >= from && bar.time * 1000 <= to);
    await route.fulfill({ json: (dated ? rows.slice(0, limit) : rows.slice(-limit)).map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), (bar.time + (interval === "5m" ? 300 : 60)) * 1000 - 1]) });
  });
  if (!await page.getByRole("button", { name: "5m", exact: true }).first().isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: "5m", exact: true }).first().click(); await expect.poll(() => primary.length).toBe(1);
  let stamp = base * 1000 + 100, primaryVolume = 1000;
  const emitPrimary = (close: number) => {
    const event = { e: "kline", E: ++stamp, s: "BTCUSDT", k: { t: base * 1000, T: (base + 300) * 1000 - 1,
      i: "5m", s: "BTCUSDT", o: "67520", h: "67540", l: "67490", c: String(close), v: String(++primaryVolume), x: false } };
    events.push({ kind: "primary", event }); primary[0].send(JSON.stringify(event));
  };
  let nativeVolume = 20;
  const emitNative = (socket: any, time: number, close: number, confirmed = false) => {
    const end = (time + 60) * 1000 - 1; stamp = Math.max(stamp + 1, time * 1000 + 200, confirmed ? end : 0);
    const bar = { time, open: 67520, high: 67540, low: 67490, close, volume: ++nativeVolume };
    const event = { e: "kline", E: stamp, s: "BTCUSDT", k: { t: time * 1000, T: end,
      i: "1m", s: "BTCUSDT", o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(close), v: String(bar.volume), x: confirmed } };
    if (confirmed) { const index = minutes.findIndex(item => item.time === time); if (index >= 0) minutes[index] = bar; else minutes.push(bar); }
    events.push({ kind: "native", index: native.indexOf(socket), event }); socket.send(JSON.stringify(event)); return bar;
  };
  const add = async (save = false) => {
    const dialog = await editor(page); await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
    await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source); await checkedRun(dialog);
    if (save) { await dialog.getByRole("button", { name: "Save", exact: true }).click(); await expect.poll(() => state.storage.get("custom-indicator-scripts.v1")?.some((item: any) => item.source === source)).toBe(true); }
    await dialog.getByRole("button", { name: "Add to chart", exact: true }).click(); await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  };
  await add(true); const historical = await observed(page, result => !result.sessionId);
  expect(tail(historical, "Calculation SMA")).toBeCloseTo(historicalSma(2), 8); expect(historical.audit.bars).toBe(primaryHistory.length);
  const readyBefore = (await results(page)).filter(result => !result.sessionId).length;
  emitPrimary(67524); await expect.poll(() => native.length).toBe(1); emitNative(native[0], base, 67525);
  await expect.poll(async () => (await results(page)).filter(result => !result.sessionId).length).toBeGreaterThan(readyBefore);
  emitPrimary(67525);
  const first = await observed(page, result => result.sessionId && result.sequence > 0 && tail(result, "Calculation close") === 67525);
  expect(tail(first, "Calculation SMA")).toBeCloseTo(developingSma(1, 2, 67525), 8); expect(tail(first, "Calculation confirmed")).toBe(0);
  const pane = page.getByRole("region", { name: `${name} native Pine pane`, exact: true }); await expect(pane).toBeVisible();
  await expect(pane.locator("p.sr-only")).toContainText(`Calculation SMA: ${tail(first, "Calculation SMA")}`);
  const calculationsBefore = (await results(page)).filter(result => result.sessionId).length;
  emitNative(native[0], base, 67526); await quiet(page, first.sessionId, 2);
  expect((await results(page)).filter(result => result.sessionId)).toHaveLength(calculationsBefore);
  emitPrimary(67526); const tick = await observed(page, result => result.sessionId === first.sessionId && result.sequence > first.sequence && tail(result, "Calculation close") === 67526);
  expect(tail(tick, "Calculation SMA")).toBeCloseTo(developingSma(1, 2, 67526), 8); expect(tail(tick, "Ticks")).toBe(tail(first, "Ticks") + 1);
  const previous = minutes.at(-1)!.close; emitNative(native[0], base, 67527, true); await quiet(page, first.sessionId, 3);
  emitPrimary(67527); const confirmed = await observed(page, result => result.sessionId === first.sessionId && result.sequence > tick.sequence && tail(result, "Calculation confirmed") === 1);
  expect(tail(confirmed, "Calculation SMA")).toBeCloseTo((previous + 67527) / 2, 8); expect(tail(confirmed, "Ticks")).toBe(tail(tick, "Ticks") + 1);
  expect(events.filter(item => item.kind === "primary").every(item => item.event.k.x === false)).toBe(true);
  await pane.getByRole("button", { name, exact: true }).click();
  const settings = page.getByRole("group", { name: "Indicator settings", exact: true });
  const historicalBeforeTwo = (await results(page)).filter(result => !result.sessionId && result.inputs.in_1 === "2").length;
  await settings.getByRole("textbox", { name: "Timeframe", exact: true }).fill("2");
  await expect.poll(() => native.length).toBe(2); await expect.poll(() => closed).toContain(0); emitNative(native[1], base + 60, 67528);
  await expect.poll(async () => (await results(page)).filter(result => !result.sessionId && result.inputs.in_1 === "2").length).toBeGreaterThan(historicalBeforeTwo);
  emitPrimary(67528);
  const two = await observed(page, result => result.sessionId && result.sessionId !== first.sessionId && result.sequence > 0 && result.inputs.in_1 === "2" && tail(result, "Calculation close") === 67528);
  expect(tail(two, "Calculation SMA")).toBeCloseTo(developingSma(2, 2, 67528), 8); expect(tail(two, "Calculation minutes")).toBe(2);
  const historicalBeforeThree = (await results(page)).filter(result => !result.sessionId && result.inputs.in_0 === 3).length;
  await settings.getByRole("spinbutton", { name: "Length", exact: true }).fill("3");
  await expect.poll(() => native.length).toBe(3); await expect.poll(() => closed).toContain(1); emitNative(native[2], base + 60, 67529);
  await expect.poll(async () => (await results(page)).filter(result => !result.sessionId && result.inputs.in_0 === 3).length).toBeGreaterThan(historicalBeforeThree);
  emitPrimary(67529);
  const three = await observed(page, result => result.sessionId && result.sessionId !== two.sessionId && result.sequence > 0 && result.inputs.in_0 === 3 && tail(result, "Calculation close") === 67529);
  expect(tail(three, "Calculation SMA")).toBeCloseTo(developingSma(2, 3, 67529), 8); await expect(pane.locator("p.sr-only")).toContainText(`Calculation SMA: ${tail(three, "Calculation SMA")}`);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(1); expect(await page.locator(".chart-stage").count()).toBe(1);
  const folder = path.resolve(".artifacts/pine-live-calculation168", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "calculation-controls.png") });
  await settings.getByRole("button", { name: "Close indicator settings", exact: true }).click(); await pane.screenshot({ path: path.join(folder, "native-calculation-chart.png") });
  await pane.getByRole("button", { name, exact: true }).click(); await settings.getByTitle("Remove indicator", { exact: true }).click();
  await expect(pane).toHaveCount(0); await expect.poll(() => closed).toContain(2); await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  const readyBeforeReadd = (await results(page)).filter(result => !result.sessionId).length; await add(); emitPrimary(67529);
  await expect.poll(() => native.length).toBe(4); emitNative(native[3], base + 60, 67530);
  await expect.poll(async () => (await results(page)).filter(result => !result.sessionId).length).toBeGreaterThan(readyBeforeReadd + 1);
  emitPrimary(67530);
  const readded = await observed(page, result => result.sessionId && ![first.sessionId, two.sessionId, three.sessionId].includes(result.sessionId) && result.sequence > 0 && tail(result, "Calculation close") === 67530);
  expect(readded.inputs).toEqual({ in_0: 2, in_1: "1", in_2: false }); expect(tail(readded, "Calculation SMA")).toBeCloseTo((67527 + 67530) / 2, 8);
  await page.evaluate(key => { const previous = localStorage.getItem(key); localStorage.removeItem(key); dispatchEvent(new StorageEvent("storage", { key, oldValue: previous, newValue: null, storageArea: localStorage })); }, AUTH_SESSION_KEY);
  await expect(page).toHaveURL(/\/auth\/signin/); await expect.poll(() => closed).toContain(3); await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(events.some(item => item.kind === "primary-close")).toBe(true);
  expect(requests.every(request => request.noAuthorization && request.noCookie)).toBe(true); expect(errors).toEqual([]);
  expect(seal()).toBe(beforeSeal); expect(hashes()).toEqual(beforeHashes);
  const workerName = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker.*\.js$/.test(file))!, worker = fs.readFileSync(path.join("frontend/dist/assets", workerName));
  expect(workers.length).toBeGreaterThan(0); expect(workers.every(item => item.sha256 === hash(worker) && item.bytes === worker.length)).toBe(true);
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), beforeHashes, afterHashes: hashes(), workerName, workerSha256: hash(worker), workers,
    base, primaryHistoryBars: primaryHistory.length, independentClosedMinuteCloses: minutes.map(bar => [bar.time, bar.close]), events, requests,
    evidence: { historical, first, tick, confirmed, two, three, readded, closed }, errors, harnessErrors,
    qualification: "Actual production native5m primary without sourceSnapshot, evaluated nativeM1 acquisition, editor/controller/coordinator and opaque sealed worker. Only dated provider/auth/storage boundaries controlled. UTC complete-group SMA oracle, actual lower confirmation while primary remains forming, input retirement, removal and actual persisted-identity retirement." }, null, 2));
});
