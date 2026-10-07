import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Bundle the same verified source/overrides as the production worker. The only
// fixture seam is the provider's deterministic sequence of market updates.
const root = fileURLToPath(new URL("../..", import.meta.url));
const engineBundle = async (patched) => (await build({
  bundle: true, minify: true, format: "esm", logLevel: "silent", platform: "browser", target: "es2020", write: false,
  plugins: [createPineEnginePlugin({ patched })],
  stdin: { contents: 'export { PineTS } from "pinets";', loader: "ts", resolveDir: root, sourcefile: "pine-realtime54-fixture.ts" },
})).outputFiles[0].text + `\n//# sourceURL=edgelab-pine-engine-${patched ? "patched" : "pinned"}.mjs\n`;
const patchedBundle = await engineBundle(true);
const pinnedBundle = await engineBundle(false);
const loadEngine = async (bundle) => (await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`)).PineTS;
const PineTS = await loadEngine(patchedBundle);
const PinnedPineTS = await loadEngine(pinnedBundle);
if (process.env.EDGELAB_PINE_ENGINE_RECEIPT === "1") {
  const bytes = fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url));
  const manifest = JSON.parse(bytes.toString());
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  console.info("ENGINE_BINDING " + JSON.stringify({
    version: manifest.version, patch: manifest.patch, minify: true,
    sourceMapSha256: manifest.sourceMapSha256, manifestSha256: sha(bytes),
    patchedBundleSha256: sha(patchedBundle), patchedBundleBytes: Buffer.byteLength(patchedBundle),
    pinnedBundleSha256: sha(pinnedBundle), pinnedBundleBytes: Buffer.byteLength(pinnedBundle),
  }));
}

const script = (body) => `//@version=6\nindicator("Realtime oracle")\n${body}`;
const candle = (index, close, confirmed = true) => ({
  openTime: 1_700_000_000_000 + index * 60_000,
  closeTime: confirmed ? 1_700_000_060_000 + index * 60_000 : Date.now() + 3_600_000,
  open: close - 1, high: close + 2, low: close - 2, close, volume: 10,
});

async function session(source, closes = [10, 20, 30, 40], Engine = PineTS, realtime = true) {
  let snapshot = closes.map((close, index) => candle(index, close, index < closes.length - 1));
  let empty = false;
  let pausedRead;
  const requests = [];
  const provider = {
    configure() {},
    async getMarketData(symbol, timeframe, limit, start, end) {
      requests.push({ symbol, timeframe, limit, start, end });
      if (pausedRead) {
        const current = pausedRead;
        pausedRead = undefined;
        current.enter();
        await current.gate;
      }
      if (empty) return [];
      let result = snapshot.filter((bar) => (start === undefined || bar.openTime >= start) && (end === undefined || bar.openTime <= end));
      if (limit !== undefined) result = result.slice(-limit);
      return result.map((bar) => ({ ...bar }));
    },
    async getSymbolInfo() {
      return { tickerid: "TEST", ticker: "TEST", timezone: "UTC", session: "24x7", currency: "USD", mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1 };
    },
  };
  const engine = new Engine(provider, "TEST", "1", snapshot.length);
  if (realtime) engine.setRealtimeMode(true);
  const context = await engine.run(source);
  return {
    engine, context, requests,
    pauseNextRead() {
      let enter, release;
      const entered = new Promise((resolve) => { enter = resolve; });
      const gate = new Promise((resolve) => { release = resolve; });
      pausedRead = { enter, gate };
      return { entered, release };
    },
    async tick(close, confirmed = false) {
      const index = snapshot.length - 1;
      snapshot[index] = candle(index, close, confirmed);
      assert.equal(await engine.updateTail(context, { confirmed }), true);
    },
    async append(close) {
      snapshot.push(candle(snapshot.length, close, false));
      assert.equal(await engine.updateTail(context, { confirmed: false }), true);
    },
    async noUpdate() {
      empty = true;
      assert.equal(await engine.updateTail(context, { confirmed: false }), false);
      empty = false;
    },
  };
}

const values = (context, name) => context.plots[name].data.map((point) => point.value);
const tail = (context, name) => values(context, name).at(-1);
const historic = (context) => Object.fromEntries(Object.entries(context.plots).map(([name, plot]) => [name, structuredClone(plot.data.slice(0, -1))]));
const unchanged = (context, expected) => {
  for (const [name, points] of Object.entries(expected)) assert.deepEqual(context.plots[name].data.slice(0, points.length), points, `${name} committed history`);
};

// https://www.tradingview.com/pine-script-docs/language/execution-model/
test("ordinary var rolls back but varip accumulates ticks then commits once", async () => {
  const run = await session(script(`var int bars = 0
varip int ticks = 0
varip int perBar = 0
if barstate.isnew
    perBar := 0
bars += 1
ticks += 1
perBar += 1
plot(bars,"Bars")
plot(ticks,"Ticks")
plot(perBar,"Per bar")
plot(bars[1],"Previous")`));
  assert.deepEqual(values(run.context, "Bars"), [1, 2, 3, 4]);
  assert.deepEqual(values(run.context, "Ticks"), [1, 2, 3, 4]);
  const past = historic(run.context);
  for (const [close, count] of [[41, 5], [42, 6]]) {
    await run.tick(close);
    assert.equal(tail(run.context, "Bars"), 4);
    assert.equal(tail(run.context, "Ticks"), count);
    assert.equal(tail(run.context, "Per bar"), count - 3);
    assert.equal(tail(run.context, "Previous"), 3);
    unchanged(run.context, past);
  }
  await run.tick(43, true);
  assert.equal(tail(run.context, "Bars"), 4);
  assert.equal(tail(run.context, "Ticks"), 7);
  const committed = structuredClone(run.context.plots.Ticks.data);
  await run.append(50);
  assert.equal(tail(run.context, "Bars"), 5);
  assert.equal(tail(run.context, "Ticks"), 8);
  assert.equal(tail(run.context, "Per bar"), 1);
  assert.equal(tail(run.context, "Previous"), 4);
  assert.deepEqual(run.context.plots.Ticks.data.slice(0, 4), committed);
  assert.equal(new Set(run.context.plots.Ticks.data.map((point) => point.time)).size, 5);
});

test("array aliases roll back ordinary mutations while varip arrays retain them", async () => {
  const run = await session(script(`var array<int> ordinary = array.new<int>(1,0)
var array<int> alias = ordinary
varip array<int> intrabar = array.new<int>(1,0)
array.set(alias,0,array.get(alias,0)+1)
array.set(intrabar,0,array.get(intrabar,0)+1)
plot(array.get(ordinary,0),"Ordinary")
plot(array.get(alias,0),"Alias")
plot(array.get(intrabar,0),"Intrabar")`));
  const past = historic(run.context);
  for (const count of [5, 6, 7]) {
    await run.tick(40 + count);
    assert.equal(tail(run.context, "Ordinary"), 4);
    assert.equal(tail(run.context, "Alias"), 4);
    assert.equal(tail(run.context, "Intrabar"), count);
    unchanged(run.context, past);
  }
});

function recurrence(closes, length, alpha) {
  const result = closes.map(() => NaN);
  let previous = closes.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  result[length - 1] = previous;
  for (let index = length; index < closes.length; index++) {
    previous = alpha * closes[index] + (1 - alpha) * previous;
    result[index] = previous;
  }
  return result;
}

function near(actual, expected, name) {
  if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual), name);
  else assert.ok(Math.abs(actual - expected) < 1e-10, `${name}: ${actual} != ${expected}`);
}

