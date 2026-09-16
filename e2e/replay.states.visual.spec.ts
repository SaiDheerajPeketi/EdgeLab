import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import {
  expectCertifiedScreenshot,
  expectStableScreenshot,
  gotoStable,
  installDeterminism,
  seedApprovedSession,
  seedChartLayout,
} from "./support/app";

const session = {
  id: 4101,
  name: "BTC morning review",
  symbol: "BTCUSDT",
  instrument: "BTC / Tether",
  timeframe: "5m",
  csv_path: null,
  currency: "USD",
  timezone: "UTC",
  pnl_multiplier: 1,
  strategy_name: "Opening range",
  playbook_id: 31,
  start_at: "2026-09-15T08:00:00.000Z",
  end_at: "2026-09-15T10:30:00.000Z",
  start_offset: 0,
  end_offset: 119,
  status: "ACTIVE" as const,
  current_offset: 96,
  replay_ready: true,
  initial_balance: 25_000,
  realized_pnl: 384.75,
  default_commission_mode: "FIXED" as const,
  default_commission_value: 2.5,
  default_fee_mode: "NONE" as const,
  default_fee_value: 0,
  created_at: "2026-09-15T10:30:00.000Z",
  updated_at: "2026-09-15T10:30:00.000Z",
};

const bars = Array.from({ length: 120 }, (_, index) => {
  const open = 67_500 + index * 5 + Math.sin(index / 5) * 80;
  const close = open + Math.cos(index / 4) * 32;
  return {
    time: Date.parse("2026-09-15T00:00:00Z") / 1_000 + index * 300,
    timestamp: new Date(Date.parse("2026-09-15T00:00:00Z") + index * 300_000).toISOString(),
    open,
    high: Math.max(open, close) + 24,
    low: Math.min(open, close) - 21,
    close,
    volume: 80 + index,
    ema_20: null,
    ema_50: null,
    rsi_14: null,
  };
});

const metrics = {
  net_pnl: 384.75,
  win_rate: 57.1,
  total_trades: 14,
  winning_trades: 8,
  breakeven_trades: 0,
  open_trades: 0,
  profit_factor: 1.82,
  gross_pnl: 396.5,
  total_commissions: 5,
  total_fees: 6.75,
  max_drawdown: -182.5,
  recovery_factor: 2.1,
  sharpe_ratio: 1.4,
  average_r: 1.4,
  average_hold_minutes: 37,
  average_win: 95,
  average_loss: -62,
  expectancy: 27.48,
  best_trade: 198.25,
  worst_trade: -91.5,
  longest_win_streak: 3,
  longest_loss_streak: 2,
  equity_curve: [],
  strategy_performance: [],
  side_breakdown: [],
  calendar: [],
};

function replayState(status: "ACTIVE" | "COMPLETE" = "ACTIVE") {
  const currentOffset = status === "COMPLETE" ? session.end_offset : session.current_offset;
  return {
    session: { ...session, current_offset: currentOffset, status },
    current_candle: bars[currentOffset],
    position: null,
    orders: [],
    executions: [],
    trades: [],
    metrics,
  };
}

