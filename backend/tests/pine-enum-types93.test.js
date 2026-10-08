import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser",
  write: false, logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";export * from "./frontend/src/lib/pineProtocol.ts";',
    loader: "ts", resolveDir: root, sourcefile: "pine-enum-types93.ts",
  } })).outputFiles[0].text;
const worker = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const bars = JSON.parse(fs.readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url))).slice(0, 4);
const enums = 'enum Side\n    up="Same"\n    down="Same"\n    neutral\nenum Other\n    up="Same"\n';
const source = (body, version = 6) => '//@version=' + version + '\nindicator("Enum types93")\n' + body;
const request = (code, action = "prepare", inputs = {}) => ({ id: "types93", action, source: code, inputs,
  ...(action === "run" ? { bars, context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } } : {}) });
const execute = async (body, action = "prepare", inputs = {}, version = 6) => {
  try { return await worker.executePineRequest(request(source(body, version), action, inputs)); }
  catch (error) { error.stack = error.name + ': ' + error.message; throw error; }
};
const constantPlot = (result, value) => assert.deepEqual(result.plots[0].points.map(point => point.value), Array(4).fill(value));

test("canonical metadata includes all ordered members with duplicate labels and option subsets", async () => {
  for (const version of [5, 6]) {
    const body = enums + 'const Side chosen=Side.down\nchoice=input.enum(chosen,"Choice",options=[Side.down,Side.neutral])\nplot(choice==Side.down?2:3)';
    const prepared = await execute(body, "prepare", {}, version), definition = prepared.inputDefinitions[0];
    assert.deepEqual({ version: definition.enumVersion, type: definition.enumType, members: definition.enumMembers }, {
      version: 1, type: "Side", members: [{ id: "Side.up", label: "Same" }, { id: "Side.down", label: "Same" }, { id: "Side.neutral", label: "neutral" }],
    });
    assert.equal(definition.defval, "Side.down");
    assert.deepEqual(definition.options, ["Side.down", "Side.neutral"]);
    constantPlot(await execute(body, "run", { [definition.id]: "Side.neutral" }, version), 3);
  }
});

test("constant aliases and string conversion remain separate from enum identity", async () => {
  const body = enums + 'const Side first=Side.up\nconst Side second=first\nchoice=input.enum(second,"Choice")\ncaption=input.string(str.tostring(Side.down),"Text")\nplot(choice==Side.up and caption=="Same"?1:0)';
  const prepared = await execute(body);
  assert.equal(prepared.inputDefinitions[0].defval, "Side.up");
  assert.equal(prepared.inputDefinitions[1].defval, "Same");
  constantPlot(await execute(body, "run"), 1);
});

test("foreign types reject in direct inferred typed historical and unreachable comparisons", async () => {
  for (const tail of [
    'plot(Side.up==Other.up?1:0)',
    'chosen=Side.up\nplot(chosen!=Other.up?1:0)',
    'Side chosen=Side.up\nplot(chosen[1]==Other.up?1:0)',
    'if false\n    invalid=Side.up==Other.up\nplot(1)',
    'plot(true?1:(Side.up==Other.up?2:3))',
    'plot(Side.up==close?1:0)',
    'plot(bar_index==Side.up?1:0)',
    'plot(Side.up==barstate.isfirst?1:0)',
    'plot(Side.up==syminfo.ticker?1:0)',
  ]) await assert.rejects(execute(enums + tail), /Incompatible enum types.*comparison/i);
});

test("declarations and reassignment retain declared or inferred enum type and permit NA", async () => {
  for (const tail of [
    'Side chosen=Other.up\nplot(1)',
    'chosen=Side.up\nchosen:=Other.up\nplot(1)',
    'Side chosen=na\nchosen:="Same"\nplot(1)',
    'chosen=Side.up\nchosen:=1\nplot(1)',
    'chosen=Side.up\nchosen:=bar_index\nplot(1)',
  ]) await assert.rejects(execute(enums + tail), /Incompatible enum types/i);
  constantPlot(await execute(enums + 'Side chosen=na\nchosen:=Side.down\nplot(chosen==Side.down?1:0)', "run"), 1);
});

