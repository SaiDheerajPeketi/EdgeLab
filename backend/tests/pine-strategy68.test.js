import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = (await build({
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "silent",
  plugins: [createPineEnginePlugin()],
  define: { "import.meta.env": "{}" },
  stdin: {
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts";',
    loader: "ts",
    resolveDir: root,
    sourcefile: "pine-strategy68-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-strategy68-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
console.info("STRATEGY68_BINDING " + JSON.stringify({
  minify: true,
  bundleSha256: sha(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  workerSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/workers/pineNative.worker.ts", import.meta.url))),
  engineManifestSha256: sha(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))),
}));
import { cases68, context68, ledger68 } from "./fixtures/pine-strategy68.mjs";
for (const scenario of cases68) {
  test(scenario.name, async () => {
    const request = { id: "strategy68", action: "run", source: scenario.source, bars: scenario.bars, inputs: {}, context: context68 };
    if (scenario.error) {
      await assert.rejects(pine.executePineRequest(request), error => {
        assert.equal(error.code, scenario.error);
        assert.match(error.message, /fixed quantities or partial percentages/);
        return true;
      });
      return;
    }
    const result = await pine.executePineRequest(request);
    assert.equal(result.source, scenario.source);
    assert.deepEqual(ledger68(result), { ...scenario.expected, pending: scenario.expected.pending ?? [] });
    for (const plot of result.plots) assert.deepEqual(plot.points.map(point => point.time), scenario.bars.map(bar => bar.time));
    for (const trade of result.strategy.closedTrades) {
      assert.equal(trade.entry_time, scenario.bars[trade.entry_bar_index].time);
      assert.equal(trade.exit_time, scenario.bars[trade.exit_bar_index].time);
    }
  });
}
