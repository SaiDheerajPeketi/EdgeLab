import { CandlestickChart, ShieldCheck, Sparkles } from "lucide-react";
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
import { ExecutionTape } from "../ExecutionTape";
import { MetricsBar } from "../MetricsBar";
import { PlaybookBoard } from "../PlaybookBoard";
import type { Execution, Metrics, Playbook, Trade } from "../../lib/api";

type DemoBar = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: UTCTimestamp;
  volume: number;
};

type DemoScenario = {
  bars: DemoBar[];
  executions: Execution[];
  focusPoints: string[];
  id: string;
  label: string;
  metrics: Metrics;
  note: string;
  playbooks: Playbook[];
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

function buildMetrics(netPnl: number, winRate: number, totalTrades: number, equity: number[]): Metrics {
  return {
    net_pnl: netPnl,
    win_rate: winRate,
    total_trades: totalTrades,
    profit_factor: 1.84,
    max_drawdown: -412,
    sharpe_ratio: 1.42,
    average_r: 0.68,
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

function createExecution(
  id: number,
  sessionId: number,
  side: "BUY" | "SELL",
  price: number,
  quantity: number,
  realizedPnl: number,
  timestamp: string,
): Execution {
  return {
    id,
    session_id: sessionId,
    order_id: id + 100,
    side,
    timestamp,
    offset: id,
    price,
    quantity,
    realized_pnl: realizedPnl,
    position_side_after: realizedPnl === 0 ? (side === "BUY" ? "LONG" : "SHORT") : "FLAT",
    position_quantity_after: realizedPnl === 0 ? quantity : 0,
    created_at: timestamp,
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

function createBars({
  baseVolume,
  closes,
  day,
  stepMinutes = 5,
}: {
  baseVolume: number;
  closes: number[];
  day: number;
  stepMinutes?: number;
}): DemoBar[] {
  const startTime = Date.UTC(2026, 5, day, 9, 30) / 1000;

  return closes.map((close, index) => {
    const previousClose = index === 0 ? close * 0.9986 : closes[index - 1];
    const baseRange = Math.max(Math.abs(close - previousClose), Math.abs(close) * 0.00045);
    const high = Math.max(previousClose, close) + baseRange * (0.72 + (index % 3) * 0.12);
    const low = Math.min(previousClose, close) - baseRange * (0.78 + ((index + 1) % 3) * 0.1);

    return {
      time: (startTime + index * stepMinutes * 60) as UTCTimestamp,
      open: previousClose,
      high,
      low,
      close,
      volume: baseVolume + index * 1800 + (index % 4) * 2400,
    };
  });
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
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

const SCENARIOS: DemoScenario[] = [
  {
    id: "replay",
    label: "Replay",
    note: "Walk live candles, take the trade, keep fills and context in same frame.",
    symbol: "NQ 100",
    timeframe: "5m replay",
    bars: createBars({
      day: 12,
      baseVolume: 182000,
      closes: [4280.4, 4278.6, 4279.8, 4282.2, 4284.1, 4287.4, 4290.5, 4288.9, 4292.1, 4294.8, 4293.7, 4296.4],
    }),
    focusPoints: [
      "Opening range break stays visible beside fills.",
      "Metrics update from same session, not exported screenshots.",
      "Review starts from what price actually did.",
    ],
    metrics: buildMetrics(1426, 0.581, 31, [0, 112, 260, 208, 442, 615, 588, 756, 921, 1108, 1264, 1426]),
    executions: [
      createExecution(11, 7, "BUY", 4284.1, 2, 0, "2026-06-12T09:42:00Z"),
      createExecution(12, 7, "SELL", 4290.5, 1, 174, "2026-06-12T09:58:00Z"),
      createExecution(13, 7, "SELL", 4296.4, 1, 286, "2026-06-12T10:06:00Z"),
    ],
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
    label: "Review",
    note: "Switch from replay to journal review without losing execution truth.",
    symbol: "AAPL",
    timeframe: "15m review",
    bars: createBars({
      day: 14,
      baseVolume: 124000,
      stepMinutes: 15,
      closes: [191.8, 191.6, 191.2, 190.9, 190.5, 190.1, 189.8, 190.2, 189.9, 189.5, 189.1, 188.8],
    }),
    focusPoints: [
      "Mistake tags stay attached to exact session outcome.",
      "Journal pass highlights forced entries and clean exits.",
      "Nothing jumps to separate tools during review.",
    ],
    metrics: buildMetrics(986, 0.544, 24, [0, 85, 142, 318, 276, 344, 478, 632, 590, 728, 814, 986]),
    executions: [
      createExecution(21, 8, "SELL", 190.9, 300, 0, "2026-06-14T13:02:00Z"),
      createExecution(22, 8, "BUY", 189.8, 300, 330, "2026-06-14T13:18:00Z"),
      createExecution(23, 8, "BUY", 190.2, 200, -94, "2026-06-14T14:10:00Z"),
    ],
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
    note: "Outcome stays believable only when candles, fills, and review agree.",
    symbol: "EURUSD",
    timeframe: "5m results",
    bars: createBars({
      day: 16,
      baseVolume: 212000,
      closes: [1.0842, 1.0838, 1.0846, 1.0851, 1.0856, 1.0862, 1.0868, 1.0863, 1.0871, 1.0878, 1.0874, 1.0882],
    }),
    focusPoints: [
      "Metrics prove process after chart context already exists.",
      "Playbooks show which behavior still compounds.",
      "Results feel earned instead of decorative marketing.",
    ],
    metrics: buildMetrics(1874, 0.603, 37, [0, 164, 298, 552, 488, 736, 924, 1160, 1318, 1514, 1688, 1874]),
    executions: [
      createExecution(31, 9, "BUY", 1.0846, 120000, 0, "2026-06-16T08:48:00Z"),
      createExecution(32, 9, "SELL", 1.0868, 120000, 228, "2026-06-16T09:06:00Z"),
      createExecution(33, 9, "SELL", 1.0878, 100000, 142, "2026-06-16T11:11:00Z"),
    ],
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
        exitPrice: 1.0878,
        realizedPnl: 80,
        playbookId: 2,
        strategyName: "NY Reversal",
        mistakeTags: ["early cover"],
      }),
      createTrade({
        id: 303,
        sessionId: 9,
        side: "LONG",
        entryPrice: 1.0834,
        exitPrice: 1.0859,
        realizedPnl: 250,
        playbookId: 3,
        strategyName: "Trend Continuation",
        notes: "Clean pullback continuation.",
      }),
    ],
    playbooks: PLAYBOOKS,
  },
];

function SurfaceNotes({ scenario }: { scenario: DemoScenario }) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-[#081018] p-4 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/60">
            Why this view
          </div>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
            Same surface, different proof
          </h3>
        </div>
        <Sparkles className="text-cyan-100" size={18} />
      </div>

      <div className="mt-4 grid gap-2.5">
        {scenario.focusPoints.map((point) => (
          <div
            key={point}
            className="rounded-[18px] border border-white/8 bg-black/20 px-3 py-3 text-sm leading-7 text-slate-300"
          >
            {point}
          </div>
        ))}
      </div>
    </section>
  );
}

function MarketingCandleSurface({ scenario }: { scenario: DemoScenario }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const lastBar = scenario.bars[scenario.bars.length - 1] ?? scenario.bars[0];
  const firstBar = scenario.bars[0];
  const changePercent =
    firstBar != null && lastBar != null
      ? ((lastBar.close - firstBar.open) / Math.max(Math.abs(firstBar.open), Number.EPSILON)) * 100
      : 0;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const precision = pricePrecision(lastBar?.close ?? 1);
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: "#0b1017", type: ColorType.Solid },
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
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
        top: 0.8,
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
  }, [lastBar?.close]);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) {
      return;
    }

    const candleData: CandlestickData<UTCTimestamp>[] = scenario.bars.map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    const volumeData: HistogramData<UTCTimestamp>[] = scenario.bars.map((bar) => ({
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(38, 166, 154, 0.34)" : "rgba(239, 83, 80, 0.34)",
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current.timeScale().fitContent();
  }, [scenario]);

  return (
    <section className="rounded-[26px] border border-white/10 bg-[#060c12] p-4 shadow-panel">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/60">
            {scenario.symbol}
          </div>
          <h3 className="mt-2 text-[1.7rem] font-semibold tracking-[-0.04em] text-white">
            {scenario.timeframe}
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-7 text-slate-400">{scenario.note}</p>
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-slate-300">
          Candles + live widgets
        </div>
      </div>

      <div className="chart-ohlcv-row mt-4">
        <span className="chart-ohlcv-time">Latest</span>
        <span className="chart-ohlcv-item">
          <span>O</span>
          <strong>{formatPrice(lastBar?.open ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>H</span>
          <strong>{formatPrice(lastBar?.high ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>L</span>
          <strong>{formatPrice(lastBar?.low ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>C</span>
          <strong>{formatPrice(lastBar?.close ?? 0)}</strong>
        </span>
        <span className="chart-ohlcv-item">
          <span>Vol</span>
          <strong>{formatCompactVolume(lastBar?.volume ?? 0)}</strong>
        </span>
        <span className={`chart-ohlcv-change ${changePercent >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
          {formatPercent(changePercent)}
        </span>
      </div>

      <div className="mt-4 overflow-hidden rounded-[22px] border border-white/10 bg-[#0b1017]">
        <div ref={containerRef} className="h-[360px] w-full" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Frame</div>
          <div className="mt-2 text-sm font-semibold text-white">Replay stays candle-first</div>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Proof</div>
          <div className="mt-2 text-sm font-semibold text-white">Metrics stay tied to session</div>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Review</div>
          <div className="mt-2 text-sm font-semibold text-white">Playbooks expose what repeats</div>
        </div>
      </div>
    </section>
  );
}

export function HeroDemo() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(SCENARIOS[0]?.id ?? "replay");
  const [visibleScenarioId, setVisibleScenarioId] = useState(SCENARIOS[0]?.id ?? "replay");
  const [showing, setShowing] = useState(true);
  const prefersReducedMotion = usePrefersReducedMotion();
  const hideTimerRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);

  const scenario = useMemo(
    () => SCENARIOS.find((item) => item.id === visibleScenarioId) ?? SCENARIOS[0],
    [visibleScenarioId],
  );

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
      if (showTimerRef.current) {
        window.clearTimeout(showTimerRef.current);
      }
    };
  }, []);

  const selectScenario = (nextScenarioId: string) => {
    if (nextScenarioId === visibleScenarioId) {
      return;
    }

    setSelectedScenarioId(nextScenarioId);

    if (prefersReducedMotion) {
      setVisibleScenarioId(nextScenarioId);
      setShowing(true);
      return;
    }

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
    }

    setShowing(false);

    hideTimerRef.current = window.setTimeout(() => {
      setVisibleScenarioId(nextScenarioId);
      showTimerRef.current = window.setTimeout(() => {
        setShowing(true);
      }, 24);
    }, 120);
  };

  return (
    <div className="overflow-hidden rounded-[34px] border border-white/10 bg-[#050a10]/95 shadow-[0_36px_90px_rgba(0,0,0,0.45)]">
      <div className="border-b border-white/10 bg-black/20 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/65">
              Live surface preview
            </div>
            <div className="mt-2 flex items-center gap-2 text-[1.9rem] font-semibold tracking-[-0.04em] text-white">
              <CandlestickChart className="text-cyan-100" size={22} />
              Actual EdgeLab surfaces
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">
              Preview stays calm, candle-first, and grounded in product chrome instead of fake marketing art.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1.5 text-xs font-medium text-cyan-50">
            <ShieldCheck size={14} />
            Private beta track
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SCENARIOS.map((item) => (
            <button
              key={item.id}
              className={`rounded-full border px-3.5 py-2 text-xs font-semibold transition duration-200 ease-out motion-reduce:transition-none ${
                item.id === selectedScenarioId
                  ? "border-cyan-300/30 bg-cyan-300/12 text-cyan-50"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-cyan-300/20 hover:text-cyan-50"
              }`}
              onClick={() => selectScenario(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`p-4 transition duration-200 ease-out motion-reduce:transition-none sm:p-5 ${
          showing ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <MetricsBar metrics={scenario.metrics} />

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.14fr)_minmax(320px,0.86fr)]">
          <MarketingCandleSurface scenario={scenario} />
          <div className="grid gap-4">
            <ExecutionTape executions={scenario.executions} />
            <SurfaceNotes scenario={scenario} />
          </div>
        </div>

        <div className="mt-4">
          <PlaybookBoard playbooks={scenario.playbooks} trades={scenario.trades} />
        </div>
      </div>
    </div>
  );
}