test("typed function parameters and inferred returned enum values reject foreign calls", async () => {
  for (const tail of [
    'accept(Side value)=>value==Side.up\nplot(accept(Other.up)?1:0)',
    'accept(Side value)=>value\nchosen=accept(Side.up)\nplot(chosen==Other.up?1:0)',
    'accept(Side value)=>value\nSide chosen=accept(Other.up)\nplot(1)',
    'accept(Side value)=>value\nplot(accept(value=Other.up)==Side.up?1:0)',
    'accept(Side value)=>value\nplot(accept(close)==Side.up?1:0)',
  ]) await assert.rejects(execute(enums + tail), /Incompatible enum types/i);
  constantPlot(await execute(enums + 'accept(Side value)=>value\nplot(accept(Side.down)==Side.down?1:0)', "run"), 1);
});

test("enum overloads select both exact signatures including named and method arguments", async () => {
  const body = enums + 'identity(Side value)=>value\nidentity(Other value)=>value\nmethod select(Side self,Side value)=>value==Side.down?11:12\nmethod select(Other self,Other value)=>value==Other.up?22:23\nplot(identity(Side.down)==Side.down and identity(value=Other.up)==Other.up and Side.up.select(Side.down)==11 and Other.up.select(Other.up)==22?1:0)';
  constantPlot(await execute(body, "run"), 1);
  const sameReceiver = enums + 'method choose(Side self,int prefix,Side value)=>prefix+11\nmethod choose(Side self,int prefix,Other value)=>prefix+22\nplot(Side.up.choose(100,Side.down)==111 and Side.up.choose(prefix=200,value=Other.up)==222?1:0)';
  constantPlot(await execute(sameReceiver, "run"), 1);
  await assert.rejects(execute(enums + 'identity(Side value)=>value\nidentity(Other value)=>value\nplot(identity(close)==Side.up?1:0)'), /Incompatible enum types/i);
});

test("integer literals and bar indexes select their static enum-return signature", async () => {
  for (const [value, type] of [['1', 'Side'], ['bar_index', 'Side'], ['1.0', 'Other'], ['1e0', 'Other']]) {
    await execute(enums + 'selectValue(int value)=>Side.up\nselectValue(float value)=>Other.up\n' + type + ' chosen=selectValue(' + value + ')\nplot(1)');
  }
});

test("type analysis rejects recursive calls and bounds branching inference work", async () => {
  for (const tail of [
    'recurse(Side value)=>recurse(value)\nplot(1)',
    'first(Side value)=>second(value)\nsecond(Side value)=>first(value)\nplot(1)',
  ]) await assert.rejects(execute(enums + tail), /Recursive Pine function/i);
  const branching = ['branch0(Side value)=>value'];
  for (let index = 1; index <= 18; index++) branching.push('branch' + index + '(Side value)=>true?branch' + (index - 1) + '(value):branch' + (index - 1) + '(value)');
  await assert.rejects(execute(enums + branching.join('\n') + '\nplot(branch18(Side.up)==Side.up?1:0)'), /expression budget/i);
});

test("typed methods and switch arms preserve receiver and returned enum types", async () => {
  constantPlot(await execute(enums + 'method opposite(Side self)=>self==Side.up?Side.down:Side.up\nplot(Side.up.opposite()==Side.down?1:0)', "run"), 1);
  await assert.rejects(execute(enums + 'method bad(Side self,Side value)=>value\nplot(Side.up.bad(Other.up)==Side.up?1:0)'), /Incompatible enum types/i);
  await assert.rejects(execute(enums + 'chosen=switch bar_index\n    0=>Side.up\n    =>Other.up\nplot(1)'), /Incompatible enum types/i);
});

