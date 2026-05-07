import { ArrowDownToLine, ArrowUpToLine, BadgeDollarSign } from "lucide-react";
import type { Position } from "../lib/api";
import { formatPrice } from "../lib/format";
import { useBacktestStore } from "../store/backtestStore";

type Props = {
  currency?: string;
  position: Position | null;
};

export function PositionPanel({ currency = "USD", position }: Props) {
  const placeOrder = useBacktestStore((store) => store.placeOrder);
  const isFlat = !position || position.side === "FLAT" || position.quantity <= 0;
  const closeSide = position?.side === "LONG" ? "SELL" : "BUY";

  function closeFraction(fraction: number) {
    if (!position || isFlat) {
      return;
    }
    void placeOrder({
      side: closeSide,
      order_type: "MARKET",
      quantity: position.quantity * fraction,
      reduce_only: true,
      strategy_name: position.strategy_name,
    });
  }

  return (
    <section className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Open Position</h2>
        <BadgeDollarSign size={18} className="text-emerald-200" />
      </div>

      {isFlat ? (
        <div className="grid h-28 place-items-center rounded-md bg-ink-950 text-sm text-slate-500">
          Flat
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid min-w-0 grid-cols-2 gap-2 text-sm">
            <Metric label="Side" value={position.side} tone={position.side === "LONG" ? "text-emerald-300" : "text-rose-300"} />
            <Metric label="Qty" value={position.quantity.toLocaleString()} />
            <Metric label="Avg" value={formatPrice(position.avg_price)} />
            <Metric
              label="Unrealized"
              value={money(position.unrealized_pnl, currency)}
              tone={position.unrealized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}
            />
            <Metric label="SL" value={formatPrice(position.stop_loss)} />
            <Metric label="TP" value={formatPrice(position.take_profit)} />
          </div>
          {position.breakeven_moved && (
            <div className="rounded-md bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
              Stop moved to breakeven
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <button className="control-button" onClick={() => closeFraction(0.25)} type="button">
              <ArrowDownToLine size={16} />
              25%
            </button>
            <button className="control-button" onClick={() => closeFraction(0.5)} type="button">
              <ArrowDownToLine size={16} />
              50%
            </button>
            <button className="control-button" onClick={() => closeFraction(1)} type="button">
              <ArrowUpToLine size={16} />
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone = "text-slate-100" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-ink-950 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}
