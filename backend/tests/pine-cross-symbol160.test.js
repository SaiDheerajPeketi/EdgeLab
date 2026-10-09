import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";', resolveDir: root, sourcefile: "pine-cross-symbol160.ts", loader: "ts" } })).outputFiles[0].text;
console.info("CROSS160_BINDING " + JSON.stringify({ minify: true, sealed: true, bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const start = 1700000100;
const bar = (index, close) => ({ time: start + index * 60, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 });
const bars = Array.from({ length: 10 }, (_, index) => bar(index, 10 + index));
const metadata = (symbol, extra = {}) => ({ symbol, timeframe: "1", mintick: .05, pointvalue: 2, mincontract: .002, quantityStep: .002, currency: "USDT", basecurrency: symbol.includes("ETH") ? "ETH" : "SOL", ...extra });
const snapshot = (symbol = "BINANCE:ETHUSDT", requestedTimeframe = "1", extra = {}) => ({ context: metadata(symbol), requestedTimeframe, bars: bars.map((item, index) => bar(index, 100 + index)), asOf: start + bars.length * 60, ...extra });
const request = (body, { version = 6, snapshots = [snapshot()], mode = "historical", marketData = { provider: "binance", snapshots }, inputs = {}, declaration = 'indicator("Cross160")', chart = bars, context = metadata("BINANCE:BTCUSDT", { mintick: .01, pointvalue: 1 }) } = {}) => ({ id: "cross160", action: "run", source: `//@version=${version}\n${declaration}\n${body}`, inputs, mode, bars: chart, context, ...(marketData === null ? {} : { marketData }) });
const run = (body, options) => pine.executePineRequest(request(body, options));
const values = (result, name = "Remote") => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const plot = expression => `plot(${expression},"Remote")`;

test("same-timeframe secondary prices and aliases use their own dataset in Pine v5/v6", async () => {
  for (const version of [5, 6]) for (const mode of ["historical", "live"]) {
    for (const symbol of ["BINANCE:ETHUSDT", "ETHUSDT", "binance:ethusdt"]) {
      const result = await run(plot(`request.security("${symbol}","1",close)`), { version, mode });
      assert.deepEqual(values(result), bars.map((_, index) => 100 + index));
    }
    const primary = await run(plot('request.security("BTCUSDT","1",close)'), { version, mode });
    assert.deepEqual(values(primary), bars.map(bar => bar.close));
  }
});

test("secondary syminfo and input-selected contexts retain requested instrument metadata", async () => {
  for (const version of [5, 6]) {
    const body = 'selected=input.symbol("ETHUSDT","Market")\n[price,tick,point,minimum]=request.security(selected,"1",[close,syminfo.mintick,syminfo.pointvalue,syminfo.mincontract])\nplot(price,"Remote")\nplot(tick,"Tick")\nplot(point,"Point")\nplot(minimum,"Minimum")';
    const result = await run(body, { version, inputs: { in_0: "BINANCE:ETHUSDT" } });
    assert.deepEqual(values(result), bars.map((_, index) => 100 + index));
    assert.deepEqual(values(result, "Tick"), bars.map(() => .05));
    assert.deepEqual(values(result, "Point"), bars.map(() => 2));
    assert.deepEqual(values(result, "Minimum"), bars.map(() => .002));
  }
});

test("foreign same-timeframe lower_tf arrays never return primary prices or fill missing periods", async () => {
  const remote = snapshot(), missing = remote.bars.filter((_, index) => index !== 2 && index !== 5);
  for (const version of [5, 6]) {
    const result = await run('children=request.security_lower_tf("ETHUSDT","1",close)\nplot(array.size(children),"Count")\nplot(array.size(children)>0?array.get(children,0):na,"Remote")', { version, snapshots: [{ ...remote, bars: missing }] });
    assert.deepEqual(values(result, "Count"), [1, 1, 0, 1, 1, 0, 1, 1, 1, 1]);
    assert.deepEqual(values(result), [100, 101, null, 103, 104, null, 106, 107, 108, 109]);
  }
});

test("secondary higher timeframe calculations preserve genuine grouping gaps and lookahead", async () => {
  for (const version of [5, 6]) {
    const source = snapshot("BINANCE:ETHUSDT", "5");
    for (const [gaps, lookahead, expected] of [["off", "off", [null, null, null, null, 104, 104, 104, 104, 104, 109]], ["on", "off", [null, null, null, null, 104, null, null, null, null, 109]], ["off", "on", [104, 104, 104, 104, 104, 109, 109, 109, 109, 109]]]) {
      const result = await run(plot(`request.security("ETHUSDT","5",close,gaps=barmerge.gaps_${gaps},lookahead=barmerge.lookahead_${lookahead})`), { version, snapshots: [source] });
      assert.deepEqual(values(result), expected);
    }
  }
});

test("secondary SMA and nested requests retain independently evaluated symbol contexts", async () => {
  for (const version of [5, 6]) {
    const sol = snapshot("BINANCE:SOLUSDT", "1", { bars: bars.map((_, index) => bar(index, 200 + index)) });
    const result = await run('read(string market)=>request.security(market,"1",ta.sma(close,2))\nplot(read("ETHUSDT"),"Remote")\nplot(request.security("ETHUSDT","1",request.security("SOLUSDT","1",close)),"Nested")', { version, snapshots: [snapshot(), sol] });
    assert.deepEqual(values(result), [null, ...Array.from({ length: 9 }, (_, index) => 100.5 + index)]);
    assert.deepEqual(values(result, "Nested"), bars.map((_, index) => 200 + index));
  }
});

test("requested ticker metadata keeps the original main chart identity across nested markets", async () => {
  for (const version of [5, 6]) {
    const sol = snapshot("BINANCE:SOLUSDT", "1");
    const expression = '[syminfo.tickerid=="BINANCE:ETHUSDT"?1:0,syminfo.main_tickerid=="BINANCE:BTCUSDT"?1:0,syminfo.type=="crypto"?1:0,request.security("SOLUSDT","1",syminfo.main_tickerid=="BINANCE:BTCUSDT" and syminfo.tickerid=="BINANCE:SOLUSDT"?1:0)]';
    const result = await run(`[own,main,kind,nested]=request.security("ETHUSDT","1",${expression})\nplot(own+main+kind+nested,"Remote")`, { version, snapshots: [snapshot(), sol] });
    assert.deepEqual(values(result), bars.map(() => 4));
  }
});

test("missing evaluated secondary context emits a canonical demand while unused names do not", async () => {
  const body = 'market=input.symbol("ETHUSDT","Market")\n' + plot('request.security(market,"5",close)');
  await assert.rejects(run(body, { snapshots: [], inputs: { in_0: "binance:ethusdt" } }), cause => {
    assert.equal(cause.code, "MARKET_DATA_REQUIRED");
    assert.deepEqual(JSON.parse(cause.message), { symbol: "BINANCE:ETHUSDT", timeframe: "5" });
    return true;
  });
  const unused = await run('unused="ETHUSDT"\nplot(close,"Remote")', { snapshots: [] });
  assert.deepEqual(values(unused), bars.map(bar => bar.close));
  const branch = await run('float remote=na\nif bar_index>100\n    remote:=request.security("ETHUSDT","1",close)\nplot(close,"Remote")', { snapshots: [], declaration: 'indicator("Cross160",dynamic_requests=true)' });
  assert.deepEqual(values(branch), bars.map(bar => bar.close));
});

test("unsupported exchanges modifiers and disabled aliases remain unavailable", async () => {
  for (const options of [{}, { marketData: null }]) for (const symbol of ["OTHER:ETHUSDT", "BINANCE:ETHUSDT;heikinashi", ...(options.marketData === null ? ["ETHUSDT"] : [])]) {
    await assert.rejects(run(plot(`request.security("${symbol}","1",close)`), options), cause => cause.code === "UNAVAILABLE_DATA");
  }
});

test("persistent secondary requests fail explicitly before stale historical prices can publish", async () => {
  const executor = pine.createPineLiveExecutor();
  try {
    const initial = request(plot('request.security("ETHUSDT","1",close)'), { mode: "live" });
    initial.id = "cross-symbol160-live:0";
    await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId: "cross-symbol160-live", sequence: 0, action: "start", request: initial }), cause => {
      assert.equal(cause.code, "UNAVAILABLE_DATA");
      assert.match(cause.message, /independently admitted live stream/);
      return true;
    });
  } finally { executor.dispose(); }
});

