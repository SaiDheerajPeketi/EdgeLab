import { expect, type Page } from "@playwright/test";
import { productSetup, editor, checkedRun } from "./pine-layering.product-support";
import { AUTH_SESSION_KEY, FROZEN_TIME } from "./support/app";

export const historyStart = Date.parse("2026-09-15T00:30:00Z") / 1000;
export const baseFor = (symbol: string) => symbol === "ETHUSDT" ? 675 : 67500;
export const historyFor = (symbol: string) => Array.from({ length: 600 }, (_, index) => {
  const close = baseFor(symbol) + index / 10;
  return { time: historyStart + index * 60, open: close + 0.5, high: close + 2, low: close - 2, close, volume: 10 };
});
const fiveMinuteHistoryFor = (symbol: string) => {
  const groups = new Map<number, ReturnType<typeof historyFor>>();
  for (const bar of historyFor(symbol)) {
    const time = Math.floor(bar.time / 300) * 300;
    groups.set(time, [...(groups.get(time) ?? []), bar]);
  }
  return [...groups].filter(([, bars]) => bars.length === 5).map(([time, bars]) => ({ time, open: bars[0].open,
    high: Math.max(...bars.map(bar => bar.high)), low: Math.min(...bars.map(bar => bar.low)), close: bars.at(-1)!.close,
    volume: bars.reduce((total, bar) => total + bar.volume, 0) }));
};

const diagnostics = new WeakMap<Page, any>();

export async function contextDiagnostics(page: Page) {
  const record = diagnostics.get(page) ?? {};
  const dom = await page.evaluate(() => ({
    mutationCount: (window as any).__context59?.mutationCount ?? 0,
    traceCount: (window as any).__context59?.observations?.length ?? 0,
    editorLoading: [...document.querySelectorAll('[role="status"]')].some(item => item.textContent?.includes("Loading indicator editor")),
    editorDialog: !!document.querySelector('[role="dialog"][aria-label="EdgeLab indicator editor"]'),
    frames: document.querySelectorAll('iframe[sandbox="allow-scripts"]').length,
  }));
  return { ...record, dom };
}