test("EMA and Wilder tentative updates use committed prior values without history drift", async () => {
  const closes = [10, 20, 5, 25, 15, 30, 12, 40];
  const run = await session(script('plot(ta.ema(close,3),"EMA")\nplot(ta.rma(close,3),"Wilder")'), closes);
  const past = historic(run.context);
  for (const close of [45, 18, 55, 21]) {
    await run.tick(close);
    for (const [name, alpha] of [["EMA", 0.5], ["Wilder", 1 / 3]]) {
      const expected = recurrence([...closes.slice(0, -1), close], 3, alpha);
      values(run.context, name).forEach((actual, index) => near(actual, expected[index], `${name} bar ${index}`));
    }
    unchanged(run.context, past);
  }
  await run.tick(21, true);
  await run.append(35);
  for (const [name, alpha] of [["EMA", 0.5], ["Wilder", 1 / 3]]) {
    const expected = recurrence([...closes.slice(0, -1), 21, 35], 3, alpha);
    values(run.context, name).forEach((actual, index) => near(actual, expected[index], `${name} appended bar ${index}`));
  }
});

test("an empty provider update leaves all real plot state unchanged", async () => {
  const run = await session(script('var int count=0\ncount+=1\nplot(count,"Count")'));
  const before = structuredClone(run.context.plots);
  await run.noUpdate();
  assert.deepEqual(run.context.plots, before);
});

