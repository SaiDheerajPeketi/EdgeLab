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
    <section className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Pending Orders</h2>
        <span className="text-xs text-slate-500">{pending.length}</span>
      </div>
      <div className="space-y-2">
        {pending.map((order) => (
          <div key={order.id} className="rounded-md bg-ink-950 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-100">
                  {order.side} {order.order_type}
                </div>
                <div className="text-xs text-slate-500">
                  Qty {order.quantity?.toLocaleString() ?? `${order.risk_percent ?? "risk"}% risk`} · Entry{" "}
                  {formatPrice(entryPrice(order))}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="icon-button h-8 w-8" onClick={() => beginEdit(order)} type="button">
                  <Pencil size={14} />
                </button>
                <button className="icon-button h-8 w-8" onClick={() => void cancelOrder(order.id)} type="button">
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
              <OrderMetric label="SL" value={formatPrice(order.stop_loss)} tone="text-rose-200" />
              <OrderMetric label="TP" value={formatPrice(order.take_profit)} tone="text-emerald-200" />
              <OrderMetric label="R:R" value={formatRatio(order)} tone={rrTone(order)} />
              <OrderMetric label="Kind" value={order.reduce_only ? "Reduce" : "Entry"} />
            </div>
          </div>
        ))}
        {pending.length === 0 && (
          <div className="grid h-24 place-items-center rounded-md bg-ink-950 text-sm text-slate-500">
            No pending orders
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
          <input
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

function OrderMetric({ label, value, tone = "text-slate-200" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/5 bg-black/20 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
