import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeSummary } from "../utils/analytics.js";
import { streamCsvCandles } from "../utils/csvParser.js";
import { resampleCandles } from "../utils/resample.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("streams CSV candles and detects one minute timeframe", async () => {
  const batches = [];
  const stats = await streamCsvCandles(path.join(__dirname, "fixtures", "sample.csv"), (batch) => {
    batches.push(...batch);
  });

  assert.equal(stats.candle_count, 6);
  assert.equal(stats.timeframe_detected, "1m");
  assert.equal(batches[0].timestamp, Date.UTC(2000, 0, 3, 0, 1, 0));
  assert.equal(batches[0].close, 1.0073);
});

test("resamples one minute candles with OHLCV merge rules", () => {
  const candles = [
    { timestamp: 946857660000, open: 1.0073, high: 1.0075, low: 1.0073, close: 1.0073, volume: 5 },
    { timestamp: 946857720000, open: 1.0079, high: 1.0082, low: 1.0078, close: 1.0081, volume: 8 },
    { timestamp: 946857780000, open: 1.0081, high: 1.0088, low: 1.008, close: 1.0085, volume: 10 },
    { timestamp: 946857840000, open: 1.0085, high: 1.009, low: 1.0084, close: 1.0089, volume: 11 },
    { timestamp: 946857900000, open: 1.0088, high: 1.0092, low: 1.0083, close: 1.0084, volume: 9 },
    { timestamp: 946857960000, open: 1.0084, high: 1.0087, low: 1.0077, close: 1.0079, volume: 12 },
  ];

  const resampled = resampleCandles(candles, "5m");

  assert.deepEqual(resampled, [
    { timestamp: 946857600000, open: 1.0073, high: 1.009, low: 1.0073, close: 1.0089, volume: 34 },
    { timestamp: 946857900000, open: 1.0088, high: 1.0092, low: 1.0077, close: 1.0079, volume: 21 },
  ]);
});

test("computes core trade analytics from closed trades", () => {
  const summary = computeSummary([
    {
      id: 1,
      exit_timestamp: 946857960000,
      net_pnl: 100,
      commission: 0,
      r_multiple: 1,
      hold_duration_minutes: 5,
    },
    {
      id: 2,
      exit_timestamp: 946858320000,
      net_pnl: -50,
      commission: 2,
      r_multiple: -0.5,
      hold_duration_minutes: 8,
    },
  ]);

  assert.equal(summary.total_trades, 2);
  assert.equal(summary.win_rate, 0.5);
  assert.equal(summary.total_net_pnl, 50);
  assert.equal(summary.profit_factor, 2);
  assert.equal(summary.average_r_multiple, 0.25);
  assert.equal(summary.consecutive_wins, 1);
  assert.equal(summary.consecutive_losses, 1);
});
