import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundle = await build({ entryPoints: [fileURLToPath(new URL("../../frontend/src/lib/binanceChartFeed.ts", import.meta.url))], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
const { binanceChartPlan, loadBinanceRequestHistory, loadBinanceChartHistory } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const utc = value => Date.parse(value) / 1000;
const day = 86400, start = utc("2020-01-01T00:00:00Z");
const row = (time, seconds = day) => [time * 1000, "100", "102", "99", "101", "10", (time + seconds) * 1000 - 1];
const options = overrides => ({ from: start, to: start + 2000 * day, signal: new AbortController().signal, ...overrides });
const provider = rows => {
  const calls = [];
  return { calls, fetcher: async (url, init) => {
    const query = new URL(url).searchParams;
    calls.push({ query, signal: init.signal, credentials: init.credentials, redirect: init.redirect });
    const from = Number(query.get("startTime")), to = Number(query.get("endTime")), limit = Number(query.get("limit"));
    return { ok: true, json: async () => rows.filter(item => item[0] >= from && item[0] <= to).slice(0, limit) };
  } };
};

test("requested symbol history pages the specified past range without fetching the latest window", async () => {
  const rows = Array.from({ length: 2011 }, (_, index) => row(start + (index - 10) * day));
  const feed = provider(rows), signal = new AbortController().signal;
  const result = await loadBinanceRequestHistory("ETHUSDT", binanceChartPlan("1D"), options({ warmupPeriods: 10, signal, fetcher: feed.fetcher }));
  assert.equal(result.bars.length, 2011);
  assert.equal(result.warmupFrom, start - 10 * day);
  assert.equal(result.requests, 3);
  assert.equal(result.exhausted, true);
  assert.equal(result.capped, false);
  assert.deepEqual(feed.calls.map(call => Number(call.query.get("startTime"))), [start - 10 * day, start + 990 * day, start + 1990 * day].map(time => time * 1000));
  for (const call of feed.calls) {
    assert.equal(call.query.get("symbol"), "ETHUSDT");
    assert.equal(call.query.get("interval"), "1d");
    assert.equal(Number(call.query.get("endTime")), (start + 2000 * day) * 1000);
    assert.equal(call.signal, signal);
    assert.equal(call.credentials, "omit");
    assert.equal(call.redirect, "error");
  }
});

test("genuine missing periods and delisting remain absent across pages and warmup", async () => {
  const rows = Array.from({ length: 1200 }, (_, index) => row(start + index * day)).filter((_, index) => index < 20 || index > 39);
  const feed = provider(rows);
  const result = await loadBinanceRequestHistory("OLDUSDT", binanceChartPlan("1D"), options({ from: start + 30 * day, warmupPeriods: 30, fetcher: feed.fetcher }));
  assert.equal(result.bars.length, rows.length);
  assert.deepEqual(result.bars.map(bar => bar.time), rows.map(item => item[0] / 1000));
  assert.equal(result.bars.at(-1).time, start + 1199 * day);
  assert.equal(result.exhausted, true);
  assert.equal(result.capped, false);
  const strict = async () => loadBinanceChartHistory("OLDUSDT", binanceChartPlan("1D"), { signal: new AbortController().signal,
    fetcher: async () => ({ ok: true, json: async () => [rows[19], rows[20]] }) });
  await assert.rejects(strict, /missing or overlapping/); // Visible chart continuity remains strict.
});

test("monthly warmup and close validation use actual calendar boundaries", async () => {
  const dates = ["2023-12-01", "2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"].map(date => utc(`${date}T00:00:00Z`));
  const rows = dates.slice(0, 4).map((time, index) => row(time, dates[index + 1] - time));
  const feed = provider(rows);
  const result = await loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1M"), options({ from: dates[2] + day, to: dates[3], warmupPeriods: 2, fetcher: feed.fetcher }));
  assert.equal(result.warmupFrom, dates[0]);
  assert.equal(result.sourceTimeframe, "1M");
  assert.deepEqual(result.bars.map(bar => bar.time), dates.slice(0, 4));
  const bad = rows.map(item => [...item]);
  bad[2][6] = (dates[2] + 30 * day) * 1000 - 1;
  await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1M"), options({ from: dates[2], to: dates[3], fetcher: provider(bad).fetcher })), /candle interval or date range/);
});

test("custom chart plan fetches genuine native divisor candles with inclusive aligned starts", async () => {
  const plan = binanceChartPlan("2D"), rows = [row(start), row(start + day), row(start + 2 * day)];
  const feed = provider(rows);
  const result = await loadBinanceRequestHistory("SOLUSDT", plan, options({ from: start + 123, to: start + 2 * day + 456, fetcher: feed.fetcher }));
  assert.equal(plan.sourceTimeframe, "1D");
  assert.equal(result.sourceTimeframe, "1D");
  assert.equal(Number(feed.calls[0].query.get("startTime")), start * 1000);
  assert.equal(Number(feed.calls[0].query.get("endTime")), (start + 2 * day + 456) * 1000);
  assert.deepEqual(result.bars.map(bar => bar.time), [start, start + day, start + 2 * day]);
});

test("7m historical range includes the leading chart constituents and warms up in requested periods", async () => {
  const bucket = Math.floor(start / 420) * 420;
  const rows = Array.from({ length: 35 }, (_, index) => row(bucket + (index - 14) * 60, 60));
  for (const warmupPeriods of [0, 2]) {
    const feed = provider(rows);
    const result = await loadBinanceRequestHistory("ETHUSDT", binanceChartPlan("7m"), options({ from: bucket + 3 * 60, to: bucket + 6 * 60, warmupPeriods, fetcher: feed.fetcher }));
    const expectedStart = bucket - warmupPeriods * 420;
    assert.equal(result.warmupFrom, expectedStart);
    assert.equal(Number(feed.calls[0].query.get("startTime")), expectedStart * 1000);
    assert.deepEqual(result.bars.map(bar => bar.time), rows.filter(item => item[0] / 1000 >= expectedStart && item[0] / 1000 <= bucket + 6 * 60).map(item => item[0] / 1000));
    assert.equal(result.bars.filter(bar => bar.time >= bucket).length, 7);
    assert.equal(result.bars[0].time, expectedStart);
  }
});

test("calendar week and custom day warmup retain requested grid alignment", async () => {
  const monday = utc("2024-03-04T00:00:00Z"), week = 7 * day;
  const weekly = provider([-2, -1, 0].map(index => row(monday + index * week, week)));
  const weekResult = await loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1W"), options({ from: monday + 2 * day, to: monday + 5 * day, warmupPeriods: 2, fetcher: weekly.fetcher }));
  assert.equal(weekResult.warmupFrom, monday - 2 * week);
  assert.equal(new Date(weekResult.warmupFrom * 1000).getUTCDay(), 1);
  assert.equal(weekResult.bars.length, 3);
  const customDayBucket = Math.floor(start / (2 * day)) * 2 * day;
  const daily = provider(Array.from({ length: 6 }, (_, index) => row(customDayBucket + (index - 4) * day)));
  const dayResult = await loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("2D"), options({ from: customDayBucket + day, to: customDayBucket + day, warmupPeriods: 2, fetcher: daily.fetcher }));
  assert.equal(dayResult.warmupFrom, customDayBucket - 4 * day);
  assert.equal(dayResult.bars.length, 6);
  let requests = 0;
  await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("2W"), options({ fetcher: async () => { requests++; return { ok: true, json: async () => [] }; } })), /multi-week.*calendar-aligned/);
  assert.equal(requests, 0);
});

