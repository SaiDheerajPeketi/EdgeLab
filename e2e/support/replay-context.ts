import type { Page } from "@playwright/test";
import { installDeterminism, seedApprovedSession, seedChartLayout } from "./app";

export const session = {
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

export const bars = Array.from({ length: 120 }, (_, index) => {
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

export function replayState(status: "ACTIVE" | "COMPLETE" = "ACTIVE") {
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

export async function fulfillReplayContext(page: Page, status: "ACTIVE" | "COMPLETE" = "ACTIVE") {
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

export async function prepare(page: Page) {
  await installDeterminism(page);
  await seedApprovedSession(page);
  await seedChartLayout(page, "single");
}

