import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Runtime failures must not print a complete data-URL bundle.
Error.stackTraceLimit = 0;

const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({
  bundle: true, minify: true, format: "esm", platform: "browser", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()],
  stdin: { contents: 'export { PineTS, Indicator, Context, Series } from "pinets";',
    loader: "ts", resolveDir: root, sourcefile: "pine-enum-runtime93.ts" },
})).outputFiles[0].text;
const { PineTS, Indicator, Context, Series } = await import(
  "data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const bar = (i, close) => ({ openTime: 1_700_000_000_000 + i * 60_000,
  closeTime: Date.now() + 3_600_000, open: close - 1, high: close + 2,
  low: close - 2, close, volume: 10 });
const bars = [10, 20, 30, 40].map((close, i) => bar(i, close));
const source = (body, version = 6) => '//@version=' + version + '\nindicator("Enum identity")\n' + body;
const enums = 'enum Side\n    a = "Same"\n    b = "Same"\nenum Other\n    a = "Same"\n';
const run = (body, inputs = {}, version = 6) => new PineTS(bars, "TEST", "1").run(
  new Indicator(source(body, version), inputs));
const values = (context, title) => context.plots[title].data.map(point => point.value);
const context = () => new Context({ marketData: bars, source: bars });

test("actual minified Context interns immutable opaque members per full context", () => {
  const first = context(), other = context();
  const a = first.pine.Type._enumMember("Side", "a", "Same");
  const b = first.pine.Type._enumMember("Side", "b", "Same");
  assert.equal(a, first.pine.Type._enumMember("Side", "a", "Same"));
  assert.notEqual(a, b);
  assert.notEqual(a, first.enumMember("Other", "a", "Same"));
  assert.equal(Object.isFrozen(a), true);
  assert.equal(Object.isFrozen(Object.getPrototypeOf(a)), true);
  assert.throws(() => String(a), /enum/i);
  assert.throws(() => +a, /enum/i);
  assert.notEqual(Object.getPrototypeOf(a), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(a), []);
  assert.deepEqual(first.enumInfo(a), { id: "Side.a", type: "Side", title: "Same" });
  assert.equal(other.enumInfo(a), undefined);
  assert.notEqual(other.enumMember("Side", "a", "Same"), a);
  const page = new Context({ marketData: bars, source: bars, fullContext: first });
  assert.equal(page.enumMember("Side", "a", "Same"), a);
  assert.equal(first.precision(a), a);
  const history = new Series([a, b, a]);
  assert.equal(history.get(1), b);
  assert.equal(first.param(history, 1, "enumHistory").get(0), b);
  assert.throws(() => first.enumMember("Side", "a", "Changed"), /conflict/i);
});

test("v5/v6 duplicate titles never collapse members or unrelated enum types", async () => {
  for (const version of [5, 6]) {
    const result = await run(enums + 'choice=Side.a\nplot(choice==Side.a?1:0,"Self")\nplot(choice==Side.b?1:0,"Other member")', {}, version);
    assert.deepEqual(values(result, "Self"), [1, 1, 1, 1]);
    assert.deepEqual(values(result, "Other member"), [0, 0, 0, 0]);
    await assert.rejects(run(enums + 'plot(Side.a==Other.a?1:0,"Invalid")', {}, version), /enum|type/i);
  }
});

test("positional/named enum declarations translate exact host IDs back to canonical members", async () => {
  for (const declaration of [
    'choice=input.enum(Side.a,"Pick",options=[Side.a,Side.b])',
    'choice=input.enum(defval=Side.a,title="Pick",options=[Side.a,Side.b])',
  ]) {
    const body = enums + declaration + '\nplot(choice==Side.a?1:choice==Side.b?2:0,"Choice")';
    assert.deepEqual(values(await run(body), "Choice"), [1, 1, 1, 1]);
    assert.deepEqual(values(await run(body, { in_0: "Side.b" }), "Choice"), [2, 2, 2, 2]);
    for (const invalid of ["Same", "Other.a", "Side.unknown"]) {
      await assert.rejects(run(body, { in_0: invalid }), /allowed enum|enum member/i);
    }
  }
});

test("authored strings never masquerade as enum defaults or option members", async () => {
  for (const declaration of [
    'choice=input.enum("Side.a","Pick")',
    'choice=input.enum(defval="Side.a",title="Pick")',
    'choice=input.enum(Side.a,"Pick",options=["Side.a"])',
    'choice=input.enum(Side.a,"Pick",options=[Other.a])',
  ]) await assert.rejects(run(enums + declaration + '\nplot(1)'), /enum|member/i);
});

test("enum string conversion uses labels explicitly; direct format rejects tokens", async () => {
  const result = await run(enums + 'plot(str.tostring(Side.a)=="Same"?1:0,"Label")\nplot(str.tostring(Side.b)=="Same"?1:0,"Duplicate label")');
  assert.deepEqual(values(result, "Label"), [1, 1, 1, 1]);
  assert.deepEqual(values(result, "Duplicate label"), [1, 1, 1, 1]);
  await assert.rejects(run(enums + 'message=str.format("{0}",Side.a)\nplot(1)'), /str.format.*enum|enum.*str.tostring/i);
});

