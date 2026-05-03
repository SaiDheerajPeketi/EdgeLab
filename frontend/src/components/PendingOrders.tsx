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
                  Qty {order.quantity?.toLocaleString() ?? "risk"} · Price{" "}
                  {formatPrice(order.limit_price ?? order.stop_price)}
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
