import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createPineEnginePlugin } from "../../scripts/pine-engine.mjs";

// Host integration, not a browser: real Pine/resolver/auth/HTTP paths share one
// minified module. Controlled worker scheduling is explicitly named below.
Error.stackTraceLimit = 0;
const root = new URL("../../", import.meta.url).pathname;
const bundle = (await build({ bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false,
  logLevel: "silent", define: { "import.meta.env": "{}" }, plugins: [createPineEnginePlugin()], stdin: { loader: "ts", resolveDir: root,
    contents: 'export * from "./frontend/src/workers/pineNative.worker.ts"; export * from "./frontend/src/lib/pineMarketRuntime.ts"; export * from "./frontend/src/lib/pineMarketDataResolver.ts"; export {PineProtocolError} from "./frontend/src/lib/pineProtocol.ts"; export {setStoredAuthSession,clearStoredAuthSession,getStoredAuthSession} from "./frontend/src/lib/authSession.ts";' } })).outputFiles[0].text;
console.info("MARKET_RUNTIME160_BINDING " + JSON.stringify({ minified: true, genuineWorker: true,
  bundleSha256: createHash("sha256").update(bundle).digest("hex"), manifestSha256: createHash("sha256").update(fs.readFileSync(new URL("../../frontend/vendor/pinets/manifest.json", import.meta.url))).digest("hex") }));
let moduleId = 0;
const fresh = () => import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}#${++moduleId}`);
const start = Date.parse("2019-04-01T00:00:00Z") / 1000;
const bar = (time, close) => ({ time, open: close - 1, high: close + 2, low: close - 2, close, volume: 10 });
const chart = Array.from({ length: 10 }, (_, i) => bar(start + i * 60, 20 + i));
const remote = (before = 1300, after = 30) => Array.from({ length: before + after }, (_, i) => bar(start + (i - before) * 60, 10000 + i - before));
const instrument = symbol => ({ symbol, label: symbol, description: symbol, status: "TRADING", asset_class: "crypto",
  base_asset: symbol.slice(0, -4), quote_asset: "USDT", tick_size: .001, min_quantity: .002, quantity_step: .002 });
