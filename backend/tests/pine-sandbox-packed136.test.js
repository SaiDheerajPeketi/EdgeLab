import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const root = new URL("../../", import.meta.url).pathname;
const runtimeCode = (await build({ bundle: true, minify: true, platform: "browser", format: "esm", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], define: { "import.meta.env": "{}" },
  stdin: { contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineProtocol.ts"; export * from "./frontend/src/lib/pinePacked.ts"; export * from "./frontend/src/lib/pineLiveProtocol.ts";', loader: "ts", resolveDir: root },
})).outputFiles[0].text;
const pine = await import("data:text/javascript;base64," + Buffer.from(runtimeCode).toString("base64"));
const sandboxCode = (await build({ entryPoints: ["frontend/src/lib/pineSandbox.ts"], bundle: true, minify: true,
  platform: "browser", format: "iife", globalName: "sandbox", write: false, logLevel: "silent" })).outputFiles[0].text;

// Capture the actual API-generated iframe script instead of copying its gate.
let iframe;
const captureContext = vm.createContext({ crypto: webcrypto, location: { origin: "https://edgelab.example" },
  Worker: class {}, AbortController, setTimeout, clearTimeout,
  window: { addEventListener() {}, removeEventListener() {} },
  document: { createElement() { iframe = { setAttribute() {}, remove() {}, contentWindow: { postMessage() {} } }; return iframe; }, body: { appendChild() {} } },
});
vm.runInContext(sandboxCode, captureContext);
const captureJob = vm.runInContext('sandbox.createSandboxWorkerJob({request:{id:"capture136"},loadWorker:async()=>"trusted-worker",validate:value=>value,timeoutMs:1000})', captureContext);
const capturePromise = captureJob.promise.catch(error => error.code);
captureJob.cancel(); assert.equal(await capturePromise, "CANCELLED");
const bridge = iframe.srcdoc.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1];
assert.ok(bridge, "Actual sandbox API must emit its trusted bridge script");
const nonce = iframe.srcdoc.match(/data-job="([^"]+)"/)[1];
console.info("PINE_SANDBOX_PACKED136_BINDING " + JSON.stringify({ minify: true, bridgeSha256: createHash("sha256").update(bridge).digest("hex"), runtimeSha256: createHash("sha256").update(runtimeCode).digest("hex") }));

function bridgeHarness(persistent = false) {
  let receive, worker; const messages = [], revoked = [];
  const parent = { postMessage(message, origin, transfer = []) {
    assert.equal(origin, "https://edgelab.example");
    // Simulate the browser's structured clone and actual transferable ownership.
    messages.push(structuredClone(message, { transfer: Array.from(transfer) }));
  } };
  const context = vm.createContext({ TextEncoder, Blob, parent,
    document: { currentScript: { dataset: { job: nonce, origin: "https://edgelab.example", session: String(persistent) } } },
    URL: { createObjectURL() { return "blob:trusted-worker"; }, revokeObjectURL(url) { revoked.push(url); } },
    Worker: class { constructor() { worker = this; this.terminated = false; } postMessage() {} terminate() { this.terminated = true; } },
    addEventListener(type, callback) { assert.equal(type, "message"); receive = callback; },
  });
  vm.runInContext(bridge, context);
  assert.equal(messages.pop().type, "ready");
  receive({ source: parent, origin: "https://edgelab.example", data: { nonce, type: "start", workerSource: "trusted-worker", request: { id: "packed136" } } });
  return { context, messages, revoked,
    send(wire, mutation = "", sequence = 0) {
      context.metadataJSON = JSON.stringify({ ...wire, buffers: [] });
      context.buffersJSON = JSON.stringify(wire.buffers.map(buffer => Array.from(new Uint8Array(buffer))));
      vm.runInContext('globalThis.payload=JSON.parse(metadataJSON);payload.buffers=JSON.parse(buffersJSON).map(bytes=>new Uint8Array(bytes).buffer);globalThis.getterReads=0;' + mutation, context);
      context.receiptSequence = sequence;
      const payload = persistent ? vm.runInContext('({protocol:"pine-live-v1",sessionId:"packed136-session",sequence:receiptSequence,response:payload})', context) : context.payload;
      worker.onmessage({ data: payload });
      return messages.at(-1);
    },
    terminated() { return worker.terminated; },
  };
}

const fields = ["lines", "lineFills", "boxes", "labels", "polylines", "tables"];
const bars = Array.from({ length: 128 }, (_, index) => ({ time: 1700000040 + index * 60, open: 100 + index / 10,
  high: 102 + index / 10, low: 99 + index / 10, close: 101 + index / 10, volume: 100 + index }));