async function fulfillReplayContext(page: Page, status: "ACTIVE" | "COMPLETE" = "ACTIVE") {
  await page.route("**/api/backtests/latest", (route) => route.fulfill({
    body: JSON.stringify(replayState(status)),
    contentType: "application/json",
    status: 200,
  }));
  await page.route("**/api/market-data/meta**", (route) => route.fulfill({
    body: JSON.stringify({
      csv_path: "/fixtures/markets/BTCUSDT/5m.csv",
      rows: bars.length,
      first_timestamp: bars[0].timestamp,
      last_timestamp: bars.at(-1)!.timestamp,
    }),
    contentType: "application/json",
    status: 200,
  }));
  await page.route("**/api/market-data/bars**", (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? bars.length);
    return route.fulfill({
      body: JSON.stringify({ bars: bars.slice(offset, offset + limit), limit, next_offset: offset + limit, offset }),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function prepare(page: Page) {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await seedChartLayout(page, "single");
}

async function seedChartAuthoringObjects(page: Page) {
  await page.addInitScript(({ candleTime }) => {
    for (const key of ["edgelab.chart-layout.v1.user-7001", "edgelab.live-chart-layout.v1.user-7001"]) {
      const layout = JSON.parse(window.localStorage.getItem(key) ?? "{}");
      window.localStorage.setItem(key, JSON.stringify({
        ...layout,
        drawings: [{
          id: "e2e-horizontal-line",
          tool: "horizontal",
          color: "#32d3ee",
          createdAt: "2026-09-15T08:00:00.000Z",
          lineStyle: "solid",
          lineWidth: 2,
          points: [{ price: 68_000, time: candleTime }],
        }],
        indicatorInstances: [{
          id: "e2e-rsi-14",
          kind: "rsi",
          settings: { color: "#a78bfa", period: 14, lineStyle: "solid", lineWidth: 2 },
          visible: true,
          createdAt: "2026-09-15T08:00:00.000Z",
        }],
      }));
    }
  }, { candleTime: bars[96].time });
}

async function expectNoHorizontalOverflow(locator: Locator) {
  expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}

async function assertFocusTrap(page: Page, dialog: Locator) {
  const focusable = dialog.locator('button:not([disabled]):visible, [href]:visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible');
  await focusable.first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(focusable.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(focusable.first()).toBeFocused();
}

async function expectReplayScreenshot(page: Page, name: string) {
  await expectStableScreenshot(page, name, {
    fullPage: false,
    mask: [page.locator(".chart-plot-column")],
  });
}

test.describe("replay critical state baselines", () => {
  test.beforeEach(async ({ page }) => prepare(page));

  test("loading preserves the workspace context", async ({ page }) => {
    let releaseLatest: (() => void) | undefined;
    await page.route("**/api/backtests/latest", async (route: Route) => {
      await new Promise<void>((resolve) => { releaseLatest = resolve; });
      await route.fulfill({ body: JSON.stringify(replayState()), contentType: "application/json", status: 200 });
    });

    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    await expect(page.getByRole("status", { name: "Loading session" }).first()).toBeVisible();
    await expect(page.locator("#workspace-content")).toBeVisible();
    await expectReplayScreenshot(page, "replay-loading");
    releaseLatest?.();
  });

  test("completion names the terminal state and recovery", async ({ page }) => {
    await fulfillReplayContext(page, "COMPLETE");
    let restartedSession: Record<string, unknown> | null = null;
    let restartRequests = 0;
    let activeSessionReloads = 0;
    let releaseRestart!: () => void;
    const restartGate = new Promise<void>((resolve) => { releaseRestart = resolve; });
    await page.route("**/api/backtests/4101", async (route) => {
      activeSessionReloads += 1;
      await route.fulfill({ body: JSON.stringify(replayState("COMPLETE")), contentType: "application/json", status: 200 });
    });
    await page.route("**/api/backtests", async (route) => {
      restartRequests += 1;
      restartedSession = route.request().postDataJSON() as Record<string, unknown>;
      if (restartRequests === 1) {
        await restartGate;
        await route.fulfill({
          body: JSON.stringify({ detail: "Replay session could not be restarted." }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          ...replayState(),
          session: { ...session, current_offset: 0, status: "ACTIVE" },
          current_candle: bars[0],
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });

    await expect(page.getByText("Replay complete", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replay again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    await expectReplayScreenshot(page, "replay-complete");

    const replayAgain = page.getByRole("button", { name: "Replay again" });
    await replayAgain.click();
    await expect(replayAgain).toBeDisabled();
    await expect.poll(() => restartRequests).toBe(1);
    releaseRestart();
    const reloadActiveSession = page.getByRole("button", { name: "Reload active session", exact: true });
    await expect(reloadActiveSession).toBeVisible();
    await reloadActiveSession.click();
    await expect.poll(() => activeSessionReloads).toBe(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Replay complete", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Replay again" }).click();
    await expect(page.getByText("Replay complete", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect(page.getByText("Bar 0", { exact: true })).toBeVisible();
    expect(restartedSession).toMatchObject({
      name: session.name,
      symbol: session.symbol,
      start_timestamp: session.start_at,
      end_timestamp: session.end_at,
    });
    expect(restartRequests).toBe(2);
    expect(activeSessionReloads).toBe(1);
  });

  test("playing exposes an unambiguous transport state", async ({ page }) => {
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });

    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(page.getByText("Playing", { exact: true }).first()).toBeVisible();
    await expectReplayScreenshot(page, "replay-playing");
  });

  test("transport remains usable without horizontal overflow", async ({ page }) => {
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });

    const transport = page.getByRole("region", { name: "Replay transport" });
    await expect(transport.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect(transport.getByRole("button", { name: "Step", exact: true })).toBeEnabled();
    await expectCertifiedScreenshot(page, transport, "replay-transport.png");
    expect(await transport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });

  test("open order ticket preserves replay controls", async ({ page }) => {
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });

    const trigger = page.getByRole("button", { name: "Ticket", exact: true }).first();
    await trigger.focus();
    await trigger.press("Enter");
    const ticket = page.getByRole("form", { name: "Order ticket" });
    await expect(ticket).toBeVisible();
    await expect(ticket.getByRole("button", { name: "Long / Buy" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Replay transport" })).toBeVisible();
    expect(await ticket.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectReplayScreenshot(page, "replay-order-open");
    await expectCertifiedScreenshot(page, ticket, "order-ticket.png");
  });

  test("selected trade opens an accessible review drawer", async ({ page }) => {
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });

    await page.getByRole("tab", { name: "Journal" }).click();
    const panel = page.getByRole("tabpanel", { name: "Journal" });
    await panel.getByRole("button").filter({ hasText: "BTCUSDT" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: /close/i })).toBeVisible();
    await expectReplayScreenshot(page, "replay-trade-selected");
  });

  test("Objects panel supports keyboard resize", async ({ page }, testInfo) => {
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    const trigger = page.getByRole("button", { name: "Objects", exact: true }).first();
    await trigger.focus();
    await trigger.press("Enter");
    const panel = page.getByRole("complementary", { name: "Chart objects" });
    await expect(panel).toBeVisible();
    const resize = panel.getByRole("separator", { name: "Resize Chart objects" });
    if (["desktop", "tradingDesktop"].includes(testInfo.project.name)) {
      await resize.focus();
      await resize.press("ArrowLeft");
    } else await expect(resize).toBeHidden();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectCertifiedScreenshot(page, panel, "panel-objects.png");
  });

  test("Indicator editor traps focus and closes predictably", async ({ page }) => {
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    const tools = page.getByRole("button", { name: "Tools", exact: true });
    await tools.focus();
    await tools.press("Enter");
    const editorTrigger = page.getByRole("button", { name: "Editor", exact: true });
    await editorTrigger.focus();
    await editorTrigger.press("Enter");
    const panel = page.getByRole("dialog", { name: "EdgeLab indicator editor" });
    await expect(panel).toBeVisible();
    await expect(panel.locator(":focus")).toHaveCount(1);
    await assertFocusTrap(page, panel);
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectCertifiedScreenshot(page, panel, "panel-indicator-editor.png");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(editorTrigger).toBeFocused();
  });

  test("chart settings opens and closes from its keyboard trigger", async ({ page }) => {
    await seedChartAuthoringObjects(page);
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    const settingsTrigger = page.locator(".chart-studio-toolbar").getByRole("button", { name: "Settings", exact: true });
    await settingsTrigger.focus();
    await settingsTrigger.press("Enter");
    const chartSettings = page.getByRole("dialog", { name: "Chart settings" });
    await expect(chartSettings).toBeVisible();
    await expectNoHorizontalOverflow(chartSettings);
    await expectCertifiedScreenshot(page, chartSettings, "overlay-chart-settings.png");
    await page.keyboard.press("Escape");
    await expect(chartSettings).toBeHidden();
    await expect(settingsTrigger).toBeFocused();
  });

  test("symbol search opens and closes from the keyboard", async ({ page }) => {
    await seedChartAuthoringObjects(page);
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    const symbolSearch = page.getByRole("combobox", { name: "Chart symbol" });
    await symbolSearch.focus();
    await symbolSearch.fill("BTC");
    await symbolSearch.press("ArrowDown");
    const symbolResults = page.getByRole("listbox");
    await expect(symbolResults).toBeVisible();
    await expect(symbolSearch).toHaveAttribute("aria-activedescendant", /chart-symbol-option-/);
    await expectNoHorizontalOverflow(symbolResults);
    const symbolBounds = await symbolResults.boundingBox();
    const viewport = page.viewportSize();
    expect(symbolBounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(symbolBounds!.x).toBeGreaterThanOrEqual(0);
    expect(symbolBounds!.y).toBeGreaterThanOrEqual(0);
    expect(symbolBounds!.x + symbolBounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(symbolBounds!.y + symbolBounds!.height).toBeLessThanOrEqual(viewport!.height + 1);
    await expectCertifiedScreenshot(page, symbolResults, "overlay-symbol-search.png");
    await symbolSearch.press("Escape");
    await expect(symbolResults).toBeHidden();
    await expect(symbolSearch).toBeFocused();
  });

  test("indicator settings opens and closes from its keyboard trigger", async ({ page }) => {
    await seedChartAuthoringObjects(page);
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    const rsiTitle = page.locator(".indicator-pane-title").getByText("RSI 14", { exact: true });
    await rsiTitle.scrollIntoViewIfNeeded();
    await rsiTitle.focus();
    await rsiTitle.press("Enter");
    const indicatorSettings = page.getByRole("group", { name: "Indicator settings" });
    await expect(indicatorSettings).toBeVisible();
    await expectNoHorizontalOverflow(indicatorSettings);
    await expectCertifiedScreenshot(page, indicatorSettings, "overlay-indicator-settings.png");
    await page.keyboard.press("Escape");
    await expect(indicatorSettings).toBeHidden();
    await expect(rsiTitle).toBeFocused();
  });

  test("drawing settings opens and closes from keyboard placement", async ({ page }) => {
    await seedChartAuthoringObjects(page);
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    const horizontalLevel = page.getByTitle("Horizontal level");
    await horizontalLevel.focus();
    await horizontalLevel.press("Enter");
    const chart = page.getByRole("region", { name: /chart/i }).first();
    await chart.focus();
    await chart.press("Enter");
    const drawingSettings = page.getByRole("group", { name: "Drawing settings" });
    await expect(drawingSettings).toBeVisible();
    await expectNoHorizontalOverflow(drawingSettings);
    await expectCertifiedScreenshot(page, drawingSettings, "overlay-drawing-settings.png");
    await page.keyboard.press("Escape");
    await expect(drawingSettings).toBeHidden();
    await expect(chart).toBeFocused();
  });

  test("radial drawing toolbox remains keyboard operable and contained", async ({ page }) => {
    await seedChartAuthoringObjects(page);
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    const chart = page.getByRole("region", { name: /chart/i }).first();
    await chart.focus();
    await page.keyboard.down("Alt");
    const radialToolbox = page.getByRole("toolbar", { name: "Circular drawing toolbox" });
    await expect(radialToolbox).toBeVisible();
    expect(await radialToolbox.getByRole("button").count()).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(radialToolbox);
    await expectCertifiedScreenshot(page, radialToolbox, "overlay-radial-drawing-toolbox.png", {
      maxDiffPixelRatio: 0.03,
    });
    await page.keyboard.press("1");
    await expect(radialToolbox).toBeHidden();
    await page.keyboard.up("Alt");
    await expect(chart).toBeFocused();
  });

  test("failed progress save keeps the replay recoverable", async ({ page }) => {
    await fulfillReplayContext(page);
    const jumpOffsets: number[] = [];
    await page.route("**/api/backtests/4101/jump", async (route) => {
      const payload = route.request().postDataJSON() as { offset: number };
      jumpOffsets.push(payload.offset);
      if (jumpOffsets.length === 1) {
        await route.fulfill({
          body: JSON.stringify({ detail: "Replay progress could not be saved. Your session is still open; retry when the connection recovers." }),
          contentType: "application/json",
          status: 503,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({ ...replayState(), session: { ...session, current_offset: payload.offset }, current_candle: bars[payload.offset] }),
        contentType: "application/json",
        status: 200,
      });
    });
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });

    const offset = page.getByPlaceholder("Offset");
    await offset.fill("104");
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Replay progress could not be saved");
    await expect(offset).toHaveValue("104");
    const retry = page.getByRole("button", { name: "Retry replay action", exact: true });
    await expect(retry).toBeVisible();
    await expectReplayScreenshot(page, "replay-save-error");

    await retry.click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Bar 104", { exact: true })).toBeVisible();
    await expect(offset).toHaveValue("104");
    expect(jumpOffsets).toEqual([104, 104]);
  });
});