// UDT aliases are reference aliases. Ordinary fields do not inherit varip from
// a variable holding the object: https://www.tradingview.com/pine-script-docs/language/objects/
test("UDT aliases and their nested arrays restore the same ordinary graph", async () => {
  const run = await session(script(`type Cell
    int count = 0
    array<int> members
var Cell original = Cell.new(0,array.new<int>(1,0))
var Cell alias = original
alias.count += 1
array.set(alias.members,0,array.get(alias.members,0)+1)
plot(original.count,"Original")
plot(alias.count,"Alias")
plot(array.get(original.members,0),"Nested")`));
  const past = historic(run.context);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    for (const name of ["Original", "Alias", "Nested"]) assert.equal(tail(run.context, name), 4);
    unchanged(run.context, past);
  }
});

test("ordinary map and matrix aliases restore contents rather than retain tentative writes", async () => {
  const run = await session(script(`var map<string,int> counts = map.new<string,int>()
var map<string,int> mapAlias = counts
var matrix<int> cells = matrix.new<int>(1,1,0)
var matrix<int> matrixAlias = cells
map.put(mapAlias,"count",nz(map.get(mapAlias,"count"),0)+1)
matrix.set(matrixAlias,0,0,matrix.get(matrixAlias,0,0)+1)
plot(map.get(counts,"count"),"Map")
plot(map.get(mapAlias,"count"),"Map alias")
plot(matrix.get(cells,0,0),"Matrix")
plot(matrix.get(matrixAlias,0,0),"Matrix alias")`));
  const past = historic(run.context);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    for (const name of ["Map", "Map alias", "Matrix", "Matrix alias"]) assert.equal(tail(run.context, name), 4);
    unchanged(run.context, past);
  }
});


test("a varip UDT reference does not exempt ordinary fields from rollback", async () => {
  const run = await session(script(`type Count
    int value = 0
varip Count count = Count.new()
count.value += 1
plot(count.value,"Value")`));
  assert.equal(tail(run.context, "Value"), 4);
  await run.tick(41);
  assert.equal(tail(run.context, "Value"), 4);
  await run.tick(42);
  assert.equal(tail(run.context, "Value"), 4);
});

test("explicit varip UDT fields persist while sibling ordinary fields roll back", async () => {
  const run = await session(script(`type Counter
    int bars = 0
    varip int ticks = 0
var Counter counter = Counter.new()
counter.bars += 1
counter.ticks += 1
plot(counter.bars,"Bars")
plot(counter.ticks,"Ticks")`));
  const past = historic(run.context);
  for (const count of [5, 6, 7]) {
    await run.tick(40 + count);
    assert.equal(tail(run.context, "Bars"), 4);
    assert.equal(tail(run.context, "Ticks"), count);
    unchanged(run.context, past);
  }
});

test("conditional open-tick collection creation rolls back ordinary but not varip identity", async () => {
  const run = await session(script(`var array<int> ordinary = na
varip array<int> persistent = na
if close > 40
    if na(ordinary)
        ordinary := array.new<int>(1,7)
    if na(persistent)
        persistent := array.new<int>(1,9)
plot(na(ordinary)?0:array.get(ordinary,0),"Ordinary")
plot(na(persistent)?0:array.get(persistent,0),"Persistent")`));
  assert.equal(tail(run.context, "Ordinary"), 0);
  await run.tick(41);
  assert.equal(tail(run.context, "Ordinary"), 7);
  assert.equal(tail(run.context, "Persistent"), 9);
  await run.tick(39);
  assert.equal(tail(run.context, "Ordinary"), 0);
  assert.equal(tail(run.context, "Persistent"), 9);
});

