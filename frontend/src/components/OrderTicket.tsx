import { Send, ShieldCheck } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import type { OrderPayload, Playbook } from "../lib/api";
import { formatPrice } from "../lib/format";
import { useBacktestStore } from "../store/backtestStore";

type Props = {
  playbooks: Playbook[];
};

export function OrderTicket({ playbooks }: Props) {
  const state = useBacktestStore((store) => store.state);
  const placeOrder = useBacktestStore((store) => store.placeOrder);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [sizingMode, setSizingMode] = useState<"quantity" | "risk">("quantity");
  const [quantity, setQuantity] = useState("100000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [breakeven, setBreakeven] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [strategy, setStrategy] = useState("London Continuation");
  const [playbookId, setPlaybookId] = useState("");
  const [notes, setNotes] = useState("");

  const currentPrice = state?.current_candle?.close;
  const estimatedRiskSize = useMemo(() => {
    if (sizingMode !== "risk" || currentPrice == null || !stopLoss) {
      return null;
    }
    const risk = Math.abs(currentPrice - Number(stopLoss));
    if (!state) {
      return null;
    }
    const equity = state.session.initial_balance + state.session.realized_pnl;
    if (!Number.isFinite(risk) || risk <= 0) {
      return null;
    }
    return (equity * (Number(riskPercent) / 100)) / risk;
  }, [currentPrice, riskPercent, sizingMode, state, stopLoss]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const payload: OrderPayload = {
      side,
      order_type: orderType,
      quantity: sizingMode === "quantity" ? numberOrNull(quantity) : null,
      risk_percent: sizingMode === "risk" ? numberOrNull(riskPercent) : null,
      limit_price: orderType === "LIMIT" ? numberOrNull(limitPrice) : null,
      stop_price: orderType === "STOP" ? numberOrNull(stopPrice) : null,
      stop_loss: numberOrNull(stopLoss),
      take_profit: numberOrNull(takeProfit),
      breakeven_trigger_r: numberOrNull(breakeven),
      reduce_only: reduceOnly,
      strategy_name: strategy || null,
      playbook_id: playbookId ? Number(playbookId) : null,
      mistake_tags: [],
      notes: notes || null,
    };
    void placeOrder(payload);
  }

  return (
    <form
      className="min-w-0 rounded-md border border-white/10 bg-ink-850 p-4 shadow-panel"
      onSubmit={handleSubmit}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Order Ticket</h2>
          <p className="text-xs text-slate-500">
            {currentPrice ? `Last ${formatPrice(currentPrice)}` : "No candle"}
          </p>
        </div>
        <ShieldCheck className="text-cyan-200" size={18} />
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`segmented ${side === "BUY" ? "segmented-long" : ""}`}
            onClick={() => setSide("BUY")}
            type="button"
          >
            Long / Buy
          </button>
          <button
            className={`segmented ${side === "SELL" ? "segmented-short" : ""}`}
            onClick={() => setSide("SELL")}
            type="button"
          >
            Short / Sell
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(["MARKET", "LIMIT", "STOP"] as const).map((value) => (
            <button
              className={`segmented ${orderType === value ? "segmented-active" : ""}`}
              key={value}
              onClick={() => setOrderType(value)}
              type="button"
            >
              {value}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            className={`segmented ${sizingMode === "quantity" ? "segmented-active" : ""}`}
            onClick={() => setSizingMode("quantity")}
            type="button"
          >
            Quantity
          </button>
          <button
            className={`segmented ${sizingMode === "risk" ? "segmented-active" : ""}`}
            onClick={() => setSizingMode("risk")}
            type="button"
          >
            Risk %
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {sizingMode === "quantity" ? (
            <label className="form-field">
              <span>Quantity</span>
              <input
                className="input-control h-10"
                onChange={(event) => setQuantity(event.target.value)}
                type="number"
                value={quantity}
              />
            </label>
          ) : (
            <label className="form-field">
              <span>Risk %</span>
              <input
                className="input-control h-10"
                onChange={(event) => setRiskPercent(event.target.value)}
                type="number"
                value={riskPercent}
              />
            </label>
          )}
          <label className="form-field">
            <span>{orderType === "LIMIT" ? "Limit" : orderType === "STOP" ? "Stop" : "Trigger"}</span>
            <input
              className="input-control h-10"
              disabled={orderType === "MARKET"}
              onChange={(event) =>
                orderType === "LIMIT"
                  ? setLimitPrice(event.target.value)
                  : setStopPrice(event.target.value)
              }
              step="0.00001"
              type="number"
              value={orderType === "LIMIT" ? limitPrice : stopPrice}
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="form-field">
            <span>SL</span>
            <input
              className="input-control h-10"
              onChange={(event) => setStopLoss(event.target.value)}
              step="0.00001"
              type="number"
              value={stopLoss}
            />
          </label>
          <label className="form-field">
            <span>TP</span>
            <input
              className="input-control h-10"
              onChange={(event) => setTakeProfit(event.target.value)}
              step="0.00001"
              type="number"
              value={takeProfit}
            />
          </label>
          <label className="form-field">
            <span>BE R</span>
            <input
              className="input-control h-10"
              onChange={(event) => setBreakeven(event.target.value)}
              type="number"
              value={breakeven}
            />
          </label>
        </div>

        {estimatedRiskSize != null && (
          <div className="rounded-md bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
            Estimated size {Math.round(estimatedRiskSize).toLocaleString()}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="form-field">
            <span>Strategy</span>
            <input
              className="input-control h-10"
              onChange={(event) => setStrategy(event.target.value)}
              value={strategy}
            />
          </label>
          <label className="form-field">
            <span>Playbook</span>
            <select
              className="input-control h-10"
              onChange={(event) => setPlaybookId(event.target.value)}
              value={playbookId}
            >
              <option value="">None</option>
              {playbooks.map((playbook) => (
                <option key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="form-field">
          <span>Notes</span>
          <textarea
            className="input-control min-h-20 py-3"
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            checked={reduceOnly}
            onChange={(event) => setReduceOnly(event.target.checked)}
            type="checkbox"
          />
          Reduce only
        </label>

        <button className="control-button border-cyan-300/30 bg-cyan-300/10 text-cyan-100" type="submit">
          <Send size={17} />
          Submit Order
        </button>
      </div>
    </form>
  );
}

function numberOrNull(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
