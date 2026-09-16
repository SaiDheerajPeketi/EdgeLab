import { expect, test, type Page, type Route } from "@playwright/test";
import {
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
    await expect(transport).toHaveScreenshot("replay-transport.png");
    expect(await transport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });

  test("open order ticket preserves replay controls", async ({ page }) => {
    await fulfillReplayContext(page);
    await gotoStable(page, "/app/replay", { waitForNetworkIdle: false });

    await page.getByRole("button", { name: "Ticket", exact: true }).first().click();
    const ticket = page.getByRole("form", { name: "Order ticket" });
    await expect(ticket).toBeVisible();
    await expect(ticket.getByRole("button", { name: "Long / Buy" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Replay transport" })).toBeVisible();
    expect(await ticket.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expectReplayScreenshot(page, "replay-order-open");
    await expect(ticket).toHaveScreenshot("order-ticket.png");
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
