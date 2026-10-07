import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
async function bundle(patched) {
  const result = await build({
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    write: false,
    logLevel: "silent",
    plugins: [createPineEnginePlugin({ patched })],
    stdin: {
      contents: 'export { PineTS } from "pinets";',
      loader: "ts",
      resolveDir: root,
      sourcefile: "pine-object-copy55-fixture.ts",
    },
  });
  return result.outputFiles[0].text + `\n//# sourceURL=edgelab-copy55-${patched ? "patched" : "pinned"}.mjs\n`;
}
const patchedBundle = await bundle(true);
const pinnedBundle = await bundle(false);
const load = async (source) => (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).PineTS;
const PineTS = await load(patchedBundle);
const PinnedPineTS = await load(pinnedBundle);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (process.env.EDGELAB_PINE_ENGINE_RECEIPT === "1") {
  const bytes = fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url));
  const manifest = JSON.parse(bytes.toString());
  console.info("ENGINE_BINDING " + JSON.stringify({
    version: manifest.version,
    patch: manifest.patch,
    minify: true,
    manifestSha256: sha(bytes),
    sourceMapSha256: manifest.sourceMapSha256,
    patchedBundleSha256: sha(patchedBundle),
    patchedBundleBytes: Buffer.byteLength(patchedBundle),
    pinnedBundleSha256: sha(pinnedBundle),
    pinnedBundleBytes: Buffer.byteLength(pinnedBundle),
  }));
}

const script = (body) => `//@version=6\nindicator("Object copy oracle")\n${body}`;
const forms = [
  ["member", (name) => `${name}.copy()`],
  ["static", (name, type = "Cell") => `${type}.copy(${name})`],
];
const candle = (index, close, confirmed) => ({
  openTime: 1_700_000_000_000 + index * 60_000,
  closeTime: confirmed ? 1_700_000_060_000 + index * 60_000 : Date.now() + 3_600_000,
  open: close - 1,
  high: close + 2,
  low: close - 2,
  close,
  volume: 10,
});
// Only provider data changes; execution, compilation, objects and rollback are real.
async function run(source, realtime = false, Engine = PineTS) {
  let bars = [10, 20, 30, 40].map((close, index) => candle(index, close, index < 3));
  const provider = {
    configure() {},
    async getMarketData(symbol, timeframe, limit, start, end) {
      let selected = bars.filter((bar) => (start === undefined || bar.openTime >= start) && (end === undefined || bar.openTime <= end));
      if (limit !== undefined) selected = selected.slice(-limit);
      return selected.map((bar) => ({ ...bar }));
    },
    async getSymbolInfo() {
      return { tickerid: "TEST", ticker: "TEST", timezone: "UTC", session: "24x7", currency: "USD", mintick: 0.01, pricescale: 100, minmove: 1, pointvalue: 1 };
    },
  };
  const engine = new Engine(provider, "TEST", "1", bars.length);
  if (realtime) engine.setRealtimeMode(true);
  const context = await engine.run(source);
  return {
    context,
    async tick(close, confirmed = false) {
      bars[bars.length - 1] = candle(bars.length - 1, close, confirmed);
      assert.equal(await engine.updateTail(context, { confirmed }), true);
    },
    async append(close) {
      bars.push(candle(bars.length, close, false));
      assert.equal(await engine.updateTail(context, { confirmed: false }), true);
    },
  };
}
const values = (context, name) => context.plots[name].data.map((point) => point.value);
const tail = (context, name) => values(context, name).at(-1);
function every(context, name, expected, variant) {
  assert.deepEqual(values(context, name), [expected, expected, expected, expected], `${variant}: ${name}`);
}
function history(context) {
  return Object.fromEntries(Object.entries(context.plots).filter(([name]) => !name.startsWith("__")).map(([name, plot]) => [name, structuredClone(plot.data.slice(0, -1))]));
}
function unchanged(context, snapshot) {
  for (const [name, points] of Object.entries(snapshot)) assert.deepEqual(context.plots[name].data.slice(0, points.length), points, `${name}: committed values/options/times`);
}

// Official object-copy contract: current scalar values, distinct outer object,
// shallow special-type references. No TradingView pixel or whole-engine parity claim.
// https://www.tradingview.com/pine-script-docs/language/objects/#copying-objects
test("member and static copies use current scalar fields including late initialization and na", async () => {
  for (const [variant, copy] of forms) {
    const result = await run(script(`type Cell
    int count = 0
    float price = 1.5
    bool enabled = false
    string label = "default"
    color shade = color.red
    int late
    float missing
Cell original = Cell.new()
original.count := 9
original.price := 2.75
original.enabled := true
original.label := "changed"
original.shade := color.blue
original.late := 17
original.missing := na
Cell copied = ${copy("original")}
copied.count := 12
plot(original.count,"Original")
plot(copied.count,"Copied")
plot(copied.price,"Price")
plot(copied.enabled ? 1 : 0,"Enabled")
plot(copied.label == "changed" ? 1 : 0,"Label")
plot(copied.shade == color.blue ? 1 : 0,"Color")
plot(copied.late,"Late")
plot(copied.missing,"Missing")`));
    for (const [name, expected] of [["Original", 9], ["Copied", 12], ["Price", 2.75], ["Enabled", 1], ["Label", 1], ["Color", 1], ["Late", 17]]) every(result.context, name, expected, variant);
    assert.ok(values(result.context, "Missing").every(Number.isNaN), `${variant}: explicit na remains NaN`);
  }
});

