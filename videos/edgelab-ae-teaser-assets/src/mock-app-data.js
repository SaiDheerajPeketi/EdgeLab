export const now = "2026-07-19T09:30:00Z";

export const playbooks = [
  { id: 1, name: "London Break", description: "Breakout with retest confirmation.", rules: "Wait for displacement, retest, and clean invalidation.", created_at: now },
  { id: 2, name: "NY Reversal", description: "Sweep, reclaim, and continuation through value.", rules: "No entry before reclaim candle closes.", created_at: now },
  { id: 3, name: "Trend Continuation", description: "Pullback continuation with momentum confirmation.", rules: "Trade with higher timeframe bias only.", created_at: now },
];

export const sessions = [
  session(101, "London Break Replay", "EURUSD", "M15", 1240, 1),
  session(102, "NY Reversal Drill", "NQ", "M5", -320, 2),
  session(103, "Trend Continuation Set", "BTCUSDT", "M15", 890, 3),
];

export const candles = Array.from({ length: 180 }, (_, index) => {
  const base = 1.086 + index * 0.000024;
  const wave = Math.sin(index * 0.19) * 0.0012;
  const open = base + wave;
  const close = base + Math.sin(index * 0.23 + 0.8) * 0.001;
  return {
    time: Math.floor(new Date("2026-07-19T07:00:00Z").getTime() / 1000) + index * 60,
    timestamp: new Date(Date.UTC(2026, 6, 19, 7, index)).toISOString(),
    open,
    high: Math.max(open, close) + 0.00055,
    low: Math.min(open, close) - 0.0005,
    close,
    volume: 100 + Math.round(Math.abs(Math.sin(index)) * 80),
    ema_20: base,
    ema_50: base - 0.0006,
    rsi_14: 48 + Math.sin(index * 0.13) * 18,
  };
});

export const trades = [
  trade(201, 101, "LONG", 1.0871, 1.0924, 1240, 2.4, "London Break", 1, "Clean retest, strong close above VWAP.", ["discipline", "retest"]),
  trade(202, 101, "SHORT", 1.0902, 1.0917, -320, -0.8, "NY Reversal", 2, null, ["late-entry"]),
  trade(203, 101, "LONG", 1.0862, 1.0889, 620, 1.1, "Trend Continuation", 3, "Scaled partial at session high.", []),
  trade(204, 102, "SHORT", 18780.25, 18710.75, 890, 1.6, "NY Reversal", 2, "Reclaim failed; short continuation followed.", ["patience"]),
  trade(205, 103, "LONG", 64210, 64980, 1120, 2.1, "Trend Continuation", 3, "Momentum held after pullback.", ["process"]),
];

export const metrics = {
  net_pnl: 3550,
  win_rate: 0.62,
  total_trades: 26,
  winning_trades: 16,
  breakeven_trades: 2,
  open_trades: 1,
  profit_factor: 1.84,
  gross_pnl: 4440,
  total_commissions: 240,
  total_fees: 118,
  max_drawdown: 910,
  recovery_factor: 3.9,
  sharpe_ratio: 1.42,
  average_r: 0.74,
  average_hold_minutes: 42,
  average_win: 420,
  average_loss: -190,
  expectancy: 136.54,
  best_trade: 1240,
  worst_trade: -420,
  longest_win_streak: 5,
  longest_loss_streak: 2,
  equity_curve: Array.from({ length: 16 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 6, index + 1, 9, 30)).toISOString(),
    equity: 100000 + index * 220 + Math.sin(index * 0.8) * 580,
  })),
  strategy_performance: [
    { strategy_name: "London Break", trades: 10, net_pnl: 2140, win_rate: 0.7, average_r: 0.92 },
    { strategy_name: "NY Reversal", trades: 8, net_pnl: 760, win_rate: 0.55, average_r: 0.42 },
    { strategy_name: "Trend Continuation", trades: 8, net_pnl: 650, win_rate: 0.6, average_r: 0.61 },
  ],
  side_breakdown: [
    { side: "LONG", trades: 15, net_pnl: 2240, win_rate: 0.66 },
    { side: "SHORT", trades: 11, net_pnl: 1310, win_rate: 0.58 },
  ],
  calendar: Array.from({ length: 12 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    pnl: Math.round(Math.sin(index * 1.1) * 340 + 220),
    trades: 1 + (index % 4),
  })),
};

