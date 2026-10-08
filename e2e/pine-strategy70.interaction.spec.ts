import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

import { cases70, context70, ledger70 } from "../backend/tests/fixtures/pine-strategy70.mjs";
const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-strategy70/browser");
const port = Number(process.env.EDGELAB_PINE_STRATEGY70_PORT ?? 45370);
let server: http.Server;
let origin: string;
let workerPath: string;
let workerBytes: Buffer;
let workerRequests: string[];
let unexpectedRequests: string[];

// Same real-runtime transport as pine-runtime: the host bundles only the public
// job API; the opaque bridge receives byte-identical frozen production worker JS.
test.beforeAll(async () => {
  const assets = path.join(root, "frontend/dist/assets");
  const name = fs.readdirSync(assets).find((entry) => /^pine-native-worker.*\.js$/.test(entry));
  if (!name) throw new Error("Build the production worker before this isolated gate.");
  workerPath = `/assets/${name}`;
  workerBytes = fs.readFileSync(path.join(assets, name));
  const fixture = await build({
    stdin: {
      contents: `import {createPineRuntimeJob} from './pineRuntime';
export async function run(request) {
  try { return {ok:true,value:await createPineRuntimeJob(request).promise}; }
  catch(error) { return {ok:false,error:{name:error.name,code:error.code,message:error.message}}; }
}`,
      resolveDir: path.join(root, "frontend/src/lib"), loader: "ts", sourcefile: "strategy70-host.ts",
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "strategy70Host",
    plugins: [{ name: "frozen-worker", setup(builder) {
      builder.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: "worker", namespace: "production" }));
      builder.onLoad({ filter: /.*/, namespace: "production" }, () => ({ contents: `export default ${JSON.stringify(workerPath)}`, loader: "js" }));
    } }],
  });
  workerRequests = [];
  unexpectedRequests = [];
  server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><title>Production strategy fill verification</title><script src="/host.js"></script>');
    } else if (pathname === "/host.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(fixture.outputFiles[0].contents);
    } else if (pathname === workerPath) {
      workerRequests.push(pathname);
      response.setHeader("Content-Type", "text/javascript");
      response.end(workerBytes);
    } else if (pathname === "/favicon.ico") {
      response.statusCode = 204;
      response.end();
    } else {
      unexpectedRequests.push(pathname);
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("production opaque worker preserves per-entry partial exits and pending entry eligibility", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  const outcomes = [];
  for (const scenario of cases70) {
    const request = { action: "run", source: scenario.source, inputs: {}, bars: scenario.bars, mode: "historical", context: scenario.context ?? context70 };
    const output = await page.evaluate(request => (window as any).strategy70Host.run(request), request);
    outcomes.push({ name: scenario.name, request, output });
    expect(output.ok, `${scenario.name}: ${JSON.stringify(output.error)}`).toBe(true);
    expect(output.value.source).toBe(scenario.source);
    expect(ledger70(output.value), scenario.name).toEqual({ ...scenario.expected, pending: scenario.expected.pending ?? [] });
    for (const plot of output.value.plots) expect(plot.points.map((point: any) => point.time)).toEqual(scenario.bars.map(bar => bar.time));
    for (const trade of output.value.strategy.closedTrades) {
      expect(trade.entry_time).toBe(scenario.bars[trade.entry_bar_index].time);
      expect(trade.exit_time).toBe(scenario.bars[trade.exit_bar_index].time);
    }
    await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  }
  expect(workerRequests).toHaveLength(cases70.length);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "opaque-worker.json"), JSON.stringify({
    project: info.project.name, workerPath, workerBytes: workerBytes.length,
    workerSha256: createHash("sha256").update(workerBytes).digest("hex"),
    outcomes, pageErrors: errors, workerRequests, unexpectedRequests,
    limitation: "Emulated Chromium widths; actual production opaque-worker ledgers, no rendered UI or complete TradingView equivalence claim.",
  }, null, 2));
});
