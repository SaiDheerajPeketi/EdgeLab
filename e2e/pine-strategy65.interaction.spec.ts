import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-strategy65/browser");
const port = Number(process.env.EDGELAB_PINE_STRATEGY65_PORT ?? 45365);
const bars = [
  { open: 70, high: 85, low: 65, close: 80 },
  { open: 100, high: 110, low: 80, close: 105 },
  { open: 120, high: 150, low: 110, close: 140 },
].map((bar, index) => ({ ...bar, time: 1700000040 + index * 60, volume: 100 + index }));
const header = '//@version=6\nstrategy("Actual historical fills",initial_capital=10000,default_qty_value=1,calc_on_order_fills=true)';
const reversal = `${header}
varip int executions=-1
executions+=1
var int ordinary=0
ordinary+=1
var array<int> ordinaryValues=array.new<int>()
array.push(ordinaryValues,bar_index)
if strategy.position_size<=0
    strategy.entry("Long",strategy.long)
else
    strategy.entry("Short",strategy.short)
plot(executions,"Executions")
plot(executions[1],"Prior executions")
plot(ordinary,"Ordinary")
plot(array.size(ordinaryValues),"Ordinary collection")
plot(ta.sma(close,2),"SMA")
plot(high,"Final high")`;
const values = (result: any, name: string) => result.plots.find((plot: any) => plot.name === name).points.map((point: any) => point.value);
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
      resolveDir: path.join(root, "frontend/src/lib"), loader: "ts", sourcefile: "strategy65-host.ts",
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "strategy65Host",
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

test("frozen production opaque worker interleaves fills and protects guarded failure boundaries", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const outcomes: any[] = [];
  const run = async (source: string, snapshot = bars) => {
    const request = { action: "run", source, inputs: {}, bars: snapshot, mode: "historical", context: { symbol: "TEST", timeframe: "1", mintick: 1, pointvalue: 1 } };
    const output = await page.evaluate((request) => (window as any).strategy65Host.run(request), request);
    outcomes.push({ request, output });
    return output;
  };
  const first = await run(reversal);
  expect(first.ok, JSON.stringify(first.error)).toBe(true);
  const result = first.value;
  expect(result.source).toBe(reversal);
  expect(result.strategy.config.calc_on_order_fills).toBe(true);
  expect(values(result, "Executions")).toEqual([0, 4, 8]);
  expect(values(result, "Prior executions")).toEqual([null, 0, 4]);
  // This ordinary-variable expectation is the documented rollback model,
  // not independently recorded output from a TradingView chart.
  expect(values(result, "Ordinary")).toEqual([1, 2, 3]);
  expect(values(result, "Ordinary collection")).toEqual([1, 2, 3]);
  expect(values(result, "SMA")).toEqual([null, 92.5, 122.5]);
  expect(values(result, "Final high")).toEqual([85, 110, 150]);
  for (const plot of result.plots) expect(plot.points.map((point: any) => point.time)).toEqual(bars.map((bar) => bar.time));
  expect(result.strategy.closedTrades.map((trade: any) => [trade.entry_price, trade.exit_price, trade.size, trade.profit])).toEqual([
    [100, 110, 1, 10], [110, 80, -1, 30], [80, 105, 1, 25],
    [105, 120, -1, -15], [120, 110, 1, -10], [110, 150, -1, -40], [150, 140, 1, -10],
  ]);
  expect(result.strategy.metrics.netprofit).toBe(-10);
  expect(result.strategy.openTrades[0]).toMatchObject({ entry_price: 140, size: -1 });

  const partialSource = `${header.replace("default_qty_value=1", "pyramiding=2")}
varip bool placed=false
if bar_index==0
    strategy.entry("A",strategy.long,qty=2)
    strategy.entry("B",strategy.long,qty=2)
if strategy.position_size==4 and not placed
    placed:=true
    strategy.exit("X",limit=105,qty_percent=75)
plot(strategy.position_size,"Position")`;
  const partial = await run(partialSource, bars.slice(0, 2));
  expect(partial.ok, JSON.stringify(partial.error)).toBe(true);
  expect(partial.value.source).toBe(partialSource);
  expect(partial.value.strategy.closedTrades.map((trade: any) => [trade.entry_id, trade.size, trade.profit])).toEqual([["A", 2, 10], ["B", 1, 5]]);
  expect(partial.value.strategy.metrics.netprofit).toBe(15);
  expect(partial.value.strategy.openTrades[0]).toMatchObject({ entry_id: "B", size: 1 });

  const reservedSource = `${header}
varip bool placed=false
if bar_index==0
    strategy.entry("Buy",strategy.long,qty=20)
if strategy.position_size==20 and not placed
    placed:=true
    strategy.exit("TP",limit=110,qty=19)
    strategy.exit("SL",stop=90,qty=20)
plot(strategy.position_size,"Position")`;
  const reserved = await run(reservedSource, [bars[0], { ...bars[1], high: 105, close: 95 }]);
  expect(reserved.ok, JSON.stringify(reserved.error)).toBe(true);
  expect(reserved.value.source).toBe(reservedSource);
  expect(reserved.value.strategy.closedTrades.map((trade: any) => [trade.exit_price, trade.size, trade.profit])).toEqual([[90, 1, -10]]);
  expect(reserved.value.strategy.metrics.netprofit).toBe(-10);
  expect(reserved.value.strategy.metrics.position_size).toBe(19);
  expect(values(reserved.value, "Position")).toEqual([0, 19]);

  const history = await run(`${header.replace("calc_on_order_fills=true", "calc_on_order_fills=true,calc_on_every_history_tick=true")}\nruntime.error("BODY_RAN")`);
  expect(history).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_EXECUTION_SETTING" } });
  expect(history.error.message).not.toContain("BODY_RAN");
  const trailing = await run(`${header}
if bar_index==0
    strategy.entry("Buy",strategy.long)
if strategy.position_size>0
    strategy.exit("Trail","Buy",trail_points=5)`);
  expect(trailing).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_ORDER_FILL_CONTEXT" } });
  const cycle = await run(`${header.replace("calc_on_order_fills=true", "calc_on_order_fills=true,process_orders_on_close=true")}
if strategy.position_size==0
    strategy.entry("Buy",strategy.long)
else
    strategy.close("Buy",immediately=true)`, bars.slice(0, 1));
  expect(cycle).toMatchObject({ ok: false, error: { code: "STRATEGY_EXECUTION_LIMIT" } });
  // A failed isolated worker must not prevent the next genuine job succeeding.
  const recovery = await run(reversal);
  expect(recovery.ok, JSON.stringify(recovery.error)).toBe(true);
  expect(values(recovery.value, "Executions")).toEqual([0, 4, 8]);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(workerRequests.length).toBe(outcomes.length);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "opaque-worker.json"), JSON.stringify({
    project: info.project.name, workerPath, workerBytes: workerBytes.length,
    workerSha256: createHash("sha256").update(workerBytes).digest("hex"),
    outcomes, pageErrors: errors, workerRequests, unexpectedRequests,
    limitation: "Emulated Chromium widths; real production opaque worker, no rendered UI or TV parity claim.",
  }, null, 2));
});