const source = '//@version=6\nindicator("Packed drawings 136",overlay=true)\nvar table t=table.new(position.top_right,1,1)\n'
  + Array.from({ length: 64 }, (_, index) => `plot(close+${index},"Channel ${index}")`).join("\n")
  + '\nif barstate.islast\n    a=line.new(bar_index-8,close-2,bar_index,close+2)\n    b=line.new(bar_index-8,close-4,bar_index,close)\n    linefill.new(a,b,#00ff0040)\n    box.new(bar_index-6,close+3,bar_index-2,close-3)\n    label.new(bar_index,close,"Packed label")\n    points=array.from(chart.point.from_index(bar_index-8,close),chart.point.from_index(bar_index,close+1))\n    polyline.new(points,line_color=#ff00ff)\n    table.cell(t,0,0,"Packed table")';
const request = pine.validatePineRequest({ id: "packed136", action: "run", source, bars,
  context: { symbol: "TEST", timeframe: "1", mintick: .01, pointvalue: 1 } });
let cached;
async function fixture() {
  cached ??= (async () => {
    const result = await pine.executePineRequest(request);
    for (const field of fields) assert.ok(result[field]?.length, `Genuine engine must produce ${field}`);
    assert.equal(result.plots.length, 64);
    const wire = pine.toPineWireResponse(request.id, result, bars);
    assert.equal(wire.encoding, "pine-packed-v1"); assert.equal(wire.buffers.length, 192);
    const decoded = pine.validatePineResponse(wire, request);
    for (const field of fields) assert.deepEqual(decoded[field], result[field]);
    return wire;
  })();
  return structuredClone(await cached);
}
function assertBridgeReject(message, harness) {
  assert.equal(message.type, "result"); assert.equal(message.payload.status, "failed");
  assert.equal(message.payload.error.code, "INVALID_MESSAGE"); assert.equal(harness.terminated(), true);
}

test("actual trusted bridge forwards all six genuine drawing collections alongside 64 packed native plot channels", async () => {
  const wire = await fixture(), harness = bridgeHarness(), message = harness.send(wire);
  assert.equal(message.type, "result"); assert.equal(message.payload.status, "completed");
  assert.equal(message.payload.encoding, "pine-packed-v1"); assert.equal(message.payload.buffers.length, 192);
  assert.equal(harness.terminated(), true); assert.deepEqual(harness.revoked, ["blob:trusted-worker"]);
  assert.ok(vm.runInContext("payload.buffers.every(buffer=>buffer.byteLength===0)", harness.context), "Bridge transfers rather than copies typed ownership");
  const decoded = pine.validatePineResponse(message.payload, request);
  for (const field of fields) assert.deepEqual(decoded[field], wire.result[field]);
  assert.equal(decoded.plots.length, 64);
  for (const index of [0, 31, 63]) assert.equal(pine.pointAtBar(decoded.plots[index], 127).value, bars[127].close + index);
});

test("each established drawing key is admitted independently by the bridge's exact packed allowlist", async () => {
  for (const field of fields) {
    const wire = await fixture(); for (const other of fields) if (other !== field) delete wire.result[other];
    const message = bridgeHarness().send(wire);
    assert.equal(message.payload.status, "completed", field);
    assert.deepEqual(message.payload.result[field], wire.result[field]);
  }
});

test("persistent bridge retains drawing metadata and transferable buffers under its existing live envelope gate", async () => {
  const sessionId = "packed136-session", liveRequest = { ...request, id: sessionId + ":0", mode: "live" };
  const command = pine.validatePineLiveRequest({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: liveRequest });
  const executor = pine.createPineLiveExecutor();
  let result;
  try { result = await executor.execute(command); } finally { executor.dispose(); }
  const wire = pine.toPineWireResponse(liveRequest.id, result, bars), harness = bridgeHarness(true), message = harness.send(wire);
  assert.equal(message.type, "result"); assert.equal(message.payload.protocol, "pine-live-v1");
  assert.equal(message.payload.sessionId, sessionId); assert.equal(message.payload.sequence, 0);
  assert.equal(harness.terminated(), false); assert.equal(harness.revoked.length, 0);
  const decoded = pine.validatePineLiveResponse(message.payload, command, liveRequest);
  assert.equal(decoded.audit.mode, "live");
  for (const field of fields) assert.deepEqual(decoded[field], result[field]);
  assert.throws(() => pine.validatePineLiveResponse({ ...message.payload, sequence: 1 }, command, liveRequest), pine.PineProtocolError);
});

