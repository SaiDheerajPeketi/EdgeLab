import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";

const seal = () => createHash("sha256").update(fs.readdirSync("frontend/dist", { recursive: true }).map(String)
  .filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort()
  .map(file => file + ":" + createHash("sha256").update(fs.readFileSync(path.join("frontend/dist", file))).digest("hex")).join("\n")).digest("hex");
const initialSeal = seal();
const step = (time: number, interval: string, amount = 1) => interval === "1M"
  ? Date.UTC(new Date(time * 1000).getUTCFullYear(), new Date(time * 1000).getUTCMonth() + amount, 1) / 1000
  : time + amount * ({ "5m": 300, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 }[interval]!);
function nativeRows(interval: string) {
  const now = Date.now(), date = new Date(now), seconds = ({ "5m": 300, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800 }[interval]!);
  const boundary = interval === "1M" ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000
    : interval === "1w" ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7) / 1000
    : Math.floor(now / 1000 / seconds) * seconds;
  const count = interval === "1M" ? 120 : 1000;
  return Array.from({ length: count }, (_, index) => {
    const close = 67000 + index * .7 + Math.sin(index * .19) * 12, time = step(boundary, interval, index - count + 1);
    return { time, open: close - 2, high: close + 5, low: close - 6, close, volume: 700 + index };
  });
}
async function chart(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector(".chart-stage")!;
    const key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let api: any, candles: any, volume: any;
    for (let fiber = key ? (stage as any)[key] : null, depth = 0; fiber && depth < 64; fiber = fiber.return, depth++) {
      for (let hook = fiber.memoizedState, n = 0; hook && n < 384; hook = hook.next, n++) {
        const ref = hook.memoizedState?.current;
        if (ref?.timeScale && ref?.addCandlestickSeries) api ??= ref;
        if (ref?.seriesType?.() === "Candlestick") candles ??= ref;
        if (ref?.seriesType?.() === "Histogram") volume ??= ref;
      }
    }
    if (!api || !candles) throw Error("Production chart refs unavailable");
    const rows = candles.data().map((bar: any) => ({ ...bar, time: Number(bar.time) }));
    return { rows, volume: volume?.data().map((bar: any) => ({ ...bar, time: Number(bar.time) })) ?? [],
      range: api.timeScale().getVisibleLogicalRange(), width: api.timeScale().width(), lastX: rows.length ? api.timeScale().timeToCoordinate(rows.at(-1).time) : null };
  });
}
async function nativeSetup(page: Page, heldInterval?: string) {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).__native154Results = [];
    addEventListener("message", event => {
      const actual = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
        .some(frame => frame.contentWindow === event.source && frame.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (!actual || event.origin !== "null" || event.data?.type !== "result") return;
      const payload = event.data.payload, wire = payload?.protocol === "pine-live-v1" ? payload.response : payload;
      if (wire?.status !== "completed" || wire.result?.kind !== "run") return;
      (window as any).__native154Results.push({ source: wire.result.source, audit: wire.result.audit, inputs: wire.result.inputs,
        live: payload?.protocol === "pine-live-v1", sequence: payload?.sequence,
        plots: wire.result.plots.map((plot: any) => ({ name: plot.name, last: plot.packed
          ? new Float64Array(wire.buffers[plot.packed.values])[plot.packed.slots - 1] : plot.points.at(-1)?.value })) });
    }, true);
  });
  const base = await liveViewportSetup(page);
  const sockets: any[] = [], requests: string[] = [], completed = new Set<string>(), rows = new Map<string, ReturnType<typeof nativeRows>>();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.routeWebSocket(/data-stream\.binance\.vision\/ws\//, socket => {
    sockets.push(socket); socket.onClose(() => { const index = sockets.indexOf(socket); if (index >= 0) sockets.splice(index, 1); });
  });
  await page.route("https://data-api.binance.vision/api/v3/klines?**", async route => {
    const url = new URL(route.request().url()), interval = url.searchParams.get("interval")!;
    if (interval === "1m") return route.fallback();
    requests.push(url.toString()); const history = nativeRows(interval); rows.set(interval, history);
    if (interval === heldInterval) await gate;
    await route.fulfill({ json: history.map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), step(bar.time, interval) * 1000 - 1]) }).catch(() => undefined);
    completed.add(interval);
  });
  let eventTime = Date.now();
  const emit = (interval: string, time: number, close: number, confirmed = false, volume = 2400) => {
    const event = { e: "kline", E: ++eventTime, s: "BTCUSDT", k: { t: time * 1000, T: step(time, interval) * 1000 - 1,
      s: "BTCUSDT", i: interval, o: "67000", h: String(Math.max(69000, close)), l: "66000", c: String(close), v: String(volume), x: confirmed } };
    for (const socket of sockets) if (socket.url().endsWith(`@kline_${interval}`)) socket.send(JSON.stringify(event));
  };
  const choose = async (label: string, interval: string) => {
    await page.getByRole("button", { name: label, exact: true }).first().click();
    await expect.poll(() => sockets.some(socket => socket.url().endsWith(`@kline_${interval}`))).toBe(true);
    await expect.poll(() => rows.has(interval)).toBe(true);
  };
  return { ...base, rows, requests, completed, sockets, errors, emit, choose, release };
}
async function save(page: Page, project: string, name: string, evidence: unknown, errors: string[]) {
  expect(errors).toEqual([]); expect(seal()).toBe(initialSeal);
  const folder = path.resolve(".artifacts/native-history154", project); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ initialSeal, finalSeal: seal(), errors, evidence,
    qualification: "Real application, React hooks, Lightweight Charts and opaque Pine engine. Only authenticated API/storage and provider transport are fixtures; passive chart refs and authentic sandbox outputs are read." }, null, 2));
  await page.locator(".chart-stage").first().screenshot({ path: path.join(folder, name + ".png") });
}

