import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundled = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false, logLevel: "silent",
  plugins: [createPineEnginePlugin()], define: { "import.meta.env": "{}" }, stdin: {
    contents: 'export * from "./frontend/src/lib/pineInteractiveInputs.ts"; export {executePineRequest} from "./frontend/src/workers/pineNative.worker.ts";',
    loader: "ts", resolveDir: new URL("../../", import.meta.url).pathname,
  },
})).outputFiles[0].text;
const pine = await import("data:text/javascript;base64," + Buffer.from(bundled).toString("base64"));
const bars = Array.from({ length: 4 }, (_, i) => ({ time: 1700000040 + i * 60, open: 100, high: 102, low: 98, close: 100, volume: 10 }));
const request = (body, action = "prepare", inputs = {}, version = 6) => ({ id: "interactive134", action,
  source: `//@version=${version}\nindicator("Interactive134",overlay=true)\n${body}`, inputs,
  ...(action === "run" ? { bars, context: { symbol: "TEST", timeframe: "1" } } : {}),
});
const basic = 'p=input.price(1.5,"Price",inline="A",group="Point",confirm=true)\nt=input.time(0,"Time",inline="A",group="Point",confirm=true)\nplot(p,"Price")\nplot(t,"Time")';
const prepare = async body => (await pine.executePineRequest(request(body))).inputDefinitions;
const definition = (id, type, extra = {}) => ({ id, type, name: id, defval: type === "price" ? 10 : type === "time" ? 0 : true, ...extra });

test("genuine v5/v6 prepared inputs yield a single ordered point and atomic millisecond patches drive actual script outputs", async () => {
  for (const version of [5, 6]) {
    const prepared = await pine.executePineRequest(request(basic, "prepare", {}, version));
    const defs = prepared.inputDefinitions, anchors = pine.pineInputAnchors(defs);
    assert.equal(anchors.length, 1); const anchor = anchors[0];
    assert.deepEqual(anchor, { id: `point:${defs[0].id}:${defs[1].id}`, kind: "point", priceId: defs[0].id, timeId: defs[1].id, label: "Price / Time" });
    assert.deepEqual(pine.pineAnchorValues(anchor, defs, {}), { price: 1.5, time: 0 });
    for (const time of [-1, 0, 1700000040123]) {
      const patch = pine.pineAnchorPatch(anchor, { price: 2.75, time }, defs);
      assert.deepEqual(patch, { [defs[0].id]: 2.75, [defs[1].id]: time });
      const result = await pine.executePineRequest(request(basic, "run", patch, version));
      assert.deepEqual(result.plots[0].points.map(point => point.value), [2.75, 2.75, 2.75, 2.75]);
      assert.deepEqual(result.plots[1].points.map(point => point.value), [time, time, time, time]);
    }
  }
});

test("anchor order follows the first declaration, inline/group keys are exact, and any third declaration prevents pairing", () => {
  const defs = [definition("in_0", "time", { inline: "a", group: "G", title: "First" }),
    definition("in_1", "string", { inline: "x" }), definition("in_2", "price", { inline: "a", group: "G", title: "Second" }),
    definition("in_3", "price", { inline: "b", group: "G" }), definition("in_4", "time", { inline: "b", group: "Other" }),
    definition("in_5", "price", { inline: "c" }), definition("in_6", "time", { inline: "c" }), definition("in_7", "bool", { inline: "c" }),
    definition("in_8", "price", { inline: "" }), definition("in_9", "time", { inline: "" }),
    definition("in_10", "price", { inline: "A", group: "G" }), definition("in_11", "time", { inline: "a", group: "g" })];
  const anchors = pine.pineInputAnchors(defs);
  assert.deepEqual(anchors.map(anchor => anchor.id), ["point:in_2:in_0", "in_3", "in_4", "in_5", "in_6", "in_8", "in_9", "in_10", "in_11"]);
  assert.equal(anchors[0].label, "First / Second");
  assert.deepEqual(pine.pineAnchorValues(anchors[0], defs, {}), { price: 10, time: 0 });
  const separators = [definition("in_0", "price", { group: "x|y", inline: "z" }), definition("in_1", "time", { group: "x", inline: "y|z" })];
  assert.deepEqual(pine.pineInputAnchors(separators).map(anchor => anchor.kind), ["price", "time"]);
});

test("point activity evaluates both real dependent input expressions without resetting disabled saved values", async () => {
  const defs = await prepare('enabled=input.bool(false,"Enabled")\np=input.price(1,"Price",inline="A",active=enabled)\nt=input.time(0,"Time",inline="A",active=enabled)\nplot(p)');
  const anchor = pine.pineInputAnchors(defs)[0];
  assert.equal(pine.pineAnchorActive(anchor, defs, {}), false);
  assert.equal(pine.pineAnchorActive(anchor, defs, { [defs[0].id]: true }), true);
  assert.equal(pine.pineAnchorActive(anchor, defs, { [defs[0].id]: false }), false);
  const inputs = { [defs[0].id]: false, [anchor.priceId]: 7.5, [anchor.timeId]: -123 };
  assert.deepEqual(pine.pineAnchorValues(anchor, defs, inputs), { price: 7.5, time: -123 });
  const disabled = structuredClone(defs); disabled[2].activeCondition = undefined; disabled[2].active = false;
  assert.equal(pine.pineAnchorActive(anchor, disabled, { [defs[0].id]: true }), false);
});