const session = id => ({ createdAt: new Date().toISOString(), expiresAt: "2099-01-01T00:00:00Z", token: `runtime160-owner-${id}`,
  user: { id, email: `owner${id}@example.test`, name: "Owner", provider: "google", approved: false, betaPosition: null,
    workspaceAccess: true, accessExpiresAt: "2099-01-01T00:00:00Z", deploymentMode: "production", plan: "pro", isBetaUser: false } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const request = (body = 'plot(close,"Primary")', extra = {}) => ({ id: "market-runtime160", action: "run", mode: "historical", inputs: {},
  source: `//@version=6\nindicator("Host160",dynamic_requests=true)\n${body}`, bars: chart,
  context: { symbol: "BINANCE:BTCUSDT", timeframe: "1", mintick: .01, pointvalue: 1, mincontract: .001, quantityStep: .001, currency: "USDT", basecurrency: "BTC" }, ...extra });
const values = (result, name) => result.plots.find(plot => plot.name === name).points.map(point => point.value);
const metadata = entry => entry.url.pathname === "/api/live/binance/instruments";

async function harness(run) {
  const old = { window: globalThis.window, fetch: globalThis.fetch }, storage = new Map(), listeners = new Map(), ledger = [], attempts = [], jobs = [];
  const window = new EventTarget(), add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (type, callback, options) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); add(type, callback, options); };
  window.removeEventListener = (type, callback, options) => { listeners.get(type)?.delete(callback); remove(type, callback, options); };
  window.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  window.location = { origin: "https://edgelab.test" }; globalThis.window = window;
  const api = await fresh(); api.setStoredAuthSession(session(1));
  const census = () => [...listeners.entries()].filter(([, callbacks]) => callbacks.size).map(([type, callbacks]) => [type, callbacks.size]);
  const baseline = census();
  const transport = handler => { globalThis.fetch = async (url, init = {}) => {
    const entry = { url: new URL(String(url), window.location.origin), headers: new Headers(init.headers), signal: init.signal, credentials: init.credentials, redirect: init.redirect };
    ledger.push(entry); return handler(entry);
  }; };
  const provider = (entry, bars = remote()) => {
    if (metadata(entry)) {
      assert.equal(entry.headers.get("Authorization"), "Bearer runtime160-owner-1");
      return Response.json({ instruments: [instrument(entry.url.searchParams.get("search"))] });
    }
    assert.equal(entry.url.origin, "https://data-api.binance.vision"); assert.equal(entry.url.pathname, "/api/v3/klines");
    assert.equal(entry.headers.has("Authorization"), false); assert.equal(entry.credentials, "omit"); assert.equal(entry.redirect, "error");
    assert.equal(entry.url.searchParams.get("interval"), "1m");
    const query = entry.url.searchParams;
    return Response.json(bars.filter(bar => bar.time * 1000 >= Number(query.get("startTime")) && bar.time * 1000 <= Number(query.get("endTime")))
      .slice(0, Number(query.get("limit"))).map(bar => [bar.time * 1000, ...[bar.open, bar.high, bar.low, bar.close, bar.volume].map(String), (bar.time + 60) * 1000 - 1]));
  };
  transport(entry => provider(entry));
  const create = (input = request(), worker, scopeExtra = {}) => {
    const scope = { provider: "binance", chartSymbol: "BTCUSDT", revision: "runtime160", range: { from: input.bars[0].time, to: start + 599 }, asOf: start + 600, owns: () => true, ...scopeExtra };
    const job = api.createPineMarketRuntimeJob(input, scope, { createResolver: api.createPineMarketDataResolver, createJob: input => {
      attempts.push(input); return worker ? worker(input) : { id: input.id, cancel() {}, promise: api.executePineRequest(input) };
    } }); jobs.push(job); return job;
  };
  const demand = (symbol = "BINANCE:ETHUSDT", extra = {}) => new api.PineProtocolError("MARKET_DATA_REQUIRED", JSON.stringify({ symbol, timeframe: "1", ...extra }));
  const fake = outcome => ({ id: "controlled-worker", cancel() {}, promise: Promise.resolve().then(outcome) });
  const aba = clear => {
    if (clear) { const key = "edgelab.auth.session.v1", raw = window.localStorage.getItem(key); window.localStorage.removeItem(key); window.localStorage.setItem(key, raw);
      const event = new Event("storage"); Object.defineProperty(event, "key", { value: null }); window.dispatchEvent(event); }
    else { api.setStoredAuthSession(session(2), { notify: false }); api.setStoredAuthSession(session(1), { notify: false }); }
  };
  try { await run({ api, create, provider, transport, ledger, attempts, demand, fake, aba, census, baseline }); }
  finally { for (const job of jobs) job.cancel(); api.clearStoredAuthSession(); globalThis.fetch = old.fetch; if (old.window === undefined) delete globalThis.window; else globalThis.window = old.window; }
}

test("genuine evaluated Pine ignores unused markets and loads input-selected ETH through authenticated transport without pane dependencies", async () => {
  await harness(async ({ create, ledger, attempts, census, baseline }) => {
    const unused = await create(request('unused="SOLUSDT"\nif false\n    ignored=request.security("SOLUSDT","1",close)\nplot(close,"Primary")')).promise;
    assert.deepEqual(values(unused, "Primary"), chart.map(bar => bar.close)); assert.equal(ledger.length, 0);
    const result = await create(request('market=input.symbol("SOLUSDT","Market")\nmultiplier=input.int(2,"Multiplier")\n[price,tick,minimum]=request.security(market,"1",[close,syminfo.mintick,syminfo.mincontract])\nplot(price*multiplier,"Remote")\nplot(tick,"Tick")\nplot(minimum,"Minimum")', { inputs: { in_0: "ETHUSDT", in_1: 3 } })).promise;
    assert.deepEqual(values(result, "Remote"), chart.map((_, i) => (10000 + i) * 3));
    assert.deepEqual(values(result, "Tick"), chart.map(() => .001)); assert.deepEqual(values(result, "Minimum"), chart.map(() => .002));
    assert.equal(ledger.filter(metadata).length, 1); assert.equal(ledger[0].url.searchParams.get("search"), "ETHUSDT");
    assert.ok(ledger.filter(entry => !metadata(entry)).every(entry => entry.url.searchParams.get("symbol") === "ETHUSDT"));
    assert.equal(attempts.at(-1).marketData.snapshots[0].context.basecurrency, "ETH"); assert.deepEqual(census(), baseline);
  });
});

