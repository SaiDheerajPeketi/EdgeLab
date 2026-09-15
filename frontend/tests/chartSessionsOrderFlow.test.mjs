import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  filterBarsForTradingSession,
  getChartSessionTemplate,
  resolveChartSessionTemplate,
  sanitizeSessionTemplatePreference,
  sessionPhaseAt,
  sessionTradingDayKey,
} from "../src/lib/chartSessions.ts";
import {
  aggregateOrderFlowBars,
  analyzeOrderFlowBar,
  buildMarketProfile,
  buildOrderFlowIndicatorSeries,
  readOrderFlowSeries,
  resolveOrderFlowAvailability,
} from "../src/lib/orderFlowPresentation.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("symbol-aware session templates use safe explicit and fallback policies", () => {
  assert.equal(resolveChartSessionTemplate("AAPL").id, "us-equity");
  assert.equal(resolveChartSessionTemplate("NASDAQ:MSFT").id, "us-equity");
  assert.equal(resolveChartSessionTemplate("CME_MINI:MESZ2026").id, "cme-futures");
  assert.equal(resolveChartSessionTemplate("BTCUSDT").id, "crypto-24x7");
  assert.equal(resolveChartSessionTemplate("EURUSD").id, "forex-24x5");
  assert.equal(resolveChartSessionTemplate("NIFTY50").id, "nse-equity");
  assert.equal(resolveChartSessionTemplate("unmapped-instrument-2026").id, "always-open");
  assert.equal(sanitizeSessionTemplatePreference("not-a-template"), "auto");
  assert.equal(resolveChartSessionTemplate("AAPL", "lse-equity").id, "lse-equity");
});

test("US regular hours remain stable across the spring DST boundary", () => {
  const template = getChartSessionTemplate("us-equity");
  assert.equal(sessionPhaseAt("2024-03-08T14:30:00Z", template), "regular");
  assert.equal(sessionPhaseAt("2024-03-11T13:30:00Z", template), "regular");
  assert.equal(sessionPhaseAt("2024-03-08T13:30:00Z", template), "premarket");
  assert.equal(sessionPhaseAt("2024-03-11T12:30:00Z", template), "premarket");
});

test("RTH filters before downstream calculations while ETH retains every bar", () => {
  const template = getChartSessionTemplate("us-equity");
  const source = [
    { id: "pre", time: Date.parse("2024-06-03T12:00:00Z") / 1000 },
    { id: "open", time: Date.parse("2024-06-03T13:30:00Z") / 1000 },
    { id: "post", time: Date.parse("2024-06-03T21:00:00Z") / 1000 },
  ];
  assert.deepEqual(
    filterBarsForTradingSession(source, "regular", template).map((bar) => bar.id),
    ["open"],
  );
  assert.deepEqual(
    filterBarsForTradingSession(source, "extended", template).map((bar) => bar.id),
    ["pre", "open", "post"],
  );
  assert.deepEqual(source.map((bar) => bar.id), ["pre", "open", "post"]);
});

test("overnight futures classify maintenance closure and roll the trading day", () => {
  const template = getChartSessionTemplate("cme-futures");
  assert.equal(sessionPhaseAt("2024-01-08T00:15:00Z", template), "premarket");
  assert.equal(sessionPhaseAt("2024-01-08T14:30:00Z", template), "regular");
  assert.equal(sessionPhaseAt("2024-01-08T22:30:00Z", template), "closed");
  assert.equal(sessionPhaseAt("2024-01-08T23:15:00Z", template), "premarket");
  assert.equal(sessionTradingDayKey("2024-01-08T23:15:00Z", template), "2024-01-09");
});

function embeddedBar(time, levels) {
  return {
    close: 100,
    high: 104,
    low: 100,
    open: 101,
    time,
    volume: 105,
    order_flow: {
      levels: levels.map(([price, bid, ask]) => ({
        ask_volume: String(ask),
        bid_volume: String(bid),
        price: String(price),
        total_volume: String(bid + ask),
        trade_count: 2,
        unknown_volume: "0",
      })),
      tick_size: "1",
    },
  };
}

test("order-flow input is read only from real aggregates and never synthesized from OHLCV", () => {
  assert.deepEqual(
    readOrderFlowSeries([{ time: 1, open: 1, high: 2, low: 0, close: 2, volume: 99 }]),
    [],
  );
  assert.equal(resolveOrderFlowAvailability(1, []).status, "unavailable");

  const parsed = readOrderFlowSeries([
    embeddedBar(60, [
      [100, 10, 1],
      [101, 2, 40],
    ]),
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].bidVolume, 12);
  assert.equal(parsed[0].askVolume, 41);
  assert.equal(parsed[0].delta, 29);
  assert.equal(resolveOrderFlowAvailability(1, parsed).status, "available");
});

test("imbalance, stacked imbalance, and unfinished-auction markers are deterministic", () => {
  const [bar] = readOrderFlowSeries([
    embeddedBar(60, [
      [100, 10, 1],
      [101, 2, 40],
      [102, 1, 30],
      [103, 1, 20],
    ]),
  ]);
  const analysis = analyzeOrderFlowBar(bar, 3, 3);
  assert.deepEqual(analysis.buyPrices, [101, 102, 103]);
  assert.deepEqual(analysis.stackedBuyPrices, [101, 102, 103]);
  assert.equal(analysis.unfinishedLow, true);
  assert.equal(analysis.unfinishedHigh, true);
});

test("aggregation, delta indicators, and TPO value area preserve aggregate truth", () => {
  const raw = readOrderFlowSeries([
    embeddedBar(60, [
      [100, 10, 40],
      [101, 5, 10],
    ]),
    embeddedBar(120, [
      [100, 20, 5],
      [102, 10, 5],
    ]),
  ]);
  const merged = aggregateOrderFlowBars(raw, () => 0);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].tradeCount, 8);
  assert.equal(merged[0].delta, 15);

  assert.deepEqual(
    buildOrderFlowIndicatorSeries(raw, "bar-delta").map((point) => point.value),
    [35, -20],
  );
  assert.deepEqual(
    buildOrderFlowIndicatorSeries(raw, "cumulative-delta").map((point) => point.value),
    [35, 15],
  );

  const profile = buildMarketProfile(raw, 1, 70);
  assert.equal(profile.pointOfControl, 100);
  assert.ok(profile.rows.some((row) => row.inValueArea));
  assert.ok(profile.valueAreaHigh >= profile.valueAreaLow);
});

test("strict share settings persist valid session and order-flow state", () => {
  const python = path.join(repoRoot, "backend/.venv/bin/python");
  const code = [
    "import json, sys",
    "from app.schemas import WorkspaceShareChartSettings",
    "value = WorkspaceShareChartSettings.model_validate(json.load(sys.stdin))",
    "print(value.trading_hours_mode, value.session_template, value.footprint_display_mode, value.tpo_value_area_percent)",
  ].join("; ");
  const result = spawnSync(python, ["-c", code], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: path.join(repoRoot, "backend") },
    input: JSON.stringify({
      footprintDisplayMode: "delta-profile",
      footprintImbalanceRatio: 4,
      sessionTemplate: "cme-futures",
      tpoValueAreaPercent: 72,
      tradingHoursMode: "regular",
    }),
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "regular cme-futures delta-profile 72");
});
