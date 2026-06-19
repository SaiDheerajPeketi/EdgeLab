import { ArrowRightLeft, CandlestickChart, Play, Sparkles } from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import { EquityCurve } from "../EquityCurve";
import { ExecutionTape } from "../ExecutionTape";
import { MetricsBar } from "../MetricsBar";
import { PlaybookBoard } from "../PlaybookBoard";
import type { Execution, Metrics, Playbook, Trade } from "../../lib/api";

type DemoScenario = {
  closes: number[];
  direction: "BUY" | "SELL";
  entryIndex: number;
  executions: Execution[];
  exitIndex: number;
  id: string;
  label: string;
  metrics: Metrics;
  note: string;
  playbooks: Playbook[];
  trades: Trade[];
};

type DemoCandle = {
  close: number;
  high: number;
  low: number;
  open: number;
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
  id,
  sessionId,
  side,
  entryPrice,
  exitPrice,
  realizedPnl,
  playbookId,
  strategyName,
  notes,
  mistakeTags = [],
  emotionalState = "steady",
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
}) : Trade {
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

function buildCandles(closes: number[]): DemoCandle[] {
  return closes.map((close, index) => {
    const previousClose = index === 0 ? close - close * 0.0012 : closes[index - 1];
    const wiggle = Math.max(Math.abs(close) * 0.0006, 0.12);
    return {
      close,
      high: Math.max(previousClose, close) + wiggle + (index % 3) * wiggle * 0.2,
      low: Math.min(previousClose, close) - wiggle - ((index + 1) % 3) * wiggle * 0.18,
      open: previousClose,
    };
  });
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

function CandlePreview({ scenario }: { scenario: DemoScenario }) {
  const candles = buildCandles(scenario.closes);
  const width = 520;
  const height = 248;
  const stepX = width / Math.max(candles.length, 1);
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const range = Math.max(high - low, 1);
  const priceY = (value: number) => 12 + ((high - value) / range) * (height - 24);
  const entryCandle = candles[scenario.entryIndex] ?? candles[0];
  const exitCandle = candles[scenario.exitIndex] ?? candles[candles.length - 1];

  return (
    <section className="min-w-0 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.01))] p-4 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/70">
            Replay Candles
          </div>
          <div className="mt-2 text-2xl font-semibold text-white">{scenario.label}</div>
          <p className="mt-2 max-w-xl text-sm leading-7 text-slate-400">{scenario.note}</p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
          Japanese candlestick preview
        </div>
      </div>

      <div className="mt-4 rounded-[24px] border border-white/10 bg-[#060b10] p-3">
        <svg
          aria-hidden="true"
          className="h-[260px] w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${width} ${height}`}
        >
          {[0.2, 0.4, 0.6, 0.8].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              x2={width}
              y1={(height * fraction).toFixed(2)}
              y2={(height * fraction).toFixed(2)}
              stroke="rgba(148,163,184,0.1)"
              strokeDasharray="5 7"
            />
          ))}

          {candles.map((candle, index) => {
            const x = stepX * index + stepX * 0.5;
            const openY = priceY(candle.open);
            const closeY = priceY(candle.close);
            const highY = priceY(candle.high);
            const lowY = priceY(candle.low);
            const bullish = candle.close >= candle.open;
            const bodyWidth = Math.max(10, stepX * 0.48);

            return (
              <g key={`${scenario.id}-${index}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={highY}
                  y2={lowY}
                  stroke={bullish ? "#77f2ff" : "#ff9caf"}
                  strokeWidth="2"
                />
                <rect
                  x={x - bodyWidth / 2}
                  y={Math.min(openY, closeY)}
                  width={bodyWidth}
                  height={Math.max(8, Math.abs(closeY - openY))}
                  rx="3"
                  fill={bullish ? "rgba(50,211,238,0.82)" : "rgba(251,113,133,0.82)"}
                />
              </g>
            );
          })}

          <line
            x1="0"
            x2={width}
            y1={priceY(entryCandle.close)}
            y2={priceY(entryCandle.close)}
            stroke={scenario.direction === "BUY" ? "rgba(50,211,238,0.95)" : "rgba(251,113,133,0.95)"}
            strokeDasharray="7 7"
          />
          <circle
            cx={stepX * scenario.entryIndex + stepX * 0.5}
            cy={priceY(entryCandle.close)}
            fill="#8bf5ff"
            r="5"
          />
          <circle
            cx={stepX * scenario.exitIndex + stepX * 0.5}
            cy={priceY(exitCandle.close)}
            fill="#f6c26b"
            r="5"
          />
          <text
            fill="#8bf5ff"
            fontFamily="JetBrains Mono"
            fontSize="10"
            x="10"
            y={Math.max(18, priceY(entryCandle.close) - 8)}
          >
            {scenario.direction} {formatPrice(entryCandle.close)}
          </text>
        </svg>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Entry</div>
          <div className="mt-2 font-data text-lg text-white">{formatPrice(entryCandle.close)}</div>
        </div>
        <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Exit</div>
          <div className="mt-2 font-data text-lg text-white">{formatPrice(exitCandle.close)}</div>
        </div>
        <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Direction</div>
          <div className="mt-2 flex items-center gap-2 text-lg font-semibold text-white">
            <ArrowRightLeft size={16} className="text-cyan-100" />
            {scenario.direction}
          </div>
        </div>
      </div>
    </section>
  );
}

const SCENARIOS: DemoScenario[] = [
  {
    id: "replay",
    label: "Replay session",
    note: "Candles, metrics, execution tape, and playbook context stay on same surface.",
    closes: [4280.4, 4278.6, 4279.8, 4282.2, 4284.1, 4287.4, 4290.5, 4288.9, 4292.1, 4294.8, 4293.7, 4296.4],
    direction: "BUY",
    entryIndex: 4,
    exitIndex: 11,
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
    id: "journal",
    label: "Journal review",
    note: "Trade replay rolls straight into tagged review instead of separate tooling.",
    closes: [191.8, 191.6, 191.2, 190.9, 190.5, 190.1, 189.8, 190.2, 189.9, 189.5, 189.1, 188.8],
    direction: "SELL",
    entryIndex: 3,
    exitIndex: 10,
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
    id: "analytics",
    label: "Analytics pass",
    note: "Edge survives only when candles, execution, and results all agree with each other.",
    closes: [1.0842, 1.0838, 1.0846, 1.0851, 1.0856, 1.0862, 1.0868, 1.0863, 1.0871, 1.0878, 1.0874, 1.0882],
    direction: "BUY",
    entryIndex: 2,
    exitIndex: 9,
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

export function HeroDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const scenario = SCENARIOS[scenarioIndex] ?? SCENARIOS[0];

  const runScenarioTransition = (nextIndex: number) => {
    if (nextIndex === scenarioIndex) {
      return;
    }

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
    }
    if (showTimerRef.current) {
      window.clearTimeout(showTimerRef.current);
    }

    setIsTransitioning(true);

    hideTimerRef.current = window.setTimeout(() => {
      startTransition(() => {
        setScenarioIndex(nextIndex);
      });

      showTimerRef.current = window.setTimeout(() => {
        setIsTransitioning(false);
      }, 60);
    }, 180);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      runScenarioTransition((scenarioIndex + 1) % SCENARIOS.length);
    }, 5200);

    return () => window.clearTimeout(timer);
  }, [scenarioIndex]);

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

  return (
    <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[#081019]/92 p-4 shadow-[0_36px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />

      <div className="rounded-[24px] border border-white/10 bg-black/25 px-4 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/70">
              Live surface preview
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">{scenario.label}</div>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-400">{scenario.note}</p>
          </div>
          <div className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-cyan-50">
            Candles + real app widgets
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SCENARIOS.map((item, index) => (
            <button
              key={item.id}
              className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${
                index === scenarioIndex
                  ? "border-cyan-300/25 bg-cyan-300/12 text-cyan-50"
                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-cyan-300/20 hover:text-cyan-50"
              }`}
              onClick={() => runScenarioTransition(index)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`transition-all duration-500 ${
          isTransitioning
            ? "translate-y-3 scale-[0.985] opacity-0"
            : "translate-y-0 scale-100 opacity-100"
        }`}
      >
        <div className="mt-4">
          <MetricsBar metrics={scenario.metrics} />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(280px,0.88fr)]">
          <CandlePreview scenario={scenario} />
          <div className="grid gap-4">
            <ExecutionTape executions={scenario.executions} />
            <EquityCurve metrics={scenario.metrics} />
          </div>
        </div>

        <div className="mt-4">
          <PlaybookBoard playbooks={scenario.playbooks} trades={scenario.trades} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Play,
              title: "Replay first",
              body: "Start from candles and timing, not isolated stats.",
            },
            {
              icon: CandlestickChart,
              title: "Proof stays visual",
              body: "Price action remains in frame while review sharpens.",
            },
            {
              icon: Sparkles,
              title: "Transitions feel alive",
              body: "Surface rotates through replay, journal, and analytics with motion.",
            },
          ].map((item) => {
            const Icon = item.icon;

            return (
              <div
                key={item.title}
                className="rounded-[22px] border border-white/10 bg-black/20 p-4"
              >
                <Icon className="text-cyan-100" size={18} />
                <div className="mt-3 text-lg font-semibold text-white">{item.title}</div>
                <p className="mt-2 text-sm leading-7 text-slate-400">{item.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
