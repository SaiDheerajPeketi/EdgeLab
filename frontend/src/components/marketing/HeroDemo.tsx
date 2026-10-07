import { CandlestickChart, ShieldCheck } from "lucide-react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { MetricsBar } from "../MetricsBar";
import { PlaybookBoard } from "../PlaybookBoard";
import { ResultsPanel } from "../ResultsPanel";
import { TradeLog } from "../TradeLog";
import { loadGsap, prefersReducedMotion, type GsapPlugins } from "../../lib/gsap";
import type { BacktestSession, Metrics, Playbook, Trade } from "../../lib/api";
import { useReducedMotionPreference } from "../../lib/motionPreferences";
import { isRichTextEmpty, normalizeStoredNoteHtml, sanitizeRichTextHtml } from "../../lib/richText";
import { formatMarketSymbol } from "../../lib/symbols";
import { tradeStrategyName } from "../../lib/strategy";

type DemoBar = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: UTCTimestamp;
  volume: number;
};

type DemoMarker = {
  color: string;
  position: "aboveBar" | "belowBar";
  shape: "arrowDown" | "arrowUp" | "circle";
  text: string;
  time: UTCTimestamp;
};

type DemoScenario = {
  bars: DemoBar[];
  featuredTradeId?: number;
  id: string;
  label: string;
  markerNote: string;
  markers: DemoMarker[];
  metrics: Metrics;
  note: string;
  playbooks: Playbook[];
  session: BacktestSession;
  symbol: string;
  timeframe: string;
  trades: Trade[];
};

const PLAYBOOKS: Playbook[] = [
  {
    id: 1,
    name: "London Break",
    description: "Momentum break with structure follow-through.",
    rules: null,
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: 2,
    name: "NY Reversal",
    description: "Fade reclaim after extension and sweep.",
    rules: null,
    created_at: "2026-06-01T00:00:00Z",
  },
  {
    id: 3,
    name: "Trend Continuation",
    description: "Join pullback only when momentum confirms.",
    rules: null,
    created_at: "2026-06-01T00:00:00Z",
  },
];

function buildMetrics({
  averageR,
  equity,
  netPnl,
  profitFactor,
  sharpeRatio,
  totalTrades,
  winRate,
}: {
  averageR: number;
  equity: number[];
  netPnl: number;
  profitFactor: number;
  sharpeRatio: number;
  totalTrades: number;
  winRate: number;
}): Metrics {
  const winningTrades = Math.max(1, Math.round(totalTrades * winRate));
  const breakevenTrades = Math.max(0, Math.round(totalTrades * 0.08));
  const openTrades = 2;

  return {
    net_pnl: netPnl,
    win_rate: winRate,
    total_trades: totalTrades,
    winning_trades: winningTrades,
    breakeven_trades: breakevenTrades,
    open_trades: openTrades,
    profit_factor: profitFactor,
    gross_pnl: netPnl + 214,
    total_commissions: 126,
    total_fees: 88,
    max_drawdown: 412,
    recovery_factor: netPnl / 412,
    sharpe_ratio: sharpeRatio,
    average_r: averageR,
    average_hold_minutes: 73,
    average_win: 168,
    average_loss: -94,
    expectancy: totalTrades > 0 ? netPnl / totalTrades : null,
    best_trade: 532,
    worst_trade: -184,
    longest_win_streak: 4,
    longest_loss_streak: 2,
    equity_curve: equity.map((value, index) => ({
      timestamp: `2026-06-${String(index + 2).padStart(2, "0")}T09:30:00Z`,
      equity: value,
    })),
    strategy_performance: [
      {
        strategy_name: "London Break",
        trades: Math.max(6, Math.round(totalTrades * 0.45)),
        net_pnl: netPnl * 0.56,
        win_rate: Math.min(0.8, winRate + 0.03),
        average_r: 0.72,
      },
      {
        strategy_name: "NY Reversal",
        trades: Math.max(4, Math.round(totalTrades * 0.32)),
        net_pnl: netPnl * 0.28,
        win_rate: Math.max(0.33, winRate - 0.04),
        average_r: 0.48,
      },
      {
        strategy_name: "Trend Continuation",
        trades: Math.max(4, totalTrades - Math.max(10, Math.round(totalTrades * 0.77))),
        net_pnl: netPnl * 0.16,
        win_rate: Math.max(0.31, winRate - 0.08),
        average_r: 0.39,
      },
    ],
    side_breakdown: [
      {
        side: "LONG",
        trades: Math.max(1, Math.round(totalTrades * 0.57)),
        net_pnl: netPnl * 0.62,
        win_rate: Math.min(0.82, winRate + 0.02),
      },
      {
        side: "SHORT",
        trades: Math.max(1, totalTrades - Math.round(totalTrades * 0.57)),
        net_pnl: netPnl * 0.38,
        win_rate: Math.max(0.3, winRate - 0.02),
      },
    ],
    calendar: equity.slice(-6).map((value, index, collection) => {
      const previous =
        index === 0 ? equity[Math.max(0, equity.length - 7)] ?? value : collection[index - 1];
      return {
        date: `2026-06-${String(index + 10).padStart(2, "0")}`,
        pnl: value - previous,
        trades: Math.max(1, Math.round(totalTrades / 6)),
      };
    }),
  };
}