test("previous committed array instances survive tentative replacement unchanged", async () => {
  const run = await session(script(`array<float> current = array.new<float>(1,close)
array<float> previous = current[1]
plot(array.get(current,0),"Current")
plot(na(previous)?na:array.get(previous,0),"Previous")`));
  const past = historic(run.context);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    assert.equal(tail(run.context, "Current"), close);
    assert.equal(tail(run.context, "Previous"), 30);
    unchanged(run.context, past);
  }
});


test("default closed execution preserves the verified unmodified engine's values and colors", async () => {
  const source = script(`var int bars = 0
varip int ticks = 0
var array<int> members = array.new<int>(1,0)
bars += 1
ticks += 1
array.set(members,0,array.get(members,0)+1)
plot(bars,"Bars",color=#ff0000)
plot(ticks,"Ticks",color=#0000ff)
plot(array.get(members,0),"Array")
plot(ta.ema(close,3),"EMA")
plot(ta.rma(close,3),"Wilder")`);
  const baseline = await session(source, [10, 20, 5, 25, 15, 30], PinnedPineTS, false);
  const patched = await session(source, [10, 20, 5, 25, 15, 30], PineTS, false);
  assert.deepEqual(patched.context.plots, baseline.context.plots);
});


test("a finite tentative average cannot leak through an na close into the next bar", async () => {
  const closes = [10, 20, 5, 25, 15, 30, 12, 40];
  const run = await session(script('sample = close == 99 ? na : close\nplot(ta.ema(sample,3),"EMA")\nplot(ta.rma(sample,3),"Wilder")'), closes);
  const past = historic(run.context);
  await run.tick(45);
  await run.tick(99, true);
  // The pinned display contract returns na at the missing source bar. This
  // state test does not equate that output policy with TradingView pixels.
  for (const name of ["EMA", "Wilder"]) assert.ok(Number.isNaN(tail(run.context, name)));
  unchanged(run.context, past);
  await run.append(35);
  for (const [name, alpha] of [["EMA", 0.5], ["Wilder", 1 / 3]]) {
    const expected = recurrence([...closes.slice(0, -1), 35], 3, alpha).at(-1);
    near(tail(run.context, name), expected, `${name} next finite committed state`);
  }
});


test("shared UDT references inside a map and matrix retain one restored identity", async () => {
  const run = await session(script(`type Cell
    int value = 0
var Cell original = Cell.new()
var map<string,Cell> graph = map.new<string,Cell>()
var matrix<Cell> grid = matrix.new<Cell>(1,1,original)
if barstate.isfirst
    map.put(graph,"shared",original)
Cell fromMap = map.get(graph,"shared")
Cell fromMatrix = matrix.get(grid,0,0)
fromMap.value += 1
plot(original.value,"Original")
plot(fromMap.value,"Map")
plot(fromMatrix.value,"Matrix")`));
  const past = historic(run.context);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    for (const name of ["Original", "Map", "Matrix"]) assert.equal(tail(run.context, name), 4);
    unchanged(run.context, past);
  }
});


test("a genuine script runtime error halts that context before later provider reads", async () => {
  const source = script(`varip int count = 0
count += 1
if close == 99
    runtime.error("deliberate realtime oracle failure")
plot(count,"Count")`);
  const run = await session(source);
  await assert.rejects(run.tick(99), /deliberate realtime oracle failure/);
  const failedPlots = structuredClone(run.context.plots);
  const providerReads = run.requests.length;
  await assert.rejects(run.tick(41), /halted after a script runtime error/);
  assert.equal(run.requests.length, providerReads);
  assert.deepEqual(run.context.plots, failedPlots);
  const replacement = await session(source);
  assert.equal(tail(replacement.context, "Count"), 4);
  await replacement.tick(41);
  assert.equal(tail(replacement.context, "Count"), 5);
});


