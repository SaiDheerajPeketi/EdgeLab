import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false,
  target: "es2020", logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(),
    sourcefile: "pine-declaration-timeframe167.ts", contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";' } })).outputFiles[0].text;
console.info("DECLARATION_TIMEFRAME167_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
assert.equal(origin % 3600, 0);
const candle = (i, close = 10 + i) => ({ time: origin + i * 60, open: 9 + i, high: Math.max(12 + i, close),
  low: Math.min(8 + i, close), close, volume: 100 + i });
const bars = Array.from({ length: 180 }, (_, i) => candle(i));
const context = { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, declaration = 'indicator("Declaration167",timeframe="60")', version = 6, prelude = "") =>
  `//@version=${version}\n${prelude}${declaration}\n${body}`;
const request = (body, extra = {}) => {
  const { declaration, version, prelude, ...options } = extra;
  return { id: "declaration167", action: "run", mode: "historical", source: source(body, declaration, version, prelude),
    bars, context, inputs: {}, ...options };
};
const run = (body, extra) => pine.executePineRequest(request(body, extra));
const values = (result, name) => {
  const plot = result.plots.find(plot => plot.name === name); assert.ok(plot, `Missing actual plot ${name}`);
  const byTime = new Map(plot.points.map(point => [point.time, point.value]));
  return bars.map(bar => byTime.get(bar.time) ?? null);
};
const tail = (result, name) => result.plots.find(plot => plot.name === name).points.at(-1)?.value ?? null;

// Independent OHLCV grouping from authored minute timestamps; no production aggregation helper.
function complete(children, minutes) {
  const width = minutes * 60, grouped = new Map();
  for (const bar of children) {
    const start = Math.floor(bar.time / width) * width;
    if (!grouped.has(start)) grouped.set(start, []);
    grouped.get(start).push(bar);
  }
  return [...grouped].flatMap(([time, group]) => {
    if (group.length !== minutes || group.some((bar, i) => bar.time !== time + i * 60)) return [];
    return [{ time, end: time + width, open: group[0].open, high: Math.max(...group.map(bar => bar.high)),
      low: Math.min(...group.map(bar => bar.low)), close: group.at(-1).close, volume: group.reduce((sum, bar) => sum + bar.volume, 0) }];
  });
}
function merged(children, targets, expression, gaps = true) {
  return children.map(bar => {
    const index = targets.findLastIndex(target => target.end <= bar.time + 60);
    if (index < 0 || gaps && targets[index].end !== bar.time + 60) return null;
    return expression(targets[index], index);
  });
}
const sma = (targets, index, length) => index < length - 1 ? null :
  targets.slice(index - length + 1, index + 1).reduce((sum, bar) => sum + bar.close, 0) / length;
const hourly = complete(bars, 60);

test("v5/v6 hourly declaration calculates SMA on hour closes with default confirmed gaps", async () => {
  for (const version of [5, 6]) {
    const result = await run('plot(ta.sma(close,2),"Hourly SMA")', { version });
    assert.deepEqual(values(result, "Hourly SMA"), merged(bars, hourly, (_, i) => sma(hourly, i, 2)));
    assert.equal(values(result, "Hourly SMA")[119], (bars[59].close + bars[119].close) / 2);
    assert.equal(values(result, "Hourly SMA")[120], null);
    assert.equal(result.audit.bars, 180); assert.equal(result.source, source('plot(ta.sma(close,2),"Hourly SMA")', undefined, version));
  }
});

test("gaps false carries completed hourly SMA while source length overrides remain calculation-based", async () => {
  const body = 'length=input.int(2,"Length",minval=1,maxval=10)\nplot(ta.sma(close,length),"Hourly SMA")';
  for (const length of [2, 3]) {
    const result = await run(body, { declaration: 'indicator("Declaration167",timeframe="60",timeframe_gaps=false)', inputs: { in_0: length } });
    assert.deepEqual(values(result, "Hourly SMA"), merged(bars, hourly, (_, i) => sma(hourly, i, length), false));
    assert.equal(result.inputs.in_0, length);
    assert.notEqual(values(result, "Hourly SMA")[119], (bars[118].close + bars[119].close) / 2);
  }
});

test("hourly OHLCV time and bar index are calculated in the declaration context and main_period survives requests", async () => {
  const fields = ["open", "high", "low", "close", "volume", "time", "time_close", "bar_index"];
  const body = fields.map(field => `plot(${field},"${field}")`).join("\n")
    + '\nplot(timeframe.period=="60"?60:-1,"Period")\nplot(timeframe.main_period=="60"?60:-1,"Main period")'
    + '\nplot(request.security("CHART:TEST","120",timeframe.main_period=="60"?60:-1),"Requested main period")';
  const result = await run(body);
  for (const field of fields) {
    const expression = field === "time" ? target => target.time * 1000 : field === "time_close" ? target => target.end * 1000
      : field === "bar_index" ? (_, i) => i : target => target[field];
    assert.deepEqual(values(result, field), merged(bars, hourly, expression), field);
  }
  assert.deepEqual(values(result, "Period"), merged(bars, hourly, () => 60));
  assert.deepEqual(values(result, "Main period"), merged(bars, hourly, () => 60));
  assert.equal(values(result, "Requested main period")[119], 60);
});

test("empty declaration timeframe preserves chart calculations without adding synthetic gaps", async () => {
  for (const gaps of [true, false]) {
    const result = await run('plot(ta.sma(close,2),"Chart SMA")\nplot(timeframe.main_period=="1"?1:-1,"Main period")',
      { declaration: `indicator("Declaration167",timeframe="",timeframe_gaps=${gaps})` });
    assert.deepEqual(values(result, "Chart SMA"), bars.map((bar, i) => i ? (bars[i - 1].close + bar.close) / 2 : null));
    assert.deepEqual(values(result, "Main period"), bars.map(() => 1));
  }
});

test("constant aliases resolve declaration timeframe and gap behavior without source rewriting", async () => {
  const body = 'plot(close,"Hourly close")', prelude = 'const string CALC="60"\nconst bool GAPS=false\n';
  const result = await run(body, { prelude, declaration: 'indicator("Declaration167",timeframe=CALC,timeframe_gaps=GAPS)' });
  assert.deepEqual(values(result, "Hourly close"), merged(bars, hourly, target => target.close, false));
  assert.equal(result.source, source(body, 'indicator("Declaration167",timeframe=CALC,timeframe_gaps=GAPS)', 6, prelude));
});

test("Calculation inputs append stable IDs after authored inputs and change effective timeframe and gaps independently", async () => {
  const body = 'length=input.int(2,"Length",minval=1,maxval=10)\nenabled=input.bool(true,"Enable")\nplot(enabled?ta.sma(close,length):na,"Average")';
  const declaration = 'indicator("Declaration167",timeframe="60",timeframe_gaps=false)';
  const prepared = await run(body, { declaration, action: "prepare" });
  assert.deepEqual(prepared.inputDefinitions.map(item => [item.id, item.type, item.title, item.defval, item.group]), [
    ["in_0", "int", "Length", 2, undefined], ["in_1", "bool", "Enable", true, undefined],
    ["in_2", "timeframe", "Timeframe", "60", "Calculation"], ["in_3", "bool", "Wait for timeframe closes", false, "Calculation"],
  ]);
  const halfHours = complete(bars, 30), inputs = { in_0: 3, in_1: true, in_2: "30", in_3: true };
  const result = await run(body, { declaration, inputs });
  assert.deepEqual(result.inputs, inputs);
  assert.deepEqual(values(result, "Average"), merged(bars, halfHours, (_, i) => sma(halfHours, i, 3)));
  const disabled = await run(body, { declaration, inputs: { ...inputs, in_1: false } });
  assert.deepEqual(values(disabled, "Average"), bars.map(() => null));
  const onlyTimeframe = await run('plot(close,"Close")', { action: "prepare" });
  assert.deepEqual(onlyTimeframe.inputDefinitions.map(item => [item.id, item.title]), [["in_0", "Timeframe"]]);
  const empty = await run('plot(close,"Close")', { action: "prepare", declaration: 'indicator("Declaration167",timeframe="")' });
  assert.equal(empty.inputDefinitions[0].defval, "");
  const omitted = await run('length=input.int(2,"Length")\nplot(close,"Close")', { action: "prepare", declaration: 'indicator("Declaration167")' });
  assert.deepEqual(omitted.inputDefinitions.map(item => item.id), ["in_0"]);
});

test("generated Calculation inputs respect the existing combined 24-input capacity", async () => {
  const authored = count => Array.from({ length: count }, (_, i) => `a${i}=input.int(${i},"Authored ${i}")`).join("\n") + '\nplot(close,"Close")';
  const declaration = 'indicator("Declaration167",timeframe="60",timeframe_gaps=true)';
  const admitted = await run(authored(22), { action: "prepare", declaration });
  assert.equal(admitted.inputDefinitions.length, 24); assert.equal(admitted.inputDefinitions[22].id, "in_22"); assert.equal(admitted.inputDefinitions[23].id, "in_23");
  await assert.rejects(run(authored(23), { action: "prepare", declaration }), error => error.code === "INPUT_LIMIT");
});

test("declared lower timeframe uses actual source children and always publishes the last intrabar", async () => {
  const children = bars.slice(0, 20), chart = complete(children, 5).map(({ end, ...bar }) => bar);
  for (const gaps of [true, false]) {
    const result = await run('plot(ta.sma(close,2),"Minute SMA")', { declaration: `indicator("Declaration167",timeframe="1",timeframe_gaps=${gaps})`,
      bars: chart, context: { ...context, timeframe: "5" }, sourceSnapshot: { timeframe: "1", bars: children } });
    const byTime = new Map(result.plots.find(plot => plot.name === "Minute SMA").points.map(point => [point.time, point.value]));
    assert.deepEqual(chart.map(bar => byTime.get(bar.time)), [4, 9, 14, 19].map(i => (children[i - 1].close + children[i].close) / 2));
  }
});

test("calendar calculation uses actual leap-month and Monday-week boundaries rather than fixed month lengths", async () => {
  const days = Array.from({ length: 60 }, (_, i) => ({ ...candle(i), time: origin + i * 86400 }));
  const monthly = await run('plot(close,"Close")\nplot(volume,"Volume")\nplot(ta.sma(close,2),"SMA")\nplot(bar_index,"Index")', {
    declaration: 'indicator("Declaration167",timeframe="1M")', bars: days, context: { ...context, timeframe: "1D" } });
  const expected = {
    Close: days.map((_, i) => i === 30 ? days[30].close : i === 59 ? days[59].close : null),
    Volume: days.map((_, i) => i === 30 ? days.slice(0, 31).reduce((sum, day) => sum + day.volume, 0)
      : i === 59 ? days.slice(31).reduce((sum, day) => sum + day.volume, 0) : null),
    SMA: days.map((_, i) => i === 59 ? (days[30].close + days[59].close) / 2 : null),
    Index: days.map((_, i) => i === 30 ? 0 : i === 59 ? 1 : null),
  };
  for (const [name, series] of Object.entries(expected)) {
    const points = new Map(monthly.plots.find(plot => plot.name === name).points.map(point => [point.time, point.value]));
    assert.deepEqual(days.map(day => points.get(day.time) ?? null), series, name);
  }
  assert.equal(days[59].time, Date.UTC(2024, 1, 29) / 1000);
  assert.equal(monthly.audit.bars, 60);
  const fortnight = days.slice(0, 14), weekly = await run('plot(close,"Close")', {
    declaration: 'indicator("Declaration167",timeframe="1W")', bars: fortnight, context: { ...context, timeframe: "1D" } });
  const points = new Map(weekly.plots[0].points.map(point => [point.time, point.value]));
  assert.deepEqual(fortnight.map(day => points.get(day.time) ?? null), fortnight.map((_, i) => i === 6 || i === 13 ? fortnight[i].close : null));
});

test("explicit calculation timeframe rejects drawing and alert side effects including helper and dead branches", async () => {
  const forbidden = [
    'line.new(bar_index,close,bar_index+1,close)',
    'var table t=table.new(position.top_right,1,1)',
    'f()=>label.new(bar_index,close,"Label")\nif false\n    f()',
    'if false\n    alert("Forbidden",alert.freq_once_per_bar)',
  ];
  for (const timeframe of ["60", ""]) for (const code of forbidden)
    await assert.rejects(run(code + '\nplot(close,"Price")', { action: "prepare", declaration: `indicator("Declaration167",timeframe="${timeframe}")` }),
      error => /timeframe/i.test(error.message) && /drawing|side.effect|alert/i.test(error.message));
});

test("alertcondition remains permitted and orphan timeframe_gaps or malformed timeframes fail explicitly", async () => {
  const result = await run('alertcondition(close>open,"Signal","Signal")\nplot(close,"Price")');
  assert.deepEqual(values(result, "Price"), merged(bars, hourly, target => target.close));
  for (const declaration of ['indicator("Declaration167",timeframe_gaps=false)', 'indicator("Declaration167",timeframe="garbage")'])
    await assert.rejects(run('plot(close,"Price")', { action: "prepare", declaration }), error => /timeframe/i.test(error.message));
});

for (const gaps of [true, false]) test(`actual live updates preserve declaration rollback and confirm at its own 3-minute boundary, gaps=${gaps}`, async () => {
  const body = 'var int ordinary=0\nvarip int ticks=0\nordinary+=1\nticks+=1\nplot(ordinary,"Ordinary")\nplot(ticks,"Ticks")\nplot(ta.sma(close,2),"SMA",color=close%2==0?"#ff0000":"#0000ff")\nplot(barstate.isconfirmed?1:0,"Confirmed")';
  const executor = pine.createPineLiveExecutor(), sessionId = "declaration167-live-" + gaps, liveBars = bars.slice(0, 9);
  let sequence = 0;
  try {
    const warm = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
      ...request(body, { declaration: `indicator("Declaration167",timeframe="3",timeframe_gaps=${gaps})`, bars: liveBars, mode: "live" }), id: sessionId + ":0" } });
    assert.equal(tail(warm, "Ordinary"), 3); assert.equal(tail(warm, "Ticks"), 3);
    const send = async (minute, close, confirmed) => executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence,
      action: "update", bar: candle(minute, close), confirmed });
    const updates = [[9, 40, false], [9, 41, false], [9, 42, true], [10, 43, false], [10, 44, true], [11, 45, false], [11, 46, true]];
    for (let i = 0; i < updates.length; i++) {
      const result = await send(...updates[i]), targetClosed = i === updates.length - 1;
      const visible = !gaps || targetClosed;
      assert.equal(tail(result, "Ordinary"), visible ? 4 : null);
      assert.equal(tail(result, "Ticks"), visible ? 4 + i : null);
      assert.equal(tail(result, "Confirmed"), visible ? Number(targetClosed) : null);
      assert.equal(tail(result, "SMA"), visible ? (liveBars.at(-1).close + updates[i][1]) / 2 : null);
      if (!gaps && i >= 3) {
        const frozen = result.plots.find(plot => plot.name === "SMA").points.find(point => point.time === origin + 9 * 60);
        assert.ok(frozen); assert.equal(frozen.value, (18 + 42) / 2); assert.equal(frozen.options.color, "#ff0000");
        const ticks = result.plots.find(plot => plot.name === "Ticks").points.find(point => point.time === origin + 9 * 60);
        assert.equal(ticks.value, 6);
      }
    }
    const next = await send(12, 47, false);
    assert.equal(tail(next, "Ordinary"), gaps ? null : 5); assert.equal(tail(next, "Ticks"), gaps ? null : 11);
    assert.equal(tail(next, "SMA"), gaps ? null : (46 + 47) / 2);
    if (!gaps) {
      const frozen = next.plots.find(plot => plot.name === "SMA").points.find(point => point.time === origin + 9 * 60);
      assert.equal(frozen.value, (18 + 42) / 2); assert.equal(frozen.options.color, "#ff0000");
    }
    assert.equal(tail(warm, "Ordinary"), 3); assert.equal(tail(warm, "Ticks"), 3);
  } finally { executor.dispose(); }
});

