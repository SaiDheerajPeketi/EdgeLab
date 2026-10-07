import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { productSetup } from "./pine-layering.product-support";
import { bars, replayState, session } from "./support/replay-context";
import { gotoStable } from "./support/app";

const artifacts = path.resolve(".artifacts/replay-session61/browser");
const diagnostics = new WeakMap<Page, { errors: string[]; calls: unknown[]; responses: unknown[] }>();

test.afterEach(async ({ page }, info) => {
  const value = diagnostics.get(page);
  if (!value) return;
  fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, `${info.project.name}-${info.testId}-diagnostics.json`),
    JSON.stringify({ status: info.status, ...value }, null, 2));
});
const first = { ...session, name: "Ownership A", strategy_name: "Replay ownership", playbook_id: null };
const second = { ...first, id: 4102, name: "Ownership B", symbol: "ETHUSDT", instrument: "ETH / Tether", current_offset: 72 };
const histories = new Map([
  [first.id, bars],
  [second.id, bars.map(bar => ({ ...bar, time: bar.time + 86400,
    timestamp: new Date(Date.parse(bar.timestamp) + 86400000).toISOString(),
    open: bar.open + 20000, high: bar.high + 20000, low: bar.low + 20000, close: bar.close + 20000 }))],
]);

function stateFor(selected: typeof first) {
  return { ...replayState(), session: { ...selected }, current_candle: histories.get(selected.id)![selected.current_offset] };
}

async function setup(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const calls: { endpoint: string; method: string; id?: number; offset?: number }[] = [];
  const responses: { endpoint: string; status: number; payload: unknown }[] = [];
  diagnostics.set(page, { errors, calls, responses });
  page.on("response", async response => {
    const endpoint = new URL(response.url()).pathname.replace(/^\/api/, "");
    if (!/^\/(?:bootstrap|backtests|market-data|app-data\/operations)/.test(endpoint)) return;
    const payload = await response.json().catch(() => null);
    responses.push({ endpoint, status: response.status(), payload });
  });
  const selected = new Map([[first.id, { ...first }], [second.id, { ...second }]]);
  let latestMode: "normal" | "empty" = "normal";
  let failedId: number | null = null;
  let holdId: number | null = null;
  let release: (() => void) | null = null;
  let gate: Promise<void> | null = null;
  let receipts: Map<string, any>;
  await productSetup(page, { beforeNavigate: async context => {
    receipts = context.receipts;
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.replace(/^\/api/, "");
      const initial = endpoint.match(/^\/backtests\/(4101|4102)$/);
      const jump = endpoint.match(/^\/backtests\/(4101|4102)\/jump$/);
      const handled = initial || jump || ["/backtests/latest", "/bootstrap-shell", "/backtests/summaries",
        "/backtests/strategy-summaries", "/backtests", "/market-data/meta", "/market-data/bars"].includes(endpoint);
      if (!handled) return route.fallback();
      expect(request.headers().authorization).toBe("Bearer ui-regression-token");
      const id = initial ? Number(initial[1]) : jump ? Number(jump[1]) : Number(url.searchParams.get("session_id") ?? first.id);
      calls.push({ endpoint, method: request.method(), id });
      const bound = request.headers()["x-edgelab-operation-id"];
      if (bound) {
        expect(receipts.get(bound)).toMatchObject({
          method: request.method(), path: endpoint, status: "reserved",
        });
      }
      const respond = (json: unknown, status = 200) => {
        if (bound) {
          Object.assign(receipts.get(bound), {
            status: "completed", http_status: status, completed_at: receipts.get(bound).created_at,
          });
        }
        return route.fulfill({ status, json });
      };
      if (endpoint === "/bootstrap-shell") return respond({
        playbooks: [], recent_sessions: [...selected.values()], recent_sessions_next_offset: 2,
        recent_sessions_next_cursor: null, recent_sessions_has_more: false, strategy_summaries: [],
      });
      if (endpoint === "/backtests/summaries") return respond({
        items: [...selected.values()], next_offset: 2, next_cursor: null, has_more: false,
      });
      if (endpoint === "/backtests/strategy-summaries") return respond([]);
      if (endpoint === "/backtests") return respond([...selected.values()]);
      if (endpoint === "/backtests/latest") return latestMode === "empty"
        ? respond({ detail: "No replay session" }, 404)
        : respond(stateFor(selected.get(second.id)!));
      if (initial) {
        if (holdId === id && gate) await gate;
        if (failedId === id) return respond({ detail: "Selected replay is unavailable" }, 503);
        return respond(stateFor(selected.get(id)!));
      }
      if (jump) {
        const offset = request.postDataJSON().offset;
        expect(Number.isInteger(offset)).toBe(true);
        selected.get(id)!.current_offset = offset;
        calls.at(-1)!.offset = offset;
        return respond(stateFor(selected.get(id)!));
      }
      const source = histories.get(id)!;
      if (endpoint === "/market-data/meta") return respond({
        csv_path: `/fixtures/ownership-${id}.csv`, rows: source.length,
        first_timestamp: source[0].timestamp, last_timestamp: source.at(-1)!.timestamp,
      });
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? source.length);
      return respond({ bars: source.slice(offset, offset + limit), offset, limit, next_offset: offset + limit });
    });
  } });
  // A canvas exists before replay bootstrap has finished. Do not abandon its
  // coordinated account read during navigation and leave an uncertain receipt.
  await expectPrimary(page, second.id, second.current_offset);
  await expect.poll(() => responses.filter(response =>
    /^\/app-data\/operations\/[^/]+\/recover$/.test(response.endpoint)
    && response.status === 200
    && (response.payload as any)?.path === "/bootstrap-shell"
    && (response.payload as any)?.status === "completed").length).toBeGreaterThan(0);
  return { errors, calls, selected,
    emptyLatest() { latestMode = "empty"; },
    fail(id: number | null) { failedId = id; },
    hold(id: number) { holdId = id; gate = new Promise<void>(resolve => { release = resolve; }); },
    release() { release?.(); holdId = null; },
  };
}