test("copies of copies retain reassigned references shallowly and scalars independently", async () => {
  for (const [variant, copy] of forms) {
    const result = await run(script(`type Child
    int count = 1
type Cell
    int count = 0
    array<int> members
    map<string,int> lookup
    matrix<int> grid
    Child child
    chart.point point
Cell original = Cell.new(0,array.from(1),map.new<string,int>(),matrix.new<int>(1,1,1),Child.new(),chart.point.from_index(bar_index,1))
original.count := 9
original.members := array.from(10)
original.lookup := map.new<string,int>()
map.put(original.lookup,"key",20)
original.grid := matrix.new<int>(1,1,30)
original.child := Child.new(40)
original.point := chart.point.from_index(bar_index,50)
Cell first = ${copy("original")}
first.count := 12
first.members := array.from(60)
first.lookup := map.new<string,int>()
map.put(first.lookup,"key",70)
first.grid := matrix.new<int>(1,1,80)
first.child := Child.new(90)
first.point := chart.point.from_index(bar_index,100)
Cell second = ${copy("first")}
second.count := 15
array.set(second.members,0,61)
map.put(second.lookup,"key",71)
matrix.set(second.grid,0,0,81)
second.child.count := 91
second.point.price := 101
plot(original.count,"Original scalar")
plot(first.count,"First scalar")
plot(second.count,"Second scalar")
plot(array.get(original.members,0),"Original array")
plot(map.get(original.lookup,"key"),"Original map")
plot(matrix.get(original.grid,0,0),"Original matrix")
plot(original.child.count,"Original child")
plot(original.point.price,"Original point")
plot(array.get(first.members,0),"Shared array")
plot(map.get(first.lookup,"key"),"Shared map")
plot(matrix.get(first.grid,0,0),"Shared matrix")
plot(first.child.count,"Shared child")
plot(first.point.price,"Shared point")`));
    const expected = {
      "Original scalar": 9, "First scalar": 12, "Second scalar": 15,
      "Original array": 10, "Original map": 20, "Original matrix": 30,
      "Original child": 40, "Original point": 50,
      "Shared array": 61, "Shared map": 71, "Shared matrix": 81,
      "Shared child": 91, "Shared point": 101,
    };
    for (const [name, value] of Object.entries(expected)) every(result.context, name, value, variant);
  }
});

test("copied objects retain authored type method dispatch and do not mutate the original scalar", async () => {
  for (const [variant, copy] of forms) {
    const result = await run(script(`type Cell
    int count = 0
method add(Cell self,int amount) =>
    self.count += amount
    self.count
Cell original = Cell.new()
original.count := 9
Cell copied = ${copy("original")}
plot(copied.add(3),"Method")
plot(copied.count,"Copied")
plot(original.add(2),"Original method")
plot(original.count,"Original")`));
    every(result.context, "Method", 12, variant);
    every(result.context, "Copied", 12, variant);
    every(result.context, "Original method", 11, variant);
    every(result.context, "Original", 11, variant);
  }
});

test("static copy remains callable when an authored field is named copy", async () => {
  const result = await run(script(`type Cell
    int copy = 0
    int count
Cell original = Cell.new()
original.copy := 7
original.count := 9
Cell copied = Cell.copy(original)
copied.copy := 12
plot(original.copy,"Original")
plot(copied.copy,"Copied")
plot(copied.count,"Late")`));
  every(result.context, "Original", 7, "static");
  every(result.context, "Copied", 12, "static");
  every(result.context, "Late", 9, "static");
});

