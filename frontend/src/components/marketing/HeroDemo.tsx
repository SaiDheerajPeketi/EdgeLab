import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type DemoScenario = {
  closes: number[];
  direction: "BUY" | "SELL";
  entryIndex: number;
  exitIndex: number;
  label: string;
  pnl: number;
  rMultiple: number;
};

type DemoCandle = {
  close: number;
  high: number;
  low: number;
  open: number;
};

const SCENARIOS: DemoScenario[] = [
  {
    closes: [
      4210, 4206, 4201, 4208, 4214, 4220, 4224, 4229, 4235, 4241, 4248, 4255, 4262,
      4268, 4271, 4278, 4285, 4290,
    ],
    direction: "BUY",
    entryIndex: 5,
    exitIndex: 15,
    label: "London open momentum",
    pnl: 284,
    rMultiple: 2.3,
  },
  {
    closes: [
      193.2, 193.5, 193.1, 192.9, 192.4, 191.9, 191.4, 191.1, 190.8, 190.5, 190.1,
      189.8, 189.4, 189.0, 188.7, 188.3, 188.1, 187.8,
    ],
    direction: "SELL",
    entryIndex: 4,
    exitIndex: 14,
    label: "Impulse fade on rejection",
    pnl: 196,
    rMultiple: 1.9,
  },
];

function buildCandles(closes: number[]) {
  return closes.map<DemoCandle>((close, index) => {
    const previousClose = index === 0 ? close - 0.7 : closes[index - 1];
    const high = Math.max(previousClose, close) + 0.55 + (index % 2) * 0.18;
    const low = Math.min(previousClose, close) - 0.48 - ((index + 1) % 3) * 0.11;

    return {
      close,
      high,
      low,
      open: previousClose,
    };
  });
}

function toPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