export const backtestState = {
  session: sessions[0],
  current_candle: candles.at(-1),
  position: {
    id: 1,
    session_id: 101,
    side: "LONG",
    quantity: 2.4,
    avg_price: 1.08862,
    stop_loss: 1.08595,
    take_profit: 1.09502,
    breakeven_trigger_r: 1,
    breakeven_moved: true,
    strategy_name: "London Break",
    playbook_id: 1,
    unrealized_pnl: 420,
  },
  orders: [
    order(301, "BUY", "LIMIT", 1.08862, null, "PENDING"),
    order(302, "SELL", "STOP", null, 1.08595, "PENDING", true),
    order(303, "SELL", "LIMIT", 1.09502, null, "PENDING", true),
  ],
  executions: [
    { id: 1, session_id: 101, order_id: 301, side: "BUY", timestamp: "2026-07-19T09:35:12Z", offset: 165, price: 1.08862, quantity: 2.4, realized_pnl: 0, position_side_after: "LONG", position_quantity_after: 2.4, created_at: now },
    { id: 2, session_id: 101, order_id: 303, side: "SELL", timestamp: "2026-07-19T09:48:44Z", offset: 172, price: 1.0922, quantity: 0.8, realized_pnl: 420, position_side_after: "LONG", position_quantity_after: 1.6, created_at: now },
  ],
  trades,
  metrics,
};

export const datasets = {
  root: "/datasets",
  instruments: [
    {
      id: "eurusd",
      name: "EURUSD",
      symbol: "EURUSD",
      currency: "USD",
      timezone: "UTC",
      pnl_multiplier: 100000,
      folder_path: "/datasets/EURUSD",
      updated_at: now,
      timeframes: [
        { timeframe: "M1", csv_path: "/datasets/EURUSD/EURUSD_M1.csv", rows: 7200000, first_timestamp: "2021-01-01T00:00:00Z", last_timestamp: now, imported: true, imported_at: now },
        { timeframe: "M15", csv_path: "/datasets/EURUSD/EURUSD_M15.csv", rows: 480000, first_timestamp: "2021-01-01T00:00:00Z", last_timestamp: now, imported: true, imported_at: now },
      ],
    },
  ],
};

export const strategySummaries = playbooks.map((playbook) => ({
  name: playbook.name,
  aggregate: {
    closed_trades: 8,
    winning_trades: 5,
    net_pnl: playbook.id === 1 ? 2140 : playbook.id === 2 ? 760 : 650,
    gross_profit: 2600,
    gross_loss: -460,
    win_rate: playbook.id === 1 ? 0.7 : 0.58,
    average_r: 0.62,
    profit_factor: 1.8,
    r_sum: 5.2,
    r_samples: 8,
  },
  sessions: [{ session: sessions[playbook.id - 1], aggregate: { closed_trades: 8, winning_trades: 5, net_pnl: 760, gross_profit: 1200, gross_loss: -440, win_rate: 0.62, average_r: 0.58, profit_factor: 1.7, r_sum: 4.6, r_samples: 8 } }],
}));

export const economicCalendar = {
  provider: "forex_factory",
  source_url: "https://www.forexfactory.com/calendar",
  updated_at: now,
  cache_expires_at: "2026-07-19T10:30:00Z",
  stale: false,
  events: [
    { title: "Core CPI m/m", currency: "USD", starts_at: "2026-07-19T08:30:00Z", impact: "High", forecast: "0.3%", previous: "0.2%", actual: null },
    { title: "Fed Chair Powell Speaks", currency: "USD", starts_at: "2026-07-19T10:00:00Z", impact: "High", forecast: null, previous: null, actual: null },
    { title: "ECB Rate Statement", currency: "EUR", starts_at: "2026-07-19T14:00:00Z", impact: "Medium", forecast: "4.25%", previous: "4.25%", actual: null },
    { title: "Tokyo Core CPI y/y", currency: "JPY", starts_at: "2026-07-19T18:45:00Z", impact: "Medium", forecast: "2.1%", previous: "2.0%", actual: null },
    { title: "Employment Change", currency: "AUD", starts_at: "2026-07-19T22:30:00Z", impact: "High", forecast: "24.8K", previous: "39.7K", actual: null },
  ],
};