test("native hourly daily weekly monthly history and explicit provider updates reach the actual chart", async ({ page }, info) => {
  const state = await nativeSetup(page), evidence: any[] = [];
  for (const [label, interval] of [["1H", "1h"], ["4H", "4h"], ["1D", "1d"], ["1W", "1w"], ["1M", "1M"]]) {
    await state.choose(label, interval); const rows = state.rows.get(interval)!;
    await expect.poll(async () => (await chart(page)).rows.length).toBe(rows.length);
    const initial = await chart(page); const { volume: firstVolume, ...firstCandle } = rows[0];
    expect(initial.rows[0]).toMatchObject(firstCandle); expect(initial.volume[0]?.value).toBe(firstVolume);
    expect(initial.lastX).toBeGreaterThan(0); expect(initial.lastX).toBeLessThan(initial.width);
    state.emit(interval, rows.at(-1)!.time, 68111, false, 2500);
    await expect.poll(async () => (await chart(page)).rows.at(-1)?.close).toBe(68111);
    expect((await chart(page)).volume.at(-1)?.value).toBe(2500);
    state.emit(interval, rows.at(-1)!.time, 68112, true, 2600);
    await expect.poll(async () => (await chart(page)).rows.at(-1)?.close).toBe(68112);
    state.emit(interval, step(rows.at(-1)!.time, interval), 68120, false, 12);
    await expect.poll(async () => (await chart(page)).rows.length).toBe(rows.length + 1);
    const next = await chart(page); expect(next.rows.at(-1)?.close).toBe(68120); expect(next.volume.at(-1)?.value).toBe(12);
    expect(next.range.to - next.range.from).toBeCloseTo(initial.range.to - initial.range.from, 6);
    evidence.push({ label, interval, initialCount: initial.rows.length, finalCount: next.rows.length, last: next.rows.at(-1), volume: next.volume.at(-1) });
  }
  await save(page, info.project.name, "native-intervals", { evidence, requests: state.requests }, state.errors);
});

