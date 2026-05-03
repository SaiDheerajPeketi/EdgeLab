import { Activity, Crosshair, Flame, Gauge, ListOrdered } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Candle, Order, Position } from "../lib/api";
import { formatMoney, formatPrice } from "../lib/format";

type Props = {
  candle: Candle | null | undefined;
  orders: Order[];
  position: Position | null;
};

export function CandleInspector({ candle, orders, position }: Props) {
  const range =
    candle != null ? Math.max(candle.high - candle.low, 0) : null;
  const body =
    candle != null ? Math.abs(candle.close - candle.open) : null;
  const pending = orders.filter((order) => order.status === "PENDING").length;

  return (
    <section className="terminal-panel grid min-w-0 gap-2 p-3 xl:grid-cols-2">
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:col-span-2">
        <PriceCell label="Open" value={candle?.open} />
        <PriceCell label="High" value={candle?.high} tone="text-emerald-300" />
        <PriceCell label="Low" value={candle?.low} tone="text-rose-300" />
        <PriceCell label="Close" value={candle?.close} tone="text-cyan-100" />
      </div>

      <div className="grid min-w-0 grid-cols-3 gap-2">
        <InfoCell icon={Crosshair} label="Range" value={formatPrice(range)} />
        <InfoCell icon={Activity} label="Body" value={formatPrice(body)} />
        <InfoCell icon={Gauge} label="RSI" value={candle?.rsi_14?.toFixed(2) ?? "—"} />
      </div>

      <div className="grid min-w-0 grid-cols-3 gap-2">
        <InfoCell icon={ListOrdered} label="Pending" value={String(pending)} />
        <InfoCell icon={Flame} label="Exposure" value={position?.side ?? "FLAT"} />
        <InfoCell
          icon={Activity}
          label="U-PnL"
          value={formatMoney(position?.unrealized_pnl)}
          tone={(position?.unrealized_pnl ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"}
        />
      </div>
    </section>
  );
}

function PriceCell({
  label,
  value,
  tone = "text-slate-100",
}: {
  label: string;
  value: number | null | undefined;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-black/20 px-3 py-2">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-1 truncate text-sm font-semibold ${tone}`}>
        {formatPrice(value)}
      </div>
    </div>
  );
}

function InfoCell({
  icon: Icon,
  label,
  value,
  tone = "text-slate-100",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-black/20 px-3 py-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
        <Icon size={13} />
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
