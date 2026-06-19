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
import type { Metrics, Playbook, Trade } from "../../lib/api";

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
  id: string;
  label: string;
  markerNote: string;
  markers: DemoMarker[];
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

function interpolateCloses(points: number[], stepsPerSegment: number) {
  if (points.length <= 1) {
    return points;
  }

  const closes: number[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];

    for (let step = 0; step < stepsPerSegment; step += 1) {
      const progress = step / stepsPerSegment;
      const delta = end - start;
      const curve = Math.sin(progress * Math.PI) * delta * 0.08;
      closes.push(start + delta * progress + curve);
    }
  }

  closes.push(points[points.length - 1]);
  return closes;
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
    const previousClose = index === 0 ? close * 0.999 : closes[index - 1];
    const baseRange = Math.max(Math.abs(close - previousClose), Math.abs(close) * 0.00055);
    const high = Math.max(previousClose, close) + baseRange * (0.64 + (index % 4) * 0.11);
    const low = Math.min(previousClose, close) - baseRange * (0.62 + ((index + 2) % 4) * 0.09);

    return {
      time: (startTime + index * stepMinutes * 60) as UTCTimestamp,
      open: previousClose,
      high,
      low,
      close,
      volume: baseVolume + index * 1400 + (index % 5) * 2200,
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

function formatBarTime(value: UTCTimestamp) {
  return new Date(Number(value) * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const replayBars = createBars({
  day: 12,
  baseVolume: 182000,
  closes: interpolateCloses(
    [4278.8, 4276.9, 4277.4, 4279.6, 4282.4, 4285.2, 4283.4, 4286.9, 4290.8, 4294.1, 4291.7, 4297.6, 4301.3],
    5,
  ),
});

const reviewBars = createBars({
  day: 14,
  baseVolume: 124000,
  stepMinutes: 15,
  closes: interpolateCloses(
    [192.1, 191.8, 191.4, 190.8, 190.2, 189.7, 189.9, 189.5, 189.1, 188.7, 188.9, 188.4, 188.1],
    4,
  ),
});

const resultsBars = createBars({
  day: 16,
  baseVolume: 212000,
  closes: interpolateCloses(
    [1.0838, 1.0843, 1.0847, 1.0852, 1.0858, 1.0864, 1.0861, 1.0867, 1.0873, 1.0879, 1.0876, 1.0881, 1.0887],
    5,
  ),
});

const SCENARIOS: DemoScenario[] = [
  {
    id: "replay",
    label: "Replay",
    note: "Follow live candles and session tempo before review starts.",
    markerNote: "Entry and exit markers stay on chart while replay unfolds.",
    symbol: "NQ 100",
    timeframe: "5m replay",
    bars: replayBars,
    markers: buildMarkers(replayBars, [
      { index: 14, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Entry" },
      { index: 37, position: "aboveBar", shape: "arrowDown", color: "#f59e0b", text: "Partial" },
      { index: 52, position: "aboveBar", shape: "circle", color: "#38bdf8", text: "Review" },
    ]),
    metrics: buildMetrics(1426, 0.581, 31, [0, 112, 260, 208, 442, 615, 588, 756, 921, 1108, 1264, 1426]),
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
    note: "Move from replay into journal pass without losing price context.",
    markerNote: "Review markers flag hesitation and clean follow-through.",
    symbol: "AAPL",
    timeframe: "15m review",
    bars: reviewBars,
    markers: buildMarkers(reviewBars, [
      { index: 11, position: "aboveBar", shape: "arrowDown", color: "#fb7185", text: "Short" },
      { index: 22, position: "belowBar", shape: "circle", color: "#f59e0b", text: "Tag" },
      { index: 40, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Re-entry" },
    ]),
    metrics: buildMetrics(986, 0.544, 24, [0, 85, 142, 318, 276, 344, 478, 632, 590, 728, 814, 986]),
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
    note: "Results stay believable only when chart action and review agree.",
    markerNote: "Winning sequences remain tied to exact swing structure.",
    symbol: "EURUSD",
    timeframe: "5m results",
    bars: resultsBars,
    markers: buildMarkers(resultsBars, [
      { index: 9, position: "belowBar", shape: "arrowUp", color: "#22c55e", text: "Start" },
      { index: 29, position: "aboveBar", shape: "circle", color: "#38bdf8", text: "Scale" },
      { index: 53, position: "aboveBar", shape: "arrowDown", color: "#f59e0b", text: "Close" },
    ]),
    metrics: buildMetrics(1874, 0.603, 37, [0, 164, 298, 552, 488, 736, 924, 1160, 1318, 1514, 1688, 1874]),
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

function ReplayPulseCard({
  currentBar,
  progressPercent,
  scenario,
  visibleBarCount,
}: {
  currentBar: DemoBar | null;
  progressPercent: number;
  scenario: DemoScenario;
  visibleBarCount: number;
}) {
  return (
    <section className="rounded-[24px] border border-white/10 bg-[#081018] p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/60">
            Replay pulse
          </div>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">
            {scenario.label} active
          </h3>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100">
          <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.55)] motion-safe:animate-pulse" />
          Live
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Playback</div>
          <div className="mt-2 text-lg font-semibold text-white">
            {visibleBarCount}/{scenario.bars.length} candles
          </div>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Current time</div>
          <div className="mt-2 text-lg font-semibold text-white">
            {currentBar ? formatBarTime(currentBar.time) : "—"}
          </div>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-200 to-emerald-300 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="mt-4 grid gap-3">
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-slate-300">
          {scenario.markerNote}
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Current price</div>
          <div className="mt-2 text-xl font-semibold text-white">
            {currentBar ? formatPrice(currentBar.close) : "—"}
          </div>
        </div>
      </div>
    </section>
  );
}

function MarketingCandleSurface({
  scenario,
  visibleBarCount,
}: {
  scenario: DemoScenario;
  visibleBarCount: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const visibleBars = useMemo(
    () => scenario.bars.slice(0, Math.max(1, visibleBarCount)),
    [scenario.bars, visibleBarCount],
  );
  const lastBar = visibleBars[visibleBars.length - 1] ?? null;
  const firstBar = visibleBars[0] ?? null;
  const changePercent =
    firstBar != null && lastBar != null
      ? ((lastBar.close - firstBar.open) / Math.max(Math.abs(firstBar.open), Number.EPSILON)) * 100
      : 0;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const precision = pricePrecision(lastBar?.close ?? scenario.bars[0]?.close ?? 1);
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
  }, [lastBar?.close, scenario.bars]);

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
          Hover candles for OHLC
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
        <div ref={containerRef} className="h-[392px] w-full" />
      </div>
    </section>
  );
}

export function HeroDemo() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(SCENARIOS[0]?.id ?? "replay");
  const [visibleScenarioId, setVisibleScenarioId] = useState(SCENARIOS[0]?.id ?? "replay");
  const [showing, setShowing] = useState(true);
  const [visibleBarCount, setVisibleBarCount] = useState(
    Math.min(24, SCENARIOS[0]?.bars.length ?? 24),
  );
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

  useEffect(() => {
    if (!scenario) {
      return;
    }

    const initialCount = Math.min(24, scenario.bars.length);

    if (prefersReducedMotion) {
      setVisibleBarCount(scenario.bars.length);
      return;
    }

    setVisibleBarCount(initialCount);

    const timer = window.setInterval(() => {
      setVisibleBarCount((current) => {
        if (current >= scenario.bars.length) {
          window.clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, 120);

    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, scenario]);

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

  const currentBar = scenario.bars[Math.max(0, Math.min(visibleBarCount - 1, scenario.bars.length - 1))] ?? null;
  const progressPercent = Math.max(12, (visibleBarCount / Math.max(scenario.bars.length, 1)) * 100);

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
              More candles, live playback, real chart markers, same product chrome.
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

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.22fr)_minmax(300px,0.78fr)]">
          <MarketingCandleSurface scenario={scenario} visibleBarCount={visibleBarCount} />
          <ReplayPulseCard
            currentBar={currentBar}
            progressPercent={progressPercent}
            scenario={scenario}
            visibleBarCount={visibleBarCount}
          />
        </div>

        <div className="mt-4">
          <PlaybookBoard playbooks={scenario.playbooks} trades={scenario.trades} />
        </div>
      </div>
    </div>
  );
}
