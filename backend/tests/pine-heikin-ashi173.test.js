import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Actual sealed compiler/worker; only explicit authored market candles are supplied.
Error.stackTraceLimit = 0;
const baseline = process.env.PINE_HA173_BASELINE === "head";
const headWorker = baseline ? execFileSync("rtk", ["proxy", "git", "show", "HEAD:frontend/src/workers/pineNative.worker.ts"], { encoding: "utf8" }) : undefined;
const headPlugin = { name: "heikin-ashi173-before-source", setup(builder) {
  builder.onLoad({ filter: /[/\\]pineNative\.worker\.ts$/ }, args => ({ contents: headWorker, loader: "ts", resolveDir: new URL("../../frontend/src/workers/", import.meta.url).pathname }));
} };
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [...(baseline ? [headPlugin] : []), createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-heikin-ashi173.ts",
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";' } })).outputFiles[0].text;
console.info("HEIKIN_ASHI173_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  baselineHeadWorker: baseline, ...(baseline ? { workerSourceSha256: createHash("sha256").update(headWorker).digest("hex") } : {}),
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const candle = (i, base = 20) => {
  const open = base + i * .7 + [0, 5, -3, 2][i % 4], close = open + [3, -2, 4, -5][i % 4];
  return { time: origin + i * 60, open, high: Math.max(open, close) + 2 + i % 3,
    low: Math.min(open, close) - 1 - i % 2, close, volume: 10 + i };
};
const bars = Array.from({ length: 30 }, (_, i) => candle(i));
const metadata = (symbol = "BINANCE:BTCUSDT", timeframe = "1") => ({ symbol, timeframe, mintick: .01, pointvalue: 1,
  mincontract: .001, quantityStep: .001, currency: "USDT", basecurrency: symbol.includes("ETH") ? "ETH" : "BTC" });
const source = (body, version = 6) => `//@version=${version}\nindicator("Heikin Ashi173",dynamic_requests=true)\n${body}`;
const request = (body, { version = 6, chart = bars, context = metadata(), ...extra } = {}) => ({ id: "heikin-ashi173",
  action: "run", mode: "historical", source: source(body, version), inputs: {}, bars: chart, context, ...extra });
const run = (body, options) => pine.executePineRequest(request(body, options));
const values = (result, name) => { const plot = result.plots.find(item => item.name === name); assert.ok(plot, `Missing ${name}`); return plot.points.map(point => point.value); };
const tail = (result, name) => values(result, name).at(-1);
function numeric(actual, expected, label = "numeric output") {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, i) => expected[i] === null ? assert.equal(value, null, `${label}[${i}]`) :
    assert.ok(typeof value === "number" && Math.abs(value - expected[i]) <= Math.max(1, Math.abs(expected[i])) * 1e-11,
      `${label}[${i}] expected ${expected[i]}, received ${value}`));
}
// Independent recurrence, never imports the renderer/provider transformation.
function ha(raw) {
  const transformed = [];
  for (const bar of raw) {
    const previous = transformed.at(-1), close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = previous ? (previous.open + previous.close) / 2 : (bar.open + bar.close) / 2;
    transformed.push({ ...bar, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close) });
  }
  return transformed;
}
function aggregate(raw, minutes) {
  const grouped = new Map(), width = minutes * 60;
  for (const bar of raw) { const start = Math.floor(bar.time / width) * width; if (!grouped.has(start)) grouped.set(start, []); grouped.get(start).push(bar); }
  return [...grouped].flatMap(([time, group]) => group.length !== minutes || group.some((bar, i) => bar.time !== time + i * 60) ? [] :
    [{ time, open: group[0].open, high: Math.max(...group.map(bar => bar.high)), low: Math.min(...group.map(bar => bar.low)),
      close: group.at(-1).close, volume: group.reduce((total, bar) => total + bar.volume, 0) }]);
}
function carry(raw, transformed, minutes, field, gaps = false, lookahead = false) {
  return raw.map(bar => {
    const index = transformed.findLastIndex(target => lookahead ? target.time <= bar.time : target.time + minutes * 60 <= bar.time + 60);
    return index < 0 || gaps && transformed[index].time + minutes * 60 !== bar.time + 60 ? null : transformed[index][field];
  });
}
const fields = ["open", "high", "low", "close", "volume"];
const tupleBody = (symbol = "syminfo.tickerid", timeframe = '"1"') => `[o,h,l,c,v]=request.security(ticker.heikinashi(${symbol}),${timeframe},[open,high,low,close,volume])\n`
  + fields.map((field, i) => `plot(${["o", "h", "l", "c", "v"][i]},"HA ${field}")`).join("\n");