test("atomic pair patches reject missing members, nonfinite prices, fractional/unsafe times and declared bounds/options without snapping step", () => {
  const defs = [definition("in_0", "price", { inline: "pair", minval: 0, maxval: 2, step: .5 }), definition("in_1", "time", { inline: "pair", minval: -1000, maxval: 1000 })];
  const anchor = pine.pineInputAnchors(defs)[0];
  const held = structuredClone(defs);
  assert.deepEqual(pine.pineAnchorPatch(anchor, { price: 1.75, time: -1 }, defs), { in_0: 1.75, in_1: -1 });
  for (const values of [{}, { price: 1 }, { time: 0 }, { price: NaN, time: 0 }, { price: Infinity, time: 0 }, { price: -1, time: 0 }, { price: 3, time: 0 }, { price: 1, time: .1 }, { price: 1, time: 1001 }, { price: 1, time: -1001 }, { price: 1, time: 2 ** 53 }, { price: "1", time: 0 }, { price: 1, time: "0" }]) assert.equal(pine.pineAnchorPatch(anchor, values, defs), null);
  assert.deepEqual(defs, held);
  defs[0].options = [0, 1.75, 2]; defs[1].options = [-1, 0];
  assert.equal(pine.pineAnchorPatch(anchor, { price: 1, time: 0 }, defs), null);
  assert.equal(pine.pineAnchorPatch(anchor, { price: 1.75, time: 1 }, defs), null);
  assert.deepEqual(pine.pineAnchorPatch(anchor, { price: 0, time: 0 }, defs), { in_0: 0, in_1: 0 });
});

test("single anchors patch only their own declared field; stale, forged and ambiguous identities never update inputs", () => {
  const defs = [definition("in_0", "price"), definition("in_1", "time")];
  const [price, time] = pine.pineInputAnchors(defs);
  assert.deepEqual(pine.pineAnchorPatch(price, { price: 0, time: 50 }, defs), { in_0: 0 });
  assert.deepEqual(pine.pineAnchorPatch(time, { time: -1, price: 50 }, defs), { in_1: -1 });
  for (const anchor of [{ ...price, priceId: "in_1" }, { ...time, timeId: "missing" }, { ...price, kind: "point", timeId: "in_1" }]) {
    assert.equal(pine.pineAnchorPatch(anchor, { price: 1, time: 0 }, defs), null);
    assert.equal(pine.pineAnchorValues(anchor, defs, {}), undefined);
    assert.equal(pine.pineAnchorActive(anchor, defs, {}), false);
  }
  const paired = defs.map(item => ({ ...item, inline: "A" })), old = pine.pineInputAnchors(paired)[0];
  paired.push(definition("in_2", "bool", { inline: "A" }));
  assert.equal(pine.pineAnchorPatch(old, { price: 1, time: 0 }, paired), null);
  assert.equal(pine.pineAnchorPatch(price, { price: 1 }, [...defs, { ...defs[0] }]), null);
});

test("applied anchor values preserve zero and integer milliseconds while malformed or out-of-range saved pairs stay absent", () => {
  const defs = [definition("in_0", "price", { inline: "A", minval: 0 }), definition("in_1", "time", { inline: "A" })], anchor = pine.pineInputAnchors(defs)[0];
  assert.deepEqual(pine.pineAnchorValues(anchor, defs, { in_0: 0, in_1: -1 }), { price: 0, time: -1 });
  for (const inputs of [{ in_0: -1 }, { in_0: "1" }, { in_0: NaN }, { in_1: .001 }, { in_1: Infinity }, { in_1: 2 ** 53 }, { in_1: undefined }]) assert.equal(pine.pineAnchorValues(anchor, defs, inputs), undefined);
});

test("explicit UTC formatting/parsing round-trips milliseconds, epoch zero and pre-1970 dates independent of host timezone", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
      process.env.TZ = timezone;
      for (const timestamp of [-2208988800123, -1, 0, 1, 1700000040123, 253402300799999]) assert.equal(pine.parsePineUtcTime(pine.formatPineUtcTime(timestamp)), timestamp);
      assert.equal(pine.formatPineUtcTime(0), "1970-01-01T00:00:00.000");
      assert.equal(pine.parsePineUtcTime("1969-12-31T23:59:59.999"), -1);
      assert.equal(pine.parsePineUtcTime("1970-01-01T00:00"), 0);
      assert.equal(pine.parsePineUtcTime("1970-01-01T00:00:00.1"), 100);
      assert.equal(pine.parsePineUtcTime("1970-01-01T00:00:00.01"), 10);
      assert.equal(pine.formatPineUtcTime(pine.parsePineUtcTime("0099-01-01T00:00:00.123")), "0099-01-01T00:00:00.123");
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("incomplete, invalid calendar or timezone-bearing UTC drafts do not become a timestamp or roll into another date", () => {
  for (const draft of ["", "2024-", "2024-02-30T12:00", "2023-02-29T12:00", "2024-13-01T12:00", "2024-00-01T12:00", "2024-01-00T12:00", "2024-01-32T12:00", "2024-01-01T24:00", "2024-01-01T12:60", "2024-01-01T12:00:60", "2024-01-01T12:00:00.0001", "2024-01-01T12:00Z", "2024-01-01T12:00+05:30", "not a date", "Infinity", "999999-01-01T00:00"]) assert.equal(pine.parsePineUtcTime(draft), undefined, draft);
  for (const value of [null, undefined, false, "0", NaN, Infinity, .1, 2 ** 53]) assert.equal(pine.formatPineUtcTime(value), "");
  const leap = pine.parsePineUtcTime("2024-02-29T12:34:56.789"); assert.equal(pine.formatPineUtcTime(leap), "2024-02-29T12:34:56.789");
});
