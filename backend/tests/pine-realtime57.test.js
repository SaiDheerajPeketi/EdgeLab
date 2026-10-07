import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Actual minified engine; only the provider's observed market snapshots change.
const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = (await build({
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "silent",
  plugins: [createPineEnginePlugin()],
  stdin: {
    contents: 'export { PineTS, Series } from "pinets";',
    loader: "ts",
    resolveDir: root,
    sourcefile: "pine-realtime57-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-realtime57-minified.mjs\n";
const { PineTS, Series } = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (value) => createHash("sha256").update(value).digest("hex");
if (process.env.EDGELAB_PINE_ENGINE_RECEIPT === "1") {
  const bytes = fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url));
  const manifest = JSON.parse(bytes.toString());
  console.info("ENGINE_BINDING " + JSON.stringify({
    version: manifest.version,
    patch: manifest.patch,
    minify: true,
    manifestSha256: sha(bytes),
    sourceMapSha256: manifest.sourceMapSha256,
    bundleSha256: sha(bundle),
    bundleBytes: Buffer.byteLength(bundle),
  }));
}

const script = (body) => `//@version=6\nindicator("Bounded realtime oracle")\n${body}`;
const candle = (index, close) => ({
  openTime: 1_700_000_000_000 + index * 60_000,
  // Explicit events, rather than the clock, determine realtime confirmation.
  closeTime: Date.now() + 3_600_000,
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume: 10,
});

function fixture(source, options, closes = [10, 20, 30, 40]) {
  const bars = closes.map((close, index) => candle(index, close));
  const requests = [];
  const provider = {
    configure() {},
    async getMarketData(symbol, timeframe, limit, start, end) {
      requests.push({ symbol, timeframe, limit, start, end });
      let selected = bars.filter((bar) => (start === undefined || bar.openTime >= start) && (end === undefined || bar.openTime <= end));
      if (limit !== undefined) selected = selected.slice(-limit);
      return selected.map((bar) => ({ ...bar }));
    },
    async getSymbolInfo() {
      return { tickerid: "TEST", ticker: "TEST", timezone: "UTC", session: "24x7", currency: "USD", mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1 };
    },
  };
  const engine = new PineTS(provider, "TEST", "1", bars.length);
  engine.setRealtimeMode(true, options);
  let context;
  return {
    engine,
    requests,
    get context() { return context; },
    async start() {
      context = await engine.run(source);
      return this;
    },
    async tick(close, confirmed = false) {
      bars[bars.length - 1] = candle(bars.length - 1, close);
      return engine.updateTail(context, { confirmed });
    },
    async append(close) {
      bars.push(candle(bars.length, close));
      return engine.updateTail(context, { confirmed: false });
    },
    stats() { return engine.getRealtimeStats(context); },
  };
}
const run = async (source, options, closes) => fixture(source, options, closes).start();
const values = (context, name) => context.plots[name].data.map((point) => point.value);
const tail = (context, name) => values(context, name).at(-1);
const past = (context) => Object.fromEntries(Object.entries(context.plots).filter(([name]) => !name.startsWith("__")).map(([name, plot]) => [name, structuredClone(plot.data)]));
function unchanged(context, history) {
  for (const [name, points] of Object.entries(history)) assert.deepEqual(context.plots[name].data.slice(0, points.length), points, `${name} committed prefix`);
}
function stateLimit(cause) {
  assert.equal(cause.code, "REALTIME_STATE_LIMIT", `${cause.name}: ${cause.message}`);
  return true;
}
async function halted(run) {
  const reads = run.requests.length;
  const plots = structuredClone(run.context.plots);
  await assert.rejects(run.tick(41), /halted/);
  assert.equal(run.requests.length, reads, "halted context does not fetch another provider snapshot");
  assert.deepEqual(run.context.plots, plots, "halted outputs remain unchanged");
}

const flags = `var int ordinary=0
varip int ticks=0
ordinary+=1
ticks+=1
plot(ordinary,"Ordinary")
plot(ticks,"Ticks")
plot(barstate.ishistory,"Historical")
plot(barstate.isrealtime,"Realtime")
plot(barstate.isnew,"New")
plot(barstate.isconfirmed,"Confirmed")
plot(barstate.islastconfirmedhistory,"Last historical")`;

test("historical initial tail executes every supplied bar once and appends the first real open bar", async () => {
  for (const closes of [[10], [10, 20, 30, 40]]) {
    const session = await run(script(flags), { initialTail: "historical" }, closes);
    const count = closes.length;
    assert.deepEqual(values(session.context, "Ordinary"), closes.map((_, index) => index + 1));
    assert.deepEqual(values(session.context, "Ticks"), closes.map((_, index) => index + 1));
    for (const name of ["Historical", "New", "Confirmed"]) assert.deepEqual(values(session.context, name), closes.map(() => true));
    assert.deepEqual(values(session.context, "Realtime"), closes.map(() => false));
    assert.deepEqual(values(session.context, "Last historical"), closes.map((_, index) => index === count - 1));
    const history = past(session.context);
    assert.equal(await session.append(50), true);
    assert.equal(tail(session.context, "Ordinary"), count + 1);
    assert.equal(tail(session.context, "Ticks"), count + 1);
    assert.equal(tail(session.context, "New"), true);
    assert.equal(tail(session.context, "Realtime"), true);
    assert.equal(tail(session.context, "Historical"), false);
    assert.equal(tail(session.context, "Confirmed"), false);
    for (const [close, ticks, confirmed] of [[51, count + 2, false], [52, count + 3, true]]) {
      assert.equal(await session.tick(close, confirmed), true);
      assert.equal(tail(session.context, "Ordinary"), count + 1);
      assert.equal(tail(session.context, "Ticks"), ticks);
      assert.equal(tail(session.context, "New"), false);
      assert.equal(tail(session.context, "Confirmed"), confirmed);
      unchanged(session.context, history);
    }
    assert.equal(new Set(session.context.plots.Ticks.data.map((point) => point.time)).size, count + 1);
  }
});

test("omitted initialTail preserves the explicit open-tail rollback contract", async () => {
  const session = await run(script(flags));
  assert.deepEqual(values(session.context, "Historical"), [true, true, true, false]);
  assert.deepEqual(values(session.context, "Realtime"), [false, false, false, true]);
  assert.deepEqual(values(session.context, "Confirmed"), [true, true, true, false]);
  assert.deepEqual(values(session.context, "Last historical"), [false, false, true, false]);
  assert.equal(await session.tick(41), true);
  assert.equal(tail(session.context, "Ordinary"), 4);
  assert.equal(tail(session.context, "Ticks"), 5);
});

test("surviving open-born varip UDT restores ordinary birth fields while retaining qualified nested aliases", async () => {
  const session = await run(script(`type Cell
    int ordinary=7
    varip int ticks=0
    varip array<int> members
varip Cell live=na
if barstate.isrealtime
    if na(live)
        live:=Cell.new(7,0,array.new<int>(1,0))
    live.ordinary+=1
    live.ticks+=1
    array<int> alias=live.members
    array.set(alias,0,array.get(alias,0)+1)
plot(na(live)?na:live.ordinary,"Ordinary")
plot(na(live)?na:live.ticks,"Ticks")
plot(na(live)?na:array.get(live.members,0),"Alias")`));
  for (let index = 1; index <= 32; index++) {
    assert.equal(tail(session.context, "Ordinary"), 8);
    assert.equal(tail(session.context, "Ticks"), index);
    assert.equal(tail(session.context, "Alias"), index);
    if (index < 32) assert.equal(await session.tick(40 + index), true);
  }
  assert.equal(await session.tick(80, true), true);
  assert.equal(tail(session.context, "Ordinary"), 8);
  assert.equal(await session.append(90), true);
  assert.equal(tail(session.context, "Ordinary"), 9);
  assert.equal(tail(session.context, "Ticks"), 34);
  assert.equal(tail(session.context, "Alias"), 34);
});

test("historical object references still roll back tentative writes in place", async () => {
  const session = await run(script(`type Cell
    int value=0
Cell current=Cell.new(bar_index)
Cell previous=current[1]
if barstate.isrealtime
    previous.value+=1
plot(barstate.isrealtime?previous.value:na,"Previous")
plot(current.value,"Current")`));
  const history = past(session.context);
  history.Previous.pop();
  history.Current.pop();
  for (const close of [41, 42, 43]) {
    assert.equal(tail(session.context, "Previous"), 3);
    assert.equal(await session.tick(close), true);
    unchanged(session.context, history);
  }
});

test("local policy excludes dead newborn qualifiers from an ordinary surviving collection", async () => {
  const session = await run(script(`type Box
    varip array<int> members
var array<int> ordinary=array.new<int>(1,0)
if barstate.isrealtime and close>40
    Box transient=Box.new(ordinary)
    array.set(transient.members,0,100)
plot(array.get(ordinary,0),"Ordinary")`));
  assert.equal(tail(session.context, "Ordinary"), 0);
  assert.equal(await session.tick(41), true);
  assert.equal(tail(session.context, "Ordinary"), 100);
  assert.equal(await session.tick(39), true);
  assert.equal(tail(session.context, "Ordinary"), 0);
});

test("current persistent array map and matrix growth hits payload limits and halts further reads", async () => {
  const sources = [
    `varip array<int> data=array.new<int>(0)
if close>40
    for index=0 to 511
        array.push(data,index)
plot(array.size(data),"Size")`,
    `varip map<string,int> data=map.new<string,int>()
if close>40
    for index=0 to 511
        map.put(data,str.tostring(index),index)
plot(map.size(data),"Size")`,
    `varip matrix<int> data=matrix.new<int>(0,1,0)
if close>40
    for index=0 to 511
        matrix.add_row(data,matrix.rows(data),array.new<int>(1,index))
plot(matrix.rows(data),"Size")`,
  ];
  for (const source of sources) {
    const session = await run(script(source), { limits: { cells: 256 } });
    assert.equal(tail(session.context, "Size"), 0);
    await assert.rejects(session.tick(41), stateLimit);
    await halted(session);
  }
});

test("appended graph growth failures latch before a later provider read", async () => {
  const session = await run(script(`varip array<int> data=array.new<int>(0)
if bar_index>=4
    for index=0 to 511
        array.push(data,index)
plot(array.size(data),"Size")`), { initialTail: "historical", limits: { cells: 256 } });
  await assert.rejects(session.append(50), stateLimit);
  await halted(session);
});


test("2048 discarded newborn ticks plateau while retained birth state remains semantically correct", async () => {
  const session = await run(script(`type Cell
    int value=7
Cell transient=Cell.new()
transient.value+=1
plot(transient.value,"Value")
varip int observed=0
observed+=1
plot(observed,"Observed")`));
  const history = past(session.context);
  history.Value.pop();
  history.Observed.pop();
  const samples = [];
  let heapBefore;
  for (let index = 1; index <= 2048; index++) {
    assert.equal(await session.tick(40 + index), true);
    assert.equal(tail(session.context, "Value"), 8);
    assert.equal(tail(session.context, "Observed"), 4 + index);
    assert.equal(session.context.plots.Value.data.length, 4);
    unchanged(session.context, history);
    if ([32, 1024, 2048].includes(index)) {
      samples.push({ tick: index, ...session.stats() });
      if (typeof global.gc === "function") {
        global.gc();
        const heapUsed = process.memoryUsage().heapUsed;
        if (index === 32) heapBefore = heapUsed;
        samples.at(-1).heapUsed = heapUsed;
      }
    }
  }
  for (const field of ["nodes", "mutableCells", "seriesSlots", "baselineNodes", "newbornNodes"]) {
    assert.equal(samples[1][field], samples[0][field], `${field} plateau by tick 1024`);
    assert.equal(samples[2][field], samples[0][field], `${field} plateau by tick 2048`);
  }
  assert.ok(samples[2].prunedNodes > samples[0].prunedNodes, "discarded newborns are actually pruned");
  assert.equal(samples[2].failed, false);
  if (process.env.EDGELAB_PINE_ENGINE_RECEIPT === "1") {
    console.info("REALTIME_PLATEAU " + JSON.stringify({
      ticks: 2048,
      samples,
      heapDeltaAfterGc: heapBefore === undefined ? null : samples.at(-1).heapUsed - heapBefore,
      scope: "Retained rollback/current payload accounting; observed process heap is not a whole-engine memory cap.",
    }));
  }
});

test("hard caps and lower positive integer limits are explicit and invalid configurations fail closed", async () => {
  const session = await run(script('plot(close,"Close")'));
  assert.deepEqual(session.stats().limits, { nodes: 16_384, cells: 262_144, seriesSlots: 1_280_000 });
  for (const [field, maximum] of Object.entries(session.stats().limits)) {
    for (const value of [0, -1, 1.5, NaN, Infinity, maximum + 1, "1", null]) {
      assert.throws(() => fixture(script('plot(close,"Close")'), { limits: { [field]: value } }), /limit|budget|positive|integer/i, `${field}=${value}`);
    }
  }
  for (const value of ["closed", true, null, 1]) {
    assert.throws(() => fixture(script('plot(close,"Close")'), { initialTail: value }), /initial|tail|historical|open/i);
  }
  for (const [field, maximum] of Object.entries(session.stats().limits)) {
    assert.doesNotThrow(() => fixture(script('plot(close,"Close")'), { limits: { [field]: maximum } }));
  }
});

test("telemetry-relative nodes cells and series slot boundaries accept N and reject N minus one", async () => {
  const source = script(`type Cell
    int value=7
var Cell persistent=Cell.new()
var array<int> members=array.new<int>(8,7)
varip int ticks=0
ticks+=1
plot(persistent.value+array.get(members,0)+ticks,"Value")`);
  const baseline = await run(source, { initialTail: "historical" }, [10]);
  const stats = baseline.stats();
  for (const [limit, field] of [["nodes", "nodes"], ["cells", "mutableCells"], ["seriesSlots", "seriesSlots"]]) {
    const count = stats[field];
    assert.ok(Number.isInteger(count) && count > 1, `${field} is a meaningful numerical boundary`);
    const exact = await run(source, { initialTail: "historical", limits: { [limit]: count } }, [10]);
    assert.equal(tail(exact.context, "Value"), 15);
    assert.equal(exact.stats()[field], count);
    const rejected = fixture(source, { initialTail: "historical", limits: { [limit]: count - 1 } }, [10]);
    await assert.rejects(rejected.start(), stateLimit);
    assert.equal(rejected.engine.getRealtimeStats().failed, true, "initial budget failure is latched");
  }
});

test("scoped series accounting includes every varip history slot without inflating object payloads", async () => {
  const session = await run(script(`var int ordinary=0
varip int intrabar=0
ordinary+=1
intrabar+=1
plot(ordinary+intrabar,"Count")`));
  const count = () => {
    let slots = 0;
    for (const scope of [session.context, ...session.context.lctx.values()]) {
      for (const kind of ["const", "var", "let", "params", "varip"]) {
        for (const binding of Object.values(scope[kind] ?? {})) {
          if (binding instanceof Series) slots += binding.data.length;
        }
      }
    }
    return slots;
  };
  assert.equal(session.stats().seriesSlots, count());
  const before = session.stats().seriesSlots;
  for (const close of [41, 42, 43]) {
    assert.equal(await session.tick(close), true);
    assert.equal(session.stats().seriesSlots, count());
    assert.equal(session.stats().seriesSlots, before);
  }
});

test("oversized sparse cache arrays are checked before snapshot slicing", async () => {
  const original = Array.prototype.slice;
  let oversizedCopies = 0;
  Array.prototype.slice = function (...args) {
    if (this.length >= 300_000) oversizedCopies++;
    return Reflect.apply(original, this, args);
  };
  try {
    const source = ($) => {
      const { plot } = $.pine;
      $.cache.large = new Array(300_000);
      plot($.data.close, "Close");
    };
    const session = fixture(source);
    await assert.rejects(session.start(), stateLimit);
    assert.equal(session.engine.getRealtimeStats().failed, true);
    assert.equal(oversizedCopies, 0, "oversized sparse payload was not copied before its cell guard");
  } finally {
    Array.prototype.slice = original;
  }
});

test("oversized map and matrix payloads reject before observed snapshot entry and row-copy calls", async () => {
  const entries = Map.prototype.entries;
  const slice = Array.prototype.slice;
  let oversizedMapCopies = 0;
  let matrixRowCopies = 0;
  Map.prototype.entries = function (...args) {
    if (this.size === 512) oversizedMapCopies++;
    return Reflect.apply(entries, this, args);
  };
  Array.prototype.slice = function (...args) {
    if (this.length === 17 && this.every((value) => value === 7)) matrixRowCopies++;
    return Reflect.apply(slice, this, args);
  };
  try {
    const map = fixture(script(`var map<string,int> data=map.new<string,int>()
if barstate.isfirst
    for index=0 to 511
        map.put(data,str.tostring(index),index)
plot(map.size(data),"Size")`), { limits: { cells: 256 } });
    await assert.rejects(map.start(), stateLimit);
    assert.equal(map.engine.getRealtimeStats().failed, true);
    assert.equal(oversizedMapCopies, 0);
    const matrix = fixture(script(`var matrix<int> grid=matrix.new<int>(17,17,7)
plot(matrix.rows(grid),"Rows")`), { limits: { cells: 256 } });
    await assert.rejects(matrix.start(), stateLimit);
    assert.equal(matrix.engine.getRealtimeStats().failed, true);
    assert.equal(matrixRowCopies, 0);
  } finally {
    Map.prototype.entries = entries;
    Array.prototype.slice = slice;
  }
});

test("retained-state telemetry is numeric owned-context data and cannot expose mutable budget state", async () => {
  const session = await run(script('plot(close,"Close")'));
  const other = await run(script('plot(close,"Close")'));
  assert.throws(() => session.engine.getRealtimeStats(other.context), /own|context/i);
  assert.deepEqual(session.engine.getRealtimeStats(), session.stats(), "default telemetry selects the owned context");
  assert.throws(() => session.engine.getRealtimeStats({}), /own|context/i);
  const stats = session.stats();
  for (const field of ["nodes", "mutableCells", "seriesSlots", "baselineNodes", "newbornNodes", "prunedNodes"]) {
    assert.ok(Number.isSafeInteger(stats[field]) && stats[field] >= 0, field);
  }
  assert.equal(typeof stats.failed, "boolean");
  const expected = session.stats().limits.cells;
  try { stats.limits.cells = 1; } catch {}
  assert.equal(session.stats().limits.cells, expected, "returned budget metadata cannot alter active enforcement");
});


test("a series history cap reached on append fails and halts before another read", async () => {
  const source = script('varip int ticks=0\nticks+=1\nplot(ticks,"Ticks")');
  const baseline = await run(source, { initialTail: "historical" });
  const slots = baseline.stats().seriesSlots;
  const session = await run(source, { initialTail: "historical", limits: { seriesSlots: slots } });
  await assert.rejects(session.append(50), stateLimit);
  assert.equal(session.stats().failed, true);
  await halted(session);
});


test("alias-unique payload accounting grows by one node and exactly eight cells for one new array", async () => {
  const source = (second) => script(`type Cell
    array<int> members
var array<int> first=array.new<int>(8,7)
var array<int> second=${second}
var Cell left=Cell.new(first)
var Cell right=Cell.new(second)
plot(array.size(left.members)+array.size(right.members),"Sizes")`);
  const alias = await run(source("first"), { initialTail: "historical" }, [10]);
  const distinct = await run(source("array.new<int>(8,7)"), { initialTail: "historical" }, [10]);
  assert.equal(tail(alias.context, "Sizes"), 16);
  assert.equal(tail(distinct.context, "Sizes"), 16);
  assert.equal(distinct.stats().nodes - alias.stats().nodes, 1, "two UDT references to the same payload count it only once");
  assert.equal(distinct.stats().mutableCells - alias.stats().mutableCells, 8, "one additional eight-element payload consumes eight cells");
  // Argument bindings may differ, so independently sum the actual scoped
  // Series histories rather than inventing a tolerance for their count.
  for (const session of [alias, distinct]) {
    let slots = 0;
    for (const scope of [session.context, ...session.context.lctx.values()]) {
      for (const kind of ["const", "var", "let", "params", "varip"]) {
        for (const binding of Object.values(scope[kind] ?? {})) {
          if (binding instanceof Series) slots += binding.data.length;
        }
      }
    }
    assert.equal(session.stats().seriesSlots, slots);
  }
});


test("realtime configuration rejects accessor TOCTOU and hidden keys without invoking getters", async () => {
  const source = script('plot(close,"Close")');
  let reads = 0;
  const changing = {
    get nodes() { return ++reads <= 3 ? 16_384 : 16_385; },
  };
  assert.throws(() => fixture(source, { limits: changing }), /option|limit|descriptor|accessor|plain|field/i);
  assert.equal(reads, 0, "untrusted cap getter must never execute");

  for (const field of ["initialTail", "limits"]) {
    let calls = 0;
    const options = {};
    Object.defineProperty(options, field, {
      enumerable: true,
      get() {
        calls++;
        options.initialTail = "historical";
        return field === "limits" ? { nodes: 16_384 } : "open";
      },
    });
    assert.throws(() => fixture(source, options), /option|limit|descriptor|accessor|plain|field/i);
    assert.equal(calls, 0, `${field} getter is rejected before side effects`);
  }

  const hiddenOption = Object.defineProperty({}, "initialTail", { value: "open", enumerable: false });
  const hiddenLimit = Object.defineProperty({}, "nodes", { value: 16_384, enumerable: false });
  const inheritedOptions = Object.create({ initialTail: "open" });
  const inheritedLimits = Object.create({ nodes: 16_384 });
  const token = Symbol("untrusted");
  for (const options of [
    inheritedOptions,
    { limits: inheritedLimits },
    { [token]: "open" },
    { limits: { [token]: 16_384 } },
    Object.defineProperty({}, "unknown", { value: "open", enumerable: false }),
    { limits: Object.defineProperty({}, "unknown", { value: 16_384, enumerable: false }) },
  ]) {
    assert.throws(() => fixture(source, options), /option|limit|descriptor|accessor|plain|field/i);
  }

  const hidden = await run(script(flags), Object.defineProperty(hiddenOption, "limits", { value: hiddenLimit, enumerable: false }));
  assert.equal(tail(hidden.context, "Realtime"), true);
  assert.equal(hidden.stats().limits.nodes, 16_384);
  const overCap = Object.defineProperty({}, "nodes", { value: 16_385, enumerable: false });
  assert.throws(() => fixture(source, { limits: overCap }), /limit|budget|positive|integer/i);
  const hiddenAccessor = Object.defineProperty({}, "cells", { enumerable: false, get() { reads++; return 1; } });
  assert.throws(() => fixture(source, { limits: hiddenAccessor }), /option|limit|descriptor|accessor|plain|field/i);
  assert.equal(reads, 0);

  const limits = { cells: 256 };
  const options = { initialTail: "open", limits };
  const session = fixture(script(`varip array<int> data=array.new<int>(0)
if close>40
    for index=0 to 511
        array.push(data,index)
plot(barstate.isrealtime,"Realtime")`), options);
  limits.cells = 262_144;
  options.initialTail = "historical";
  options.limits = { cells: 262_144 };
  await session.start();
  assert.equal(tail(session.context, "Realtime"), true, "selected initialTail was copied before caller mutation");
  assert.equal(session.stats().limits.cells, 256, "selected cap was copied before caller mutation");
  await assert.rejects(session.tick(41), stateLimit);
  await halted(session);
});