test("v5/v6 same timeframe OHLC follows recurrence without mutating underlying chart or standard requests", async () => {
  for (const version of [5, 6]) {
    const supplied = structuredClone(bars), before = structuredClone(supplied);
    const result = await run(tupleBody() + '\nplot(close,"Raw")\nplot(request.security(ticker.standard(ticker.heikinashi(syminfo.tickerid)),"1",close),"Standard")', { version, chart: supplied });
    for (const field of fields) numeric(values(result, "HA " + field), ha(bars).map(bar => bar[field]), field);
    numeric(values(result, "Raw"), bars.map(bar => bar.close)); numeric(values(result, "Standard"), bars.map(bar => bar.close));
    assert.deepEqual(supplied, before); assert.equal(result.audit.bars, bars.length);
  }
});

test("v5/v6 requested higher timeframe aggregates real OHLC before HA and obeys confirmed gaps and lookahead", async () => {
  const transformed = ha(aggregate(bars, 5));
  assert.notEqual(transformed[1].open, aggregate(ha(bars), 5)[1].open, "Fixture discriminates transform order");
  for (const version of [5, 6]) {
    const body = tupleBody("syminfo.tickerid", '"5"')
      + '\nplot(request.security(ticker.heikinashi(syminfo.tickerid),"5",close,gaps=barmerge.gaps_on),"Gaps")'
      + '\nplot(request.security(ticker.heikinashi(syminfo.tickerid),"5",open,lookahead=barmerge.lookahead_on),"Ahead")';
    const result = await run(body, { version });
    for (const field of fields) numeric(values(result, "HA " + field), carry(bars, transformed, 5, field), field);
    numeric(values(result, "Gaps"), carry(bars, transformed, 5, "close", true));
    numeric(values(result, "Ahead"), carry(bars, transformed, 5, "open", false, true));
  }
});

test("requested SMA and history references warm on transformed target candles, not chart candles", async () => {
  for (const version of [5, 6]) {
    const transformed = ha(aggregate(bars, 5));
    const expected = transformed.map((bar, i) => ({ ...bar, average: i ? (transformed[i - 1].close + bar.close) / 2 : null,
      prior: i ? transformed[i - 1].open : null }));
    const result = await run('[average,prior]=request.security(ticker.heikinashi(syminfo.tickerid),"5",[ta.sma(close,2),open[1]])\nplot(average,"Average")\nplot(prior,"Prior")', { version });
    numeric(values(result, "Average"), carry(bars, expected, 5, "average")); numeric(values(result, "Prior"), carry(bars, expected, 5, "prior"));
  }
});

test("v5/v6 lower timeframe arrays preserve full-history HA open recurrence across parent boundaries", async () => {
  for (const version of [5, 6]) {
    const chart = aggregate(bars, 5), transformed = ha(bars);
    const result = await run('[o,c,v]=request.security_lower_tf(ticker.heikinashi(syminfo.tickerid),"1",[open,close,volume])\nplot(array.size(o),"Count")\nplot(array.get(o,0),"First open")\nplot(array.get(o,4),"Last open")\nplot(array.sum(c),"Close sum")\nplot(array.sum(v),"Volume sum")',
      { version, chart, context: metadata(undefined, "5"), sourceSnapshot: { timeframe: "1", bars } });
    numeric(values(result, "Count"), chart.map(() => 5));
    numeric(values(result, "First open"), chart.map((_, i) => transformed[i * 5].open));
    numeric(values(result, "Last open"), chart.map((_, i) => transformed[i * 5 + 4].open));
    numeric(values(result, "Close sum"), chart.map((_, i) => transformed.slice(i * 5, i * 5 + 5).reduce((sum, bar) => sum + bar.close, 0)));
    numeric(values(result, "Volume sum"), chart.map((_, i) => bars.slice(i * 5, i * 5 + 5).reduce((sum, bar) => sum + bar.volume, 0)));
  }
});

