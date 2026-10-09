import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;

// Genuine reviewed/minified engine and worker. This iteration tests declaration
// metadata only; it does not claim named-condition delivery or UI subscriptions.
const bundled = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-alert-conditions179.ts",
    contents: 'export {Indicator} from "pinets";export * from "./frontend/src/workers/pineNative.worker";export * from "./frontend/src/lib/pineProtocol";export {sanitizePinePrepared} from "./frontend/src/lib/customIndicators";' } })).outputFiles[0].text;
console.info("PINE_ALERT_CONDITIONS179_BINDING " + JSON.stringify({ actualWorker: true, minified: true, metadataOnly: true,
  bundleSha256: createHash("sha256").update(bundled).digest("hex"), manifestSha256: createHash("sha256").update(readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));
const pine = await import("data:text/javascript;base64," + Buffer.from(bundled).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const bars = Array.from({ length: 30 }, (_, i) => ({ time: origin + i * 60, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10 + i }));
const source = (body, version = 6, declaration = 'indicator("Named conditions179")') => `//@version=${version}\n${declaration}\n${body}\nplot(close,"Price")`;
const request = (body, { version = 6, declaration, action = "prepare" } = {}) => ({ id: "named-conditions179", action,
  source: source(body, version, declaration), ...(action === "run" ? { mode: "historical", bars,
    context: { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1 } } : {}) });
const prepare = (body, options) => pine.executePineRequest(request(body, options));
const descriptor = (index, title = "Alert", message = "") => ({ id: `alertcondition_${index}`, title, message });
const compileError = failure => failure.code === "COMPILE_ERROR";

test("v5/v6 omitted arguments use Alert/empty defaults and duplicate titles retain distinct source IDs", async () => {
  for (const version of [5, 6]) {
    const prepared = await prepare('alertcondition(true)\nalertcondition(false,"Duplicate","First")\nalertcondition(close>open,"Duplicate","Second")\nalertcondition(true,"","")', { version });
    assert.deepEqual(prepared.alertConditions, [descriptor(0), descriptor(1, "Duplicate", "First"), descriptor(2, "Duplicate", "Second"), descriptor(3, "", "")]);
    assert.equal(prepared.kind, "prepare"); assert.equal(prepared.pineVersion, version);
    assert.equal(pine.sanitizePinePrepared(prepared, prepared.source)?.alertConditions.length, 4);
  }
});

test("v5/v6 actual constant aliases, positional/named mixtures and raw placeholders survive compilation", async () => {
  const body = 'const string TITLE="Entry"\nconst string FIRST="Price "\nconst string MESSAGE=FIRST+"{{close}} {{plot_0}}"\nalertcondition(condition=close>open,title=TITLE,message=MESSAGE)\nalertcondition(false,message="Named only")\nalertcondition(true,"Mixed",message=\'Value {{plot("After")}}\')\nplot(close*2,"After")';
  for (const version of [5, 6]) {
    const prepared = await prepare(body, { version });
    assert.deepEqual(prepared.alertConditions, [descriptor(0, "Entry", "Price {{close}} {{plot_0}}"), descriptor(1, "Alert", "Named only"), descriptor(2, "Mixed", 'Value {{plot("After")}}')]);
    assert.equal(prepared.inputDefinitions.length, 0);
  }
});

test("immutable var/varip string literals remain constant metadata, while a reassigned series-valued var is refused", async () => {
  // TradingView's type-system/#const example uses `var PLOT1_TITLE = "High"`:
  // declaration mode controls initialization, not the value's const qualifier.
  for (const version of [5, 6]) for (const mode of ["var", "varip"]) {
    const body = `${mode} string TITLE="Persistent title"\n${mode} string MESSAGE="Price {{close}}"\nalertcondition(close>open,TITLE,MESSAGE)`;
    const prepared = await prepare(body, { version });
    assert.deepEqual(prepared.alertConditions, [descriptor(0, "Persistent title", "Price {{close}}")]);
    const historical = await prepare(body, { version, action: "run" }); assert.deepEqual(historical.alertConditions, prepared.alertConditions);
    await assert.rejects(prepare(`${mode} string TITLE="Initial title"\nif barstate.isfirst\n    TITLE:=str.tostring(close)\nalertcondition(true,TITLE,"Invalid")`, { version }), compileError);
  }
});

test("native local conditions and nonconstant title/message are rejected before any historical execution", async () => {
  const invalid = [
    'if true\n    alertcondition(true,"Local","Invalid")',
    'f()=>alertcondition(true,"Function local","Invalid")\nf()',
    'title=input.string("Input title")\nalertcondition(true,title,"Invalid")',
    'alertcondition(true,"Series message",str.tostring(close))',
    'alertcondition(true,str.tostring(close),"Series title")',
    'alertcondition(true,condition=false)',
    'alertcondition(condition=true,title="One",title="Two")',
    'alertcondition(condition=true,unexpected="Unknown argument")',
    'alertcondition(title="Missing condition")',
    'alertcondition()',
  ];
  for (const version of [5, 6]) for (const body of invalid) for (const action of ["prepare", "run"])
    await assert.rejects(prepare(body, { version, action }), compileError);
});

test("comments, string literals and user-defined shadowing never create a native condition descriptor", async () => {
  for (const version of [5, 6]) {
    const text = await prepare('// alertcondition(true,"Comment","Not a call")\nnote="alertcondition(true)"\nplot(str.length(note),"Text length")', { version });
    assert.equal(text.alertConditions?.length ?? 0, 0);
    const customBody = 'alertcondition(condition,title,message)=>condition\ncustom=alertcondition(close>open,"User function","Not native")\nplot(custom?1:0,"Custom")';
    const custom = await prepare(customBody, { version });
    assert.equal(custom.alertConditions?.length ?? 0, 0);
    const historical = await prepare(customBody, { version, action: "run" });
    assert.equal(historical.alertConditions?.length ?? 0, 0);
    assert.deepEqual(historical.plots.find(plot => plot.name === "Custom").points.map(point => point.value), bars.map(() => 1));
  }
});

test("a user method named alertcondition cannot waive native global metadata or the native local restriction", async () => {
  const methods = 'type Marker\n    float value\nmethod alertcondition(Marker self,bool condition,string title,string message)=>condition\nm=Marker.new(1)\ncustom=m.alertcondition(close>open,"User method","Not native")\ndirect=alertcondition(m,close>open,"Direct method","Not native")\nplot(custom?1:0,"Custom method")\nplot(direct?1:0,"Direct method")';
  for (const version of [5, 6]) {
    const body = methods + '\nalertcondition(close>open,"Native","Named native condition")\nalertcondition(message="Reordered named message",title="Native named",condition=close>open)';
    const prepared = await prepare(body, { version });
    assert.deepEqual(prepared.alertConditions, [descriptor(0, "Native", "Named native condition"), descriptor(1, "Native named", "Reordered named message")]);
    const historical = await prepare(body, { version, action: "run" }); assert.deepEqual(historical.alertConditions, prepared.alertConditions);
    assert.deepEqual(historical.plots.find(plot => plot.name === "Custom method").points.map(point => point.value), bars.map(() => 1));
    assert.deepEqual(historical.plots.find(plot => plot.name === "Direct method").points.map(point => point.value), bars.map(() => 1));
    for (const action of ["prepare", "run"])
      await assert.rejects(prepare(methods + '\nif true\n    alertcondition(true,"Still native","Invalid local")', { version, action }), compileError);
  }
});

test("strategies compile condition metadata while declared indicator timeframes remain permitted", async () => {
  for (const version of [5, 6]) for (const declaration of ['strategy("Strategy conditions179")', 'indicator("Calculation conditions179",timeframe="15")']) {
    const body = 'alertcondition(close>open,"Named","No delivery in this iteration")';
    const prepared = await prepare(body, { version, declaration });
    assert.deepEqual(prepared.alertConditions, [descriptor(0, "Named", "No delivery in this iteration")]);
    const historical = await prepare(body, { version, declaration, action: "run" });
    assert.deepEqual(historical.alertConditions, prepared.alertConditions); assert.equal(Object.hasOwn(historical, "alertEvents"), false);
  }
});

test("64 compiled conditions are accepted and 65 are refused rather than silently truncated", async () => {
  const body = count => Array.from({ length: count }, (_, i) => `alertcondition(false,"Condition ${i}","Message ${i}")`).join("\n");
  const prepared = await prepare(body(64)); assert.equal(prepared.alertConditions.length, 64);
  assert.deepEqual(prepared.alertConditions[63], descriptor(63, "Condition 63", "Message 63"));
  await assert.rejects(prepare(body(65)), compileError);
});

test("actual compiler metadata is a frozen owned array including frozen definitions and the empty-list case", () => {
  for (const version of [5, 6]) for (const body of ["", 'alertcondition(false,"Frozen","Raw {{close}}")']) {
    const prepared = new pine.Indicator(source(body, version)).prepare({ debug: false, ln: false });
    const field = Object.getOwnPropertyDescriptor(prepared.fn, "_edgelabAlertConditions"); assert.ok(field && "value" in field);
    const definitions = field.value; assert.deepEqual(definitions, body ? [descriptor(0, "Frozen", "Raw {{close}}")]: []);
    assert.equal(Object.isFrozen(definitions), true); for (const definition of definitions) assert.equal(Object.isFrozen(definition), true);
    assert.throws(() => definitions.push(descriptor(1)), TypeError);
    if (definitions.length) assert.throws(() => { definitions[0].message = "Mutation"; }, TypeError);
  }
});

test("constant metadata string bounds accept 512/4096 code units and reject overflow without truncation", async () => {
  const title = "T".repeat(512), message = "M".repeat(4096);
  const prepared = await prepare(`alertcondition(false,"${title}","${message}")`);
  assert.deepEqual(prepared.alertConditions, [descriptor(0, title, message)]);
  for (const [nextTitle, nextMessage] of [[title + "T", message], [title, message + "M"]])
    await assert.rejects(prepare(`alertcondition(false,"${nextTitle}","${nextMessage}")`), compileError);
});

test("prepared condition metadata survives save sanitization and optional older metadata remains compatible", async () => {
  const body = 'alertcondition(false,"Saved","{{ticker}} {{close}}")', prepared = await prepare(body);
  const saved = JSON.parse(JSON.stringify(prepared)), sanitized = pine.sanitizePinePrepared(saved, saved.source);
  assert.deepEqual(sanitized.alertConditions, [descriptor(0, "Saved", "{{ticker}} {{close}}")]);
  saved.alertConditions[0].message = "Mutated saved input"; assert.equal(sanitized.alertConditions[0].message, "{{ticker}} {{close}}");
  const legacy = structuredClone(prepared); delete legacy.alertConditions;
  assert.ok(pine.sanitizePinePrepared(legacy, legacy.source));
  assert.equal(pine.sanitizePinePrepared(prepared, source(body + "\n// changed source")), undefined);
});

test("strict metadata rejects duplicate IDs, unknown fields, malformed IDs and sparse/accessor arrays without evaluating getters", async () => {
  const prepared = await prepare('alertcondition(true,"One","First")\nalertcondition(false,"Two","Second")');
  const validators = [
    value => { value.alertConditions[1].id = value.alertConditions[0].id; },
    value => { value.alertConditions[0].unexpected = true; },
    value => { value.alertConditions[0].id = "title-is-not-an-id"; },
    value => { value.alertConditions[0].title = null; },
    value => { value.alertConditions[0].message = 1; },
    value => { delete value.alertConditions[0].title; },
    value => { value.alertConditions.reverse(); },
    value => { value.alertConditions[0].title = "T".repeat(513); },
    value => { value.alertConditions[0].message = "M".repeat(4097); },
    value => { delete value.alertConditions[0]; },
    value => { value.alertConditions = Array.from({ length: 65 }, (_, i) => descriptor(i)); },
  ];
  for (const mutate of validators) { const invalid = structuredClone(prepared); mutate(invalid);
    assert.equal(pine.sanitizePinePrepared(invalid, prepared.source), undefined); }
  let getterCalls = 0; const accessor = structuredClone(prepared);
  Object.defineProperty(accessor.alertConditions[0], "message", { enumerable: true, get() { getterCalls++; return "Getter"; } });
  assert.equal(pine.sanitizePinePrepared(accessor, prepared.source), undefined); assert.equal(getterCalls, 0);
  const extraSymbol = structuredClone(prepared); extraSymbol.alertConditions[0][Symbol("forged")] = true;
  assert.equal(pine.sanitizePinePrepared(extraSymbol, prepared.source), undefined);
  const arrayAccessor = structuredClone(prepared); Object.defineProperty(arrayAccessor.alertConditions, "0", { enumerable: true, get() { getterCalls++; return descriptor(0); } });
  assert.equal(pine.sanitizePinePrepared(arrayAccessor, prepared.source), undefined); assert.equal(getterCalls, 0);
});