test("varip newborn copies roll ordinary fields to copied current birth values while explicit varip fields persist", async () => {
  for (const [variant, copy] of forms) {
    const result = await run(script(`type Cell
    int count = 0
    varip int ticks = 0
var Cell original = Cell.new()
original.count := 9
original.ticks := 20
varip Cell copied = na
if barstate.isrealtime
    if na(copied)
        copied := ${copy("original")}
    copied.count += 1
    copied.ticks += 1
plot(na(copied) ? na : copied.count,"Copied count")
plot(na(copied) ? na : copied.ticks,"Copied ticks")
plot(original.count,"Original count")
plot(original.ticks,"Original ticks")`), true);
    assert.equal(tail(result.context, "Copied count"), 10, variant);
    assert.equal(tail(result.context, "Copied ticks"), 21, variant);
    const past = history(result.context);
    for (const [close, ticks, confirmed] of [[41, 22, false], [42, 23, false], [43, 24, true]]) {
      await result.tick(close, confirmed);
      assert.equal(tail(result.context, "Copied count"), 10, variant);
      assert.equal(tail(result.context, "Copied ticks"), ticks, variant);
      assert.equal(tail(result.context, "Original count"), 9, variant);
      assert.equal(tail(result.context, "Original ticks"), 20, variant);
      unchanged(result.context, past);
    }
    const committed = Object.fromEntries(Object.entries(result.context.plots).filter(([name]) => !name.startsWith("__")).map(([name, plot]) => [name, structuredClone(plot.data)]));
    await result.append(50);
    assert.equal(tail(result.context, "Copied count"), 11, variant);
    assert.equal(tail(result.context, "Copied ticks"), 25, variant);
    unchanged(result.context, committed);
    await result.tick(51);
    assert.equal(tail(result.context, "Copied count"), 11, variant);
    assert.equal(tail(result.context, "Copied ticks"), 26, variant);
    unchanged(result.context, committed);
  }
});

test("copied ordinary and varip collection fields share references with correct tick rollback", async () => {
  for (const [variant, copy] of forms) {
    const result = await run(script(`type Cell
    array<int> ordinary
    varip array<int> intrabar
var Cell original = Cell.new(array.from(0),array.from(0))
if barstate.islastconfirmedhistory
    original.ordinary := array.from(10)
    original.intrabar := array.from(20)
varip Cell copied = na
if barstate.isrealtime
    if na(copied)
        copied := ${copy("original")}
    array.set(copied.ordinary,0,array.get(copied.ordinary,0)+1)
    array.set(copied.intrabar,0,array.get(copied.intrabar,0)+1)
plot(array.get(original.ordinary,0),"Ordinary original")
plot(array.get(original.intrabar,0),"Intrabar original")
plot(na(copied) ? na : array.get(copied.ordinary,0),"Ordinary copy")
plot(na(copied) ? na : array.get(copied.intrabar,0),"Intrabar copy")`), true);
    const past = history(result.context);
    for (const [close, intrabar, confirmed] of [[41, 22, false], [42, 23, false], [43, 24, true]]) {
      await result.tick(close, confirmed);
      for (const name of ["Ordinary original", "Ordinary copy"]) assert.equal(tail(result.context, name), 11, `${variant}: ${name}`);
      for (const name of ["Intrabar original", "Intrabar copy"]) assert.equal(tail(result.context, name), intrabar, `${variant}: ${name}`);
      unchanged(result.context, past);
    }
    await result.append(50);
    for (const name of ["Ordinary original", "Ordinary copy"]) assert.equal(tail(result.context, name), 12, `${variant}: ${name}`);
    for (const name of ["Intrabar original", "Intrabar copy"]) assert.equal(tail(result.context, name), 25, `${variant}: ${name}`);
  }
});

test("the pristine pinned engine reproduces the mutated-field defect repaired by the fork", async () => {
  const source = script(`type Cell
    int count = 0
Cell original = Cell.new()
original.count := 9
Cell copied = original.copy()
plot(original.count,"Original")
plot(copied.count,"Copied")`);
  const before = await run(source, false, PinnedPineTS);
  const after = await run(source);
  every(before.context, "Original", 9, "pinned");
  every(before.context, "Copied", 0, "pinned defect");
  every(after.context, "Original", 9, "patched");
  every(after.context, "Copied", 9, "patched repair");
});

test("overloaded methods distinguish both authored types on originals and member/static copies", async () => {
  for (const [variant, copy] of forms) {
    const source = script(`type A
    float value = na
type B
    float value = na
method bump(A self) =>
    self.value + 1
method bump(B self) =>
    self.value + 100
A a = A.new(close)
B b = B.new(close)
A copiedA = ${copy("a", "A")}
B copiedB = ${copy("b", "B")}
plot(a.bump(),"Original A")
plot(b.bump(),"Original B")
plot(copiedA.bump(),"Copied A")
plot(copiedB.bump(),"Copied B")`);
    for (const Engine of [PinnedPineTS, PineTS]) {
      const result = await run(source, false, Engine);
      for (const name of ["Original A", "Copied A"]) assert.deepEqual(values(result.context, name), [11, 21, 31, 41], `${variant}: ${name}`);
      for (const name of ["Original B", "Copied B"]) assert.deepEqual(values(result.context, name), [110, 120, 130, 140], `${variant}: ${name}`);
    }
  }
});
