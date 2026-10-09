import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", write: false,
  target: "es2020", logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(),
    sourcefile: "pine-function-shadow169.ts", contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";' } })).outputFiles[0].text;
console.info("FUNCTION_SHADOW169_BINDING " + JSON.stringify({ minified: true, actualWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"),
  manifestSha256: createHash("sha256").update(fs.readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const candle = (index, close = 10 + index) => ({ time: origin + index * 60, open: 9 + index,
  high: Math.max(12 + index, close), low: Math.min(8 + index, close), close, volume: 100 + index });
const bars = Array.from({ length: 4 }, (_, index) => candle(index));
const context = { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const source = (body, { version = 6, declaration = 'indicator("Function shadow169")', prelude = "" } = {}) =>
  `//@version=${version}\n${prelude}${declaration}\n${body}`;
const request = (body, options = {}) => {
  const { version, declaration, prelude, ...extra } = options;
  return { id: "function-shadow169", action: "run", mode: "historical", source: source(body, { version, declaration, prelude }),
    bars, context, inputs: {}, ...extra };
};
const run = (body, options) => pine.executePineRequest(request(body, options));
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const tail = (result, name) => values(result, name).at(-1);

// Different lexical scopes may share names, including function parameters.
// Only inner locals are reassigned; formal/global reassignment is forbidden:
// https://www.tradingview.com/pine-script-docs/language/variable-declarations/#shadowing
// https://www.tradingview.com/pine-script-docs/language/user-defined-functions/
test("the exact valid nested string regression returns two in ordinary and hourly declaration execution", async () => {
  const body = 'local(string TF)=>\n    string result=TF\n    if true\n        string TF="1"\n        TF:="2"\n        result:=TF\n    result\nplot(close,"Close")\nplot(local("1")=="2"?2:-1,"Local")';
  for (const version of [5, 6]) for (const hourly of [false, true]) {
    const actualBars = hourly ? Array.from({ length: 180 }, (_, index) => candle(index)) : bars;
    const options = { version, bars: actualBars, prelude: 'const string TF="60"\n',
      declaration: hourly ? 'indicator("Function shadow169",timeframe=TF)' : 'indicator("Function shadow169")' };
    const result = await run(body, options), points = new Map(result.plots.find(plot => plot.name === "Local").points.map(point => [point.time, point.value]));
    assert.deepEqual(actualBars.map((bar, index) => points.get(bar.time) ?? null), actualBars.map((_, index) => !hourly || (index + 1) % 60 === 0 ? 2 : null));
    assert.deepEqual(values(result, "Close"), actualBars.map((bar, index) => !hourly || (index + 1) % 60 === 0 ? bar.close : null));
    assert.equal(result.source, source(body, options));
  }
});

test("numeric tuple returns the mutated inner local and the unchanged outer formal", async () => {
  const body = 'read(float value)=>\n    float output=value\n    if true\n        float value=1\n        value:=2\n        output:=value\n    [output,value]\n[inside,outside]=read(7)\nplot(inside,"Inside")\nplot(outside,"Outside")';
  for (const version of [5, 6]) {
    const result = await run(body, { version });
    assert.deepEqual(values(result, "Inside"), [2, 2, 2, 2]); assert.deepEqual(values(result, "Outside"), [7, 7, 7, 7]);
  }
});

test("sibling string branches and two written function calls preserve distinct local and formal identities", async () => {
  const body = 'read(string value)=>\n    string output=value\n    if close%2==0\n        string value="initial even"\n        value:="even"\n        output:=value\n    else\n        string value="initial odd"\n        value:="odd"\n        output:=value\n    [output,value]\n[a,outerA]=read("A")\n[b,outerB]=read("B")\nplot(a=="even"?2:a=="odd"?1:-1,"A")\nplot(b=="even"?2:b=="odd"?1:-1,"B")\nplot(outerA=="A" and outerB=="B"?1:-1,"Outer identities")';
  const result = await run(body);
  assert.deepEqual(values(result, "A"), [2, 1, 2, 1]); assert.deepEqual(values(result, "B"), [2, 1, 2, 1]);
  assert.deepEqual(values(result, "Outer identities"), [1, 1, 1, 1]);
});

test("nested string returns survive another function argument and ordinary caller history", async () => {
  const body = 'read(string value)=>\n    string output=value\n    if close>=12\n        string value="initial"\n        value:="two"\n        output:=value\n    output\nencode(string encoded)=>encoded=="two"?2:encoded=="one"?1:-1\nresult=read("one")\nplot(encode(result),"Value")\nplot(encode(result[1]),"Previous")\nplot(encode(read("one")),"Direct argument")';
  const result = await run(body);
  assert.deepEqual(values(result, "Value"), [1, 1, 2, 2]); assert.deepEqual(values(result, "Previous"), [-1, 1, 1, 2]);
  assert.deepEqual(values(result, "Direct argument"), [1, 1, 2, 2]);
});

test("local numeric history retains the scoped output while outer formal values remain untouched", async () => {
  const body = 'read(float value)=>\n    float output=value\n    if true\n        float value=close\n        value+=1\n        output:=value\n    [output,output[1],value]\n[now,previous,formal]=read(100)\nplot(now,"Now")\nplot(previous,"Previous")\nplot(formal,"Formal")';
  const result = await run(body);
  assert.deepEqual(values(result, "Now"), [11, 12, 13, 14]); assert.deepEqual(values(result, "Previous"), [null, 11, 12, 13]);
  assert.deepEqual(values(result, "Formal"), [100, 100, 100, 100]);
});

test("a skipped shadowing branch preserves string NA instead of inventing a prior local value", async () => {
  const body = 'read(string value)=>\n    string output=value\n    if close>=12\n        string value="initial"\n        value:="two"\n        output:=value\n    output\nresult=read(string(na))\nplot(na(result)?0:result=="two"?2:-1,"Value")\nplot(na(result[1])?0:result[1]=="two"?2:-1,"Previous")';
  const result = await run(body);
  assert.deepEqual(values(result, "Value"), [0, 0, 2, 2]); assert.deepEqual(values(result, "Previous"), [0, 0, 0, 2]);
});

test("actual live nested ordinary var and varip locals retain their separate rollback and confirmation histories", async () => {
  const body = 'ordinary(int value)=>\n    int output=0\n    if true\n        int value=0\n        value+=1\n        output:=value\n    output\npersistent(int value)=>\n    int output=0\n    if true\n        var int value=0\n        value+=1\n        output:=value\n    output\nintrabar(int value)=>\n    int output=0\n    if true\n        varip int value=0\n        value+=1\n        output:=value\n    output\nplot(ordinary(99),"Ordinary")\nplot(persistent(99),"Var")\nplot(intrabar(99),"Varip")';
  const executor = pine.createPineLiveExecutor(), sessionId = "function-shadow-live169";
  try {
    const warm = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: {
      ...request(body, { mode: "live", bars: bars.slice(0, 3) }), id: sessionId + ":0" } });
    assert.deepEqual(values(warm, "Ordinary"), [1, 1, 1]); assert.deepEqual(values(warm, "Var"), [1, 2, 3]);
    assert.deepEqual(values(warm, "Varip"), [1, 2, 3]); const preserved = structuredClone(warm);
    let sequence = 0;
    for (const [index, close, confirmed, ordinary, persistent, intrabar] of [[3, 20, false, 1, 4, 4], [3, 21, false, 1, 4, 5], [3, 22, true, 1, 4, 6], [4, 23, false, 1, 5, 7]]) {
      const result = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: ++sequence, action: "update", bar: candle(index, close), confirmed });
      assert.equal(tail(result, "Ordinary"), ordinary); assert.equal(tail(result, "Var"), persistent); assert.equal(tail(result, "Varip"), intrabar);
    }
    assert.deepEqual(warm, preserved);
  } finally { executor.dispose(); }
});

test("inner initializer reads the outer formal while default arguments and global names retain their own bindings", async () => {
  const body = 'float value=100\nread(float value=7)=>\n    float output=value\n    if true\n        float value=value+1\n        value+=1\n        output:=value\n    [output,value]\n[defaultInner,defaultOuter]=read()\n[explicitInner,explicitOuter]=read(11)\nplot(defaultInner,"Default inner")\nplot(defaultOuter,"Default formal")\nplot(explicitInner,"Explicit inner")\nplot(explicitOuter,"Explicit formal")\nplot(value,"Global")';
  for (const version of [5, 6]) {
    const result = await run(body, { version });
    for (const [name, expected] of [["Default inner", 9], ["Default formal", 7], ["Explicit inner", 13], ["Explicit formal", 11], ["Global", 100]])
      assert.deepEqual(values(result, name), bars.map(() => expected), name);
  }
});

test("UDT local references shadow their formal without mutating it including valid v5 namespace receivers", async () => {
  for (const [version, name] of [[5, "value"], [6, "value"], [5, "box"]]) {
    const body = `type Cell\n    float price\nread(Cell ${name})=>\n    float output=${name}.price\n    if true\n        Cell ${name}=Cell.new(2)\n        ${name}.price+=3\n        output:=${name}.price\n    [output,${name}.price]\ncurrent=Cell.new(7)\n[inside,outside]=read(current)\nplot(inside,"Inside")\nplot(outside,"Formal")\nplot(current.price,"Original")`;
    const result = await run(body, { version });
    assert.deepEqual(values(result, "Inside"), [5, 5, 5, 5]); assert.deepEqual(values(result, "Formal"), [7, 7, 7, 7]);
    assert.deepEqual(values(result, "Original"), [7, 7, 7, 7]);
  }
});

test("a for-loop counter shadows a formal only within the loop and leaves its post-loop identity intact", async () => {
  const body = 'read(int value)=>\n    int output=0\n    for value=0 to 2\n        output+=value\n    [output,value]\n[sum,formal]=read(7)\nplot(sum,"Sum")\nplot(formal,"Formal")';
  for (const version of [5, 6]) {
    const result = await run(body, { version });
    assert.deepEqual(values(result, "Sum"), [3, 3, 3, 3]); assert.deepEqual(values(result, "Formal"), [7, 7, 7, 7]);
  }
});

test("an array for-in body owns its inner declaration and never leaks that binding after the loop", async () => {
  const body = 'read(int value)=>\n    int output=0\n    items=array.from(1,2)\n    for item in items\n        int value=item*10\n        value+=1\n        output+=value\n    [output,value]\n[sum,formal]=read(7)\nplot(sum,"Sum")\nplot(formal,"Formal")';
  for (const version of [5, 6]) {
    const result = await run(body, { version });
    assert.deepEqual(values(result, "Sum"), [32, 32, 32, 32]); assert.deepEqual(values(result, "Formal"), [7, 7, 7, 7]);
  }
});
