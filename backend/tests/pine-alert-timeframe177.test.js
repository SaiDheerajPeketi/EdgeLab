import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

Error.stackTraceLimit = 0;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: process.cwd(),
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";' } })).outputFiles[0].text;
const pine = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const origin = Date.UTC(2024, 0, 1) / 1000;
const bars = Array.from({ length: 6 }, (_, i) => ({ time: origin + i * 60, open: 100, high: 102, low: 99, close: 101, volume: 10 }));
const request = (body, version, timeframe, action = "run") => ({ id: "alert-timeframe177", action, mode: "historical", inputs: {}, bars,
  context: { symbol: "CHART:TEST", timeframe: "1", mintick: .01, pointvalue: 1 },
  source: `//@version=${version}\nindicator("Declared alert177",timeframe="${timeframe}")\n${body}\nplot(close,"Price")` });
const forbidden = [
  'alert("Direct",alert.freq_all)',
  'if false\n    alert("Unreached",freq=alert.freq_once_per_bar)',
  'f()=>alert("Helper",alert.freq_once_per_bar_close)\nif false\n    f()',
];
const compileError = error => error.code === "COMPILE_ERROR" && /timeframe.*alert/i.test(error.message);

test("actual v5/v6 AST rejects declared timeframe alert side effects in prepare, history and live startup", async () => {
  let ordinal = 0;
  for (const version of [5, 6]) for (const timeframe of ["", "1", "3"]) for (const body of forbidden) {
    for (const action of ["prepare", "run"]) await assert.rejects(pine.executePineRequest(request(body, version, timeframe, action)), compileError);
    const executor = pine.createPineLiveExecutor(), sessionId = `alert-timeframe177-${++ordinal}`;
    try {
      await assert.rejects(executor.execute({ protocol: "pine-live-v1", sessionId, sequence: 0, action: "start",
        request: { ...request(body, version, timeframe), id: sessionId + ":0", mode: "live" } }), compileError);
    } finally { executor.dispose(); }
  }
});

test("comments, message text and permitted alertcondition do not masquerade as alert side effects", async () => {
  for (const version of [5, 6]) {
    const result = await pine.executePineRequest(request('// alert("Only a comment")\nnote=input.string("alert()")\nalertcondition(close>open,"Alert","alert()")', version, "3"));
    assert.equal(Object.hasOwn(result, "alertEvents"), false);
    assert.ok(result.plots.some(plot => plot.name === "Price"));
  }
});
