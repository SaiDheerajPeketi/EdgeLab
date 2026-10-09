import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const runtime = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(), sourcefile: "pine-calculation-metadata181.ts",
    contents: 'export {Indicator} from "pinets";export * from "./frontend/src/workers/pineNative.worker";export * from "./frontend/src/lib/pineProtocol";export * from "./frontend/src/lib/pinePacked";export * from "./frontend/src/lib/pineLiveProtocol";export {sanitizePinePrepared} from "./frontend/src/lib/customIndicators";' } })).outputFiles[0].text;
const pine = await import("data:text/javascript;base64," + Buffer.from(runtime).toString("base64"));
const sandboxCode = (await build({ entryPoints: ["frontend/src/lib/pineSandbox.ts"], bundle: true, minify: true, platform: "browser",
  format: "iife", globalName: "sandbox", write: false, logLevel: "silent" })).outputFiles[0].text;
let iframe;
const captureRealm = vm.createContext({ crypto: webcrypto, location: { origin: "https://edgelab.example" }, Worker: class {}, AbortController,
  setTimeout, clearTimeout, window: { addEventListener() {}, removeEventListener() {} },
  document: { createElement() { iframe = { setAttribute() {}, remove() {}, contentWindow: { postMessage() {} } }; return iframe; }, body: { appendChild() {} } } });
vm.runInContext(sandboxCode, captureRealm);
const captureJob = vm.runInContext('sandbox.createSandboxWorkerJob({request:{id:"capture181"},loadWorker:async()=>"trusted-worker",validate:value=>value,timeoutMs:1000})', captureRealm);
const cancelled = captureJob.promise.catch(error => error.code); captureJob.cancel(); assert.equal(await cancelled, "CANCELLED");
// Extract the actual API-emitted bridge, not a copied or reimplemented gate.
const bridge = iframe.srcdoc.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1], nonce = iframe.srcdoc.match(/data-job="([^"]+)"/)[1];
assert.ok(bridge);
console.info("PINE_CALCULATION_METADATA181_BINDING " + JSON.stringify({ actualWorker: true, minified: true, actualParentBridge: true,
  bundleSha256: createHash("sha256").update(runtime).digest("hex"), bridgeSha256: createHash("sha256").update(bridge).digest("hex"),
  manifestSha256: createHash("sha256").update(readFileSync("frontend/vendor/pinets/manifest.json")).digest("hex") }));

const origin = Date.UTC(2024, 0, 1) / 1000;
const bars = Array.from({ length: 180 }, (_, index) => ({ time: origin + index * 60, open: 100 + index, high: 105 + index,
  low: 95 + index, close: 101 + index, volume: 10 + index }));
const context = { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 };
const program = (body = 'plot(close,"Price")', { version = 6, declaration = 'indicator("Calculation metadata181",timeframe="60",timeframe_gaps=false)', prelude = "" } = {}) =>
  `//@version=${version}\n${prelude}${declaration}\n${body}`;
const request = (source, options = {}) => ({ id: "calculation-metadata181", action: "run", mode: "historical", source, bars, context, ...options });
const prepare = (source, inputs = {}) => pine.executePineRequest({ id: "calculation-metadata181", action: "prepare", source, inputs });
const run = (source, options) => pine.executePineRequest(request(source, options));
const calculation = (timeframeInputId, defaultTimeframe = "60", defaultGaps = false, gapsInputId) => ({ timeframeInputId,
  defaultTimeframe, defaultGaps, ...(gapsInputId === undefined ? {} : { gapsInputId }) });
const points = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const protocolError = error => error instanceof pine.PineProtocolError;
const collisionBody = 'authoredTime=input.timeframe("15","Timeframe",group="Calculation")\nauthoredWait=input.bool(true,"Wait for timeframe closes",group="Calculation")\nmultiplier=input.int(2,"Calculation")\nplot(close*multiplier,"Scaled")\nplot(authoredWait?1:0,"Authored wait")';