test("authenticated cross-symbol snapshots transform ETH rather than chart BTC and keep own financial metadata", async () => {
  const remote = Array.from({ length: bars.length }, (_, i) => candle(i, 200));
  for (const version of [5, 6]) {
    const snapshots = [{ context: { ...metadata("BINANCE:ETHUSDT"), mintick: .05 }, requestedTimeframe: "1", bars: remote, asOf: origin + bars.length * 60 }];
    const before = structuredClone(snapshots);
    const result = await run(tupleBody('"ETHUSDT"') + '\nplot(request.security(ticker.heikinashi("ETHUSDT"),"1",syminfo.mintick),"Tick")\nplot(request.security("ETHUSDT","1",close),"Raw ETH")\nplot(close,"Raw BTC")',
      { version, marketData: { provider: "binance", snapshots } });
    for (const field of fields) numeric(values(result, "HA " + field), ha(remote).map(bar => bar[field]));
    numeric(values(result, "Tick"), bars.map(() => .05)); numeric(values(result, "Raw ETH"), remote.map(bar => bar.close));
    numeric(values(result, "Raw BTC"), bars.map(bar => bar.close)); assert.deepEqual(snapshots, before);
  }
});

let ordinal = 0;
async function startLive(body, version = 6, chart = bars.slice(0, 10)) {
  const executor = pine.createPineLiveExecutor(), sessionId = "heikin-ashi173-live-" + ++ordinal;
  try { const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
    request: { ...request(body, { version, chart }), id: sessionId + ":0", mode: "live" } });
    let sequence = 0;
    return { executor, initial, send: command => executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, ...command }) };
  } catch (error) { executor.dispose(); throw error; }
}

test("persistent HA recalculates an open candle from last confirmed HA, commits once, and leaves prior results immutable", async () => {
  for (const version of [5, 6]) {
    const history = bars.slice(0, 10), body = tupleBody() + '\nplot(close,"Raw")', session = await startLive(body, version, history);
    try {
      const before = structuredClone(session.initial);
      const high = { ...candle(10), close: 45, high: 48, low: 23, volume: 30 };
      const low = { ...high, close: 27, low: 22, volume: 31 };
      for (const received of [high, low]) {
        const result = await session.send({ action: "update", bar: received, confirmed: false });
        for (const field of fields) numeric(values(result, "HA " + field), ha([...history, received]).map(bar => bar[field]));
        assert.equal(tail(result, "Raw"), received.close);
      }
      const closed = await session.send({ action: "update", bar: low, confirmed: true });
      const next = { ...candle(11), open: 27, close: 31, high: 34, low: 26, volume: 1 };
      const appended = await session.send({ action: "update", bar: next, confirmed: false });
      for (const field of fields) numeric(values(appended, "HA " + field), ha([...history, low, next]).map(bar => bar[field]));
      numeric(values(closed, "HA close"), ha([...history, low]).map(bar => bar.close));
      assert.deepEqual(session.initial, before);
    } finally { session.executor.dispose(); }
  }
});

test("developing higher HA candle replaces intrabar values and confirms only after the last actual child", async () => {
  const session = await startLive(tupleBody("syminfo.tickerid", '"5"') + '\nplot(request.security(ticker.heikinashi(syminfo.tickerid),"5",close,gaps=barmerge.gaps_on),"Confirmed")');
  try {
    const history = bars.slice(0, 10), actual = [...history];
    for (let i = 10; i < 15; i++) {
      const bar = candle(i); actual.push(bar);
      const result = await session.send({ action: "update", bar, confirmed: true });
      const partial = actual.slice(10), grouped = { time: origin + 600, open: partial[0].open, high: Math.max(...partial.map(item => item.high)),
        low: Math.min(...partial.map(item => item.low)), close: partial.at(-1).close, volume: partial.reduce((sum, item) => sum + item.volume, 0) };
      const expected = ha([...aggregate(history, 5), grouped]).at(-1);
      for (const field of fields) numeric([tail(result, "HA " + field)], [expected[field]], field);
      numeric([tail(result, "Confirmed")], [i === 14 ? expected.close : null]);
    }
    numeric(values(session.initial, "HA close"), carry(history, ha(aggregate(history, 5)), 5, "close"));
  } finally { session.executor.dispose(); }
});

