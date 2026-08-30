import { Pencil, X } from "lucide-react";
import { useState } from "react";
import type { Order } from "../lib/api";
import { formatPrice } from "../lib/format";
import { useBacktestStore } from "../store/backtestStore";

type Props = {
  orders: Order[];
};

export function PendingOrders({ orders }: Props) {
  const pending = orders.filter((order) => order.status === "PENDING");
  const cancelOrder = useBacktestStore((store) => store.cancelOrder);
  const amendOrder = useBacktestStore((store) => store.amendOrder);
  const [editing, setEditing] = useState<Order | null>(null);
  const [price, setPrice] = useState("");

  function beginEdit(order: Order) {
    setEditing(order);
    setPrice(String(order.limit_price ?? order.stop_price ?? ""));
  }

  function saveEdit() {
    if (!editing) {
      return;
    }
    const value = Number(price);
    void amendOrder(editing.id, {
      limit_price: editing.order_type === "LIMIT" ? value : undefined,
      stop_price: editing.order_type === "STOP" ? value : undefined,
    });
    setEditing(null);
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-xl bg-[#080c11] shadow-panel ring-1 ring-inset ring-white/10">
      <div className="flex min-h-14 items-center justify-between border-b border-white/[0.08] px-4">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-white">Pending orders</h2>
          <p className="text-[11px] text-slate-400">Working instructions</p>
        </div>
        <span className="text-[11px] font-medium text-slate-400">{pending.length} active</span>
      </div>
      <div>
        {pending.map((order, index) => (
          <div key={order.id} className={`px-4 py-3 text-sm ${index > 0 ? "border-t border-white/[0.06]" : ""}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={`font-semibold ${order.side === "BUY" ? "text-emerald-300" : "text-rose-300"}`}>
                  {order.side} {order.order_type}
                </div>
                <div className="text-xs text-slate-400">
                  Qty {order.quantity?.toLocaleString() ?? `${order.risk_percent ?? "risk"}% risk`} · Entry{" "}
                  {formatPrice(entryPrice(order))}
                </div>
              </div>
              <div className="flex gap-2">
                <button aria-label={`Edit ${order.side} ${order.order_type} order`} className="icon-button h-8 w-8" onClick={() => beginEdit(order)} type="button">
                  <Pencil size={14} />
                </button>
                <button aria-label={`Cancel ${order.side} ${order.order_type} order`} className="icon-button h-8 w-8" onClick={() => void cancelOrder(order.id)} type="button">
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 border-t border-white/[0.06] pt-3 text-xs">
              <OrderMetric data label="SL" value={formatPrice(order.stop_loss)} tone="text-rose-200" />
              <OrderMetric data label="TP" value={formatPrice(order.take_profit)} tone="text-emerald-200" />
              <OrderMetric data={riskReward(order) != null} label="R:R" value={formatRatio(order)} tone={rrTone(order)} />
              <OrderMetric label="Kind" value={order.reduce_only ? "Reduce" : "Entry"} />
            </div>
          </div>
        ))}
        {pending.length === 0 && (
          <div className="grid h-32 place-items-center text-center">
            <div>
              <p className="text-sm font-medium text-slate-300">No pending orders</p>
              <p className="mt-1 text-xs text-slate-400">Working instructions will appear here.</p>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-white/[0.08] p-3">
          <input
            aria-label={`Amended price for ${editing.side} ${editing.order_type} order`}
            className="input-control h-10"
            onChange={(event) => setPrice(event.target.value)}
            step="0.00001"
            type="number"
            value={price}
          />
          <button className="control-button" onClick={saveEdit} type="button">
            Save
          </button>
        </div>
      )}
    </section>
  );
}

function entryPrice(order: Order) {
  return order.limit_price ?? order.stop_price ?? order.filled_price;
}

function riskReward(order: Order) {
  const entry = entryPrice(order);
  if (entry == null || order.stop_loss == null || order.take_profit == null) {
    return null;
  }
  const risk =
    order.side === "BUY"
      ? entry - order.stop_loss
      : order.stop_loss - entry;
  const reward =
    order.side === "BUY"
      ? order.take_profit - entry
      : entry - order.take_profit;
  if (!Number.isFinite(risk) || !Number.isFinite(reward) || risk <= 0 || reward <= 0) {
    return null;
  }
  return reward / risk;
}

function formatRatio(order: Order) {
  const ratio = riskReward(order);
  return ratio == null ? "Invalid" : `${ratio.toFixed(2)}R`;
}

function rrTone(order: Order) {
  return riskReward(order) == null ? "text-amber-200" : "text-cyan-100";
}

function OrderMetric({
  data = false,
  label,
  value,
  tone = "text-slate-200",
}: {
  data?: boolean;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 border-r border-white/[0.06] px-2 last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className={`mt-0.5 truncate text-[11px] font-medium ${data ? "font-data" : ""} ${tone}`}>{value}</div>
    </div>
  );
}