test("native calendar contexts use their own actual daily weekly and monthly candles", async () => {
  const monthStart = Date.UTC(2024, 0, 1) / 1000;
  for (const timeframe of ["1D", "1W", "1M"]) {
    const dates = Array.from({ length: 3 }, (_, index) => timeframe === "1M" ? Date.UTC(2024, index, 1) / 1000 : monthStart + index * (timeframe === "1W" ? 7 : 1) * 86400);
    const asOf = timeframe === "1M" ? Date.UTC(2024, 3, 1) / 1000 : dates[2] + (timeframe === "1W" ? 7 : 1) * 86400;
    const chart = dates.map((time, index) => ({ ...bar(index, 10 + index), time }));
    const remote = snapshot("BINANCE:ETHUSDT", timeframe, { context: metadata("BINANCE:ETHUSDT", { timeframe }), bars: chart.map((item, index) => ({ ...item, open: 99 + index, high: 102 + index, low: 98 + index, close: 100 + index })), asOf });
    const result = await run(plot(`request.security("ETHUSDT","${timeframe}",close)`), { chart, context: metadata("BINANCE:BTCUSDT", { timeframe }), snapshots: [remote] });
    assert.deepEqual(values(result), [100, 101, 102], timeframe);
  }
});

test("loaded empty secondary history returns unavailable values without manufacturing primary bars", async () => {
  const result = await run(plot('request.security("ETHUSDT","1",close)'), { snapshots: [snapshot("BINANCE:ETHUSDT", "1", { bars: [] })] });
  assert.deepEqual(values(result), bars.map(() => null));
});