test("canonical HA identity, nested blank context and inherit preserve the transform while standard restores raw data", async () => {
  const remote = bars.map((_, i) => candle(i, 200));
  for (const version of [5, 6]) {
    const body = '[identity,kind,main,nested,standard]=request.security(ticker.heikinashi(syminfo.tickerid),"1",[syminfo.tickerid=="BINANCE:BTCUSDT;heikinashi"?1:0,chart.is_heikinashi?1:0,syminfo.main_tickerid=="BINANCE:BTCUSDT"?1:0,request.security("","",open),request.security(ticker.standard(syminfo.tickerid),"1",open)])'
      + '\nplot(identity+kind+main,"Identity")\nplot(nested,"Nested")\nplot(standard,"Standard")'
      + '\nplot(request.security("BINANCE:BTCUSDT;heikinashi","1",open),"Encoded")'
      + '\nplot(request.security(ticker.inherit(ticker.heikinashi(syminfo.tickerid),"BINANCE:ETHUSDT"),"1",open),"Inherited")';
    const result = await run(body, { version, marketData: { provider: "binance", snapshots: [{ context: metadata("BINANCE:ETHUSDT"),
      requestedTimeframe: "1", bars: remote, asOf: origin + bars.length * 60 }] } });
    numeric(values(result, "Identity"), bars.map(() => 3));
    numeric(values(result, "Nested"), ha(bars).map(bar => bar.open)); numeric(values(result, "Encoded"), ha(bars).map(bar => bar.open));
    numeric(values(result, "Standard"), bars.map(bar => bar.open)); numeric(values(result, "Inherited"), ha(remote).map(bar => bar.open));
  }
});

test("calc_bars_count slices only after full owned HA recurrence without inventing prior TA samples", async () => {
  const expected = ha(bars), last = expected.slice(-3);
  assert.notEqual(last[0].open, ha(bars.slice(-3))[0].open, "Recurrence seed discriminates a truncated transform");
  for (const version of [5, 6]) {
    const result = await run('[o,c,m]=request.security_lower_tf(ticker.heikinashi(syminfo.tickerid),"1",[open,close,ta.sma(close,2)],calc_bars_count=3)'
      + '\nplot(array.size(o),"Count")\nplot(array.size(o)>0?array.get(o,0):na,"Open")\nplot(array.size(c)>0?array.get(c,0):na,"Close")\nplot(array.size(m)>0?array.get(m,0):na,"SMA")', { version });
    numeric(values(result, "Count"), bars.map((_, i) => i >= 27 ? 1 : 0));
    numeric(values(result, "Open"), bars.map((_, i) => i >= 27 ? expected[i].open : null));
    numeric(values(result, "Close"), bars.map((_, i) => i >= 27 ? expected[i].close : null));
    numeric(values(result, "SMA"), bars.map((_, i) => i >= 28 ? (expected[i - 1].close + expected[i].close) / 2 : null));
  }
});

test("quiet ETH updates cannot execute main; sampled provisional HA rolls back and committed ETH carries its own recurrence", async () => {
  const remote = [0, 1, 2].map(i => candle(i, 200)), chart = bars.slice(0, 3);
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), sessionId = "heikin-ashi173-foreign-" + ++ordinal;
    let sequence = 0, remoteSequence = 0;
    const send = command => executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, ...command });
    const event = (bar, confirmed = false) => ({ symbol: "BINANCE:ETHUSDT", timeframe: "1", epoch: 7, sequence: ++remoteSequence,
      bar, confirmed, eventTime: confirmed ? (bar.time + 60) * 1000 - 1 : bar.time * 1000 + remoteSequence,
      closeTime: (bar.time + 60) * 1000 - 1 });
    try {
      const body = tupleBody('"ETHUSDT"') + '\nvarip int count=0\ncount+=1\nplot(count,"Main count")\nplot(close,"Raw BTC")';
      const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", marketStreams: [{ symbol: "BINANCE:ETHUSDT", timeframe: "1", epoch: 7 }],
        request: { ...request(body, { version, chart }), id: sessionId + ":0", mode: "live", marketData: { provider: "binance", snapshots: [
          { context: metadata("BINANCE:ETHUSDT"), requestedTimeframe: "1", bars: remote, asOf: origin + 180 }] } } });
      const before = structuredClone(initial), high = { ...candle(3, 200), close: 240, high: 245, low: 195, volume: 20 };
      const low = { ...high, close: 198, low: 194, volume: 21 };
      for (const [i, received] of [high, low].entries()) {
        const ack = await send({ action: "markets", events: [event(received)] });
        assert.equal(ack.kind, "market-update"); assert.equal(Object.hasOwn(ack, "plots"), false);
        const sampled = await send({ action: "update", bar: { ...candle(3), volume: 20 + i }, confirmed: false });
        for (const field of fields) numeric([tail(sampled, "HA " + field)], [ha([...remote, received]).at(-1)[field]], field);
        assert.equal(tail(sampled, "Main count"), 4 + i); assert.equal(tail(sampled, "Raw BTC"), candle(3).close);
      }
      await send({ action: "markets", events: [event(low, true)] });
      const next = { ...candle(4, 200), open: 198, close: 220, high: 225, low: 197, volume: 1 };
      await send({ action: "markets", events: [event(next)] });
      const sampled = await send({ action: "update", bar: { ...candle(3), volume: 22 }, confirmed: true });
      for (const field of fields) numeric([tail(sampled, "HA " + field)], [ha([...remote, low, next]).at(-1)[field]], field);
      assert.equal(tail(sampled, "Main count"), 6); assert.deepEqual(initial, before);
    } finally { executor.dispose(); }
  }
});