export async function setupContextProduct(page: Page) {
  const errors: string[] = [];
  const record = { errors, console: [] as any[], consoleCount: 0, assets: [] as any[], requestFailures: [] as any[] };
  diagnostics.set(page, record);
  page.on("console", message => {
    if (!["error", "warning"].includes(message.type())) return;
    record.consoleCount++;
    if (record.console.length < 100) record.console.push({ type: message.type(), text: message.text().slice(0, 4000) });
  });
  page.on("response", response => {
    if (new URL(response.url()).pathname.startsWith("/assets/") && record.assets.length < 256) record.assets.push({ url: response.url(), status: response.status() });
  });
  page.on("requestfailed", request => {
    if (record.requestFailures.length < 100) record.requestFailures.push({ url: request.url(), failure: request.failure() });
  });
  const sockets: any[] = [];
  const events: any[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket(/data-stream\.binance\.vision/, socket => {
    sockets.push(socket);
    socket.onClose(() => {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
  });
  // The observer runs in the host before its genuine runtime listener. It
  // preserves source, origin, nonce and buffers; opaque code is never injected.
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const state = { source: null as string | null, sequence: null as number | null, held: [] as MessageEvent[], mutationCount: 0, inputs: null as Record<string, unknown> | null, observations: [] as any[] };
    (window as any).__context59 = state;
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')]
        .find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      const payload = event.data?.payload;
      const response = payload?.protocol === "pine-live-v1" ? payload.response : payload;
      if (!frame || event.origin !== "null" || event.data?.type !== "result" || response?.status !== "completed"
        || response.result?.kind !== "run" || response.result.source !== state.source
        || (state.sequence !== null && payload.sequence !== state.sequence)
        || (state.inputs !== null && !Object.entries(state.inputs).every(([key, value]) => response.result.inputs[key] === value))) return;
      state.held.push(event);
      event.stopImmediatePropagation();
    }, true);
    new MutationObserver(() => {
      state.mutationCount++;
      const stage = document.querySelector(".chart-stage");
      if (!stage || state.observations.length >= 2048) return;
      state.observations.push({
        header: stage.querySelector(".chart-stage-header")?.textContent ?? "",
        studies: [...stage.querySelectorAll(".chart-study-pill")].map(item => item.textContent),
        notices: [...stage.querySelectorAll('[role="status"]')].map(item => item.textContent),
      });
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  let failureSymbol: string | null = null;
  const setup = await productSetup(page, {
    target: "/app/live", keepBinanceWebSocket: true,
    beforeNavigate: async () => {
      await page.route("**/api/live/binance/instruments?**", route => route.fulfill({ json: {
        instruments: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, label: symbol, description: symbol, status: "TRADING", asset_class: "crypto",
          base_asset: symbol.slice(0, -4), quote_asset: "USDT", tick_size: symbol === "ETHUSDT" ? .001 : .01,
          min_quantity: symbol === "ETHUSDT" ? .001 : .00001, quantity_step: symbol === "ETHUSDT" ? .001 : .00001 })),
      } }));
      await page.route("https://data-api.binance.vision/**", route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/klines")) {
          const symbol = url.searchParams.get("symbol")!;
          if (failureSymbol === symbol) return route.fulfill({ status: 503, json: { message: "Controlled source unavailable" } });
          const interval = url.searchParams.get("interval") ?? "1m", seconds = interval === "5m" ? 300 : 60;
          const bars = interval === "5m" ? fiveMinuteHistoryFor(symbol) : historyFor(symbol);
          const rows = url.searchParams.has("endTime") ? [] : bars.map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), (bar.time + seconds) * 1000 - 1]);
          return route.fulfill({ json: rows });
        }
        if (url.pathname.endsWith("/ticker/24hr")) {
          return route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, lastPrice: String(baseFor(symbol) + 59.9), priceChange: "1", priceChangePercent: "0.1", highPrice: String(baseFor(symbol) + 100), lowPrice: String(baseFor(symbol) - 100), volume: "1000", quoteVolume: "67500000", openPrice: String(baseFor(symbol)), closeTime: Date.parse(FROZEN_TIME) })) });
        }
        return route.fulfill({ json: { symbols: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, status: "TRADING", baseAsset: symbol.slice(0, 3), quoteAsset: "USDT" })) } });
      });
    },
  });
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  const minute = page.getByRole("button", { name: "1m", exact: true }).first();
  if (await minute.isVisible()) await minute.click();
  let eventTime = Date.parse(FROZEN_TIME);
  return {
    ...setup, errors, sockets, events,
    failSource(symbol: string | null) { failureSymbol = symbol; },
    emit(symbol: string, index = 600, delta = 1, confirmed = false) {
      const close = baseFor(symbol) + 60 + delta;
      const bar = { time: historyStart + index * 60, open: close + 0.5, high: close + 2, low: close - 2, close, volume: 15 };
      const payload = { stream: `${symbol.toLowerCase()}@kline_1m`, data: { e: "kline", E: ++eventTime, s: symbol, k: { t: bar.time * 1000, T: bar.time * 1000 + 59_999, i: "1m", s: symbol, o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), v: String(bar.volume), x: confirmed } } };
      events.push(payload);
      for (const socket of sockets) if (socket.url().includes(`${symbol.toLowerCase()}@kline_1m`)) socket.send(JSON.stringify(payload));
      return bar;
    },
    emitFiveMinute(symbol: string, bar: ReturnType<typeof historyFor>[number]) {
      expect(bar.time % 300).toBe(0);
      const payload = { e: "kline", E: ++eventTime, s: symbol, k: { t: bar.time * 1000, T: (bar.time + 300) * 1000 - 1,
        i: "5m", s: symbol, o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(bar.close), v: String(bar.volume), x: false } };
      const owners = sockets.filter(socket => socket.url().includes(`${symbol.toLowerCase()}@kline_5m`));
      expect(owners).toHaveLength(1); events.push(payload); owners[0].send(JSON.stringify(payload));
    },
  };
}