function createTrade({
  emotionalState = "steady",
  entryPrice,
  exitPrice,
  id,
  mistakeTags = [],
  notes,
  playbookId,
  realizedPnl,
  sessionId,
  side,
  strategyName,
}: {
  emotionalState?: string;
  entryPrice: number;
  exitPrice: number;
  id: number;
  mistakeTags?: string[];
  notes?: string | null;
  playbookId: number;
  realizedPnl: number;
  sessionId: number;
  side: "LONG" | "SHORT";
  strategyName: string;
}): Trade {
  const entryTime = `2026-06-${String((id % 20) + 1).padStart(2, "0")}T09:30:00Z`;
  const exitTime = `2026-06-${String((id % 20) + 1).padStart(2, "0")}T09:54:00Z`;

  return {
    id,
    session_id: sessionId,
    status: "CLOSED",
    side,
    entry_time: entryTime,
    entry_offset: id,
    entry_price: entryPrice,
    quantity: 1,
    remaining_quantity: 0,
    stop_loss: side === "LONG" ? entryPrice - Math.abs(entryPrice * 0.002) : entryPrice + Math.abs(entryPrice * 0.002),
    take_profit: exitPrice,
    exit_time: exitTime,
    exit_offset: id + 16,
    exit_price: exitPrice,
    gross_pnl: realizedPnl,
    realized_pnl: realizedPnl,
    r_multiple: Number((realizedPnl / Math.max(Math.abs(realizedPnl), 80)).toFixed(1)),
    commission_mode: "NONE",
    commission_value: 0,
    commission_amount: 0,
    fee_mode: "NONE",
    fee_value: 0,
    fee_amount: 0,
    strategy_name: strategyName,
    playbook_id: playbookId,
    notes: notes ?? null,
    mistake_tags: mistakeTags,
    emotional_state: emotionalState,
    screenshot_url: null,
  };
}

function createSession({
  currentOffset = 128,
  endOffset = 176,
  id,
  instrument,
  name,
  realizedPnl,
  startOffset = 0,
  strategyName,
  symbol,
  timeframe,
}: {
  currentOffset?: number;
  endOffset?: number;
  id: number;
  instrument: string;
  name: string;
  realizedPnl: number;
  startOffset?: number;
  strategyName: string;
  symbol: string;
  timeframe: string;
}): BacktestSession {
  return {
    id,
    name,
    symbol,
    instrument,
    timeframe,
    csv_path: null,
    currency: "USD",
    timezone: "America/New_York",
    pnl_multiplier: 1,
    strategy_name: strategyName,
    playbook_id: null,
    start_at: "2026-06-10T09:30:00Z",
    end_at: "2026-06-18T16:00:00Z",
    start_offset: startOffset,
    end_offset: endOffset,
    status: "ACTIVE",
    current_offset: currentOffset,
    replay_ready: true,
    initial_balance: 25000,
    realized_pnl: realizedPnl,
    default_commission_mode: "NONE",
    default_commission_value: 0,
    default_fee_mode: "NONE",
    default_fee_value: 0,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-24T00:00:00Z",
  };
}

function createSeededRandom(seed: number) {
  let value = seed | 0;

  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function buildClosePath({
  anchors,
  noiseRatio,
  seed,
  stepsPerSegment,
}: {
  anchors: number[];
  noiseRatio: number;
  seed: number;
  stepsPerSegment: number;
}) {
  if (anchors.length <= 1) {
    return anchors;
  }

  const random = createSeededRandom(seed);
  const closes: number[] = [anchors[0]];

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];

    for (let step = 1; step <= stepsPerSegment; step += 1) {
      const progress = step / stepsPerSegment;
      const delta = end - start;

      if (step === stepsPerSegment) {
        closes.push(end);
        continue;
      }

      const base = start + delta * progress;
      const localRange = Math.max(Math.abs(delta), Math.abs(start) * noiseRatio);
      const wave = Math.sin(progress * Math.PI * 2 + index * 0.63) * localRange * 0.24;
      const noise = (random() - 0.5) * localRange * 0.94;

      closes.push(Number((base + wave + noise).toFixed(4)));
    }
  }

  return closes;
}

function createBars({
  baseVolume,
  closes,
  day,
  seed,
  stepMinutes = 5,
}: {
  baseVolume: number;
  closes: number[];
  day: number;
  seed: number;
  stepMinutes?: number;
}): DemoBar[] {
  const startTime = Date.UTC(2026, 5, day, 9, 30) / 1000;
  const random = createSeededRandom(seed);

  return closes.map((close, index) => {
    const previousClose = index === 0 ? close * 0.999 : closes[index - 1];
    const gap = (random() - 0.5) * Math.abs(close) * 0.00038;
    const open = previousClose + gap;
    const body = Math.abs(close - open);
    const rangeBase = Math.max(body, Math.abs(close) * (0.00028 + random() * 0.00052));
    const high = Math.max(open, close) + rangeBase * (0.35 + random() * 1.7);
    const low = Math.min(open, close) - rangeBase * (0.35 + random() * 1.55);
    const volumePulse = 0.62 + random() * 0.86;
    const bodyLift = body * (Math.abs(close) >= 100 ? 2200 : 1_500_000);

    return {
      time: (startTime + index * stepMinutes * 60) as UTCTimestamp,
      open,
      high,
      low,
      close,
      volume: Math.round(baseVolume * volumePulse + index * 980 + bodyLift),
    };
  });
}

