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
  const session = useBacktestStore((store) => store.state?.session ?? null);
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
      commission_mode: session?.default_commission_mode ?? "NONE",
      commission_value: costValueForPayload(
        session?.default_commission_mode,
        session?.default_commission_value,
      ),
      fee_mode: session?.default_fee_mode ?? "NONE",
      fee_value: costValueForPayload(session?.default_fee_mode, session?.default_fee_value),
      strategy_name: position.strategy_name,
      playbook_id: position.playbook_id,
    });
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-xl bg-[#080c11] shadow-panel ring-1 ring-inset ring-white/10">
      <div className="flex min-h-14 items-center justify-between border-b border-white/[0.08] px-4">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-white">Open position</h2>
          <p className="text-[11px] text-slate-400">Live exposure</p>
        </div>
        <BadgeDollarSign size={17} strokeWidth={1.8} className="text-emerald-300" />
      </div>

      {isFlat ? (
        <div className="grid h-32 place-items-center text-center">
          <div>
            <div className="mx-auto h-1.5 w-1.5 rounded-full bg-slate-700" />
            <p className="mt-3 text-sm font-medium text-slate-300">No open position</p>
            <p className="mt-1 text-xs text-slate-400">Exposure is flat.</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid min-w-0 grid-cols-2 text-sm">
            <Metric label="Side" value={position.side} tone={position.side === "LONG" ? "text-emerald-300" : "text-rose-300"} />
            <Metric data label="Qty" value={position.quantity.toLocaleString()} />
            <Metric data label="Avg" value={formatPrice(position.avg_price)} />
            <Metric
              data
              label="Unrealized"
              value={money(position.unrealized_pnl, currency)}
              tone={position.unrealized_pnl >= 0 ? "text-emerald-300" : "text-rose-300"}
            />
            <Metric data label="SL" value={formatPrice(position.stop_loss)} />
            <Metric data label="TP" value={formatPrice(position.take_profit)} />
          </div>
          {position.breakeven_moved && (
            <div className="border-t border-emerald-300/15 bg-emerald-300/[0.06] px-4 py-2.5 text-xs text-emerald-100">
              Stop moved to breakeven
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 border-t border-white/[0.08] p-3">
            <button className="control-button border-white/[0.08] bg-transparent" onClick={() => closeFraction(0.25)} type="button">
              <ArrowDownToLine size={16} />
              25%
            </button>
            <button className="control-button border-white/[0.08] bg-transparent" onClick={() => closeFraction(0.5)} type="button">
              <ArrowDownToLine size={16} />
              50%
            </button>
            <button className="control-button border-white/[0.08] bg-transparent" onClick={() => closeFraction(1)} type="button">
              <ArrowUpToLine size={16} />
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({
  data = false,
  label,
  value,
  tone = "text-slate-100",
}: {
  data?: boolean;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 border-b border-r border-white/[0.055] px-4 py-3 even:border-r-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className={`mt-1 truncate text-xs font-medium ${data ? "font-data" : ""} ${tone}`}>{value}</div>
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

function costValueForPayload(mode: string | null | undefined, value: number | null | undefined) {
  return mode === "FIXED" || mode === "PERCENT" ? Math.max(Number(value) || 0, 0) : 0;
}