export function HeroDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(8);
  const [manualTrade, setManualTrade] = useState<{ entryIndex: number; side: "BUY" | "SELL" } | null>(
    null,
  );
  const [flashLabel, setFlashLabel] = useState<string | null>(null);
  const scenario = SCENARIOS[scenarioIndex];
  const candles = useMemo(() => buildCandles(scenario.closes), [scenario.closes]);

  useEffect(() => {
    if (visibleCount < candles.length) {
      const stepTimer = window.setTimeout(() => {
        setVisibleCount((current) => Math.min(current + 1, candles.length));
      }, 720);

      return () => window.clearTimeout(stepTimer);
    }

    const loopTimer = window.setTimeout(() => {
      setScenarioIndex((current) => (current + 1) % SCENARIOS.length);
      setVisibleCount(8);
      setManualTrade(null);
    }, 2400);

    return () => window.clearTimeout(loopTimer);
  }, [candles.length, visibleCount]);

  useEffect(() => {
    if (!flashLabel) {
      return undefined;
    }

    const flashTimer = window.setTimeout(() => setFlashLabel(null), 1800);
    return () => window.clearTimeout(flashTimer);
  }, [flashLabel]);

  const visibleCandles = candles.slice(Math.max(0, visibleCount - 12), visibleCount);
  const activeTrade = manualTrade ?? {
    entryIndex: scenario.entryIndex,
    side: scenario.direction,
  };
  const activeEntry = candles[Math.min(activeTrade.entryIndex, visibleCount - 1)] ?? candles[0];
  const activeLast = visibleCandles[visibleCandles.length - 1] ?? candles[0];
  const livePnlRaw =
    activeTrade.side === "BUY"
      ? (activeLast.close - activeEntry.close) * 82
      : (activeEntry.close - activeLast.close) * 82;
  const livePnl = Number(livePnlRaw.toFixed(0));
  const pnlPositive = livePnl >= 0;
  const statusReachedTarget = visibleCount - 1 >= scenario.exitIndex && !manualTrade;

  const high = Math.max(...visibleCandles.map((candle) => candle.high));
  const low = Math.min(...visibleCandles.map((candle) => candle.low));
  const range = Math.max(high - low, 1);
  const plotWidth = 448;
  const plotHeight = 218;
  const leftPad = 16;
  const topPad = 12;
  const stepX = plotWidth / Math.max(visibleCandles.length - 1, 1);

  const priceY = (value: number) => topPad + ((high - value) / range) * plotHeight;

  const equityPoints = visibleCandles.map((candle, index) => {
    const drift =
      activeTrade.side === "BUY"
        ? candle.close - activeEntry.close
        : activeEntry.close - candle.close;
    return {
      x: 12 + (index / Math.max(visibleCandles.length - 1, 1)) * 190,
      y: 64 - Math.max(-22, Math.min(22, drift * 8)),
    };
  });

  const handleTrade = (side: "BUY" | "SELL") => {
    setManualTrade({
      entryIndex: Math.max(0, visibleCount - 1),
      side,
    });
    setFlashLabel(`${side} @ ${activeLast.close.toFixed(2)}`);
  };

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#0b1016]/90 p-3 shadow-[0_32px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
      <div className="flex items-center justify-between gap-4 rounded-[22px] border border-white/10 bg-black/25 px-4 py-3 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] tracking-[0.18em] text-slate-300">
          app.edgelab.io
        </div>
        <div className="hidden sm:block">Live replay demo</div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.01))] p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/70">
                Replay Engine
              </div>
              <div className="mt-1 text-lg font-semibold text-white">{scenario.label}</div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-slate-300">
              {visibleCount}/{candles.length} candles
            </div>
          </div>

          <div className="mt-4 rounded-[20px] border border-white/10 bg-[#070b10] p-3">
            <svg
              aria-hidden="true"
              className="h-[240px] w-full"
              viewBox="0 0 480 240"
              preserveAspectRatio="none"
            >
              {[0.2, 0.4, 0.6, 0.8].map((fraction) => (
                <line
                  key={fraction}
                  x1="0"
                  x2="480"
                  y1={(240 * fraction).toFixed(2)}
                  y2={(240 * fraction).toFixed(2)}
                  stroke="rgba(148,163,184,0.08)"
                  strokeDasharray="5 7"
                />
              ))}

              {visibleCandles.map((candle, index) => {
                const x = leftPad + stepX * index;
                const openY = priceY(candle.open);
                const closeY = priceY(candle.close);
                const highY = priceY(candle.high);
                const lowY = priceY(candle.low);
                const bullish = candle.close >= candle.open;

                return (
                  <g key={`${scenario.label}:${index}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={highY}
                      y2={lowY}
                      stroke={bullish ? "#77f2ff" : "#ff8fa1"}
                      strokeWidth="2"
                    />
                    <rect
                      x={x - 7}
                      y={Math.min(openY, closeY)}
                      width="14"
                      height={Math.max(6, Math.abs(closeY - openY))}
                      rx="3"
                      fill={bullish ? "rgba(50,211,238,0.82)" : "rgba(251,113,133,0.82)"}
                    />
                  </g>
                );
              })}

              <line
                x1="0"
                x2="480"
                y1={priceY(activeEntry.close)}
                y2={priceY(activeEntry.close)}
                stroke={activeTrade.side === "BUY" ? "rgba(50,211,238,0.95)" : "rgba(251,113,133,0.95)"}
                strokeDasharray="7 7"
              />
              <text
                fill={activeTrade.side === "BUY" ? "#8bf5ff" : "#ff9aac"}
                fontFamily="JetBrains Mono"
                fontSize="10"
                x="10"
                y={Math.max(18, priceY(activeEntry.close) - 8)}
              >
                {activeTrade.side} {activeEntry.close.toFixed(2)}
              </text>
            </svg>
          </div>

          <div className="mt-3 grid gap-3 rounded-[20px] border border-white/10 bg-black/25 p-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                Trade tape
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-cyan-100">
                  {activeTrade.side}
                </span>
                <span>Entry {activeEntry.close.toFixed(2)}</span>
                <ArrowRight size={12} />
                <span>Last {activeLast.close.toFixed(2)}</span>
                <span
                  className={`rounded-full px-2 py-1 ${
                    pnlPositive ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"
                  }`}
                >
                  {pnlPositive ? "+" : ""}
                  ${livePnl}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-2xl border border-cyan-300/25 bg-cyan-300/12 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:-translate-y-0.5 hover:bg-cyan-300/18"
                onClick={() => handleTrade("BUY")}
                type="button"
              >
                Buy
              </button>
              <button
                className="rounded-2xl border border-rose-300/25 bg-rose-300/12 px-3 py-2 text-sm font-semibold text-rose-100 transition hover:-translate-y-0.5 hover:bg-rose-300/18"
                onClick={() => handleTrade("SELL")}
                type="button"
              >
                Sell
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
              Position state
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                <div className="text-sm text-slate-400">Scenario</div>
                <div className="mt-1 text-lg font-semibold text-white">{scenario.label}</div>
              </div>
              <div
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  activeTrade.side === "BUY"
                    ? "bg-cyan-300/12 text-cyan-100"
                    : "bg-rose-300/12 text-rose-100"
                }`}
              >
                {activeTrade.side}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between text-sm text-slate-400">
                  <span>Live P&amp;L</span>
                  {pnlPositive ? <TrendingUp size={16} className="text-emerald-300" /> : <TrendingDown size={16} className="text-rose-300" />}
                </div>
                <div
                  className={`mt-2 text-display text-3xl ${
                    pnlPositive ? "text-emerald-200" : "text-rose-200"
                  }`}
                >
                  {pnlPositive ? "+" : ""}
                  ${livePnl}
                </div>
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
                <div className="text-sm text-slate-400">Target state</div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div className="text-display text-3xl text-cyan-100">{scenario.rMultiple}R</div>
                  <div className="text-sm text-slate-400">
                    {statusReachedTarget ? "TP filled" : "Tracking"}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-[20px] border border-white/10 bg-[#06090d] p-3">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
                <span>Equity curve</span>
                <span>{scenario.pnl > 0 ? "+" : ""}${scenario.pnl}</span>
              </div>
              <svg aria-hidden="true" className="mt-3 h-20 w-full" viewBox="0 0 220 72" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="equity-gradient" x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" stopColor="rgba(50,211,238,0.25)" />
                    <stop offset="100%" stopColor="rgba(50,211,238,0.85)" />
                  </linearGradient>
                </defs>
                <path
                  d={toPath(equityPoints)}
                  fill="none"
                  stroke="url(#equity-gradient)"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="4"
                />
              </svg>
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(135deg,rgba(50,211,238,0.12),rgba(255,255,255,0.04))] p-4">
            <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/70">
              Strategy proof
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              Backtest. Execute. See edge update in real time.
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-300">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                <span>Win rate tracked</span>
                <span className="font-data text-cyan-100">58.4%</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                <span>Avg hold time</span>
                <span className="font-data text-cyan-100">18m 12s</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
                <span>Strategy tag</span>
                <span className="font-data text-cyan-100">LDN-BRK-02</span>
              </div>
            </div>
            {flashLabel ? (
              <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-50">
                {flashLabel}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