test("provisional plot background bar color and fill outputs replace one tail without history loss", async () => {
  const run = await session(script(`upper = plot(close+5,"Upper")
lower = plot(close-5,"Lower")
fill(upper,lower,color=#ff000080,title="Band")
bgcolor(close>40?#ff0000:#0000ff,title="Background")
barcolor(close>40?#00ff00:#ff0000,title="Bodies")`));
  const outputs = ["Upper", "Lower", "Band", "Background", "Bodies"];
  // The raw engine also has six reserved latest-frame drawing buckets. Those
  // are not authored per-bar plot/bgcolor/barcolor/fill channels.
  assert.deepEqual(Object.keys(run.context.plots).filter((name) => !name.startsWith("__")), outputs);
  const past = historic(run.context);
  const check = (count) => {
    for (const name of outputs) {
      const plot = run.context.plots[name];
      assert.equal(plot.data.length, count, `${name} output count`);
      assert.equal(new Set(plot.data.map((point) => point.time)).size, count, `${name} no duplicate ticks`);
      assert.deepEqual(plot.data.map((point) => point.time), Array.from({ length: count }, (_, index) => candle(index, 0).openTime), `${name} exact output timestamps`);
    }
  };
  check(4);
  for (const close of [41, 39, 42]) {
    await run.tick(close);
    check(4);
    unchanged(run.context, past);
    assert.equal(tail(run.context, "Upper"), close + 5);
    assert.equal(tail(run.context, "Lower"), close - 5);
    assert.equal(run.context.plots.Background.data.at(-1).options.color, close > 40 ? "#ff0000" : "#0000ff");
    assert.equal(run.context.plots.Bodies.data.at(-1).options.color, close > 40 ? "#00ff00" : "#ff0000");
  }
  await run.tick(42, true);
  const committed = Object.fromEntries(outputs.map((name) => [name, structuredClone(run.context.plots[name])]));
  await run.append(50);
  check(5);
  for (const [name, plot] of Object.entries(committed)) assert.deepEqual(run.context.plots[name].data.slice(0, 4), plot.data);
});

test("authored marker-looking string cannot change an ordinary variable into varip", async () => {
  const source = script(`"__pineVarip:x"
var int x = 0
x += 1
plot(x,"Ordinary")`);
  const run = await session(source);
  assert.deepEqual(values(run.context, "Ordinary"), [1, 2, 3, 4]);
  const past = historic(run.context);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    assert.equal(tail(run.context, "Ordinary"), 4);
    unchanged(run.context, past);
  }
});


test("ordinary sliced array views preserve their shared insertion window during rollback", async () => {
  const run = await session(script(`var a = array.from(10,20,30)
var view = array.slice(a,0,2)
array.push(view,1)
plot(array.size(a),"Parent size")
plot(array.last(a),"Parent last")
plot(array.size(view),"View size")`));
  assert.deepEqual(values(run.context, "Parent size"), [4, 5, 6, 7]);
  assert.deepEqual(values(run.context, "Parent last"), [30, 30, 30, 30]);
  assert.deepEqual(values(run.context, "View size"), [3, 4, 5, 6]);
  const past = historic(run.context);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    assert.equal(tail(run.context, "Parent size"), 7);
    assert.equal(tail(run.context, "Parent last"), 30);
    assert.equal(tail(run.context, "View size"), 6);
    unchanged(run.context, past);
  }
});


test("a varip collection field persists through an ordinary alias to its payload", async () => {
  const run = await session(script(`type Cell
    varip array<int> members
var Cell cell = Cell.new(array.new<int>(1,0))
var array<int> alias = cell.members
array.set(alias,0,array.get(alias,0)+1)
plot(array.get(cell.members,0),"Field")
plot(array.get(alias,0),"Alias")`));
  assert.equal(tail(run.context, "Field"), 4);
  assert.equal(tail(run.context, "Alias"), 4);
  const past = historic(run.context);
  for (const count of [5, 6, 7]) {
    await run.tick(40 + count);
    assert.equal(tail(run.context, "Field"), count);
    assert.equal(tail(run.context, "Alias"), count);
    unchanged(run.context, past);
  }
});