// VM only controls transport endpoints. Every successful payload originates
// from the genuine compiled worker; parent validation remains production code.
function forward(wire, { persistent = false, sequence = 0 } = {}) {
  let receive, worker; const messages = [], parent = { postMessage(message, _origin, transfers = []) {
    messages.push(structuredClone(message, { transfer: Array.from(transfers) }));
  } };
  const realm = vm.createContext({ TextEncoder, Blob, parent,
    document: { currentScript: { dataset: { job: nonce, origin: "https://edgelab.example", session: String(persistent) } } },
    URL: { createObjectURL() { return "blob:trusted-worker"; }, revokeObjectURL() {} },
    Worker: class { constructor() { worker = this; } postMessage() {} terminate() {} },
    addEventListener(type, callback) { assert.equal(type, "message"); receive = callback; } });
  vm.runInContext(bridge, realm); assert.equal(messages.pop().type, "ready");
  receive({ source: parent, origin: "https://edgelab.example", data: { nonce, type: "start", workerSource: "trusted-worker", request: { id: wire.id } } });
  realm.metadata = JSON.stringify({ ...wire, buffers: undefined });
  realm.bufferBytes = JSON.stringify((wire.buffers ?? []).map(buffer => Array.from(new Uint8Array(buffer))));
  vm.runInContext('globalThis.payload=JSON.parse(metadata);if(payload.encoding==="pine-packed-v1")payload.buffers=JSON.parse(bufferBytes).map(bytes=>new Uint8Array(bytes).buffer);', realm);
  realm.sequence = sequence;
  const payload = persistent ? vm.runInContext('({protocol:"pine-live-v1",sessionId:"calculation181-live",sequence,response:payload})', realm) : realm.payload;
  worker.onmessage({ data: payload }); return messages.at(-1);
}

test("v5/v6 actual source-owned generated IDs distinguish authored identical Calculation names and preserve numerical overrides", async () => {
  for (const version of [5, 6]) {
    const source = program(collisionBody, { version }), prepared = await prepare(source);
    assert.deepEqual(prepared.calculationInputs, calculation("in_3", "60", false, "in_4"));
    assert.deepEqual(prepared.inputDefinitions.map(item => [item.id, item.type, item.defval]),
      [["in_0", "timeframe", "15"], ["in_1", "bool", true], ["in_2", "int", 2], ["in_3", "timeframe", "60"], ["in_4", "bool", false]]);
    const actual = await run(source, { inputs: { in_0: "30", in_1: false, in_2: 4, in_3: "60", in_4: false } });
    assert.deepEqual(actual.calculationInputs, prepared.calculationInputs);
    assert.deepEqual(points(actual, "Scaled"), bars.map((_, index) => index < 59 ? null : bars[Math.floor((index + 1) / 60) * 60 - 1].close * 4));
    assert.deepEqual(points(actual, "Authored wait"), bars.map((_, index) => index < 59 ? null : 0));
    const changed = await run(source, { inputs: { in_0: "15", in_1: true, in_2: 3, in_3: "30", in_4: true } });
    assert.deepEqual(changed.calculationInputs, prepared.calculationInputs);
    assert.deepEqual(points(changed, "Scaled"), bars.map((bar, index) => (index + 1) % 30 === 0 ? bar.close * 3 : null));
    assert.equal(changed.inputs.in_3, "30"); assert.equal(changed.inputs.in_4, true);
  }
});

test("absent calculation declarations omit metadata even when authored controls have every generated label", async () => {
  for (const declaration of ['indicator("No declaration timeframe181")', 'strategy("No strategy calculation181")']) {
    const source = program(collisionBody, { declaration }), prepared = await prepare(source), actual = await run(source);
    assert.equal(Object.hasOwn(prepared, "calculationInputs"), false); assert.equal(Object.hasOwn(actual, "calculationInputs"), false);
    assert.equal(prepared.inputDefinitions.length, 3); assert.equal(Object.hasOwn(actual, "alertEvents"), false);
  }
});