test("delayed native history preserves live tail and custom Pine lookback uses full daily candles", async ({ page }, info) => {
  const state = await nativeSetup(page, "1d"); await state.choose("1D", "1d");
  expect((await chart(page)).rows.length).toBe(0);
  const rows = state.rows.get("1d")!, time = rows.at(-1)!.time;
  state.emit("1d", time, 68131, false, 2710); state.emit("1d", time, 68132, false, 2720); state.release();
  await expect.poll(async () => (await chart(page)).rows.length).toBe(1000);
  expect((await chart(page)).rows.at(-1)?.close).toBe(68132); expect((await chart(page)).volume.at(-1)?.value).toBe(2720);
  const source = '//@version=6\nindicator("Native history oracle",overlay=true)\nlength=input.int(200,"Length")\nplot(ta.sma(close,length),"Long average")';
  await page.getByRole("button", { name: "Editor", exact: true }).first().click();
  const editor = page.getByRole("dialog", { name: "EdgeLab indicator editor" });
  await editor.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await editor.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "Run", exact: true }).click();
  const result = async () => page.evaluate(source => [...(window as any).__native154Results].reverse().find(item => item.source === source && !item.live), source);
  await expect.poll(async () => (await result())?.audit.bars).toBe(1000);
  const expected = [...rows.slice(-200, -1).map(row => row.close), 68132].reduce((sum, close) => sum + close, 0) / 200;
  expect((await result()).plots.find((plot: any) => plot.name === "Long average").last).toBeCloseTo(expected, 7);
  await editor.getByRole("spinbutton", { name: "Length", exact: true }).fill("300");
  await editor.getByRole("button", { name: "Run", exact: true }).click();
  const changedExpected = [...rows.slice(-300, -1).map(row => row.close), 68132].reduce((sum, close) => sum + close, 0) / 300;
  await expect.poll(async () => (await result())?.plots.find((plot: any) => plot.name === "Long average").last).toBeCloseTo(changedExpected, 7);
  const historicalResult = await result();
  await editor.getByRole("button", { name: "Add to chart", exact: true }).click();
  await editor.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  await expect(editor).toBeHidden();
  const liveResult = async () => page.evaluate(source => [...(window as any).__native154Results].reverse().find(item => item.source === source && item.live), source);
  await expect.poll(async () => (await liveResult())?.audit.bars).toBe(1000);
  expect((await liveResult()).plots.find((plot: any) => plot.name === "Long average").last).toBeCloseTo(changedExpected, 7);
  state.emit("1d", time, 68135, true, 2730);
  const closedExpected = changedExpected + 3 / 300;
  await expect.poll(async () => (await liveResult())?.plots.find((plot: any) => plot.name === "Long average").last).toBeCloseTo(closedExpected, 7);
  state.emit("1d", step(time, "1d"), 68140, false, 10);
  await expect.poll(async () => (await liveResult())?.audit.bars).toBe(1001);
  const nextExpected = [...rows.slice(-299, -1).map(row => row.close), 68135, 68140].reduce((sum, close) => sum + close, 0) / 300;
  expect((await liveResult()).plots.find((plot: any) => plot.name === "Long average").last).toBeCloseTo(nextExpected, 7);
  await save(page, info.project.name, "native-pine-lookback", { requests: state.requests, expected, changedExpected,
    closedExpected, nextExpected, historicalResult, liveResult: await liveResult() }, state.errors);
});

test("a retired native timeframe cannot republish held history into its replacement", async ({ page }, info) => {
  const state = await nativeSetup(page, "1d"); await state.choose("1D", "1d");
  expect((await chart(page)).rows).toEqual([]);
  await state.choose("4H", "4h");
  await expect.poll(() => state.sockets.some(socket => socket.url().endsWith("@kline_1d"))).toBe(false);
  await expect.poll(async () => (await chart(page)).rows.length).toBe(1000);
  const rows = state.rows.get("4h")!, time = rows.at(-1)!.time;
  state.emit("4h", time, 68145); await expect.poll(async () => (await chart(page)).rows.at(-1)?.close).toBe(68145);
  state.release(); await expect.poll(() => state.completed.has("1d")).toBe(true);
  const after = await chart(page); expect(after.rows[0].time).toBe(rows[0].time); expect(after.rows.at(-1)?.close).toBe(68145);
  expect(state.requests.filter(url => new URL(url).searchParams.get("interval") === "4h")).toHaveLength(1);
  await save(page, info.project.name, "retired-timeframe", { requests: state.requests, first: after.rows[0], last: after.rows.at(-1) }, state.errors);
});