async function openRow(page: Page, name: string) {
  const recent = page.getByRole("button", { name: /^Recent work / });
  await expect(recent).toBeVisible();
  if (await recent.getAttribute("aria-expanded") === "false") await recent.click();
  await expect(recent).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Strategies, Sessions, Results" })).toBeVisible();
  await page.getByRole("button", { name: "Replay ownership", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Open", exact: true }).click();
}

async function primaryData(page: Page) {
  // Read-only harness introspection locates a genuine public LWC Candlestick API.
  // No store evaluation, application mutation or private chart API is used.
  return page.locator(".chart-stage").first().evaluate(stage => {
    const key = Object.keys(stage).find(key => key.startsWith("__reactFiber$"));
    let fiber = key ? (stage as any)[key] : null;
    for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
      let hook = fiber.memoizedState;
      for (let index = 0; hook && index < 100; index++, hook = hook.next) {
        const candidate = hook.memoizedState?.current;
        if (candidate && typeof candidate.seriesType === "function" && candidate.seriesType() === "Candlestick"
            && typeof candidate.data === "function") {
          return candidate.data().map(({ time, open, high, low, close }: any) => ({ time, open, high, low, close }));
        }
      }
    }
    return null;
  });
}

async function expectPrimary(page: Page, id: number, offset: number) {
  const expected = histories.get(id)!.slice(0, offset + 1).map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
  await expect.poll(() => primaryData(page)).toEqual(expected);
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  const actual = await primaryData(page);
  expect(actual).toEqual(expected);
  return actual;
}

async function capture(page: Page, project: string, name: string, data: unknown, errors: string[]) {
  expect(errors).toEqual([]);
  const folder = path.join(artifacts, project);
  fs.mkdirSync(folder, { recursive: true });
  const chart = page.locator(".chart-stage").first();
  if (await chart.isVisible()) await chart.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(folder, name + ".png"), animations: "disabled" });
  const store = fs.readFileSync("frontend/src/store/backtestStore.ts");
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify({ data, errors,
    storeSha256: createHash("sha256").update(store).digest("hex"), viewport: page.viewportSize(),
    scope: "Genuine product store/chart with controlled authenticated API transport; public LWC data() is read-only harness introspection." }, null, 2));
}

test("ordinary session Open accepts hydration and preserves sought data after reload and reselection", async ({ page }, info) => {
  const fixture = await setup(page);
  await gotoStable(page, "/app");
  fixture.hold(second.id);
  await openRow(page, second.name);
  await expect.poll(() => fixture.calls.filter(call => call.endpoint === `/backtests/${second.id}`).length).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Strategies, Sessions, Results" })).toBeVisible();
  fixture.release();
  await expect(page.locator(".chart-stage canvas").first()).toBeVisible();
  const hydrated = await expectPrimary(page, second.id, second.current_offset);
  const transport = page.getByRole("region", { name: "Replay transport" });
  await transport.getByPlaceholder("Offset", { exact: true }).fill("80");
  await transport.getByRole("button", { name: "Go", exact: true }).click();
  const sought = await expectPrimary(page, second.id, 80);
  expect(fixture.selected.get(second.id)!.current_offset).toBe(80);
  await page.reload();
  expect(new URL(page.url()).pathname).toBe("/app");
  await expect(page.getByRole("heading", { name: "Continue where the market left you." })).toBeVisible();
  await openRow(page, second.name);
  const reloaded = await expectPrimary(page, second.id, 80);
  await capture(page, info.project.name, "selection-seek-reload", {
    hydrated, sought, reloaded, calls: fixture.calls,
    scope: "Reload /app opens Sessions; ordinary reselection proves persisted session B80, not automatic chart resume.",
  }, fixture.errors);
});

test("empty latest and failed explicit selection do not trigger repeated or automatic latest loads", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Bounded actual App effect regression is covered once; positive chart flow runs at all widths.");
  const fixture = await setup(page);
  fixture.emptyLatest();
  const before = fixture.calls.filter(call => call.endpoint === "/backtests/latest").length;
  await page.reload();
  await expect.poll(() => fixture.calls.filter(call => call.endpoint === "/backtests/latest").length).toBe(before + 1);
  await page.waitForTimeout(500);
  expect(fixture.calls.filter(call => call.endpoint === "/backtests/latest").length).toBe(before + 1);
  await gotoStable(page, "/app");
  fixture.fail(second.id);
  await openRow(page, second.name);
  await expect(page.getByText("Selected replay is unavailable", { exact: true })).toBeVisible();
  const afterFailure = fixture.calls.filter(call => call.endpoint === "/backtests/latest").length;
  await page.waitForTimeout(500);
  expect(fixture.calls.filter(call => call.endpoint === "/backtests/latest").length).toBe(afterFailure);
  await expect(page.getByRole("heading", { name: "Strategies, Sessions, Results" })).toBeVisible();
  await capture(page, info.project.name, "empty-and-failed-selection", { calls: fixture.calls }, fixture.errors);
});