test("epoch clamp is a request boundary and never fabricates an off-grid weekly candle", async () => {
  const firstMonday = utc("1970-01-05T00:00:00Z");
  const feed = provider([row(firstMonday, 7 * day)]);
  const result = await loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1W"), options({ from: 0, to: 6 * day, warmupPeriods: 2, fetcher: feed.fetcher }));
  assert.equal(result.warmupFrom, 0);
  assert.equal(Number(feed.calls[0].query.get("startTime")), 0);
  assert.deepEqual(result.bars.map(bar => bar.time), [firstMonday]);
  const monthly = provider([row(0, 31 * day)]);
  const monthResult = await loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1M"), options({ from: 5 * day, to: 6 * day, warmupPeriods: 2, fetcher: monthly.fetcher }));
  assert.equal(monthResult.warmupFrom, 0);
  assert.deepEqual(monthResult.bars.map(bar => bar.time), [0]);
});

test("candle and request budgets report unscanned spans rather than claiming complete history", async () => {
  const rows = Array.from({ length: 2500 }, (_, index) => row(start + index * day));
  for (const budget of [{ candleLimit: 1200, requestLimit: 10, expected: 1200, requests: 2 }, { candleLimit: 5000, requestLimit: 1, expected: 1000, requests: 1 }]) {
    const feed = provider(rows);
    const result = await loadBinanceRequestHistory("ETHUSDT", binanceChartPlan("1D"), options({ ...budget, fetcher: feed.fetcher }));
    assert.equal(result.bars.length, budget.expected);
    assert.equal(result.requests, budget.requests);
    assert.equal(result.capped, true);
    assert.equal(result.exhausted, false);
  }
  const empty = await loadBinanceRequestHistory("ETHUSDT", binanceChartPlan("1D"), options({ fetcher: provider([]).fetcher }));
  assert.deepEqual(empty.bars, []);
  assert.equal(empty.exhausted, true);
  assert.equal(empty.capped, false);
});