test("scoped alias reassignment does not invalidate an unrelated constant alias", async () => {
  const body = enums + 'const Side chosen=Side.up\nhelper()=>\n    chosen=Side.down\n    chosen:=Side.up\n    chosen\nchoice=input.enum(chosen,"Choice")\nplot(choice==Side.up?1:0)';
  assert.equal((await execute(body)).inputDefinitions[0].defval, "Side.up");
  constantPlot(await execute(body, "run"), 1);
  await assert.rejects(execute(enums + 'chosen=Side.up\nchosen:=Side.down\nchoice=input.enum(chosen,"Choice")\nplot(1)'), /const|enum field/i);
});

test("enum inputs drive ID-based activation while labels are presentation only", async () => {
  const body = enums + 'choice=input.enum(Side.up,"Choice")\nlength=input.int(3,"Length",active=choice==Side.down)\nplot(length)';
  const prepared = await execute(body), [choice, length] = prepared.inputDefinitions;
  assert.equal(length.active, false);
  assert.equal((await execute(body, "prepare", { [choice.id]: "Side.down" })).inputDefinitions[1].active, true);
  const response = worker.validatePineResponse({ id: "types93", status: "completed", result: prepared }, request(source(body)));
  assert.deepEqual(response.inputDefinitions[0].enumMembers, choice.enumMembers);
});

test("declared containers and collection operations enforce enum member types", async () => {
  for (const tail of [
    'array<Side> items=array.from(Other.up)\nplot(1)',
    'items=array.new<Side>()\nitems.push(Other.up)\nplot(1)',
    'lookup=map.new<Side,int>()\nlookup.put(Other.up,1)\nplot(1)',
    'items=array.new<Side>()\narray.push(items,Other.up)\nplot(1)',
    'items=array.new<Side>()\narray.set(items,0,Other.up)\nplot(1)',
    'lookup=map.new<Side,int>()\nmap.put(lookup,Other.up,1)\nplot(1)',
    'items=array.from(Side.up)\nstring chosen=array.get(items,0)\nplot(1)',
    'items=array.from(Side.up)\nplot(array.get(items,0)+1)',
  ]) await assert.rejects(execute(enums + tail), /Incompatible enum types|Enum values support equality/i);
});

test("enum members are not implicitly numeric or boolean conditions", async () => {
  for (const tail of [
    'plot(Side.up?1:0)',
    'if Side.up\n    ignored=1\nplot(1)',
    'plot(math.abs(Side.up))',
  ]) await assert.rejects(execute(enums + tail), /Enum values cannot/i);
  for (const operator of ['+=', '-=', '*=', '/=']) {
    await assert.rejects(execute(enums + 'Side chosen=Side.up\nchosen' + operator + 'Side.down\nplot(1)'), /Enum values support direct assignment/i);
  }
});

test("string functions reject enum tokens before runtime object-to-text coercion", async () => {
  for (const tail of [
    'plot(str.length(Side.up))',
    'plot(str.length(string=Side.up))',
    'plot(str.contains("Same",Side.up)?1:0)',
    'plot(str.tostring(1,Side.up)=="1"?1:0)',
    'plot(str.tostring(value=1,format=Side.up)=="1"?1:0)',
    'plot(str.format("{0}",Side.up)=="Same"?1:0)',
  ]) await assert.rejects(execute(enums + tail), /Enum values require str.tostring/i);
  constantPlot(await execute(enums + 'plot(str.length(str.tostring(Side.up)))', "run"), 4);
});

test("duplicate declaration names fields and local declarations fail before token creation", async () => {
  for (const body of [
    'enum Side\n    up\nenum Side\n    down\nplot(1)',
    'enum Side\n    up\n    up\nplot(1)',
    'helper()=>\n    enum Local\n        up\n    1\nplot(helper())',
  ]) await assert.rejects(execute(body), /Duplicate enum|global scope|Unexpected token KEYWORD 'enum'/i);
});

test("ordinary UDT and source history computations remain distinct from enum typed variables", async () => {
  const body = enums + 'type Cell\n    float price\nCell current=Cell.new(close)\nSide choice=Side.up\nplot((current[0]).price)';
  const result = await execute(body, "run");
  assert.deepEqual(result.plots[0].points.map(point => point.value), bars.map(bar => bar.close));
});
