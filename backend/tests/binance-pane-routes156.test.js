import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: 'export * from "./frontend/src/lib/binancePaneRoutes.ts"; export * from "./frontend/src/lib/journalChartFocus.ts"; export * from "./frontend/src/lib/paneDrawingOwnership.ts";', resolveDir: process.cwd(), loader: "ts" }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { planBinancePaneRoutes, binanceChartSymbolOptions, journalFocusMatchesSymbol, ownPaneDrawings } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const pair = symbol => ({ symbol, status: "TRADING", assetClass: "crypto", label: symbol, description: `${symbol} spot pair` });
const catalog = [pair("BTCUSDT"), pair("ETHUSDT")];
const primary = { symbol: "BTCUSDT", provider: "binance" };
const pane = (id, symbol, timeframe) => ({ id, symbol, timeframe });

test("each simultaneous market owns its own canonical symbol and actual custom source", () => {
  const routes = planBinancePaneRoutes([pane("btc", "BTC/USDT", "3H"), pane("eth", "BINANCE:ETHUSDT", "7m")], catalog, primary);
  assert.deepEqual(routes.map(route => [route.id, route.symbol, route.primary, route.plan.sourceTimeframe, route.plan.targetBars]),
    [["btc", "BTCUSDT", true, "1H", 3002], ["eth", "ETHUSDT", false, "1m", 7006]]);
});

test("primary minute candles retain their authoritative feed while secondary minutes get a native feed", () => {
  const panes = [pane("btc", "BTCUSDT", "1m"), pane("eth", "ETHUSDT", "1m")];
  const before = planBinancePaneRoutes(panes, catalog, primary);
  assert.equal(before[0].plan, null);
  assert.equal(before[0].primary, true);
  assert.equal(before[1].plan.interval, "1m");
  const after = planBinancePaneRoutes(panes, catalog, { symbol: "ETHUSDT", provider: "binance" });
  assert.equal(after[0].symbol, "BTCUSDT");
  assert.equal(after[0].plan.interval, "1m");
  assert.equal(after[1].primary, true);
  assert.equal(after[1].plan, null);
});

test("unrelated exchanges, unknown pairs and stopped secondary markets are never routed to Binance", () => {
  const panes = [pane("foreign", "NYSE:ETHUSDT", "1H"), pane("unknown", "BINANCE:UNKNOWN", "1H"),
    pane("stopped", "SOLUSDT", "1H"), pane("malformed", "ETH-USDT", "1H")];
  const routes = planBinancePaneRoutes(panes, [...catalog, { ...pair("SOLUSDT"), status: "BREAK" }], primary);
  assert.equal(routes.every(route => route.plan === null), true);
  assert.equal(routes[0].symbol, "NYSE:ETHUSDT");
  assert.equal(routes[1].symbol, "BINANCE:UNKNOWN");
});

test("an explicit Binance selection cannot inherit another provider's primary candles", () => {
  const [route] = planBinancePaneRoutes([pane("crypto", "BINANCE:BTCUSDT", "1m")], catalog,
    { symbol: "BTCUSDT", provider: "dukascopy" });
  assert.equal(route.primary, false);
  assert.equal(route.symbol, "BTCUSDT");
  assert.equal(route.plan.interval, "1m");
  assert.equal(route.marketKey, "BINANCE:BTCUSDT");
  const [otherProvider] = planBinancePaneRoutes([pane("other", "BTCUSDT", "1m")], catalog,
    { symbol: "BTCUSDT", provider: "dukascopy" });
  assert.equal(otherProvider.marketKey, "DUKASCOPY:BTCUSDT");
});

test("the selected non-Binance source remains authoritative even if a catalog contains the same symbol", () => {
  const routes = planBinancePaneRoutes([pane("fx", "EURUSD", "1H"), pane("eth", "ETHUSDT", "1H")],
    [...catalog, pair("EURUSD")], { symbol: "EURUSD", provider: "dukascopy" });
  assert.equal(routes[0].primary, true);
  assert.equal(routes[0].plan, null);
  assert.equal(routes[1].plan.interval, "1h");
});

