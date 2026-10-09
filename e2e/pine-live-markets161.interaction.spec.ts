import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import { createHash } from "node:crypto";

// Controlled market input, real host facade and production opaque worker bridge.
// Secondary socket acquisition is outside this controlled-input integration.
for (const requestedMarket of [false, true]) test(`remote acknowledgements and ${requestedMarket ? "independent requested calculations" : "quiet chart state"} traverse the actual isolated worker`, async ({ page }, info) => {
  const worker = fs.readdirSync("frontend/dist/assets").find(file => /^pine-native-worker-.*\.js$/.test(file))!;
  const workerBytes = fs.readFileSync(`frontend/dist/assets/${worker}`), workerSha = createHash("sha256").update(workerBytes).digest("hex");
  const fixture = (await build({ bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent", define: { "import.meta.env": "{}" },
    plugins: [{ name: "production-worker-url161", setup(api) {
      api.onResolve({ filter: /^virtual:pine-worker-url$/ }, () => ({ path: worker, namespace: "url161" }));
      api.onLoad({ filter: /.*/, namespace: "url161" }, () => ({ contents: `export default ${JSON.stringify(`/assets/${worker}`)};`, loader: "js" }));
    } }], stdin: { loader: "ts", resolveDir: process.cwd(), contents: `
import {createPineLiveRuntimeSession} from './frontend/src/lib/pineRuntime';
const start=1704067200;
const bar=(index,close=100)=>({time:start+index*60,open:100,high:Math.max(101,close),low:Math.min(99,close),close,volume:10});
const context=symbol=>({symbol,timeframe:'1',mintick:.01,mincontract:.001,quantityStep:.001,pointvalue:1,currency:'USDT',basecurrency:symbol.includes('ETH')?'ETH':'BTC'});
const tail=(result,name)=>result.plots.find(plot=>plot.name===name).points.at(-1).value;
window.runLedger161=async()=>{
 const messages=[];const listen=event=>{if(event.origin==='null'&&event.data?.type==='result')messages.push(event.data.payload);};
 window.addEventListener('message',listen);
 const session=createPineLiveRuntimeSession({source:${JSON.stringify('//@version=6\nindicator("Browser ledger")\nvarip int ticks=0\nticks+=1\nplot(ticks,"Ticks")\nplot(close,"Price")' + (requestedMarket ? '\nplot(request.security("BINANCE:ETHUSDT","1",close),"Remote")' : ''))},inputs:{},bars:[bar(0),bar(1)],context:context('BINANCE:BTCUSDT'),marketData:{provider:'binance',snapshots:[{context:context('BINANCE:ETHUSDT'),requestedTimeframe:'1',bars:[bar(0),bar(1,101)],asOf:start+120}]},marketStreams:[{symbol:'BINANCE:ETHUSDT',timeframe:'1',epoch:4}]});
 try {
  const initial=await session.promise;const frame=document.querySelector('iframe');
  const isolation={sandbox:frame.getAttribute('sandbox'),hidden:frame.hidden,networkDenied:frame.srcdoc.includes("connect-src 'none'")};
  const source=(sequence,close,confirmed=false)=>({symbol:'BINANCE:ETHUSDT',timeframe:'1',epoch:4,sequence,bar:bar(2,close),confirmed,closeTime:(start+180)*1000-1,eventTime:confirmed?(start+180)*1000:(start+120)*1000+sequence*100});
  const first=await session.updateMarkets([source(1,105)]);const second=await session.updateMarkets([source(2,110),source(3,110,true)]);
  const quiet=await session.setViewport(null);const main=await session.update(bar(2,107),false);
  return {isolation,initialTicks:tail(initial,'Ticks'),quietTicks:tail(quiet,'Ticks'),mainTicks:tail(main,'Ticks'),mainPrice:tail(main,'Price'),remote:${requestedMarket ? "[tail(initial,'Remote'),tail(quiet,'Remote'),tail(main,'Remote')]" : "null"},quietPlotsUnchanged:JSON.stringify(initial.plots)===JSON.stringify(quiet.plots),first,second,messages:messages.map(message=>({sequence:message.sequence,kind:message.response.ack?.kind??message.response.result?.kind,hasAck:!!message.response.ack,hasResult:!!message.response.result}))};
 }finally{session.cancel();window.removeEventListener('message',listen);}
};
` } })).outputFiles[0].text;
  await page.route("**/live-ledger-fixture161", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><title>Live market protocol test</title><script type="module" src="/live-ledger-fixture161.js"></script>' }));
  await page.route("**/live-ledger-fixture161.js", route => route.fulfill({ contentType: "text/javascript", body: fixture }));
  const requestedWorkers: string[] = [], errors: string[] = [];
  page.on("request", request => { if (request.url().includes("pine-native-worker-")) requestedWorkers.push(request.url()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/live-ledger-fixture161");
  await page.waitForFunction(() => typeof (window as any).runLedger161 === "function");
  const result = await page.evaluate(() => (window as any).runLedger161());
  expect(result.isolation).toEqual({ sandbox: "allow-scripts", hidden: true, networkDenied: true });
  expect([result.initialTicks, result.quietTicks, result.mainTicks, result.mainPrice]).toEqual([2, 2, 3, 107]);
  expect(result.quietPlotsUnchanged).toBe(true);
  if (requestedMarket) expect(result.remote).toEqual([101, 101, 110]);
  expect(result.first.streams[0].revision).toBe(1); expect(result.second.streams[0].revision).toBe(3); expect(result.second.streams[0].confirmed).toBe(true);
  expect(result.messages.map((entry: any) => entry.sequence)).toEqual([0, 1, 2, 3, 4]);
  expect(result.messages.filter((entry: any) => entry.hasAck)).toEqual([
    { sequence: 1, kind: "market-update", hasAck: true, hasResult: false }, { sequence: 2, kind: "market-update", hasAck: true, hasResult: false },
  ]);
  expect(requestedWorkers).toEqual([`http://127.0.0.1:45361/assets/${worker}`]); expect(errors).toEqual([]);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(createHash("sha256").update(fs.readFileSync(`frontend/dist/assets/${worker}`)).digest("hex")).toBe(workerSha);
  await info.attach("real-worker-receipt", { body: JSON.stringify({ worker, workerSha, controlledMarketInput: true, genuineHostAndOpaqueWorker: true, result }, null, 2), contentType: "application/json" });
});
