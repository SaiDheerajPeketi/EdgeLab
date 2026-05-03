import { Search, Star, TrendingDown, TrendingUp } from "lucide-react";
import type { Candle, Position } from "../lib/api";
import { formatPrice } from "../lib/format";

type Props = {
  current: Candle | null | undefined;
  position: Position | null;
};

const symbols = [
  { symbol: "EURUSD", name: "Euro / Dollar", change: 0.18 },
  { symbol: "GBPUSD", name: "Pound / Dollar", change: -0.07 },
  { symbol: "XAUUSD", name: "Gold Spot", change: 0.42 },
  { symbol: "NAS100", name: "US Tech 100", change: -0.23 },
  { symbol: "BTCUSD", name: "Bitcoin", change: 1.12 },
];

export function MarketStrip({ current, position }: Props) {
  return (
    <section className="mb-4 grid min-w-0 gap-3 xl:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(260px,340px)]">
      <div className="terminal-panel flex h-14 min-w-0 items-center gap-3 px-3">
        <Search size={17} className="text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Quick Symbol
          </div>
          <div className="truncate text-sm font-semibold text-white">EURUSD · M1 replay</div>
        </div>
        <div className="rounded-md bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100">
          {formatPrice(current?.close)}
        </div>
      </div>

      <div className="terminal-panel flex h-14 min-w-0 items-center gap-2 overflow-x-auto px-3">
        {symbols.map((item) => {
          const UpDown = item.change >= 0 ? TrendingUp : TrendingDown;
          return (
            <button
              className={`symbol-chip ${item.symbol === "EURUSD" ? "symbol-chip-active" : ""}`}
              key={item.symbol}
              type="button"
            >
              <Star size={13} className={item.symbol === "EURUSD" ? "text-amber-300" : "text-slate-600"} />
              <span className="font-semibold text-slate-100">{item.symbol}</span>
              <span className="hidden text-slate-500 sm:inline">{item.name}</span>
              <span className={item.change >= 0 ? "text-emerald-300" : "text-rose-300"}>
                <UpDown size={13} />
              </span>
              <span className={item.change >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {item.change >= 0 ? "+" : ""}
                {item.change.toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="terminal-panel flex h-14 min-w-0 items-center justify-between gap-3 px-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Exposure
          </div>
          <div className="text-sm font-semibold text-white">
            {position && position.side !== "FLAT"
              ? `${position.side} ${Math.round(position.quantity).toLocaleString()}`
              : "Flat"}
          </div>
        </div>
        <div
          className={`rounded-md px-3 py-2 text-sm font-semibold ${
            (position?.unrealized_pnl ?? 0) >= 0
              ? "bg-emerald-300/10 text-emerald-200"
              : "bg-rose-300/10 text-rose-200"
          }`}
        >
          {money(position?.unrealized_pnl ?? 0)}
        </div>
      </div>
    </section>
  );
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