test("qualified Binance journal focus stays historical without changing another live market", () => {
  const routes = planBinancePaneRoutes([pane("btc", "BINANCE:BTC/USDT", "3H"), pane("eth", "ETHUSDT", "1H")], catalog, primary, "BTCUSDT");
  assert.equal(routes[0].focused, true);
  assert.equal(routes[0].primary, false);
  assert.equal(routes[0].symbol, "BTCUSDT");
  assert.equal(routes[0].plan, null);
  assert.equal(routes[1].focused, false);
  assert.equal(routes[1].plan.interval, "1h");
  assert.equal(journalFocusMatchesSymbol(" binance:btc/usdt ", "BTCUSDT"), true);
  assert.equal(journalFocusMatchesSymbol("NYSE:BTCUSDT", "BTCUSDT"), false);
});

test("the live chooser advertises only trading crypto pairs and preserves provider identity", () => {
  const options = binanceChartSymbolOptions([...catalog, { ...pair("SOLUSDT"), status: "BREAK" }, { ...pair("EURUSD"), assetClass: "forex" }]);
  assert.deepEqual(options.map(option => [option.symbol, option.canonical, option.source]),
    [["BINANCE:BTCUSDT", "BTCUSDT", "live"], ["BINANCE:ETHUSDT", "ETHUSDT", "live"]]);
  assert.equal(options.every(option => option.timeframes.includes("1m") && option.timeframes.includes("1M")), true);
});

test("legacy saved drawings adopt their pane market without moving or losing coordinates", () => {
  const original = { drawings: [{ id: "btc-line", points: [{ time: 1800000000, price: 67500 }] }], drawingsByMarket: {} };
  const owned = ownPaneDrawings(original, "BINANCE:BTCUSDT");
  assert.equal(owned.drawings, original.drawings);
  assert.equal(owned.drawingMarket, "BINANCE:BTCUSDT");
  assert.equal(original.drawingMarket, undefined);
  assert.equal(ownPaneDrawings(owned, "BINANCE:BTCUSDT"), owned);
});

test("market switches hide foreign prices and preserve each market's latest edits on return", () => {
  const btc = { drawings: [{ id: "btc-line", points: [{ price: 67500 }] }], drawingsByMarket: {}, drawingMarket: "BINANCE:BTCUSDT" };
  const eth = ownPaneDrawings(btc, "BINANCE:ETHUSDT");
  assert.deepEqual(eth.drawings, []);
  assert.equal(eth.drawingsByMarket["BINANCE:BTCUSDT"], btc.drawings);
  const editedEth = { ...eth, drawings: [{ id: "eth-line", points: [{ price: 3500 }] }] };
  const returnedBtc = ownPaneDrawings(editedEth, "BINANCE:BTCUSDT");
  assert.equal(returnedBtc.drawings, btc.drawings);
  const editedBtc = { ...returnedBtc, drawings: [{ id: "btc-line", points: [{ price: 68000 }] }] };
  const returnedEth = ownPaneDrawings(editedBtc, "BINANCE:ETHUSDT");
  assert.equal(returnedEth.drawings, editedEth.drawings);
  assert.equal(returnedEth.drawingsByMarket["BINANCE:BTCUSDT"], editedBtc.drawings);
  assert.equal(btc.drawings[0].points[0].price, 67500);
});

test("identical tickers from different providers retain distinct drawing archives", () => {
  const source = { drawings: [{ id: "provider-line", points: [{ price: 10 }] }], drawingsByMarket: {}, drawingMarket: "DUKASCOPY:BTCUSDT" };
  const changed = ownPaneDrawings(source, "BINANCE:BTCUSDT");
  assert.deepEqual(changed.drawings, []);
  assert.equal(ownPaneDrawings(changed, "DUKASCOPY:BTCUSDT").drawings, source.drawings);
});