test("array/map copies preserve exact enum keys and history identity", async () => {
  const result = await run(enums + 'choice=bar_index%2==0?Side.a:Side.b\nitems=array.from(Side.a,Side.b)\nclone=array.copy(items)\nlookup=map.new<Side,int>()\nmap.put(lookup,Side.a,7)\nmap.put(lookup,Side.b,9)\ncopy=map.copy(lookup)\nplot(array.includes(clone,Side.a)?1:0,"Contains")\nplot(array.indexof(clone,Side.b),"Index")\nplot(map.get(copy,Side.a),"A")\nplot(map.get(copy,Side.b),"B")\nplot(bar_index>0?(choice[1]==Side.a?1:2):0,"History")');
  assert.deepEqual(values(result, "Contains"), [1, 1, 1, 1]);
  assert.deepEqual(values(result, "Index"), [1, 1, 1, 1]);
  assert.deepEqual(values(result, "A"), [7, 7, 7, 7]);
  assert.deepEqual(values(result, "B"), [9, 9, 9, 9]);
  assert.deepEqual(values(result, "History"), [0, 1, 2, 1]);
});

test("realtime rollback preserves enum identity and ordinary/varip collection semantics", async () => {
  const current = bars.map(value => ({ ...value }));
  const provider = {
    configure() {},
    async getMarketData(_symbol, _timeframe, limit, start, end) {
      let result = current.filter(value => (start === undefined || value.openTime >= start) &&
        (end === undefined || value.openTime <= end));
      if (limit !== undefined) result = result.slice(-limit);
      return result.map(value => ({ ...value }));
    },
    async getSymbolInfo() { return { tickerid: "TEST", timezone: "UTC", session: "24x7",
      currency: "USD", mintick: .01, pricescale: 100, minmove: 1, pointvalue: 1 }; },
  };
  const engine = new PineTS(provider, "TEST", "1", current.length);
  engine.setRealtimeMode(true);
  const result = await engine.run(source(enums + 'var ordinary=array.from(Side.a)\nvarip retained=array.from(Side.a)\nplot(array.get(ordinary,0)==Side.a?1:0,"Ordinary")\nplot(array.get(retained,0)==Side.a?1:0,"Retained")\narray.set(ordinary,0,close>40?Side.b:Side.a)\narray.set(retained,0,close>40?Side.b:Side.a)'));
  const before = values(result, "Ordinary").slice(0, -1);
  current[3] = bar(3, 41);
  await engine.updateTail(result, { confirmed: false, received: true });
  assert.equal(values(result, "Ordinary").at(-1), 1);
  current[3] = bar(3, 42);
  await engine.updateTail(result, { confirmed: false, received: true });
  assert.equal(values(result, "Ordinary").at(-1), 1);
  assert.equal(values(result, "Retained").at(-1), 0);
  assert.deepEqual(values(result, "Ordinary").slice(0, -1), before);
  await engine.updateTail(result, { confirmed: true, received: true });
  current.push(bar(4, 43));
  await engine.updateTail(result, { confirmed: false, received: true });
  assert.equal(values(result, "Ordinary").at(-1), 0);
  assert.equal(values(result, "Retained").at(-1), 0);
});

test("JavaScript input.enum retains the upstream string contract", async () => {
  const result = await new PineTS(bars, "TEST", "1").run(context => {
    const { input, plot } = context.pine;
    const selected = input.enum("legacy", "JS");
    plot(selected === "legacy" ? 1 : 0, "Selected");
  });
  assert.deepEqual(values(result, "Selected"), [1, 1, 1, 1]);
});

test("string methods reject enum arguments at the actual runtime boundary", async () => {
  const ctx = context();
  const member = ctx.enumMember("Side", "a", "Same");
  const str = ctx.pine.str;
  assert.equal(str.tostring(member), "Same");
  for (const call of [
    () => str.length(member), () => str.lower(member), () => str.upper(member),
    () => str.trim(member), () => str.tonumber(member), () => str.match("text", member),
    () => str.replace_all("text", member, "x"), () => str.contains(member, "x"),
    () => str.repeat("x", member), () => str.substring("text", member, 2),
    () => str.format_time(member), () => str.format("{0}", member),
    () => str.tostring(member, "#"), () => str.tostring(1, member),
  ]) assert.throws(call, /enum/i);
  assert.equal(str.length("Same"), 4);
  assert.equal(str.repeat("x", 2), "xx");
  assert.deepEqual(str.match("null", null), "null".match(new RegExp(null)));
  await assert.rejects(run(enums + 'plot(str.length(Side.a))'), /enum/i);
  assert.deepEqual(values(await run(enums + 'plot(str.length(str.tostring(Side.a)),"Length")'), "Length"), [4, 4, 4, 4]);
});

test("typed enum methods dispatch distinct bodies by canonical receiver type", async () => {
  for (const version of [5, 6]) {
    const result = await run(enums + 'method choose(Side self,Side value)=>11\nmethod choose(Other self,Other value)=>22\nplot(Side.a.choose(Side.b),"Side")\nplot(Other.a.choose(Other.a),"Other")', {}, version);
    assert.deepEqual(values(result, "Side"), [11, 11, 11, 11]);
    assert.deepEqual(values(result, "Other"), [22, 22, 22, 22]);
  }
});

test("same enum receiver dispatch uses exact enum argument identities", async () => {
  const methods = 'method choose(Side self,int middle,Side value)=>11\nmethod choose(Side self,int middle,Other value)=>22\n';
  for (const version of [5, 6]) {
    const result = await run(enums + methods + 'plot(Side.a.choose(3,Side.b),"Side argument")\nplot(Side.a.choose(3,Other.a),"Other argument")', {}, version);
    assert.deepEqual(values(result, "Side argument"), [11, 11, 11, 11]);
    assert.deepEqual(values(result, "Other argument"), [22, 22, 22, 22]);
    await assert.rejects(run(enums + methods + 'Other missing=na\nplot(Side.a.choose(3,missing))', {}, version), /ambiguous enum method.*identity/i);
  }
});
