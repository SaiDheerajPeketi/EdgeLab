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
    sourcefile: "pine-strategy70-fixture.ts",
  },
})).outputFiles[0].text + "\n//# sourceURL=edgelab-strategy70-minified-worker.mjs\n";
const pine = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
console.info("STRATEGY70_BINDING " + JSON.stringify({
  minify: true,
  bundleSha256: sha(bundle),
  bundleBytes: Buffer.byteLength(bundle),
  workerSourceSha256: sha(fs.readFileSync(new URL("../../frontend/src/workers/pineNative.worker.ts", import.meta.url))),
  engineManifestSha256: sha(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))),
}));
import {cases70,context70,ledger70} from "./fixtures/pine-strategy70.mjs";
for(const scenario of cases70) test(scenario.name,async()=>{
 const result=await pine.executePineRequest({id:"strategy70",action:"run",source:scenario.source,bars:scenario.bars,inputs:{},context:scenario.context??context70});
 assert.deepEqual(ledger70(result),scenario.expected);
 for(const trade of result.strategy.closedTrades){assert.equal(trade.entry_time,scenario.bars[trade.entry_bar_index].time);assert.equal(trade.exit_time,scenario.bars[trade.exit_bar_index].time);}
});