export const journalController = {
  addAccount: noopReturn,
  addPlaybook: noopReturn,
  addSession: noop,
  addTrade: noop,
  deleteAccount: noop,
  deleteSession: noop,
  deleteTrade: noop,
  updatePlaybook: noopReturn,
  deletePlaybook: noop,
  updateAccount: noopReturn,
  updateSession: noopReturn,
  updateSettings: noop,
  updateTrade: noop,
  updateTradeStrategy: noop,
  data: {
    accounts: [
      { id: 1, name: "Main Futures", broker: "EdgeLab Demo", color: "#22d3ee", currency: "USD", initial_balance: 100000, notes: "Primary journal account.", status: "ACTIVE", created_at: now },
    ],
    playbooks,
    sessions: sessions.map((item) => ({ ...item, account_id: 1 })),
    settings: {
      default_commission_mode: "FIXED",
      default_commission_value: 2,
      default_account_ids: [1],
      default_broker: "EdgeLab Demo",
      default_currency: "USD",
      default_entry_type: "TAKEN",
      default_fee_mode: "FIXED",
      default_fee_value: 1,
      default_risk_percent: 0.75,
      require_account_for_taken_trades: false,
    },
    trades: trades.map((item) => ({
      ...item,
      account_ids: [1],
      journal_entry_type: "TAKEN",
      planned_entry_price: null,
      planned_exit_price: null,
      planned_stop_loss: null,
      planned_take_profit: null,
      missed_reason: null,
    })),
  },
};

function session(id, name, symbol, timeframe, pnl, playbookId) {
  return {
    id,
    name,
    symbol,
    instrument: symbol,
    timeframe,
    csv_path: `/datasets/${symbol}/${symbol}_${timeframe}.csv`,
    currency: "USD",
    timezone: "UTC",
    pnl_multiplier: symbol === "EURUSD" ? 100000 : 1,
    strategy_name: playbooks[playbookId - 1]?.name ?? null,
    playbook_id: playbookId,
    start_at: "2026-07-19T07:00:00Z",
    end_at: "2026-07-19T12:30:00Z",
    start_offset: 0,
    end_offset: 420,
    status: "ACTIVE",
    current_offset: 172,
    replay_ready: true,
    initial_balance: 100000,
    realized_pnl: pnl,
    default_commission_mode: "FIXED",
    default_commission_value: 2,
    default_fee_mode: "FIXED",
    default_fee_value: 1,
    created_at: now,
    updated_at: now,
  };
}

function trade(id, session_id, side, entry, exit, pnl, r, strategy, playbook_id, notes, tags) {
  return {
    id,
    session_id,
    status: "CLOSED",
    side,
    entry_time: "2026-07-19T09:30:00Z",
    entry_offset: 120,
    entry_price: entry,
    quantity: 1,
    remaining_quantity: 0,
    stop_loss: side === "LONG" ? entry - Math.abs(entry * 0.002) : entry + Math.abs(entry * 0.002),
    take_profit: exit,
    exit_time: "2026-07-19T10:12:00Z",
    exit_offset: 172,
    exit_price: exit,
    gross_pnl: pnl,
    realized_pnl: pnl,
    r_multiple: r,
    commission_mode: "FIXED",
    commission_value: 2,
    commission_amount: 2,
    fee_mode: "FIXED",
    fee_value: 1,
    fee_amount: 1,
    strategy_name: strategy,
    playbook_id,
    notes,
    mistake_tags: tags,
    emotional_state: "Calm",
    screenshot_url: null,
  };
}

function order(id, side, type, limit_price, stop_price, status, reduce_only = false) {
  return {
    id,
    session_id: 101,
    playbook_id: 1,
    status,
    side,
    order_type: type,
    quantity: 1.2,
    risk_percent: 0.75,
    limit_price,
    stop_price,
    stop_loss: 1.08595,
    take_profit: 1.09502,
    breakeven_trigger_r: 1,
    reduce_only,
    commission_mode: "FIXED",
    commission_value: 2,
    fee_mode: "FIXED",
    fee_value: 1,
    strategy_name: "London Break",
    mistake_tags: [],
    notes: null,
    created_offset: 165,
    filled_offset: null,
    filled_price: null,
    created_at: now,
    updated_at: now,
    filled_at: null,
  };
}

function noop() {}
function noopReturn(value) { return value ?? null; }