test("invalid ranges, symbols, budgets, and forged native plans are rejected before transport", async () => {
  let requests = 0;
  const fetcher = async () => { requests++; throw new Error("must not fetch"); };
  for (const overrides of [{ from: -1 }, { from: start + day, to: start }, { to: Infinity }, { warmupPeriods: -1 }, { warmupPeriods: 200001 }, { candleLimit: 0 }, { candleLimit: 200001 }, { requestLimit: 201 }, { requestLimit: 0 }]) {
    await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1D"), options({ ...overrides, fetcher })), /range or budget/);
  }
  for (const symbol of ["BTCUSDT/../../", "btcusdt", "X", "A".repeat(41)]) await assert.rejects(loadBinanceRequestHistory(symbol, binanceChartPlan("1D"), options({ fetcher })), /range or budget/);
  for (const forged of [{ ...binanceChartPlan("1D"), interval: "1m" }, { chartTimeframe: "1D", sourceTimeframe: "invalid", interval: null, targetBars: 1000 }]) await assert.rejects(loadBinanceRequestHistory("BTCUSDT", forged, options({ fetcher })), /range or budget/);
  assert.equal(requests, 0);
});

test("malformed, unordered, overlapping, off-grid, and out-of-cutoff rows fail closed", async () => {
  const valid = row(start), next = row(start + day);
  const scenarios = [[valid, valid], [next, valid], [[...valid.slice(0, 6), valid[6] - 1]], [row(start + 1)], [row(start - day)], [row(start + 2001 * day)], [[start * 1000, "bad", "102", "99", "101", "10", valid[6]]]];
  for (const rows of scenarios) await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1D"), options({ fetcher: async () => ({ ok: true, json: async () => rows }) })), /provider|unordered|overlapping|finite/);
  let requests = 0;
  await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1D"), options({ fetcher: async () => ({ ok: true, json: async () => ++requests === 1 ? Array.from({ length: 1000 }, (_, index) => row(start + index * day)) : [row(start + 999 * day)] }) })), /date range|overlapping/);
  await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1D"), options({ candleLimit: 1, fetcher: async () => ({ ok: true, json: async () => [valid, next] }) })), /invalid requested symbol history/);
});

test("cancelled or retired owners cannot publish history after fetch or JSON completion", async () => {
  for (const stage of ["before", "fetch", "json"]) {
    const controller = new AbortController();
    if (stage === "before") controller.abort();
    let calls = 0;
    await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1D"), options({ signal: controller.signal, fetcher: async () => {
      calls++;
      if (stage === "fetch") controller.abort();
      return { ok: true, json: async () => { if (stage === "json") controller.abort(); return [row(start)]; } };
    } })), error => error.name === "AbortError");
    assert.equal(calls, stage === "before" ? 0 : 1);
  }
  let owner = true;
  await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1D"), options({ owns: () => owner, fetcher: async () => ({ ok: true, json: async () => { owner = false; return [row(start)]; } }) })), error => error.name === "AbortError");
  await assert.rejects(loadBinanceRequestHistory("BTCUSDT", binanceChartPlan("1D"), options({ fetcher: async () => ({ ok: false }) })), /could not be loaded/);
});