test("a genuine partial target seed waits for the first actual primary update without inventing startup varip execution", async () => {
  const body = 'var int ordinary=0\nvarip int ticks=0\nordinary+=1\nticks+=1\nplot(ordinary,"Ordinary")\nplot(ticks,"Ticks")\nplot(ta.sma(close,2),"SMA")';
  const executor = pine.createPineLiveExecutor(), sessionId = "declaration167-partial-seed";
  try {
    const warm = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
      ...request(body, { declaration: 'indicator("Declaration167",timeframe="3",timeframe_gaps=false)', bars: bars.slice(0, 8), mode: "live" }), id: sessionId + ":0" } });
    assert.equal(tail(warm, "Ordinary"), 2); assert.equal(tail(warm, "Ticks"), 2); assert.equal(tail(warm, "SMA"), (12 + 15) / 2);
    let sequence = 0;
    for (const [minute, close, confirmed, ordinary, ticks] of [[8, 30, false, 3, 3], [8, 31, false, 3, 4], [8, 32, true, 3, 5], [9, 33, false, 4, 6]]) {
      const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, action: "update", bar: candle(minute, close), confirmed });
      assert.equal(tail(result, "Ordinary"), ordinary); assert.equal(tail(result, "Ticks"), ticks);
      assert.equal(tail(result, "SMA"), ((minute === 9 ? 32 : 15) + close) / 2);
    }
    assert.equal(tail(warm, "Ticks"), 2);
  } finally { executor.dispose(); }
});