test("an open-bar copied UDT retained by varip restores ordinary fields to creation state", async () => {
  const run = await session(script(`type Cell
    int count = 0
var Cell original = Cell.new()
varip Cell copied = na
if barstate.isrealtime
    if na(copied)
        copied := original.copy()
    copied.count += 1
plot(na(copied)?na:copied.count,"Copied")
plot(original.count,"Original")`));
  assert.equal(tail(run.context, "Copied"), 1);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    assert.equal(tail(run.context, "Copied"), 1);
    assert.equal(tail(run.context, "Original"), 0);
  }
});

test("ordinary UDT fields without explicit defaults still restore committed values", async () => {
  const run = await session(script(`type Cell
    int count
var Cell cell = Cell.new()
if na(cell.count)
    cell.count := 0
cell.count += 1
plot(cell.count,"Count")`));
  assert.deepEqual(values(run.context, "Count"), [1, 2, 3, 4]);
  const past = historic(run.context);
  for (const close of [41, 42, 43]) {
    await run.tick(close);
    assert.equal(tail(run.context, "Count"), 4);
    unchanged(run.context, past);
  }
});

test("public realtime lifecycle rejects foreign missing concurrent and committed updates", async () => {
  const source = script('var int count=0\ncount+=1\nplot(count,"Count")');
  const run = await session(source);
  const other = await session(source);
  const reads = run.requests.length;
  for (const [context, event] of [[other.context, { confirmed: false }], [run.context, undefined], [run.context, { confirmed: "false" }]]) {
    await assert.rejects(run.engine.updateTail(context, event), /owning context and a boolean confirmed event/);
  }
  assert.equal(run.requests.length, reads);
  const paused = run.pauseNextRead();
  const pending = run.tick(41);
  await paused.entered;
  try {
    await assert.rejects(run.engine.updateTail(run.context, { confirmed: false }), /already running/);
  } finally {
    paused.release();
  }
  await pending;
  assert.equal(tail(run.context, "Count"), 4);
  const open = await session(source);
  const beforeAppend = structuredClone(open.context.plots);
  await assert.rejects(open.append(50), /Close the current bar before opening exactly one next bar/);
  assert.deepEqual(open.context.plots, beforeAppend);
  await run.tick(42, true);
  const committed = structuredClone(run.context.plots);
  await assert.rejects(run.tick(43), /committed bar cannot receive another tick/);
  assert.deepEqual(run.context.plots, committed);
});


test("all seventeen migrated community defaults retain exact pinned-engine numeric outputs", async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../../frontend/src/lib/pineCatalogMigrations.json", import.meta.url), "utf8"));
  const fixture = fs.readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url));
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  assert.equal(sha(fixture), "fc9a28c87aed819daae602ea45422d0d40979bd42f86097607310b0300645ea1");
  const history = JSON.parse(fixture.toString()).map((bar) => ({
    ...bar, openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000,
  }));
  assert.equal(history.length, 256);
  assert.equal(manifest.entries.length, 17);
  for (const entry of manifest.entries) {
    const source = fs.readFileSync(new URL("../../frontend/public" + entry.sourcePath, import.meta.url));
    assert.equal(source.length, entry.sourceBytes, entry.path + " exact source bytes");
    assert.equal(sha(source), entry.sourceSha256, entry.path + " exact source hash");
    const expectedEngine = new PinnedPineTS(structuredClone(history), "TEST", "1", history.length);
    const actualEngine = new PineTS(structuredClone(history), "TEST", "1", history.length);
    // Leave both instances in their default closed execution mode. Compare raw
    // shapes directly so NaN, absent keys and undefined values stay distinct.
    const expected = await expectedEngine.run(source.toString());
    const actual = await actualEngine.run(source.toString());
    assert.deepEqual(Object.keys(actual.plots), Object.keys(expected.plots), entry.path + " output identity/order");
    for (const name of Object.keys(expected.plots)) {
      assert.deepEqual(actual.plots[name].options, expected.plots[name].options, `${entry.path} ${name} output options`);
      assert.deepEqual(actual.plots[name].data, expected.plots[name].data, `${entry.path} ${name} exact times/values/colors`);
    }
  }
});
