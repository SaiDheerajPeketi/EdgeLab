import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { liveViewportSetup } from "./chart-viewport151.support";
import { editor } from "./pine-layering.product-support";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const seal = () => hash(fs.readdirSync("frontend/dist", { recursive: true }).map(String).filter(file => fs.statSync(path.join("frontend/dist", file)).isFile()).sort().map(file => file + ":" + hash(fs.readFileSync(path.join("frontend/dist", file)))).join("\n"));
const beforeSeal = seal();
const source = '//@version=6\nindicator("Requested market160",overlay=false)\nmarket=input.symbol("BINANCE:ETHUSDT","Requested market")\nfactor=input.int(1,"Multiplier",minval=1,maxval=4)\nplot(request.security(market,"1",close,calc_bars_count=3)*factor,"ETH close",color=#00ffff)';

test("editor Run evaluates another market without opening its chart, using real isolated workers and custom inputs", async ({ page }, info) => {
  const errors: string[] = [], requests: any[] = [], workers: any[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    (window as any).__cross160Results = [];
    addEventListener("message", event => {
      const frame = [...document.querySelectorAll<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')].find(item => item.contentWindow === event.source && item.srcdoc.includes(`data-job="${event.data?.nonce}"`));
      if (frame && event.origin === "null" && event.data?.type === "result") (window as any).__cross160Results.push(event.data.payload);
    }, true);
  });
  await page.route("**/assets/pine-native-worker*.js", async route => {
    const response = await route.fetch(), bytes = await response.body();
    workers.push({ url: route.request().url(), bytes: bytes.length, sha256: hash(bytes) });
    await route.fulfill({ response, body: bytes });
  });
  const state = await liveViewportSetup(page);
  const remote = state.history.map((bar, index) => ({ ...bar, open: 199 + index / 5, high: 202 + index / 5, low: 198 + index / 5, close: 200 + index / 5 }));
  await page.route("https://data-api.binance.vision/**", async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/klines") || url.searchParams.get("symbol") !== "ETHUSDT" || !url.searchParams.has("endTime")) return route.fallback();
    requests.push({ url: url.toString(), headers: route.request().headers() });
    const from = Number(url.searchParams.get("startTime")), to = Number(url.searchParams.get("endTime")), limit = Number(url.searchParams.get("limit"));
    await route.fulfill({ json: remote.filter(bar => bar.time * 1000 >= from && bar.time * 1000 <= to).slice(0, limit).map(bar => [bar.time * 1000, String(bar.open), String(bar.high), String(bar.low), String(bar.close), String(bar.volume), bar.time * 1000 + 59999]) });
  });
  const dialog = await editor(page);
  await dialog.getByLabel("New script template", { exact: true }).selectOption("pine-indicator");
  await dialog.getByLabel("EdgeLab indicator source", { exact: true }).fill(source);
  await dialog.getByRole("button", { name: "Check script", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  const factor = dialog.getByLabel("Multiplier", { exact: true }); await factor.fill("2"); await factor.press("Enter");
  expect(requests).toHaveLength(0);
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  const read = () => page.evaluate(source => ((window as any).__cross160Results ?? []).flatMap((response: any) => {
    const result = response.result;
    if (response.status !== "completed" || result?.kind !== "run" || result.source !== source) return [];
    const plot = result.plots.find((item: any) => item.name === "ETH close"), packed = plot.packed;
    const values = packed ? new Float64Array(response.buffers[packed.values]) : null;
    const kinds = packed ? new Uint8Array(response.buffers[packed.kinds]) : null;
    const tail = packed ? kinds![packed.slots - 1] === 4 ? values![packed.slots - 1] : null : plot.points.at(-1).value;
    return [{ tail, bars: result.audit.bars, inputs: result.inputs, source: result.source }];
  }), source);
  await expect.poll(read).toHaveLength(1);
  const result = (await read())[0];
  expect(result.tail).toBeCloseTo(remote.at(-1)!.close * 2, 8); expect(result.bars).toBe(600);
  expect(result.inputs).toMatchObject({ in_0: "BINANCE:ETHUSDT", in_1: 2 });
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.authorization).toBeUndefined(); expect(requests[0].headers.cookie).toBeUndefined();
  expect(new URL(requests[0].url).searchParams.get("endTime")).toBe(String((remote.at(-1)!.time + 60 - 1) * 1000));
  expect(await page.locator(".chart-stage").count()).toBe(1);
  expect(errors).toEqual([]); expect(workers.length).toBeGreaterThanOrEqual(3);
  expect(new Set(workers.map(item => item.sha256)).size).toBe(1); expect(seal()).toBe(beforeSeal);
  const folder = path.resolve(".artifacts/pine-market160", info.project.name); fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, "editor-cross-market.png") });
  // Header values remain private; the receipt retains only transport isolation conclusions.
  fs.writeFileSync(path.join(folder, "receipt.json"), JSON.stringify({ beforeSeal, afterSeal: seal(), result, requests: requests.map(item => ({ url: item.url, noAuthorization: !item.headers.authorization, noCookie: !item.headers.cookie })), workers, errors, separateMarketPane: false }, null, 2));
});