test("genuine successive calculation depths replace one snapshot and preserve independently expected long SMA values", async () => {
  await harness(async ({ create, attempts, ledger }) => {
    const result = await create(request('a=request.security("ETHUSDT","1",close,calc_bars_count=1000)\nb=request.security("ETHUSDT","1",ta.sma(close,1200),calc_bars_count=1200)\nplot(a,"Remote")\nplot(b,"Average")')).promise;
    assert.deepEqual(values(result, "Remote"), chart.map((_, i) => 10000 + i));
    // calc_bars_count evaluates the final 1200 requested bars, not all fetched
    // warmup. Only their final bar has a complete 1200-period average.
    assert.deepEqual(values(result, "Average"), [...Array(9).fill(null), 9409.5]);
    assert.equal(attempts.length, 3); assert.equal(attempts.at(-1).marketData.snapshots.length, 1);
    assert.equal(attempts.at(-1).marketData.snapshots[0].bars[0].time, start - 1200 * 60);
    assert.equal(ledger.filter(metadata).length, 1); assert.equal(ledger.filter(entry => !metadata(entry)).length, 4);
  });
});

test("genuine 15-minute chart includes all final closed one-minute children up to asOf without future candles", async () => {
  await harness(async ({ create, attempts, ledger }) => {
    const bars = [bar(start, 20), bar(start + 900, 21)], asOf = start + 1800;
    const result = await create(request('children=request.security_lower_tf("ETHUSDT","1",close)\nplot(array.size(children),"Count")\nplot(array.get(children,array.size(children)-1),"Remote")', { bars, context: { ...request().context, timeframe: "15" } }), undefined,
      { range: { from: start, to: asOf - 1 }, asOf }).promise;
    assert.deepEqual(values(result, "Count"), [15, 15]); assert.deepEqual(values(result, "Remote"), [10014, 10029]);
    const snapshot = attempts.at(-1).marketData.snapshots[0]; assert.equal(snapshot.asOf, asOf); assert.equal(snapshot.bars.at(-1).time, asOf - 60);
    assert.ok(ledger.filter(entry => !metadata(entry)).every(entry => Number(entry.url.searchParams.get("endTime")) === (asOf - 1) * 1000));
  });
});

test("only verified nonexistent markets become genuine NA; metadata denial and malformed metadata remain fatal", async () => {
  for (const status of [200, 401, 403]) await harness(async ({ create, transport, ledger }) => {
    transport(() => Response.json(status === 200 ? { instruments: [] } : { detail: "Denied" }, { status }));
    const job = create(request('plot(request.security("ABSENTUSDT","1",close,ignore_invalid_symbol=true),"Remote")'));
    if (status === 200) assert.deepEqual(values(await job.promise, "Remote"), chart.map(() => null));
    else await assert.rejects(job.promise, error => error.status === status);
    assert.equal(ledger.length, 1);
  });
  await harness(async ({ create, transport }) => {
    transport(() => Response.json({ instruments: [instrument("ETHUSDT"), instrument("ETHUSDT")] }));
    await assert.rejects(create(request('plot(request.security("ETHUSDT","1",close,ignore_invalid_symbol=true),"Remote")')).promise, error => error.code === "UNAVAILABLE_DATA");
  });
});

test("genuine ignore-invalid cannot suppress actual provider transport failure or excessive calculation depth", async () => {
  await harness(async ({ create, transport, provider, ledger }) => {
    transport(entry => metadata(entry) ? provider(entry) : Response.json({ error: "Provider unavailable" }, { status: 503 }));
    await assert.rejects(create(request('plot(request.security("ETHUSDT","1",close,ignore_invalid_symbol=true),"Remote")')).promise);
    assert.equal(ledger.length, 2);
  });
  await harness(async ({ create, ledger }) => {
    await assert.rejects(create(request('plot(request.security("ETHUSDT","1",close,calc_bars_count=16001,ignore_invalid_symbol=true),"Remote")')).promise,
      error => error.code === "REQUEST_LIMIT"); assert.equal(ledger.length, 0);
  });
});