test("explicit empty timeframe is a real generated binding while default gaps and explicit false/true remain source defaults", async () => {
  for (const version of [5, 6]) for (const gaps of [undefined, false, true]) {
    const declaration = `indicator("Empty calculation181",timeframe=""${gaps === undefined ? "" : `,timeframe_gaps=${gaps}`})`;
    const source = program(undefined, { version, declaration }), prepared = await prepare(source), actual = await run(source);
    assert.deepEqual(prepared.calculationInputs, calculation("in_0", "", gaps ?? true, gaps === undefined ? undefined : "in_1"));
    assert.deepEqual(actual.calculationInputs, prepared.calculationInputs); assert.deepEqual(points(actual, "Price"), bars.map(bar => bar.close));
    assert.equal(prepared.inputDefinitions[0].defval, "");
  }
});

test("constant aliases and calendar timeframe defaults canonicalize metadata without rewriting the genuine input default", async () => {
  for (const version of [5, 6]) for (const [authored, canonical] of [["D", "1D"], ["W", "1W"], ["M", "1M"], ["3M", "3M"], ["60", "60"]]) {
    const source = program(undefined, { version, prelude: `const string TF="${authored}"\nconst bool GAPS=false\n`,
      declaration: 'indicator("Alias calculation181",timeframe=TF,timeframe_gaps=GAPS)' }), prepared = await prepare(source);
    assert.deepEqual(prepared.calculationInputs, calculation("in_0", canonical, false, "in_1"));
    assert.equal(prepared.inputDefinitions[0].defval, authored); assert.equal(prepared.inputDefinitions[1].defval, false);
  }
});

test("genuine prepare, historical run and owned live start carry the same source defaults despite selected values", async () => {
  const source = program(collisionBody), inputs = { in_0: "60", in_1: false, in_2: 5, in_3: "30", in_4: true };
  const prepared = await prepare(source, inputs), historical = await run(source, { inputs }), sessionId = "calculation181-live", executor = pine.createPineLiveExecutor();
  try {
    const liveRequest = request(source, { id: sessionId + ":0", mode: "live", inputs });
    const command = { protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: liveRequest };
    const started = await executor.execute(command);
    for (const actual of [historical, started]) { assert.deepEqual(actual.calculationInputs, prepared.calculationInputs); assert.equal(Object.hasOwn(actual, "alertEvents"), false); }
    assert.deepEqual(started.inputDefinitions, prepared.inputDefinitions);
    const transferred = forward(pine.toPineWireResponse(liveRequest.id, started, bars), { persistent: true });
    assert.equal(transferred.payload.response.status, "completed");
    assert.deepEqual(pine.validatePineLiveResponse(transferred.payload, command, liveRequest).calculationInputs, prepared.calculationInputs);
  } finally { executor.dispose(); }
});

test("saved prepared metadata deep-copies generated defaults and optional old metadata remains accepted", async () => {
  const source = program(collisionBody), prepared = await prepare(source), saved = structuredClone(prepared), sanitized = pine.sanitizePinePrepared(saved, source);
  assert.deepEqual(sanitized.calculationInputs, calculation("in_3", "60", false, "in_4"));
  saved.calculationInputs.defaultTimeframe = "15"; saved.inputDefinitions[3].defval = "15";
  assert.equal(sanitized.calculationInputs.defaultTimeframe, "60"); assert.equal(sanitized.inputDefinitions[3].defval, "60");
  const legacy = structuredClone(prepared); delete legacy.calculationInputs;
  assert.ok(pine.sanitizePinePrepared(legacy, source)); assert.equal(Object.hasOwn(pine.sanitizePinePrepared(legacy, source), "calculationInputs"), false);
  assert.equal(pine.sanitizePinePrepared(prepared, source + "\n// source changed"), undefined);
  // IDs/types/defaults establish the metadata contract; visible labels cannot
  // turn an authored control into a generated declaration setting.
  const relabelled = structuredClone(prepared);
  for (const index of [3, 4]) Object.assign(relabelled.inputDefinitions[index], { name: "Different label", title: "User label", group: "Another group" });
  assert.deepEqual(pine.sanitizePinePrepared(relabelled, source).calculationInputs, prepared.calculationInputs);
});