test("packed owned live results preserve actual named definitions and alert messages through the trusted bridge", async () => {
  const sessionId = "packed136-session";
  const conditionSource = source.replace('plot(close+63,"Channel 63")', 'alertcondition(close>open,"Signal","{{close}}")')
    + '\nalert("Packed owned update",alert.freq_all)';
  assert.notEqual(conditionSource, source);
  const initial = { ...request, id: sessionId + ":0", source: conditionSource, mode: "live" };
  const executor = pine.createPineLiveExecutor();
  try {
    const started = await executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start", request: initial });
    assert.deepEqual(started.alertConditions, [{ id: "alertcondition_0", title: "Signal", message: "{{close}}" }]);
    assert.equal(Object.hasOwn(started, "alertEvents"), false);
    const bar = { time: bars.at(-1).time + 60, open: 115, high: 117, low: 114, close: 116, volume: 10 };
    const command = { protocol: "pine-live-v1", sessionId, sequence: 1, action: "update", bar, confirmed: false, collectAlerts: true };
    const result = await executor.execute(command), current = { ...initial, id: sessionId + ":1", bars: [...bars, bar] };
    assert.deepEqual(result.alertConditions, [{ id: "alertcondition_0", title: "Signal", message: "{{close}}" }]);
    assert.equal(result.alertEvents.events[0].message, "Packed owned update");
    const wire = pine.toPineWireResponse(current.id, result, current.bars);
    assert.equal(wire.encoding, "pine-packed-v1");
    const harness = bridgeHarness(true), message = harness.send(wire, "", 1);
    assert.equal(message.type, "result"); assert.equal(message.payload.sequence, 1);
    assert.equal(message.payload.response.status, "completed"); assert.equal(harness.terminated(), false);
    const decoded = pine.validatePineLiveResponse(message.payload, command, current);
    assert.deepEqual(decoded.alertConditions, result.alertConditions); assert.deepEqual(decoded.alertEvents, result.alertEvents);
    assert.equal(decoded.plots.length, 63);
    for (const mutation of ['payload.result.alertConditions[0].id="foreign";', 'payload.result.alertEvents.events[0].time--;']) {
      const invalid = bridgeHarness(true).send(pine.toPineWireResponse(current.id, result, current.bars), mutation, 1);
      assert.equal(invalid.payload.response.status, "completed");
      assert.throws(() => pine.validatePineLiveResponse(invalid.payload, command, current), pine.PineProtocolError);
    }
  } finally { executor.dispose(); }
});

test("unknown result and envelope keys remain rejected before packed transport reaches the parent", async () => {
  for (const mutation of ['payload.result.futureDrawing=[];', 'payload.extra=true;', 'payload.result.constructor="bad";']) {
    const harness = bridgeHarness(); assertBridgeReject(harness.send(await fixture(), mutation), harness);
  }
});

test("nested accessor and nonplain drawing metadata cannot cross the trusted bridge", async () => {
  for (const mutation of [
    'Object.defineProperty(payload.result.lines[0],"color",{enumerable:true,get(){getterReads++;return "#ff0000";}});',
    'Object.setPrototypeOf(payload.result.boxes[0],{inherited:true});',
    'Object.defineProperty(payload.result.labels[0],"extra",{value:1});',
    'payload.result.polylines[0].points[0].y=Infinity;',
  ]) {
    const harness = bridgeHarness(); assertBridgeReject(harness.send(await fixture(), mutation), harness);
    assert.equal(harness.context.getterReads, 0, "Metadata inspection must not invoke object getters");
  }
});

test("packed buffer ownership, references, exact byte lengths and hard dimensions remain enforced", async () => {
  for (const mutation of [
    'payload.buffers[1]=payload.buffers[0];',
    'payload.buffers[0]=new ArrayBuffer(1);',
    'payload.result.plots[0].packed.values=-1;',
    'payload.result.plots[0].packed.kinds=payload.result.plots[0].packed.values;',
    'payload.result.plots[0].packed.slots=20001;',
    'payload.result.plots[0].packed.arity=2;',
    'Object.defineProperty(payload.buffers[0],"extra",{value:true});',
    'payload.buffers[0]=new SharedArrayBuffer(payload.buffers[0].byteLength);',
  ]) {
    const harness = bridgeHarness(); assertBridgeReject(harness.send(await fixture(), mutation), harness);
  }
});

test("existing metadata and binary budgets reject cumulative overage without raising drawing or plot limits", async () => {
  for (const mutation of [
    'payload.result.inputs=Object.fromEntries(Array.from({length:60},(_,i)=>["padding"+i,"x".repeat(20000)]));',
    'payload.buffers[0]=new ArrayBuffer(16000001);',
  ]) {
    const harness = bridgeHarness(); assertBridgeReject(harness.send(await fixture(), mutation), harness);
  }
});

test("parent schema validation still rejects admissible ordinary metadata with invalid drawing fields, references or request identity", async () => {
  for (const mutation of [
    'payload.result.lines[0].extra=true;',
    'payload.result.lineFills[0].line1="missing-line";',
    'payload.result.boxes[0].borderWidth=17;',
    'payload.result.labels[0].text="x".repeat(4097);',
    'payload.result.polylines[0].points[0].x=0.5;',
    'payload.result.tables[0].columns=4097;',
    'payload.result.source+="\\nplot(1)";',
    'payload.id="foreign-request";',
  ]) {
    const harness = bridgeHarness(), message = harness.send(await fixture(), mutation);
    assert.equal(message.payload.status, "completed", mutation);
    assert.throws(() => pine.validatePineResponse(message.payload, request), pine.PineProtocolError, mutation);
  }
});
