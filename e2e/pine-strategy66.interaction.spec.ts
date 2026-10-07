import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const root = path.resolve(import.meta.dirname, "..");
const artifacts = path.join(root, ".artifacts/pine-strategy66/browser");
const port = Number(process.env.EDGELAB_PINE_STRATEGY66_PORT ?? 45366);
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
      resolveDir: path.join(root, "frontend/src/lib"), loader: "ts", sourcefile: "strategy66-host.ts",
    },
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "strategy66Host",
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

const trailingBars = [
  { open: 100, high: 102, low: 98, close: 100 },
  { open: 100, high: 120, low: 95, close: 105 },
].map((bar, index) => ({ ...bar, time: bars[0].time + index * 60, volume: 100 + index }));
const trail = (settings: string, short = false, version = 6) => `//@version=${version}
strategy("Production trailing",initial_capital=10000,calc_on_order_fills=true)
varip int executions=-1
executions+=1
if bar_index==0
    strategy.entry("Trade",strategy.${short ? "short" : "long"})
if strategy.position_size!=0
    strategy.exit("Trail","Trade",${settings})
plot(executions,"Executions")
plot(executions[1],"Prior executions")
plot(strategy.position_size,"Position")`;

test("frozen production worker preserves trailing path, gaps, reservations and inactive NA legs", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const outcomes: any[] = [];
  const run = async (source: string, snapshot = trailingBars) => {
    const request = { action: "run", source, inputs: {}, bars: snapshot, mode: "historical", context: { symbol: "TEST", timeframe: "1", mintick: 1, pointvalue: 1 } };
    const output = await page.evaluate((request) => (window as any).strategy66Host.run(request), request);
    outcomes.push({ request, output });
    if (output.ok) {
      expect(output.value.source).toBe(source);
      for (const plot of output.value.plots) expect(plot.points.map((point: any) => point.time)).toEqual(snapshot.map((bar) => bar.time));
    }
    return output;
  };
  const closed = (output: any, expected: number[][]) => {
    expect(output.ok, JSON.stringify(output.error)).toBe(true);
    expect(output.value.strategy.closedTrades.map((trade: any) => [trade.entry_price, trade.exit_price, trade.size, trade.profit])).toEqual(expected);
  };

  const long = await run(trail("trail_price=110,trail_points=na,trail_offset=5"));
  closed(long, [[100, 115, 1, 15]]);
  expect(values(long.value, "Executions")).toEqual([0, 3]);
  expect(values(long.value, "Prior executions")).toEqual([null, 0]);
  const short = await run(trail("trail_price=90,trail_offset=5", true), [trailingBars[0], { ...trailingBars[1], high: 105, low: 80, close: 95 }]);
  closed(short, [[100, 85, -1, 15]]);

  const gap = await run(trail("trail_price=110,trail_offset=5"), [trailingBars[0], { ...trailingBars[1], close: 118 },
    { ...trailingBars[1], time: trailingBars[1].time + 60, open: 110, high: 112, low: 100, close: 108 }]);
  closed(gap, [[100, 110, 1, 10]]);
  expect(values(gap.value, "Executions")).toEqual([0, 2, 4]);

  const reservedSource = `${header}
varip bool placed=false
if bar_index==0
    strategy.entry("Trade",strategy.long,qty=20)
if strategy.position_size==20 and not placed
    placed:=true
    strategy.exit("TP","Trade",limit=130,qty=19)
    strategy.exit("Trail","Trade",trail_price=110,trail_offset=5,qty=20)
plot(strategy.position_size,"Position")`;
  const reserved = await run(reservedSource);
  closed(reserved, [[100, 115, 1, 15]]);
  expect(reserved.value.strategy.metrics.position_size).toBe(19);
  expect(reserved.value.strategy.pendingOrders).toHaveLength(1);
  expect(reserved.value.strategy.pendingOrders[0].id).toBe("TP");

  const inactive = await run(trail("trail_price=na,trail_points=na,trail_offset=na"));
  closed(inactive, []);
  expect(inactive.value.strategy.metrics.position_size).toBe(1);
  expect(inactive.value.strategy.openTrades[0]).toMatchObject({ entry_price: 100, size: 1 });
  expect(inactive.value.strategy.pendingOrders).toEqual([]);
  for (const version of [5, 6]) {
    const paired = await run(trail("trail_price=115,trail_points=5,trail_offset=3", false, version),
      [trailingBars[0], { ...trailingBars[1], high: 110, close: 106 }]);
    closed(paired, version === 6 ? [[100, 107, 1, 7]] : []);
    expect(paired.value.strategy.metrics.position_size).toBe(version === 6 ? 0 : 1);
  }

  const legacySource = '//@version=6\nstrategy("Legacy gap",initial_capital=10000,calc_on_order_fills=false)\nif bar_index==0\n    strategy.entry("Trade",strategy.long)\n    strategy.exit("Combined","Trade",limit=125,trail_points=10,trail_offset=5)\nplot(strategy.position_size,"Position")';
  const legacy = await run(legacySource, [trailingBars[0], { ...trailingBars[1], close: 119 },
    { ...trailingBars[1], time: trailingBars[1].time + 60, open: 110, high: 130, low: 80, close: 125 }]);
  closed(legacy, [[100, 110, 1, 10]]);
  const invalid = await run(trail("trail_price=110,trail_offset=-1"));
  expect(invalid).toMatchObject({ ok: false, error: { code: "UNSUPPORTED_ORDER_FILL_CONTEXT" } });

  // Genuine fresh job after a refused parameter keeps the65 nontrailing contract.
  const retained = await run(reversal, bars);
  expect(retained.ok, JSON.stringify(retained.error)).toBe(true);
  expect(values(retained.value, "Executions")).toEqual([0, 4, 8]);
  expect(values(retained.value, "Prior executions")).toEqual([null, 0, 4]);
  expect(values(retained.value, "Ordinary")).toEqual([1, 2, 3]);
  expect(values(retained.value, "SMA")).toEqual([null, 92.5, 122.5]);
  expect(retained.value.strategy.metrics.netprofit).toBe(-10);
  expect(retained.value.strategy.closedTrades).toHaveLength(7);
  await expect(page.locator('iframe[sandbox="allow-scripts"]')).toHaveCount(0);
  expect(workerRequests).toHaveLength(outcomes.length);
  expect(outcomes).toHaveLength(10);
  expect(unexpectedRequests).toEqual([]);
  expect(errors).toEqual([]);
  const directory = path.join(artifacts, info.project.name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "opaque-worker.json"), JSON.stringify({
    project: info.project.name, workerPath, workerBytes: workerBytes.length,
    workerSha256: createHash("sha256").update(workerBytes).digest("hex"),
    outcomes, pageErrors: errors, workerRequests, unexpectedRequests,
    limitation: "Emulated Chromium widths; real production opaque-worker numerical proof, no rendered product UI or full TV parity claim.",
  }, null, 2));
});
