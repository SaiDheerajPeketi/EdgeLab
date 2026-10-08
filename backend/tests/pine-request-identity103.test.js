import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  target: "es2020", write: false, logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";',
    resolveDir: root, sourcefile: "pine-request-identity103.ts", loader: "ts" },
})).outputFiles[0].text;
console.info("REQUEST103_BINDING " + JSON.stringify({ minify: true, sealed: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const closes = [10, 11, 12, 13, 14, 15];
const bar = (index, close) => ({ time: 1700000040 + index * 60,
  open: close - 1, high: close + 1, low: close - 2, close, volume: 10 });
const bars = closes.map((close, index) => bar(index, close));
const context = { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, version = 6, declaration = 'indicator("Identity103")') =>
  "//@version=" + version + "\n" + declaration + "\n" + body;
const request = (body, { version = 6, inputs = {}, mode = "historical", action = "run", declaration } = {}) =>
  ({ id: "identity103", action, source: source(body, version, declaration), inputs, mode,
    ...(action === "run" ? { bars, context } : {}) });
const execute = (body, options) => pine.executePineRequest(request(body, options));
const values = (result, name = "Remote") => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const failure = cause => {
  assert.equal(cause.code, "UNAVAILABLE_DATA", cause.message);
  assert.match(cause.message, /loaded|available|request|ticker/i);
  return true;
};
const security = (symbol, timeframe = '"1"', extra = "") =>
  'plot(request.security(' + symbol + "," + timeframe + ",close" + extra + '),"Remote")';

test("exact exchange-qualified and empty chart identities retain genuine v5/v6 snapshot prices", async () => {
  for (const version of [5, 6]) for (const mode of ["historical", "live"]) {
    for (const [symbol, timeframe] of [['"CHART:TEST"', '"1"'], ['""', '""'],
      ["syminfo.tickerid", "timeframe.period"], ['"chart:test"', '"1"']]) {
      const result = await execute(security(symbol, timeframe), { version, mode });
      assert.deepEqual(values(result), closes);
      assert.equal(result.source, source(security(symbol, timeframe), version));
    }
  }
});

test("another exchange sharing the chart ticker cannot publish chart prices", async () => {
  for (const version of [5, 6]) for (const mode of ["historical", "live"])
    for (const symbol of ['"OTHER:TEST"', '"TEST"'])
      await assert.rejects(execute(security(symbol), { version, mode }), failure);
});

test("cross-exchange aliases and same/lower/higher requests all fail unavailable", async () => {
  for (const version of [5, 6]) {
    for (const timeframe of ['"1"', '""', '"30S"', '"5"', '"60"', '"D"'])
      await assert.rejects(execute('requested="OTHER:TEST"\nalias=requested\n' + security("alias", timeframe), { version }), failure);
    for (const symbol of ["OTHER:TEST", "OTHER:ELSE"]) for (const timeframe of ["1", "30S"])
      await assert.rejects(execute('remote=request.security_lower_tf("' + symbol + '","' + timeframe + '",close)\nplot(array.size(remote),"Size")', { version }), failure);
  }
});

test("same symbol higher/lower data is unavailable without an owned additional snapshot", async () => {
  for (const version of [5, 6]) {
    for (const timeframe of ['"30S"', '"5"', '"D"'])
      await assert.rejects(execute(security('"CHART:TEST"', timeframe), { version }), failure);
  }
});

test("native saved input IDs preserve selection and reject mismatched overrides", async () => {
  for (const version of [5, 6]) {
    const body = 'chosen=input.symbol("CHART:TEST","Requested symbol")\ntf=input.timeframe("1","Requested timeframe")\n' + security("chosen", "tf");
    const prepared = await execute(body, { version, action: "prepare" });
    assert.deepEqual(prepared.inputDefinitions.map(item => [item.id, item.defval]), [["in_0", "CHART:TEST"], ["in_1", "1"]]);
    assert.equal(prepared.source, source(body, version));
    const saved = JSON.parse(JSON.stringify({ in_0: "CHART:TEST", in_1: "1" }));
    const same = await execute(body, { version, inputs: saved });
    assert.deepEqual(same.inputs, saved); assert.deepEqual(values(same), closes);
    for (const inputs of [{ ...saved, in_0: "OTHER:TEST" }, { ...saved, in_1: "5" }])
      await assert.rejects(execute(body, { version, inputs }), failure);
  }
});

test("named arguments and ignore-invalid options never admit foreign chart prices", async () => {
  for (const version of [5, 6]) {
    const bodies = [
      'plot(request.security(expression=close,timeframe="1",symbol="OTHER:TEST"),"Remote")',
      security('"OTHER:TEST"', '"1"', ",ignore_invalid_symbol=true"),
      security('"OTHER:TEST"', '"1"', ",barmerge.gaps_off,barmerge.lookahead_on,true"),
      'remote=request.security_lower_tf(symbol="OTHER:TEST",timeframe="30S",expression=close,ignore_invalid_symbol=true,ignore_invalid_timeframe=true)\nplot(array.size(remote),"Size")',
    ];
    for (const body of bodies) await assert.rejects(execute(body, { version }), failure);
  }
});

test("ordinary functions custom methods and nested requests cannot bypass identity checks", async () => {
  for (const version of [5, 6]) {
    for (const body of [
      'read(string requested)=>request.security(requested,"1",close)\nplot(read("OTHER:TEST"),"Remote")',
      'method read(string requested)=>request.security(requested,"1",close)\nchosen="OTHER:TEST"\nplot(chosen.read(),"Remote")',
      'inner=request.security("OTHER:TEST","1",close)\nplot(request.security("CHART:TEST","1",inner),"Remote")',
      'plot(request.security("CHART:TEST","1",request.security("OTHER:TEST","1",close)),"Remote")',
    ]) await assert.rejects(execute(body, { version }), failure);
    const same = await execute('read(string requested)=>request.security(requested,"1",close)\nplot(read("CHART:TEST"),"Remote")', { version });
    assert.deepEqual(values(same), closes);
  }
});

test("standard ticker constructors preserve full exchange identity", async () => {
  for (const version of [5, 6]) {
    for (const symbol of ['ticker.new("CHART","TEST")', 'ticker.standard(syminfo.tickerid)', 'ticker.inherit(syminfo.tickerid,"CHART:TEST")', 'ticker.standard(ticker.heikinashi(syminfo.tickerid))', 'ticker.standard(ticker.renko(syminfo.tickerid,"ATR",10))']) {
      assert.deepEqual(values(await execute(security(symbol), { version })), closes);
    }
    for (const symbol of ['ticker.new("OTHER","TEST")', 'ticker.standard("OTHER:TEST")', 'ticker.inherit(syminfo.tickerid,"OTHER:TEST")'])
      await assert.rejects(execute(security(symbol), { version }), failure);
  }
});

test("nonstandard chart and encoded session/adjustment requests never substitute ordinary candles", async () => {
  for (const version of [5, 6]) for (const symbol of [
    'ticker.heikinashi(syminfo.tickerid)', 'ticker.renko(syminfo.tickerid,"ATR",10)',
    'ticker.kagi(syminfo.tickerid,1)', 'ticker.linebreak(syminfo.tickerid,3)',
    'ticker.pointfigure(syminfo.tickerid,"close","Traditional",1,3)',
    'ticker.new("CHART","TEST",session.extended)',
    'ticker.modify(syminfo.tickerid,adjustment=adjustment.dividends)',
  ]) await assert.rejects(execute(security(symbol), { version }), failure);
});

test("unused nonstandard tickers remain ordinary values without requesting unavailable data", async () => {
  for (const version of [5, 6]) {
    const result = await execute('unrequested=ticker.renko(syminfo.tickerid,"ATR",10)\nunused=ticker.heikinashi(syminfo.tickerid)\nplot(close,"Remote")', { version });
    assert.deepEqual(values(result), closes);
  }
});

let ordinal = 0;
const start = (body, version) => {
  const sessionId = "request-identity103-" + ++ordinal;
  return { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
    request: { ...request(body, { version, mode: "live" }), id: sessionId + ":0" } };
};
const update = (initial, sequence, close, confirmed = false) => ({
  protocol: "pine-live-v1", sessionId: initial.sessionId, sequence, action: "update", bar: bar(6, close), confirmed,
});
test("persistent same-chart requests reflect provisional ticks rollback and confirmation without stale prices", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor(), initial = start(security("syminfo.tickerid", "timeframe.period"), version);
    try {
      assert.deepEqual(values(await executor.execute(initial)), closes);
      assert.deepEqual(values(await executor.execute(update(initial, 1, 20))), [...closes, 20]);
      assert.deepEqual(values(await executor.execute(update(initial, 2, 21))), [...closes, 21]);
      assert.deepEqual(values(await executor.execute(update(initial, 3, 22, true))), [...closes, 22]);
    } finally { executor.dispose(); }
  }
});

test("persistent requests validate later dynamic symbols before a provisional result can publish", async () => {
  for (const version of [5, 6]) {
    const executor = pine.createPineLiveExecutor();
    const initial = start('chosen=close>20?"OTHER:TEST":"CHART:TEST"\n' + security("chosen"), version);
    try {
      assert.deepEqual(values(await executor.execute(initial)), closes);
      assert.deepEqual(values(await executor.execute(update(initial, 1, 20))), [...closes, 20]);
      await assert.rejects(executor.execute(update(initial, 2, 21)), failure);
      await assert.rejects(executor.execute(update(initial, 3, 22)), cause => {
        assert.equal(cause.code, "LIVE_SESSION_HALTED"); return true;
      });
    } finally { executor.dispose(); }
  }
});

test("mismatched requests cannot publish strategy orders or profits", async () => {
  for (const version of [5, 6]) {
    const body = 'remote=request.security("OTHER:TEST","1",close)\nif bar_index==0\n    strategy.entry("Foreign",strategy.long,qty=remote)\nplot(remote,"Remote")';
    await assert.rejects(execute(body, { version, declaration: 'strategy("No foreign prices",initial_capital=1000)' }), failure);
    const valid = body.replace('"OTHER:TEST"', '"CHART:TEST"');
    const result = await execute(valid, { version, declaration: 'strategy("Owned prices",initial_capital=1000)' });
    assert.equal(result.strategy.openTrades.length, 1);
    assert.equal(result.strategy.openTrades[0].size, 10);
  }
});