test("HA signals never replace chart prices used by the live strategy broker", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), sessionId = "heikin-ashi173-strategy-" + ++ordinal;
    const body = 'signal=request.security(ticker.heikinashi(syminfo.tickerid),"1",close)\nplot(signal,"HA")\nplot(close,"Raw")\nif bar_index==9 and signal>0\n    strategy.entry("Market",strategy.long,qty=1)';
    const script = `//@version=${version}\nstrategy("HA market fills173",initial_capital=10000,calc_on_every_tick=true)\n${body}`;
    try {
      const initial = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
        ...request(body, { chart: bars.slice(0, 10) }), id: sessionId + ":0", mode: "live", source: script } });
      assert.equal(initial.strategy.pendingOrders.length, 1);
      const received = { ...candle(10), close: 45, high: 48, low: 23, volume: 30 };
      const filled = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 1, action: "update", bar: received, confirmed: false });
      assert.equal(filled.strategy.openTrades.length, 1); assert.equal(filled.strategy.openTrades[0].entry_price, 45);
      assert.equal(filled.strategy.openTrades[0].entry_bar_index, 10); assert.equal(tail(filled, "Raw"), 45);
      numeric([tail(filled, "HA")], [ha([...bars.slice(0, 10), received]).at(-1).close]); assert.notEqual(tail(filled, "HA"), 45);
    } finally { executor.dispose(); }
  }
});

test("exact HA modifier does not authorize encoded sessions or unknown modifiers and missing ETH demands its underlying base", async () => {
  for (const symbol of ["BINANCE:BTCUSDT;heikinashi;session=extended", "BINANCE:BTCUSDT;renko", "BINANCE:BTCUSDT;heikinashi;bad", "BINANCE:BTCUSDT;heikinashi;heikinashi"]) {
    await assert.rejects(run(`plot(request.security("${symbol}","1",close),"Bad")`), error => error.code === "UNAVAILABLE_DATA");
  }
  await assert.rejects(run('plot(request.security(ticker.heikinashi("ETHUSDT"),"1",close),"Missing")', { marketData: { provider: "binance", snapshots: [] } }), error => {
    assert.equal(error.code, "MARKET_DATA_REQUIRED"); assert.deepEqual(JSON.parse(error.message), { symbol: "BINANCE:ETHUSDT", timeframe: "1" }); return true;
  });
  for (const method of ["security", "security_lower_tf"]) {
    const snapshots = [{ context: metadata("BINANCE:ETHUSDT"), requestedTimeframe: "1", bars: bars.map((_, i) => candle(i, 200)), asOf: origin + bars.length * 60 }];
    await assert.rejects(run(`requested=request.${method}(ticker.heikinashi("ETHUSDT"),"1",close,calc_bars_count=31,ignore_invalid_symbol=true)\nplot(close,"Raw")`,
      { marketData: { provider: "binance", snapshots } }), error => {
      assert.equal(error.code, "MARKET_DATA_REQUIRED"); assert.deepEqual(JSON.parse(error.message), { symbol: "BINANCE:ETHUSDT", timeframe: "1", calcBarsCount: 31, ignoreInvalidSymbol: true }); return true;
    });
    for (const version of [5, 6]) {
      const result = await run(`requested=request.${method}(ticker.heikinashi("ABSENTUSDT"),"1",close,ignore_invalid_symbol=true)\nplot(na(requested)?1:0,"Ignored")`,
        { version, marketData: { provider: "binance", snapshots: [], invalidSymbols: ["BINANCE:ABSENTUSDT"] } });
      numeric(values(result, "Ignored"), bars.map(() => 1));
    }
  }
});