export async function addSource(page: Page, source: string, strategy = false) {
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption(strategy ? "pine-strategy" : "pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await checkedRun(dialog);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  const before = (await results(page, source)).length;
  await dialog.getByRole("button", { name: "Add to chart", exact: true }).click();
  await dialog.getByRole("button", { name: "Close indicator editor", exact: true }).click();
  return before;
}

export async function results(page: Page, source: string) {
  return page.evaluate(source => ((window as any).__layerResults ?? []).flatMap((payload: any) => {
    const response = payload.protocol === "pine-live-v1" ? payload.response : payload;
    const result = response?.result;
    if (response?.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    const plots = result.plots.map((plot: any) => {
      if (!plot.packed) return { name: plot.name, values: plot.points.map((point: any) => point.value), times: plot.points.map((point: any) => point.time) };
      const values = new Float64Array(response.buffers[plot.packed.values]);
      const kinds = new Uint8Array(response.buffers[plot.packed.kinds]);
      return { name: plot.name, values: Array.from({ length: plot.packed.slots }, (_, index) => kinds[index] === 4 ? values[index] : kinds[index] === 3 ? true : kinds[index] === 2 ? false : null) };
    });
    return [{ id: response.id, source: result.source, name: result.name, declaration: result.declaration, inputs: result.inputs,
      audit: result.audit, sessionId: payload.sessionId, sequence: payload.sequence, diagnostics: result.diagnostics, plots, strategy: result.strategy }];
  }), source);
}
export async function latest(page: Page, source: string, predicate: (result: any) => boolean) {
  await expect.poll(async () => (await results(page, source)).some(predicate)).toBe(true);
  return (await results(page, source)).findLast(predicate)!;
}
export const value = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).values.at(-1);
export async function hold(page: Page, source: string, sequence: number | null = null, inputs: Record<string, unknown> | null = null) {
  await page.evaluate(({ source, sequence, inputs }) => {
    const state = (window as any).__context59;
    state.source = source; state.sequence = sequence; state.inputs = inputs; state.held = [];
  }, { source, sequence, inputs });
}
export async function heldCount(page: Page) {
  return page.evaluate(() => (window as any).__context59.held.length);
}
export async function release(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__context59;
    const events: MessageEvent[] = state.held;
    state.held = []; state.source = null; state.sequence = null; state.inputs = null;
    const receipts = events.map(event => ({
      connected: [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].some(frame => frame.contentWindow === event.source),
      id: event.data.payload.response?.id ?? event.data.payload.id,
      sessionId: event.data.payload.sessionId, sequence: event.data.payload.sequence,
    }));
    for (const event of events) window.dispatchEvent(new MessageEvent("message", { data: event.data, source: event.source, origin: event.origin, ports: event.ports }));
    return receipts;
  });
}
export async function colorCounts(page: Page) {
  return page.locator(".chart-stage").first().evaluate(stage => {
    const canvas = [...stage.querySelectorAll("canvas")].filter(item => item.getBoundingClientRect().height > 80).sort((a, b) => b.width - a.width)[0];
    const bytes = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = { magenta: [255, 0, 255], red: [255, 0, 0], blue: [0, 0, 255], marker: [34, 197, 94] };
    const counts = { magenta: 0, red: 0, blue: 0, marker: 0 };
    for (let offset = 0; offset < bytes.length; offset += 4) {
      for (const key of Object.keys(colors) as (keyof typeof colors)[]) {
        if (colors[key].every((channel, index) => Math.abs(bytes[offset + index] - channel) <= 2)) counts[key]++;
      }
    }
    return counts;
  });
}
export async function authStorage(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), AUTH_SESSION_KEY);
}