function buildMarkers(
  bars: DemoBar[],
  markers: Array<{
    color: string;
    index: number;
    position: "aboveBar" | "belowBar";
    shape: "arrowDown" | "arrowUp" | "circle";
    text: string;
  }>,
): DemoMarker[] {
  return markers
    .map((marker) => {
      const bar = bars[Math.max(0, Math.min(bars.length - 1, marker.index))];
      return bar
        ? {
            color: marker.color,
            position: marker.position,
            shape: marker.shape,
            text: marker.text,
            time: bar.time,
          }
        : null;
    })
    .filter((value): value is DemoMarker => value != null);
}

function formatPrice(value: number) {
  if (Math.abs(value) >= 1000) {
    return value.toFixed(2);
  }
  if (Math.abs(value) >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

function pricePrecision(value: number) {
  if (Math.abs(value) >= 1000) {
    return 2;
  }
  if (Math.abs(value) >= 10) {
    return 2;
  }
  return 4;
}

function minMoveForPrecision(precision: number) {
  if (precision <= 0) {
    return 1;
  }
  return Number(`0.${"0".repeat(Math.max(0, precision - 1))}1`);
}

function formatCompactVolume(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

function formatPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatBarTime(value: UTCTimestamp) {
  return new Date(Number(value) * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const replayBars = createBars({
  day: 12,
  baseVolume: 182000,
  seed: 7,
  closes: buildClosePath({
    anchors: [
      4278.8, 4276.2, 4279.6, 4275.9, 4281.4, 4278.7, 4284.6, 4281.2, 4288.9,
      4284.1, 4292.7, 4289.8, 4298.4, 4293.7, 4302.2, 4298.8, 4305.6,
    ],
    noiseRatio: 0.0016,
    seed: 17,
    stepsPerSegment: 8,
  }),
});

const reviewBars = createBars({
  day: 14,
  baseVolume: 124000,
  seed: 11,
  stepMinutes: 15,
  closes: buildClosePath({
    anchors: [
      192.1, 191.7, 191.3, 190.5, 190.9, 189.8, 190.1, 189.2, 189.5,
      188.9, 189.1, 188.4, 188.8, 188.2, 188.5, 188.1,
    ],
    noiseRatio: 0.0022,
    seed: 29,
    stepsPerSegment: 7,
  }),
});

const resultsBars = createBars({
  day: 16,
  baseVolume: 212000,
  seed: 19,
  closes: buildClosePath({
    anchors: [
      1.0838, 1.0842, 1.0840, 1.0847, 1.0845, 1.0851, 1.0848, 1.0856,
      1.0852, 1.0860, 1.0858, 1.0865, 1.0862, 1.0869, 1.0867, 1.0874,
      1.0870, 1.0879, 1.0876, 1.0887,
    ],
    noiseRatio: 0.0015,
    seed: 43,
    stepsPerSegment: 8,
  }),
});

const SCENARIOS: DemoScenario[] = [
  {
    id: "replay",
    label: "Replay",
    note: "Follow the live candle path first, then move into review without losing context.",
    markerNote: "Entry and exit markers stay on chart while replay unfolds.",
    symbol: "NQ 100",
    timeframe: "5m replay",
    bars: replayBars,
    markers: buildMarkers(replayBars, [
      { index: 24, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Entry" },
      { index: 63, position: "aboveBar", shape: "arrowDown", color: "#f59e0b", text: "Partial" },
      { index: 104, position: "aboveBar", shape: "circle", color: "#38bdf8", text: "Review" },
    ]),
    metrics: buildMetrics({
      averageR: 0.68,
      equity: [0, 112, 260, 208, 442, 615, 588, 756, 921, 1108, 1264, 1426],
      netPnl: 1426,
      profitFactor: 1.84,
      sharpeRatio: 1.42,
      totalTrades: 31,
      winRate: 0.581,
    }),
    session: createSession({
      id: 7,
      instrument: "Nasdaq Futures",
      name: "London Momentum Replay",
      realizedPnl: 1426,
      strategyName: "London Break",
      symbol: "NQ",
      timeframe: "5m",
    }),
    trades: [
      createTrade({
        id: 101,
        sessionId: 7,
        side: "LONG",
        entryPrice: 4284.1,
        exitPrice: 4296.4,
        realizedPnl: 460,
        playbookId: 1,
        strategyName: "London Break",
        notes: "Held structure clean. Exit followed plan.",
      }),
      createTrade({
        id: 102,
        sessionId: 7,
        side: "SHORT",
        entryPrice: 4302.1,
        exitPrice: 4293.6,
        realizedPnl: 168,
        playbookId: 2,
        strategyName: "NY Reversal",
        mistakeTags: ["late partial"],
      }),
      createTrade({
        id: 103,
        sessionId: 7,
        side: "LONG",
        entryPrice: 4275.4,
        exitPrice: 4272.8,
        realizedPnl: -52,
        playbookId: 3,
        strategyName: "Trend Continuation",
        notes: "Chased too close to highs.",
        mistakeTags: ["late entry"],
        emotionalState: "impatient",
      }),
    ],
    playbooks: PLAYBOOKS,
  },
  {
    id: "review",
    label: "Journal + review",
    note: "Journal pass stays anchored to the exact pullbacks and re-entries that mattered.",
    markerNote: "Review markers flag hesitation and clean follow-through.",
    symbol: "AAPL",
    timeframe: "15m review",
    bars: reviewBars,
    markers: buildMarkers(reviewBars, [
      { index: 18, position: "aboveBar", shape: "arrowDown", color: "#fb7185", text: "Short" },
      { index: 46, position: "belowBar", shape: "circle", color: "#f59e0b", text: "Tag" },
      { index: 89, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Re-entry" },
    ]),
    featuredTradeId: 202,
    metrics: buildMetrics({
      averageR: 0.41,
      equity: [0, 85, 142, 318, 276, 344, 478, 632, 590, 728, 814, 986],
      netPnl: 986,
      profitFactor: 1.31,
      sharpeRatio: 0.96,
      totalTrades: 24,
      winRate: 0.544,
    }),
    session: createSession({
      id: 8,
      instrument: "Apple",
      name: "Review Pass: Failed Countertrend",
      realizedPnl: 986,
      strategyName: "NY Reversal",
      symbol: "AAPL",
      timeframe: "15m",
    }),
    trades: [
      createTrade({
        id: 201,
        sessionId: 8,
        side: "SHORT",
        entryPrice: 190.9,
        exitPrice: 189.8,
        realizedPnl: 330,
        playbookId: 2,
        strategyName: "NY Reversal",
        mistakeTags: ["slow partial"],
      }),
      createTrade({
        id: 202,
        sessionId: 8,
        side: "LONG",
        entryPrice: 190.5,
        exitPrice: 190.1,
        realizedPnl: -94,
        playbookId: 3,
        strategyName: "Trend Continuation",
        notes: "Forced long against flow.",
        mistakeTags: ["countertrend"],
        emotionalState: "frustrated",
      }),
      createTrade({
        id: 203,
        sessionId: 8,
        side: "SHORT",
        entryPrice: 190.2,
        exitPrice: 189.5,
        realizedPnl: 98,
        playbookId: 2,
        strategyName: "NY Reversal",
        notes: "Better patience this pass.",
      }),
    ],
    playbooks: PLAYBOOKS,
  },
  {
    id: "results",
    label: "Results",
    note: "Metrics make more sense when the candle path still feels live and believable.",
    markerNote: "Mixed outcomes remain tied to exact swing structure.",
    symbol: "EURUSD",
    timeframe: "5m results",
    bars: resultsBars,
    markers: buildMarkers(resultsBars, [
      { index: 22, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Start" },
      { index: 71, position: "aboveBar", shape: "circle", color: "#38bdf8", text: "Scale" },
      { index: 118, position: "aboveBar", shape: "arrowDown", color: "#f59e0b", text: "Close" },
    ]),
    metrics: buildMetrics({
      averageR: 0.29,
      equity: [0, 228, 154, 322, 414, 368, 489, 471],
      netPnl: 471,
      profitFactor: 1.22,
      sharpeRatio: 0.74,
      totalTrades: 7,
      winRate: 0.571,
    }),
    session: createSession({
      currentOffset: 214,
      endOffset: 240,
      id: 9,
      instrument: "Euro FX",
      name: "Results Snapshot: London to NY",
      realizedPnl: 471,
      strategyName: "Trend Continuation",
      symbol: "EURUSD",
      timeframe: "5m",
    }),
    trades: [
      createTrade({
        id: 301,
        sessionId: 9,
        side: "LONG",
        entryPrice: 1.0846,
        exitPrice: 1.0868,
        realizedPnl: 228,
        playbookId: 1,
        strategyName: "London Break",
        notes: "Stayed with opening range expansion.",
      }),
      createTrade({
        id: 302,
        sessionId: 9,
        side: "SHORT",
        entryPrice: 1.0886,
        exitPrice: 1.0893,
        realizedPnl: -74,
        playbookId: 2,
        strategyName: "NY Reversal",
        notes: "Covered too quickly after the flush stalled.",
        mistakeTags: ["rushed cover"],
      }),
      createTrade({
        id: 303,
        sessionId: 9,
        side: "LONG",
        entryPrice: 1.0834,
        exitPrice: 1.0852,
        realizedPnl: 168,
        playbookId: 3,
        strategyName: "Trend Continuation",
        notes: "Clean pullback continuation.",
      }),
      createTrade({
        id: 304,
        sessionId: 9,
        side: "SHORT",
        entryPrice: 1.0879,
        exitPrice: 1.0867,
        realizedPnl: 92,
        playbookId: 2,
        strategyName: "NY Reversal",
        notes: "Fade worked once momentum failed to reclaim.",
      }),
      createTrade({
        id: 305,
        sessionId: 9,
        side: "LONG",
        entryPrice: 1.0854,
        exitPrice: 1.0849,
        realizedPnl: -46,
        playbookId: 1,
        strategyName: "London Break",
        notes: "Tried to force continuation into lunchtime drift.",
        mistakeTags: ["midday chase"],
      }),
      createTrade({
        id: 306,
        sessionId: 9,
        side: "LONG",
        entryPrice: 1.0861,
        exitPrice: 1.0876,
        realizedPnl: 121,
        playbookId: 3,
        strategyName: "Trend Continuation",
        notes: "Held the cleanest follow-through of the day.",
      }),
      createTrade({
        id: 307,
        sessionId: 9,
        side: "SHORT",
        entryPrice: 1.0884,
        exitPrice: 1.0887,
        realizedPnl: -18,
        playbookId: 2,
        strategyName: "NY Reversal",
        notes: "Stopped out quickly after the reclaim stuck.",
      }),
    ],
    playbooks: PLAYBOOKS,
  },
];

function MarketingCandleSurface({
  currentBarIndex,
  scenario,
}: {
  currentBarIndex: number;
  scenario: DemoScenario;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [hoveredBar, setHoveredBar] = useState<DemoBar | null>(null);
  const visibleWindow = 128;
  const clampedIndex = Math.max(0, Math.min(currentBarIndex, scenario.bars.length - 1));

  const visibleBars = useMemo(
    () => {
      const windowStart = Math.max(0, clampedIndex - visibleWindow + 1);
      return scenario.bars.slice(windowStart, clampedIndex + 1);
    },
    [clampedIndex, scenario.bars],
  );
  const visibleBarsByTime = useMemo(
    () => new Map(visibleBars.map((bar) => [bar.time, bar])),
    [visibleBars],
  );
  const lastBar = scenario.bars[clampedIndex] ?? visibleBars[visibleBars.length - 1] ?? null;
  const displayBar = hoveredBar ?? lastBar;
  const firstBar = visibleBars[0] ?? null;
  const changePercent =
    firstBar != null && displayBar != null
      ? ((displayBar.close - firstBar.open) / Math.max(Math.abs(firstBar.open), Number.EPSILON)) * 100
      : 0;
  const replayProgress = Math.max(
    12,
    ((clampedIndex + 1) / Math.max(scenario.bars.length, 1)) * 100,
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const precision = pricePrecision(scenario.bars[0]?.close ?? 1);
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#0b1017", type: ColorType.Solid },
        fontFamily:
          "Instrument Sans Variable, Instrument Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.06)" },
        horzLines: { color: "rgba(148, 163, 184, 0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
      },
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.16)",
        barSpacing: 6,
        rightOffset: 4,
        secondsVisible: false,
        timeVisible: true,
      },
      localization: {
        priceFormatter: (value: number) => formatPrice(value),
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#26A69A",
      downColor: "#EF5350",
      borderVisible: false,
      wickUpColor: "#26A69A",
      wickDownColor: "#EF5350",
      priceFormat: {
        type: "price",
        precision,
        minMove: minMoveForPrecision(precision),
      },
    });

    const volumeSeries = chart.addHistogramSeries({
      color: "rgba(148, 163, 184, 0.24)",
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: "",
      priceFormat: {
        type: "volume",
      },
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [scenario.id, scenario.bars]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    const chart = chartRef.current;
    const handleCrosshairMove = (param: { point?: { x: number; y: number }; time?: unknown }) => {
      if (!param.point || param.time == null || typeof param.time !== "number") {
        setHoveredBar(null);
        return;
      }

      setHoveredBar(visibleBarsByTime.get(param.time as UTCTimestamp) ?? null);
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
    };
  }, [visibleBarsByTime]);

  useEffect(() => {
    setHoveredBar(null);
  }, [scenario.id, clampedIndex]);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) {
      return;
    }

    const candleData: CandlestickData<UTCTimestamp>[] = visibleBars.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    const volumeData: HistogramData<UTCTimestamp>[] = visibleBars.map((bar) => ({
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(38, 166, 154, 0.34)" : "rgba(239, 83, 80, 0.34)",
    }));

    candleSeriesRef.current.setData(candleData);
    candleSeriesRef.current.setMarkers(
      scenario.markers.filter((marker) =>
        visibleBars.some((bar) => bar.time === marker.time),
      ),
    );
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current.timeScale().fitContent();
  }, [scenario, visibleBars]);

  return (
    <section className="w-full min-w-0" aria-label={`${scenario.symbol} ${scenario.timeframe} chart`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-lg font-semibold tracking-[-0.025em] text-white">{scenario.symbol}</h3>
          <span className="text-xs text-slate-400">{scenario.timeframe}</span>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-100">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
          {formatBarTime(displayBar?.time ?? scenario.bars[0]?.time ?? 0)}
        </div>
      </div>

      <div className="chart-ohlcv-row mt-3">
        <span className="chart-ohlcv-time">OHLCV</span>
        <span className="chart-ohlcv-item">
          <span>O</span>
          <strong>{formatPrice(displayBar?.open ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>H</span>
          <strong>{formatPrice(displayBar?.high ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>L</span>
          <strong>{formatPrice(displayBar?.low ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>C</span>
          <strong>{formatPrice(displayBar?.close ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>Vol</span>
          <strong>{formatCompactVolume(displayBar?.volume ?? 0)}</strong>
        </span>
        <span className={`chart-ohlcv-change ${changePercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
          {formatPercent(changePercent)}
        </span>
      </div>

      <div className="mt-3 h-px overflow-hidden bg-white/10" aria-hidden="true">
        <div
          className="h-full origin-left bg-cyan-200"
          style={{ transform: `scaleX(${replayProgress / 100})` }}
        />
      </div>

      <div className="mt-3 overflow-hidden bg-[#0b1017]">
        <div ref={containerRef} className="h-[264px] w-full sm:h-[336px] lg:h-[376px]" />
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 text-xs leading-5 text-slate-400">
        <p>{scenario.markerNote}</p>
        <p className="font-data tabular-nums" data-visible-candles={visibleBars.length}>
          {visibleBars.length} bars shown · {scenario.bars.length} in session
        </p>
      </div>
    </section>
  );
}

function MarketingReplaySurface({ scenario }: { scenario: DemoScenario }) {
  return <PlaybookBoard playbooks={scenario.playbooks} trades={scenario.trades} />;
}

function MarketingReviewSurface({
  scenario,
  selectedTrade,
  onInspectTrade,
}: {
  scenario: DemoScenario;
  selectedTrade: Trade | null;
  onInspectTrade: (trade: Trade) => void;
}) {
  const playbookById = useMemo(
    () => new Map(scenario.playbooks.map((playbook) => [playbook.id, playbook])),
    [scenario.playbooks],
  );

  return (
    <div className="grid gap-4 2xl:grid-cols-[320px_minmax(0,1fr)]">
      <section className="terminal-panel p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Review Notes
            </div>
            <h3 className="mt-2 text-base font-semibold text-white">
              {selectedTrade ? `Trade #${selectedTrade.id}` : "Select a trade"}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Notes, tags, and context pulled from the same review language used in the app.
            </p>
          </div>
          <span className="status-pill">
            {selectedTrade?.side ?? "Review"}
          </span>
        </div>

        {selectedTrade ? (
          <div className="mt-4 grid gap-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <ReviewMetric
                label="Instrument"
                value={formatMarketSymbol(scenario.session.symbol)}
              />
              <ReviewMetric
                label="Strategy"
                value={tradeStrategyName(selectedTrade, scenario.session)}
              />
              <ReviewMetric
                label="Playbook"
                value={playbookById.get(selectedTrade.playbook_id ?? -1)?.name ?? "Unassigned"}
              />
              <ReviewMetric
                label="Net P&L"
                tone={selectedTrade.realized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}
                value={new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: scenario.session.currency ?? "USD",
                  maximumFractionDigits: 2,
                }).format(selectedTrade.realized_pnl)}
              />
            </div>

            <div className="rounded-md bg-ink-950 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Backtest Notes
              </div>
              {isRichTextEmpty(selectedTrade.notes) ? (
                <p className="mt-3 text-sm text-slate-500">No notes yet</p>
              ) : (
                <div
                  className="notebook-rich-note mt-3 text-sm text-slate-300"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeRichTextHtml(normalizeStoredNoteHtml(selectedTrade.notes)),
                  }}
                />
              )}
            </div>

            <div className="rounded-md bg-ink-950 p-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                Mistake Tags
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedTrade.mistake_tags.length > 0 ? (
                  selectedTrade.mistake_tags.map((tag) => (
                    <span
                      className="inline-flex items-center rounded bg-rose-300/10 px-2 py-1 text-xs font-semibold text-rose-100"
                      key={tag}
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="rounded bg-white/5 px-2 py-1 text-xs text-slate-500">
                    No mistake tags
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <TradeLog
        currency={scenario.session.currency ?? "USD"}
        onInspect={onInspectTrade}
        tradeContext={(trade) => ({
          currency: scenario.session.currency ?? "USD",
          instrument: formatMarketSymbol(scenario.session.symbol),
          instrumentDetail: `${scenario.session.timeframe ?? "M1"} · ${scenario.session.name.replace("Review Pass: ", "")}`,
          strategy: tradeStrategyName(trade, scenario.session),
        })}
        trades={scenario.trades}
      />
    </div>
  );
}

function MarketingResultsSurface({ scenario }: { scenario: DemoScenario }) {
  const calendarDays = (scenario.metrics.calendar ?? []).slice(-6);

  return (
    <div className="grid gap-4">
      <section className="terminal-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Day-by-day proof
            </div>
            <h3 className="mt-2 text-base font-semibold text-white">
              Results that still trace back to the session
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              The landing widget now reuses the same in-app results workspace, then carries that into day-level analysis.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="status-pill">
              {formatMarketSymbol(scenario.session.symbol)} · {scenario.session.timeframe}
            </span>
            <span className="status-pill">
              {scenario.metrics.total_trades} closed
            </span>
          </div>
        </div>
      </section>

      <ResultsPanel
        activeSessionId={scenario.session.id}
        currency={scenario.session.currency ?? "USD"}
        hideCsvAction
        metrics={scenario.metrics}
        sessions={[scenario.session]}
        showEquityCurve={false}
        trades={scenario.trades}
      />

      <section className="terminal-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Day-by-day analysis
            </div>
            <h3 className="mt-2 text-base font-semibold text-white">
              Recent sessions in sequence
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Daily closes stay visible here so the landing preview still reads like a real review workflow.
            </p>
          </div>
          <span className="status-pill">
            {calendarDays.length} days tracked
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {calendarDays.map((day) => (
            <article
              className={`rounded-md border px-3 py-3 ${
                day.pnl >= 0
                  ? "border-emerald-300/15 bg-emerald-300/10 text-emerald-100"
                  : "border-rose-300/15 bg-rose-300/10 text-rose-100"
              }`}
              key={day.date}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
                {day.date}
              </div>
              <div className="mt-2 text-lg font-semibold">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: scenario.session.currency ?? "USD",
                  maximumFractionDigits: 2,
                }).format(day.pnl)}
              </div>
              <div className="mt-1 text-xs text-white/65">
                {day.trades} closed trades
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewMetric({
  label,
  tone = "text-slate-100",
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="rounded-md bg-ink-950 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export function HeroDemo() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(SCENARIOS[0]?.id ?? "replay");
  const [visibleScenarioId, setVisibleScenarioId] = useState(SCENARIOS[0]?.id ?? "replay");
  const [autoplayActive, setAutoplayActive] = useState(true);
  const reducedMotion = useReducedMotionPreference();
  const [selectedReviewTradeId, setSelectedReviewTradeId] = useState<number | null>(
    SCENARIOS.find((item) => item.id === "review")?.featuredTradeId ??
      SCENARIOS.find((item) => item.id === "review")?.trades[0]?.id ??
      null,
  );
  const initialCursor = Math.max(0, Math.min(112, (SCENARIOS[0]?.bars.length ?? 1) - 1));
  const [currentBarIndex, setCurrentBarIndex] = useState(initialCursor);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scenarioRailRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stageTransitionRef = useRef<{ kill(): void } | null>(null);
  const flipPluginRef = useRef<GsapPlugins["Flip"] | null>(null);
  const pendingFlipStateRef = useRef<unknown>(null);
  const selectedScenarioIdRef = useRef(selectedScenarioId);

  const scenario = useMemo(
    () => SCENARIOS.find((item) => item.id === visibleScenarioId) ?? SCENARIOS[0],
    [visibleScenarioId],
  );
  const selectedReviewTrade = useMemo(() => {
    if (scenario.id !== "review") {
      return null;
    }
    return (
      scenario.trades.find((trade) => trade.id === selectedReviewTradeId) ??
      scenario.trades.find((trade) => trade.id === scenario.featuredTradeId) ??
      scenario.trades[0] ??
      null
    );
  }, [scenario, selectedReviewTradeId]);

  useEffect(() => {
    selectedScenarioIdRef.current = selectedScenarioId;
  }, [selectedScenarioId]);

  useEffect(() => {
    if (scenario.id !== "review") {
      return;
    }
    setSelectedReviewTradeId(scenario.featuredTradeId ?? scenario.trades[0]?.id ?? null);
  }, [scenario]);

  useEffect(() => {
    return () => {
      stageTransitionRef.current?.kill();
    };
  }, []);

  useEffect(() => {
    if (!scenario || !autoplayActive) {
      return;
    }

    const nextInitialCursor = Math.max(0, Math.min(112, scenario.bars.length - 1));

    setCurrentBarIndex(nextInitialCursor);

    if (reducedMotion) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentBarIndex((current) => {
        if (current >= scenario.bars.length - 1) {
          return nextInitialCursor;
        }
        return current + 1;
      });
    }, 280);

    return () => window.clearInterval(timer);
  }, [autoplayActive, reducedMotion, scenario]);

  useEffect(() => {
    const root = rootRef.current;
    const scenarioRail = scenarioRailRef.current;
    if (!root || !scenarioRail) {
      return;
    }

    let cancelled = false;
    let intersectionObserver: IntersectionObserver | null = null;
    let observer: { kill(): void } | null = null;

    const stepScenario = (direction: 1 | -1) => {
      const currentIndex = SCENARIOS.findIndex(
        (item) => item.id === selectedScenarioIdRef.current,
      );
      const safeIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        (safeIndex + direction + SCENARIOS.length) % Math.max(SCENARIOS.length, 1);
      selectScenario(SCENARIOS[nextIndex]?.id ?? SCENARIOS[0]?.id ?? "replay");
    };

    if ("IntersectionObserver" in window) {
      intersectionObserver = new IntersectionObserver(
        ([entry]) => setAutoplayActive(entry?.isIntersecting ?? true),
        { rootMargin: "160px 0px" },
      );
      intersectionObserver.observe(root);
    }

    if (!reducedMotion) {
      void loadGsap({ plugins: ["CustomEase", "Flip", "Observer"] })
        .then(({ plugins }) => {
          if (cancelled) {
            return;
          }

          flipPluginRef.current = plugins.Flip ?? null;
          observer = plugins.Observer?.create({
            onDown: () => stepScenario(-1),
            onLeft: () => stepScenario(1),
            onRight: () => stepScenario(-1),
            onUp: () => stepScenario(1),
            target: scenarioRail,
            tolerance: 18,
            type: "touch,pointer",
          }) ?? null;
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
      intersectionObserver?.disconnect();
      observer?.kill();
    };
  }, [reducedMotion]);

  const transitionedScenarioIdRef = useRef(selectedScenarioId);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const nextScenarioId = selectedScenarioId;
    stageTransitionRef.current?.kill();
    stageTransitionRef.current = null;
    stage.style.removeProperty("opacity");
    stage.style.removeProperty("transform");

    if (transitionedScenarioIdRef.current === nextScenarioId) {
      if (reducedMotion) {
        setVisibleScenarioId(nextScenarioId);
      }
      return;
    }

    transitionedScenarioIdRef.current = nextScenarioId;
    setVisibleScenarioId(nextScenarioId);

    if (reducedMotion || prefersReducedMotion()) {
      return;
    }

    let cancelled = false;
    let transition: { kill(): void } | null = null;

    void loadGsap()
      .then(({ gsap }) => {
        if (cancelled || !stage) {
          return;
        }

        const timeline = gsap.timeline();
        transition = timeline;
        stageTransitionRef.current = timeline;
        timeline
          .fromTo(
            stage,
            {
              opacity: 0.72,
              scale: 0.992,
              y: 14,
            },
            {
              clearProps: "opacity,transform",
              duration: 0.42,
              ease: "power3.out",
              opacity: 1,
              scale: 1,
              y: 0,
            },
          );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      transition?.kill();
      if (stageTransitionRef.current === transition) {
        stageTransitionRef.current = null;
      }
      stage.style.removeProperty("opacity");
      stage.style.removeProperty("transform");
    };
  }, [reducedMotion, selectedScenarioId]);

  const selectScenario = (nextScenarioId: string) => {
    if (nextScenarioId === selectedScenarioIdRef.current) {
      return;
    }

    const scenarioButtons = scenarioRailRef.current?.querySelectorAll("[data-scenario-pill]");
    if (scenarioButtons && scenarioButtons.length > 0 && flipPluginRef.current && !reducedMotion && !prefersReducedMotion()) {
      pendingFlipStateRef.current = flipPluginRef.current.getState(scenarioButtons);
    }
    setSelectedScenarioId(nextScenarioId);
  };

  useEffect(() => {
    const flip = flipPluginRef.current;
    const state = pendingFlipStateRef.current;
    if (!flip || !state || reducedMotion || prefersReducedMotion()) {
      pendingFlipStateRef.current = null;
      return;
    }

    pendingFlipStateRef.current = null;
    const animation = flip.from(state, {
      duration: 0.42,
      ease: "power3.out",
      nested: true,
    });

    return () => {
      animation.kill();
    };
  }, [reducedMotion, selectedScenarioId]);

  return (
    <div
      className="group/demo w-full max-w-full min-w-0 overflow-hidden rounded-xl bg-[#050a10] shadow-[0_32px_80px_rgba(0,0,0,0.35)]"
      ref={rootRef}
    >
      <div className="border-b border-white/10 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium leading-6 text-white sm:text-base">
              <CandlestickChart className="shrink-0 text-cyan-100" size={18} />
              <span className="hidden min-w-0 break-words sm:inline">One trade. One continuous evidence trail.</span>
              <span className="sm:hidden">One connected workflow.</span>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-amber-100">
            <ShieldCheck size={14} />
            <span className="hidden sm:inline">Illustrative market data</span>
            <span className="sm:hidden">Illustrative data</span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-md bg-[#0b1017]" ref={scenarioRailRef} aria-label="Chart to review workflow">
          {SCENARIOS.map((item) => (
            <button
              data-scenario-pill="true"
              key={item.id}
              aria-current={item.id === selectedScenarioId ? "step" : undefined}
              className={`relative min-h-14 border-r border-white/10 px-3 py-2 text-left text-xs font-semibold transition duration-200 ease-out last:border-r-0 motion-reduce:transition-none ${
                item.id === selectedScenarioId
                  ? "bg-cyan-300/12 text-cyan-50"
                  : "bg-transparent text-slate-400 hover:bg-white/[0.04] hover:text-white"
              }`}
              onClick={() => selectScenario(item.id)}
              type="button"
            >
              <span className="block text-[10px] tabular-nums text-slate-500">{item.id === "replay" ? "01 · Chart + replay" : item.id === "review" ? "02 · Journal" : "03 · Patterns"}</span>
              <span className="mt-1 block"><span className="hidden sm:inline">{item.label}</span><span className="sm:hidden">{item.id === "review" ? "Journal" : item.label}</span></span>
              {item.id === selectedScenarioId ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 bg-cyan-200" /> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-5" ref={stageRef}>
        {scenario.id === "replay" ? (
          <div>
            <MarketingCandleSurface currentBarIndex={currentBarIndex} scenario={scenario} />
          </div>
        ) : null}

        <div className={scenario.id === "replay" ? "mt-5 border-t border-white/10 pt-4" : ""}>
          <MetricsBar compact metrics={scenario.metrics} />
        </div>

        <div className="mt-4">
          {scenario.id === "replay" ? <MarketingReplaySurface scenario={scenario} /> : null}
          {scenario.id === "review" ? (
            <MarketingReviewSurface
              onInspectTrade={(trade) => setSelectedReviewTradeId(trade.id)}
              scenario={scenario}
              selectedTrade={selectedReviewTrade}
            />
          ) : null}
          {scenario.id === "results" ? <MarketingResultsSurface scenario={scenario} /> : null}
        </div>
      </div>
    </div>
  );
}