test("custom box types and selected namespace receiver methods are not falsely treated as drawing side effects", async () => {
  const typed = 'type box\n    float price\ncurrent=box.new(close)\ncopied=box.copy(current)\ncopied.price+=100\nplot(current.price,"Original")\nplot(copied.price,"Copy")';
  for (const version of [5, 6]) {
    const result = await run(typed, { version });
    assert.deepEqual(values(result, "Original"), merged(bars, hourly, target => target.close));
    assert.deepEqual(values(result, "Copy"), merged(bars, hourly, target => target.close + 100));
    assert.equal(result.boxes?.length ?? 0, 0);
  }
  const receiver = 'type Cell\n    float price\nmethod read(Cell box)=>box.price+7\nCell box=Cell.new(close)\nplot(box.read(),"Method")';
  const valid = await run(receiver, { version: 5 });
  assert.deepEqual(values(valid, "Method"), merged(bars, hourly, target => target.close + 7));
  await assert.rejects(run(receiver, { version: 6, action: "prepare" }), error =>
    error.code === "COMPILE_ERROR" && /namespace|shadow|obscur/i.test(error.message) && !/drawing objects/i.test(error.message));
});

test("scoped same-name mutations cannot invalidate a constant global timeframe but explicit nonconstant qualifiers fail", async () => {
  const prelude = 'const string TF="60"\n';
  const bodies = [
    'local()=>\n    string TF="1"\n    TF:="2"\n    TF\nplot(close,"Close")\nplot(local()=="2"?2:-1,"Local")',
    // Parameters cannot be reassigned in Pine; the same-name formal only shadows the global.
    'local(string TF)=>\n    int result=TF=="1"?1:0\n    result+=1\n    result\nplot(close,"Close")\nplot(local("1"),"Local")',
  ];
  for (const body of bodies) {
    const result = await run(body, { prelude, declaration: 'indicator("Declaration167",timeframe=TF)' });
    assert.deepEqual(values(result, "Close"), merged(bars, hourly, target => target.close));
    assert.deepEqual(values(result, "Local"), merged(bars, hourly, () => 2), body);
  }
  for (const qualifier of ["simple", "series"]) for (const version of [5, 6])
    await assert.rejects(run('plot(close,"Close")', { action: "prepare", version,
      prelude: `${qualifier} string TF="60"\n`, declaration: 'indicator("Declaration167",timeframe=TF)' }),
    error => error.code === "COMPILE_ERROR" && /timeframe.*constant/i.test(error.message));
  await assert.rejects(run('if true\n    TF:="1"\n    string TF="2"\nplot(close,"Close")', {
    action: "prepare", prelude: 'string TF="60"\n', declaration: 'indicator("Declaration167",timeframe=TF)',
  }), error => error.code === "COMPILE_ERROR" && /timeframe.*constant/i.test(error.message));
});

test("gaps publication requires an actual closing display candle and never shifts into the following sparse candle", async () => {
  const children = bars.slice(0, 18), chart = complete(children, 2).filter(bar => bar.time !== origin + 10 * 60).map(({ end, ...bar }) => bar);
  const targets = complete(children, 3);
  for (const gaps of [true, false]) {
    const result = await run('plot(close,"Close")', {
      declaration: `indicator("Declaration167",timeframe="3",timeframe_gaps=${gaps})`, bars: chart,
      context: { ...context, timeframe: "2" }, sourceSnapshot: { timeframe: "1", bars: children } });
    const points = new Map(result.plots[0].points.map(point => [point.time, point.value]));
    const expected = chart.map(bar => {
      const index = targets.findLastIndex(target => target.end <= bar.time + 120);
      if (index < 0 || gaps && targets[index].end <= bar.time) return null;
      return targets[index].close;
    });
    assert.deepEqual(chart.map(bar => points.get(bar.time) ?? null), expected);
    assert.equal(points.get(origin + 12 * 60), gaps ? null : children[11].close);
    assert.equal(result.audit.bars, chart.length);
  }
});