test("evaluated calculation depth and ignore flag are forwarded in missing-context demands", async () => {
  for (const method of ["security", "security_lower_tf"]) {
    const body = `depth=input.int(10000,"Depth")\nrequested=request.${method}("ETHUSDT","1",close,calc_bars_count=depth,ignore_invalid_symbol=true)\nplot(close,"Remote")`;
    await assert.rejects(run(body, { snapshots: [], inputs: { in_0: 10000 } }), cause => {
      assert.equal(cause.code, "MARKET_DATA_REQUIRED");
      assert.deepEqual(JSON.parse(cause.message), { symbol: "BINANCE:ETHUSDT", timeframe: "1", calcBarsCount: 10000, ignoreInvalidSymbol: true });
      return true;
    });
  }
});

test("explicit depth requests a larger owned snapshot instead of silently reusing shorter history", async () => {
  for (const method of ["security", "security_lower_tf"]) {
    await assert.rejects(run(`requested=request.${method}("ETHUSDT","1",close,calc_bars_count=11,ignore_invalid_symbol=true)\nplot(close,"Remote")`), cause => {
      assert.equal(cause.code, "MARKET_DATA_REQUIRED");
      assert.deepEqual(JSON.parse(cause.message), { symbol: "BINANCE:ETHUSDT", timeframe: "1", calcBarsCount: 11, ignoreInvalidSymbol: true });
      return true;
    });
  }
  const result = await run(plot('request.security("ETHUSDT","1",close,calc_bars_count=10)'));
  assert.deepEqual(values(result), bars.map((_, index) => 100 + index));
});

test("only registered absent symbols may return scalar or tuple NA with ignore enabled", async () => {
  for (const version of [5, 6]) {
    const marketData = { provider: "binance", snapshots: [], invalidSymbols: ["BINANCE:ABSENTUSDT"] };
    for (const method of ["security", "security_lower_tf"]) {
      const scalar = await run(`requested=request.${method}("ABSENTUSDT","1",close,ignore_invalid_symbol=true)\nplot(na(requested)?1:0,"Remote")`, { version, marketData });
      assert.deepEqual(values(scalar), bars.map(() => 1));
      const tuple = await run(`[left,right]=request.${method}("ABSENTUSDT","1",[open,close],ignore_invalid_symbol=true)\nplot(na(left)?1:0,"Left")\nplot(na(right)?1:0,"Right")`, { version, marketData });
      assert.deepEqual(values(tuple, "Left"), bars.map(() => 1));
      assert.deepEqual(values(tuple, "Right"), bars.map(() => 1));
      await assert.rejects(run(`requested=request.${method}("ABSENTUSDT","1",close)\nplot(close,"Remote")`, { version, marketData }), cause => cause.code === "UNAVAILABLE_DATA");
      await assert.rejects(run(`requested=request.${method}("ETHUSDT","1",close,ignore_invalid_symbol=true)\nplot(close,"Remote")`, { version, marketData }), cause => cause.code === "MARKET_DATA_REQUIRED");
    }
  }
});
