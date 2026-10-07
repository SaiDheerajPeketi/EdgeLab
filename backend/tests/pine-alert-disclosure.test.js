import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const bundle = buildSync({ bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", stdin: {
  contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export { Indicator, PineTS } from "pinets";',
  loader: "ts", resolveDir: fileURLToPath(new URL("../..", import.meta.url)),
} }).outputFiles[0].text;
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const bars = JSON.parse(readFileSync(new URL("../../e2e/pine-visuals.bars.json", import.meta.url))).slice(0, 32);
const context = { symbol: "TEST", timeframe: "1", mintick: 0.01, pointvalue: 1 };
const source = (body) => '//@version=5\nindicator("Alert disclosure")\n' + body + '\nplot(close,"Close")';
const request = (body, action = "run") => ({ id: "alert-disclosure", action, source: source(body), ...(action === "run" ? { bars, context } : {}) });
const warnings = (result) => result.diagnostics.filter((item) => item.code === "ALERT_DELIVERY_UNAVAILABLE");

test("actual alert helper calls disclose unavailable delivery once without changing prices", async () => {
  for (const body of ['alertcondition(false,"Inactive","No signal")', 'alertcondition(close>open,"Signal","Signal")', 'alert("Message",alert.freq_once_per_bar)', 'alertcondition(false,"Inactive","No signal")\nalert("Message",alert.freq_all)']) {
    const result = await pine.executePineRequest(request(body));
    assert.equal(warnings(result).length, 1);
    assert.match(warnings(result)[0].message, /no alert was sent/);
    assert.equal(result.plots.length, 1);
    assert.deepEqual(result.plots[0].points.map((point) => point.value), bars.map((bar) => bar.close));
  }
});

test("dead branches and following independent requests do not inherit alert warnings", async () => {
  const body = 'if false\n    alert("Unexecuted",alert.freq_all)';
  assert.equal(warnings(await pine.executePineRequest(request(body))).length, 0);
  assert.equal(warnings(await pine.executePineRequest(request('alertcondition(false,"Inactive","No signal")'))).length, 1);
  assert.equal(warnings(await pine.executePineRequest(request(""))).length, 0);
  assert.equal(warnings(await pine.executePineRequest(request('alert("Message")', "prepare"))).length, 0);
});

test("raw engine alert helpers keep their prototype and retain no host warning state", async () => {
  const data = bars.map((bar) => ({ openTime: bar.time * 1000, closeTime: (bar.time + 60) * 1000, ...bar }));
  const before = await new pine.PineTS(data, "TEST", "1", data.length).run(new pine.Indicator(source("")));
  const prototype = Object.getPrototypeOf(before.pine.alert), original = prototype.any;
  await pine.executePineRequest(request('alert("Message",alert.freq_once_per_bar_close)'));
  assert.equal(prototype.any, original);
  const after = await new pine.PineTS(data, "TEST", "1", data.length).run(new pine.Indicator(source('alertcondition(false,"Inactive","No signal")')));
  assert.equal(Object.hasOwn(after.pine.alert, "any"), false);
  assert.equal(after.pine.alert.any, original);
});
