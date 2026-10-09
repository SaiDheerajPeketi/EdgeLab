import { expect, type Page } from "@playwright/test";
import { AUTH_SESSION_KEY, betaSessionResponse, gotoStable, installDeterminism, seedChartLayout } from "./support/app";
import { fulfillReplayContext, replayState } from "./support/replay-context";

// Only current-time auth/storage and provider transport are controlled. Chart,
// range ownership, React lifecycle and actual live aggregation remain production.
export async function liveViewportSetup(page: Page, delayedHistory = false, target: "/app/live" | "/app/replay" = "/app/live") {
  const now = Date.now(), currentMinute = Math.floor(now / 60_000) * 60, origin = currentMinute - 600 * 60;
  const history = Array.from({ length: 600 }, (_, index) => {
    const close = 67500 + Math.sin(index * .17) * 20 + index * .02;
    return { time: origin + index * 60, open: close - (index % 2 ? 1 : -1), high: close + 3, low: close - 3, close, volume: 10 + index % 13 };
  });
  const catalog = { root: "/fixtures/markets", instruments: ["BTCUSDT", "ETHUSDT"].map(symbol => ({
    id: symbol.toLowerCase(), name: symbol, symbol, currency: "USD", timezone: "UTC", pnl_multiplier: 1,
    folder_path: null, updated_at: new Date(now).toISOString(), timeframes: [{ timeframe: "1m",
      csv_path: `/fixtures/markets/${symbol}/1m.csv`, rows: 600, first_timestamp: new Date(history[0].time * 1000).toISOString(),
      last_timestamp: new Date(history.at(-1)!.time * 1000).toISOString(), imported: true, imported_at: new Date(now).toISOString() }] })) };
  const sockets: any[] = [], events: any[] = [], storage = new Map<string, any>(), operations = new Map<string, any>(), requests: any[] = [];
  let release!: () => void;
  const historyGate = new Promise<void>(resolve => { release = resolve; });
  let releaseNormalized!: () => void;
  const normalizedGate = new Promise<void>(resolve => { releaseNormalized = resolve; });
  if (!delayedHistory) release();
  await page.routeWebSocket(/data-stream\.binance\.vision/, socket => {
    sockets.push(socket); socket.onClose(() => { const index = sockets.indexOf(socket); if (index >= 0) sockets.splice(index, 1); });
  });
  // Keep the dataset stream a controlled provider transport too: the shared
  // deterministic catalog contains only BTC, so it cannot author this ETH pane.
  await page.routeWebSocket(/\/api\/datasets\/stream/, socket => {
    socket.onMessage(() => socket.send(JSON.stringify({ type: "catalog", catalog })));
  });
  await page.addInitScript(() => { (window as any).__viewport151NativeSocket = WebSocket; });
  await installDeterminism(page, { freezeTime: false, keepBinanceWebSocket: true });
  await page.addInitScript(() => {
    const Native = (window as any).__viewport151NativeSocket, Fixture = WebSocket;
    delete (window as any).__viewport151NativeSocket;
    window.WebSocket = new Proxy(Fixture, { construct(target, args) {
      return new URL(String(args[0]), location.href).pathname.endsWith("/api/datasets/stream")
        ? Reflect.construct(Native, args) : Reflect.construct(target, args);
    } });
  });
  await seedChartLayout(page, "single"); await fulfillReplayContext(page);
  const session = { ...betaSessionResponse, created_at: new Date(now).toISOString(), expires_at: new Date(now + 86_400_000).toISOString(),
    user: { ...betaSessionResponse.user, provider: "google", deployment_mode: "production", workspace_access: true,
      access_expires_at: new Date(now + 600_000).toISOString(), is_beta_user: false, plan: "pro" } };
  await page.addInitScript(({ session, key }) => {
    if (window !== window.top) return;
    const user = session.user;
    localStorage.setItem(key, JSON.stringify({ createdAt: session.created_at, expiresAt: session.expires_at, token: session.token, user: {
      id: user.id, email: user.email, name: user.name, provider: user.provider, approved: user.approved, betaPosition: user.beta_position,
      deploymentMode: user.deployment_mode, workspaceAccess: user.workspace_access, accessExpiresAt: user.access_expires_at, isBetaUser: user.is_beta_user, plan: user.plan } }));
  }, { session, key: AUTH_SESSION_KEY });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.replace(/^\/api/, "");
    if (endpoint === "/auth/session") return route.fulfill({ json: session });
    if (endpoint === "/auth/config") return route.fulfill({ json: { deployment_mode: "production", google_enabled: true, manual_access_enabled: false, dev_auth_bypass_enabled: false } });
    if (endpoint === "/billing/status") return route.fulfill({ json: { provider: "stripe", mode: "live", configured: true, workspace_access: true, subscription_access: true,
      plan: "pro", status: "active", cadence: "monthly", current_period_end: session.expires_at, verified_at: session.created_at, refresh_required: false, cancel_at_period_end: false } });
    const operation = endpoint.match(/^\/app-data\/operations\/([0-9a-f-]+)\/(reserve|recover)$/);
    if (operation) { const [, id, action] = operation;
      if (action === "reserve") operations.set(id, { operation_id: id, ...request.postDataJSON(), status: "reserved", http_status: null, result: null, created_at: session.created_at, completed_at: null });
      expect(operations.has(id)).toBe(true); return route.fulfill({ json: operations.get(id) }); }
    const bound = request.headers()["x-edgelab-operation-id"];
    if (bound) { expect(operations.get(bound)).toMatchObject({ method: request.method(), path: endpoint, status: "reserved" }); Object.assign(operations.get(bound), { status: "completed", http_status: 200, completed_at: new Date().toISOString() }); }
    if (endpoint === "/datasets") return route.fulfill({ json: catalog });
    const encoded = endpoint.match(/^\/app-storage\/edgelab\/(.+)$/)?.[1];
    if (encoded) { const key = decodeURIComponent(encoded); if (request.method() === "PUT") storage.set(key, structuredClone(request.postDataJSON().value));
      return route.fulfill({ json: { namespace: "edgelab", key, value: storage.get(key) ?? null, updated_at: new Date().toISOString() } }); }
    if (endpoint === "/live/binance/instruments") return route.fulfill({ json: { provider: "binance", instruments: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, name: symbol, status: "TRADING", asset_class: "crypto", base_asset: symbol.slice(0, -4), quote_asset: "USDT", tick_size: .01, min_quantity: .00001, quantity_step: .00001 })), total: 2 } });
    if (target === "/app/replay") {
      const replayBars = history.map(bar => ({ ...bar, timestamp: new Date(bar.time * 1000).toISOString(), ema_20: null, ema_50: null, rsi_14: null }));
      if (endpoint === "/backtests/latest") {
        const state = replayState();
        return route.fulfill({ json: { ...state, session: { ...state.session, timeframe: "1m", current_offset: 599,
          start_offset: 0, end_offset: 599, start_at: replayBars[0].timestamp, end_at: replayBars.at(-1)!.timestamp }, current_candle: replayBars.at(-1) } });
      }
      if (endpoint === "/market-data/meta") return route.fulfill({ json: { csv_path: "/fixtures/markets/BTCUSDT/1m.csv", rows: 600,
        first_timestamp: replayBars[0].timestamp, last_timestamp: replayBars.at(-1)!.timestamp } });
      if (endpoint === "/market-data/bars") { const offset = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 600);
        return route.fulfill({ json: { bars: replayBars.slice(offset, offset + limit), limit, offset, next_offset: offset + limit } }); }
      if (endpoint === "/market-data/instruments") return route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map((symbol, index) => ({ id: index + 1,
        canonical_symbol: symbol, display_name: symbol, asset_class: "crypto", instrument_type: "SPOT", exchange: "BINANCE", currency: "USD",
        timezone: "UTC", tick_size: .01, active: true, identifiers: [{ provider: "BINANCE", provider_symbol: symbol }] })) });
      if (endpoint === "/market-data/subscriptions") return route.fulfill({ json: { ...request.postDataJSON(), subscription_id: "fixture151-" + request.postDataJSON().instrument_id, queued_events: 0, dropped_events: 0 } });
      if (endpoint.startsWith("/market-data/subscriptions/")) return route.fulfill({ json: { ok: true } });
      if (/^\/market-data\/instruments\/\d+\/candles$/.test(endpoint)) {
        requests.push({ url: url.toString(), at: Date.now(), kind: "normalized" });
        if (endpoint.includes("/2/")) await normalizedGate;
        const interval = Number(url.searchParams.get("interval_seconds")), groups = new Map<number, typeof history>();
        for (const bar of history) { const time = Math.floor(bar.time / interval) * interval; groups.set(time, [...(groups.get(time) ?? []), bar]); }
        return route.fulfill({ json: [...groups].map(([time, bars]) => ({ instrument_id: endpoint.includes("/2/") ? 2 : 1, interval_seconds: interval,
          start_at: new Date(time * 1000).toISOString(), end_at: new Date((time + interval) * 1000).toISOString(), open: bars[0].open,
          high: Math.max(...bars.map(bar => bar.high)), low: Math.min(...bars.map(bar => bar.low)), close: bars.at(-1)!.close,
          volume: bars.reduce((total, bar) => total + bar.volume, 0), provider: "FIXTURE", complete: true })) });
      }
    }
    return route.fallback();
  });
  await page.route("https://data-api.binance.vision/**", async route => {
    const url = new URL(route.request().url()); requests.push({ url: url.toString(), at: Date.now() });
    if (url.pathname.endsWith("/klines")) {
      if (url.searchParams.has("endTime")) return route.fulfill({ json: [] });
      await historyGate;
      const interval = url.searchParams.get("interval");
      if (interval === "5m") {
        const groups = new Map<number, typeof history>();
        for (const bar of history) { const time = Math.floor(bar.time / 300) * 300; groups.set(time, [...(groups.get(time) ?? []), bar]); }
        return route.fulfill({ json: [...groups].map(([time, bars]) => [time * 1000, String(bars[0].open), String(Math.max(...bars.map(bar => bar.high))),
          String(Math.min(...bars.map(bar => bar.low))), String(bars.at(-1)!.close), String(bars.reduce((sum, bar) => sum + bar.volume, 0)), time * 1000 + 299999]) });
      }
      return route.fulfill({ json: history.map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), bar.time * 1000 + 59999]) });
    }
    if (url.pathname.endsWith("/ticker/24hr")) return route.fulfill({ json: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, lastPrice: "67512", priceChange: "1", priceChangePercent: ".1", highPrice: "67600", lowPrice: "67400", volume: "1000", quoteVolume: "67500000", openPrice: "67500", closeTime: now })) });
    return route.fulfill({ json: { symbols: ["BTCUSDT", "ETHUSDT"].map(symbol => ({ symbol, status: "TRADING", baseAsset: symbol.slice(0, -4), quoteAsset: "USDT" })) } });
  });
  await gotoStable(page, target, { waitForNetworkIdle: false });
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  if (!await page.getByRole("button", { name: "1m", exact: true }).first().isVisible()) await page.getByRole("button", { name: "Tools", exact: true }).first().click();
  await page.getByRole("button", { name: "1m", exact: true }).first().click();
  if (target === "/app/live") await expect.poll(() => sockets.some(socket => socket.url().includes("btcusdt@kline_1m"))).toBe(true);
  let eventTime = now;
  const emit = (index: number, close: number, confirmed = false, volume = 15) => {
    const bar = { time: origin + index * 60, open: 67520, high: Math.max(67540, close), low: 67500, close, volume };
    const event = { stream: "btcusdt@kline_1m", data: { e: "kline", E: ++eventTime, s: "BTCUSDT", k: { t: bar.time * 1000, T: bar.time * 1000 + 59999,
      i: "1m", s: "BTCUSDT", o: String(bar.open), h: String(bar.high), l: String(bar.low), c: String(close), v: String(volume), x: confirmed } } };
    events.push(event); for (const socket of sockets) if (socket.url().includes("btcusdt@kline_1m")) socket.send(JSON.stringify(event)); return bar;
  };
  const emitNative = (time: number, close: number, volume: number) => {
    const event = { e: "kline", E: ++eventTime, s: "BTCUSDT", k: { t: time * 1000, T: time * 1000 + 299999,
      i: "5m", s: "BTCUSDT", o: "67520", h: "67540", l: "67500", c: String(close), v: String(volume), x: false } };
    events.push({ native: true, data: event });
    for (const socket of sockets) if (socket.url().endsWith("btcusdt@kline_5m")) socket.send(JSON.stringify(event));
  };
  const nativeReady = () => sockets.some(socket => socket.url().endsWith("btcusdt@kline_5m"));
  return { history, events, requests, storage, emit, emitNative, nativeReady, releaseHistory: release, releaseNormalized };
}