test("actual trusted parent bridge admits genuine plain and packed calculation metadata without creating notifications", async () => {
  for (const count of [1, 32]) {
    const source = program(Array.from({ length: count }, (_, index) => `plot(close+${index},"Lane ${index}")`).join("\n")
      + '\nalertcondition(true,"Metadata only","{{close}}")'), owned = request(source), result = await pine.executePineRequest(owned);
    const wire = pine.toPineWireResponse(owned.id, result, bars), transferred = forward(wire);
    assert.equal(wire.encoding === "pine-packed-v1", count === 32); assert.equal(transferred.payload.status, "completed");
    const decoded = pine.validatePineResponse(transferred.payload, owned);
    assert.deepEqual(decoded.calculationInputs, calculation("in_0", "60", false, "in_1"));
    assert.equal(decoded.plots.length, count); assert.equal(Object.hasOwn(decoded, "alertEvents"), false);
    const plot = decoded.plots.find(plot => plot.name === "Lane 0"), final = pine.getPackedPinePlot(plot) ? pine.pointAtBar(plot, 179) : plot.points[179];
    assert.equal(final.value, bars[179].close); assert.equal(final.time, bars[179].time);
  }
});

test("strict calculation metadata rejects wrong IDs/defaults, unknown keys and generated definition tampering", async () => {
  const source = program(collisionBody), prepared = await prepare(source);
  const mutations = [value => { value.calculationInputs = null; }, value => { value.calculationInputs = []; },
    value => { value.calculationInputs.timeframeInputId = "in_0"; }, value => { value.calculationInputs.gapsInputId = "in_1"; },
    value => { value.calculationInputs.timeframeInputId = "in_99"; }, value => { value.calculationInputs.gapsInputId = "in_3"; },
    value => { value.calculationInputs.defaultTimeframe = "15"; }, value => { value.calculationInputs.defaultTimeframe = "D"; },
    value => { value.calculationInputs.defaultGaps = true; }, value => { value.calculationInputs.defaultGaps = 0; },
    value => { value.calculationInputs.unexpected = true; }, value => { delete value.calculationInputs.defaultGaps; },
    value => { delete value.calculationInputs.timeframeInputId; }, value => { value.inputDefinitions[3].type = "string"; },
    value => { value.inputDefinitions[3].defval = "30"; }, value => { value.inputDefinitions[4].defval = true; },
    value => { value.inputDefinitions.reverse(); }, value => { value.calculationInputs = "Calculation"; }];
  for (const mutate of mutations) {
    const invalid = structuredClone(prepared); mutate(invalid);
    assert.throws(() => pine.validatePineResponse({ id: "calculation-metadata181", status: "completed", result: invalid }, { id: "calculation-metadata181", action: "prepare", source }), protocolError);
    assert.equal(pine.sanitizePinePrepared(invalid, source), undefined);
  }
  let getters = 0; const accessor = structuredClone(prepared);
  Object.defineProperty(accessor.calculationInputs, "defaultTimeframe", { enumerable: true, get() { getters++; return "60"; } });
  assert.equal(pine.sanitizePinePrepared(accessor, source), undefined); assert.equal(getters, 0);
  const symbols = structuredClone(prepared); symbols.calculationInputs[Symbol("forged")] = true;
  assert.equal(pine.sanitizePinePrepared(symbols, source), undefined);
});

test("absent gaps bindings require the actual true default and strategy caches cannot invent calculation settings", async () => {
  const noGapsSource = program(undefined, { declaration: 'indicator("No gaps binding181",timeframe="60")' }), noGaps = await prepare(noGapsSource);
  assert.deepEqual(noGaps.calculationInputs, calculation("in_0", "60", true));
  const invalid = structuredClone(noGaps); invalid.calculationInputs.defaultGaps = false;
  assert.equal(pine.sanitizePinePrepared(invalid, noGapsSource), undefined);
  const strategySource = program('fake=input.timeframe("60","Timeframe",group="Calculation")\nplot(close)', { declaration: 'strategy("Authored strategy control181")' });
  const strategy = await prepare(strategySource); assert.equal(Object.hasOwn(strategy, "calculationInputs"), false);
  strategy.calculationInputs = calculation("in_0", "60", true);
  assert.equal(pine.sanitizePinePrepared(strategy, strategySource), undefined);
});