test("controlled worker demands use the actual loader but refuse capped history before a second execution", async () => {
  await harness(async ({ create, fake, demand, transport, provider, ledger, attempts }) => {
    const bars = Array.from({ length: 16001 }, (_, i) => bar(start + i * 60, 100 + i)), asOf = start + bars.length * 60;
    transport(entry => provider(entry, bars));
    const job = create(request(), () => fake(() => { throw demand(); }), { range: { from: start, to: asOf - 1 }, asOf });
    await assert.rejects(job.promise, error => error.code === "REQUEST_LIMIT" && /candle limit/.test(error.message));
    assert.equal(attempts.length, 1); assert.equal(ledger.filter(entry => !metadata(entry)).length, 16);
  });
});

test("controlled distinct contexts admit exactly 64 real resolutions and reject a 65th; repeated unmet depth stops immediately", async () => {
  for (const count of [64, 65]) await harness(async ({ create, fake, demand, transport, provider, ledger, attempts }) => {
    transport(entry => provider(entry, [bar(start, 100)]));
    const output = { marker: "controlled orchestration result, not Pine output" };
    const job = create(request(), input => fake(() => {
      const n = input.marketData.snapshots.length;
      if (n < count) throw demand(`BINANCE:CTX${n}USDT`);
      return output;
    }));
    if (count === 64) assert.strictEqual(await job.promise, output); else await assert.rejects(job.promise, error => error.code === "REQUEST_LIMIT");
    assert.equal(ledger.filter(metadata).length, 64); assert.equal(ledger.filter(entry => !metadata(entry)).length, 64); assert.equal(attempts.length, 65);
  });
  await harness(async ({ create, fake, demand, ledger, attempts }) => {
    await assert.rejects(create(request(), () => fake(() => { throw demand(); })).promise, error => error.code === "REQUEST_LIMIT");
    assert.equal(attempts.length, 2); assert.equal(ledger.filter(metadata).length, 1);
  });
});

for (const stage of ["first worker", "upgrade worker", "metadata", "history"]) for (const transition of ["cancel", "auth ABA", "storage clear/restore"])
  test(`controlled scheduling: ${transition} during ${stage} promptly rejects late output and removes owned listeners`, async () => {
    await harness(async ({ create, fake, demand, transport, provider, aba, census, baseline, ledger }) => {
      const entered = deferred(), release = deferred(); let cancellations = 0, heldSignal, workerCount = 0;
      transport(entry => {
        const response = provider(entry);
        if ((stage === "metadata" && metadata(entry)) || (stage === "history" && !metadata(entry))) {
          heldSignal = entry.signal; const method = metadata(entry) ? "text" : "json", read = response[method].bind(response);
          response[method] = async () => { entered.resolve(); await release.promise; return read(); };
        }
        return response;
      });
      const job = create(request(), () => {
        workerCount++;
        if ((stage === "first worker" && workerCount === 1) || (stage === "upgrade worker" && workerCount === 2)) {
          entered.resolve(); return { id: "held", cancel() { cancellations++; }, promise: release.promise.then(() => ({ stale: true })) };
        }
        return fake(() => { throw demand(); });
      });
      await entered.promise;
      let deadline; const promptly = Promise.race([job.promise, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Cancellation did not reject the held job promptly")), 1000); })]);
      const rejected = assert.rejects(promptly, error => error.name === "AbortError");
      if (transition === "cancel") job.cancel(); else aba(transition === "storage clear/restore");
      try { await rejected; } finally { clearTimeout(deadline); release.resolve(); }
      await new Promise(done => setImmediate(done));
      if (heldSignal) assert.equal(heldSignal.aborted, true); else assert.ok(cancellations > 0);
      assert.equal(workerCount, stage === "upgrade worker" ? 2 : 1); assert.deepEqual(census(), baseline);
      if (stage === "first worker") assert.equal(ledger.length, 0);
    });
  });

test("scope is copied before first execution and changed owned revisions never commit even without auth notifications", async () => {
  await harness(async ({ create, fake, census, baseline }) => {
    const entered = deferred(), release = deferred(); let owned = true;
    const range = { from: start, to: start + 599 };
    const job = create(request(), () => { entered.resolve(); return fake(async () => { await release.promise; return { stale: true }; }); }, { range, owns: () => owned });
    await entered.promise; range.to = start + 999999; owned = false; release.resolve();
    await assert.rejects(job.promise, error => error.name === "AbortError"); assert.deepEqual(census(), baseline);
  });
});
