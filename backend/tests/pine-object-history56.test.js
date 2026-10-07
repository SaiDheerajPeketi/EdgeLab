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
      contents: 'export { PineTS, Indicator } from "pinets";',
      loader: "ts",
      resolveDir: root,
      sourcefile: "pine-object-history56-fixture.ts",
    },
  });
  return result.outputFiles[0].text + `\n//# sourceURL=edgelab-history56-${patched ? "patched" : "pinned"}.mjs\n`;
}
const patchedBundle = await bundle(true);
const pinnedBundle = await bundle(false);
const load = async (source) => (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));
const { PineTS, Indicator } = await load(patchedBundle);
const { PineTS: PinnedPineTS, Indicator: PinnedIndicator } = await load(pinnedBundle);
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

const script = (body) => `//@version=6\nindicator("Object history oracle")\n${body}`;
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
async function run(source, realtime = false, Engine = PineTS, inputs = {}) {
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
  const context = await engine.run(typeof source === "function" ? source : new (Engine === PinnedPineTS ? PinnedIndicator : Indicator)(source, inputs));
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

// Valid v6 history addresses the object, then its field. The clamped tests
// always refer to an existing object, independently of first-bar na semantics.
// https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/#history-of-udt-fields
const header = `type Cell
    float price = na`;
const closes = [10, 20, 30, 40];
const previous = (offset, addend = 0) => closes.map((_, index) => closes[Math.max(0, index - offset)] + addend);

test("direct plot arguments bind typed and inferred zero-offset object fields", async () => {
  for (const declaration of ["Cell current", "current"]) {
    const result = await run(script(`${header}
${declaration} = Cell.new(close)
plot((current[0]).price,"Now")
float scalar = (current[0]).price
plot(scalar,"Assigned")`));
    assert.deepEqual(Object.keys(result.context.plots).filter((name) => !name.startsWith("__")), ["Now", "Assigned"]);
    assert.deepEqual(values(result.context, "Now"), closes);
    assert.deepEqual(values(result.context, "Assigned"), closes);
  }
});

test("real input-selected offsets zero one and two use existing clamped object history", async () => {
  const source = script(`${header}
lookback = input.int(1,"Lookback",minval=0,maxval=3)
Cell current = Cell.new(close)
plot((current[math.min(bar_index,lookback)]).price,"Previous")`);
  for (const lookback of [0, 1, 2]) {
    const result = await run(source, false, PineTS, { in_0: lookback });
    assert.deepEqual(values(result.context, "Previous"), previous(lookback));
    assert.equal(result.context.plots.Previous.data.length, 4);
  }
});

test("guarded previous-object fields and methods retain first-bar na and exact channel history", async () => {
  const result = await run(script(`${header}
method plus(Cell self) =>
    self.price + 1
Cell current = Cell.new(close)
Cell prior = current[1]
plot(bar_index > 0 ? (current[1]).price : na,"Direct")
plot(na(prior) ? na : prior.price,"Named")
plot(na(prior) ? na : prior.plus(),"Method")`));
  assert.deepEqual(Object.keys(result.context.plots).filter((name) => !name.startsWith("__")), ["Direct", "Named", "Method"]);
  for (const name of ["Direct", "Named"]) assert.deepEqual(values(result.context, name), [NaN, 10, 20, 30]);
  assert.deepEqual(values(result.context, "Method"), [NaN, 11, 21, 31]);
});

test("member and static copied-object history retains the copied current field values", async () => {
  for (const [variant, copy] of forms) {
    const result = await run(script(`${header}
Cell current = Cell.new(0)
current.price := close + 5
Cell copied = ${copy("current")}
Cell prior = copied[math.min(bar_index,1)]
plot((copied[math.min(bar_index,1)]).price,"Direct")
plot(prior.price,"Named")`));
    for (const name of ["Direct", "Named"]) assert.deepEqual(values(result.context, name), previous(1, 5), `${variant}: ${name}`);
  }
});

test("nested UDT and chart-point fields select the prior per-bar outer object", async () => {
  const result = await run(script(`type Child
    float price = na
type Cell
    Child child
    chart.point point
Cell current = Cell.new(Child.new(0),chart.point.from_index(bar_index,0))
current.child := Child.new(close+2)
current.point := chart.point.from_index(bar_index,close+3)
Cell prior = current[math.min(bar_index,1)]
plot((current[math.min(bar_index,1)]).child.price,"Nested direct")
plot(prior.child.price,"Nested named")
plot((current[math.min(bar_index,1)]).point.price,"Point direct")`));
  for (const name of ["Nested direct", "Nested named"]) assert.deepEqual(values(result.context, name), previous(1, 2));
  assert.deepEqual(values(result.context, "Point direct"), previous(1, 3));
});

test("history retains persistent and shallow nested reference identities instead of deep snapshots", async () => {
  const result = await run(script(`type Child
    float price = na
type Cell
    float price = na
    Child child
var Child shared = Child.new(0)
var Cell persistent = Cell.new(0,shared)
persistent.price := close
shared.price := close+5
Cell fresh = Cell.new(close,shared)
plot((persistent[math.min(bar_index,1)]).price,"Persistent")
plot((fresh[math.min(bar_index,1)]).price,"Fresh scalar")
plot((fresh[math.min(bar_index,1)]).child.price,"Shared child")`));
  assert.deepEqual(values(result.context, "Persistent"), closes);
  assert.deepEqual(values(result.context, "Fresh scalar"), previous(1));
  assert.deepEqual(values(result.context, "Shared child"), closes.map((close) => close + 5));
});

test("previous copied fields stay committed through real tick close and append updates", async () => {
  const result = await run(script(`${header}
Cell current = Cell.new(close)
Cell copied = current.copy()
plot((current[math.min(bar_index,1)]).price,"Previous")
plot((copied[math.min(bar_index,1)]).price,"Copied previous")
plot((current[0]).price,"Current")`), true);
  const past = history(result.context);
  for (const [close, confirmed] of [[41, false], [42, false], [43, true]]) {
    await result.tick(close, confirmed);
    assert.equal(tail(result.context, "Current"), close);
    assert.equal(tail(result.context, "Previous"), 30);
    assert.equal(tail(result.context, "Copied previous"), 30);
    unchanged(result.context, past);
  }
  const committed = Object.fromEntries(Object.entries(result.context.plots).filter(([name]) => !name.startsWith("__")).map(([name, plot]) => [name, structuredClone(plot.data)]));
  await result.append(50);
  for (const name of ["Previous", "Copied previous"]) assert.equal(tail(result.context, name), 43);
  assert.equal(tail(result.context, "Current"), 50);
  unchanged(result.context, committed);
  await result.tick(51);
  for (const name of ["Previous", "Copied previous"]) assert.equal(tail(result.context, name), 43);
  unchanged(result.context, committed);
});

test("history receivers preserve overloaded methods for original and copied types", async () => {
  const result = await run(script(`type A
    float price = na
type B
    float price = na
method plus(A self) =>
    self.price + 1
method plus(B self) =>
    self.price + 100
A a = A.new(close)
B b = B.new(close)
A copiedA = a.copy()
B copiedB = B.copy(b)
A priorA = copiedA[math.min(bar_index,1)]
B priorB = copiedB[math.min(bar_index,1)]
plot((a[math.min(bar_index,1)]).plus(),"Direct A")
plot((b[math.min(bar_index,1)]).plus(),"Direct B")
plot(priorA.plus(),"Copied A")
plot(priorB.plus(),"Copied B")`));
  for (const name of ["Direct A", "Copied A"]) assert.deepEqual(values(result.context, name), previous(1, 1));
  for (const name of ["Direct B", "Copied B"]) assert.deepEqual(values(result.context, name), previous(1, 100));
});

test("valid v5 direct-field history remains pinned-compatible without a v6 parity claim", async () => {
  const source = `//@version=5
indicator("Legacy field history")
type Cell
    float price = na
Cell current = Cell.new(close)
plot(current.price[1],"Legacy")`;
  const baseline = await run(source, false, PinnedPineTS);
  const patched = await run(source);
  assert.deepEqual(patched.context.plots.Legacy, baseline.context.plots.Legacy);
});

test("nested namespace calls and typed function/method parameters bind existing zero-offset objects", async () => {
  const result = await run(script(`${header}
read(Cell object) =>
    (object[0]).price
method priceNow(Cell self) =>
    (self[0]).price
Cell current = Cell.new(close)
plot(math.abs((current[0]).price),"Namespace")
plot(read(current),"Function")
plot(current.priceNow(),"Method")`));
  for (const name of ["Namespace", "Function", "Method"]) assert.deepEqual(values(result.context, name), closes);
});

test("the pristine engine reproduces direct zero-offset binding failure while the fork fixes it", async () => {
  for (const declaration of ["Cell current", "current"]) {
    const source = script(`${header}
${declaration} = Cell.new(close)
plot((current[0]).price,"Now")`);
    await assert.rejects(run(source, false, PinnedPineTS), { name: "ReferenceError", message: "current is not defined" });
    const result = await run(source);
    assert.deepEqual(values(result.context, "Now"), closes);
  }
});

test("v6 rejects direct known-UDT field history including nested fields and typed parameters", async () => {
  const diagnostic = "Pine v6 cannot reference UDT field history directly; use (object[offset]).field.";
  const bodies = [
    `${header}
Cell current = Cell.new(close)
plot(current.price[1],"Bad")`,
    `${header}
current = Cell.new(close)
plot(current.price[1],"Bad")`,
    `type Child
    float price = na
type Parent
    Child child
Parent current = Parent.new(Child.new(close))
plot(current.child.price[1],"Bad")`,
    `${header}
read(Cell object) =>
    object.price[1]
Cell current = Cell.new(close)
plot(read(current),"Bad")`,
    `${header}
method previous(Cell self) =>
    self.price[1]
Cell current = Cell.new(close)
plot(current.previous(),"Bad")`,
  ];
  for (const body of bodies) await assert.rejects(run(script(body)), (error) => error.message === diagnostic);
});

test("valid extracted scalar history and namespace calls retain their prior numerical behavior", async () => {
  const source = script(`${header}
Cell current = Cell.new(close)
float price = current.price
plot(price[1],"Extracted")
plot(math.abs(close[1]),"Namespace")
plot(ta.sma(close,1)[1],"Average")`);
  for (const Engine of [PinnedPineTS, PineTS]) {
    const result = await run(source, false, Engine);
    for (const name of ["Extracted", "Namespace", "Average"]) assert.deepEqual(values(result.context, name), [NaN, 10, 20, 30]);
  }
});

test("genuine JavaScript function inputs preserve ordinary nested array-index field reads", async () => {
  const source = (context) => {
    const { plot } = context.pine;
    const record = { rows: [{ price: 1 }, { price: 2 }] };
    plot(record.rows[1].price, "JavaScript");
  };
  for (const Engine of [PinnedPineTS, PineTS]) {
    const result = await run(source, false, Engine);
    assert.deepEqual(values(result.context, "JavaScript"), [2, 2, 2, 2]);
  }
});

test("constructor copy and typed-factory call results expose current zero-offset fields", async () => {
  const result = await run(script(`${header}
make(float price) =>
    Cell.new(price)
Cell current = Cell.new(0)
current.price := close + 5
plot((Cell.new(close)[0]).price,"Constructor")
plot((current.copy()[0]).price,"Member copy")
plot((Cell.copy(current)[0]).price,"Static copy")
plot((make(close)[0]).price,"Factory")`));
  for (const name of ["Constructor", "Factory"]) assert.deepEqual(values(result.context, name), closes);
  for (const name of ["Member copy", "Static copy"]) assert.deepEqual(values(result.context, name), closes.map((close) => close + 5));
});
