import { Send, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { OrderPayload, Playbook } from "../lib/api";
import type { ChartDrawing } from "../lib/charting";
import { normalizeRiskRewardDrawing } from "../lib/charting";
import { formatPrice } from "../lib/format";
import { useBacktestStore } from "../store/backtestStore";

const RISK_BASE_STORAGE_KEY = "tradezella.order-risk-base.v1";
type RiskBase = "CURRENT_BALANCE" | "INITIAL_BALANCE";

type Props = {
  initialSide?: "BUY" | "SELL" | null;
  onOrderPlaced?: () => void;
  playbooks: Playbook[];
  riskRewardDrawing?: ChartDrawing | null;
};

export function OrderTicket({
  initialSide,
  onOrderPlaced,
  playbooks,
  riskRewardDrawing,
}: Props) {
  const state = useBacktestStore((store) => store.state);
  const placeOrder = useBacktestStore((store) => store.placeOrder);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP">("MARKET");
  const [sizingMode, setSizingMode] = useState<"quantity" | "risk">("quantity");
  const [quantity, setQuantity] = useState("100000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [riskBase, setRiskBase] = useState<RiskBase>(() => loadRiskBase());
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [breakeven, setBreakeven] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [playbookId, setPlaybookId] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentPrice = state?.current_candle?.close;
  const sessionStrategy = state?.session.strategy_name?.trim() ?? "";
  const sessionStrategyLabel = sessionStrategy || "Unassigned";
  const riskRewardValues = useMemo(
    () => extractRiskRewardOrderValues(riskRewardDrawing, currentPrice),
    [currentPrice, riskRewardDrawing],
  );
  const entryReferencePrice = useMemo(() => {
    if (orderType === "LIMIT") {
      return numberOrNull(limitPrice);
    }
    if (orderType === "STOP") {
      return numberOrNull(stopPrice);
    }
    return currentPrice ?? null;
  }, [currentPrice, limitPrice, orderType, stopPrice]);
  const estimatedRiskSize = useMemo(() => {
    if (sizingMode !== "risk" || entryReferencePrice == null || !stopLoss) {
      return null;
    }
    const risk = Math.abs(entryReferencePrice - Number(stopLoss));
    if (!state) {
      return null;
    }
    const currentBalance = state.session.initial_balance + state.session.realized_pnl;
    const baseBalance =
      riskBase === "INITIAL_BALANCE" ? state.session.initial_balance : currentBalance;
    const sizingEquity = baseBalance > 0 ? baseBalance : state.session.initial_balance;
    if (!Number.isFinite(risk) || risk <= 0) {
      return null;
    }
    return (sizingEquity * (Number(riskPercent) / 100)) / risk;
  }, [entryReferencePrice, riskBase, riskPercent, sizingMode, state, stopLoss]);

  useEffect(() => {
    if (!riskRewardValues) {
      return;
    }
    setSide(riskRewardValues.side);
    setOrderType(riskRewardValues.orderType);
    setLimitPrice(riskRewardValues.orderType === "LIMIT" ? riskRewardValues.entry : "");
    setStopPrice(riskRewardValues.orderType === "STOP" ? riskRewardValues.entry : "");
    setStopLoss(riskRewardValues.stopLoss);
    setTakeProfit(riskRewardValues.takeProfit);
  }, [riskRewardValues]);

  useEffect(() => {
    if (initialSide) {
      setSide(initialSide);
    }
  }, [initialSide]);

  useEffect(() => {
    setPlaybookId(state?.session.playbook_id ? String(state.session.playbook_id) : "");
  }, [state?.session.id, state?.session.playbook_id]);

  useEffect(() => {
    window.localStorage.setItem(RISK_BASE_STORAGE_KEY, riskBase);
  }, [riskBase]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    const payload: OrderPayload = {
      side,
      order_type: orderType,
      quantity: sizingMode === "quantity" ? numberOrNull(quantity) : null,
      risk_percent: sizingMode === "risk" ? numberOrNull(riskPercent) : null,
      risk_base: sizingMode === "risk" ? riskBase : null,
      limit_price: orderType === "LIMIT" ? numberOrNull(limitPrice) : null,
      stop_price: orderType === "STOP" ? numberOrNull(stopPrice) : null,
      stop_loss: numberOrNull(stopLoss),
      take_profit: numberOrNull(takeProfit),
      breakeven_trigger_r: numberOrNull(breakeven),
      reduce_only: reduceOnly,
      strategy_name: sessionStrategy || null,
      playbook_id: playbookId ? Number(playbookId) : null,
      mistake_tags: [],
      notes: notes || null,
    };
    setIsSubmitting(true);
    const placed = await placeOrder(payload);
    setIsSubmitting(false);
    if (placed) {
      onOrderPlaced?.();
    }
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

        {sizingMode === "risk" && (
          <div className="rounded-md border border-white/10 bg-black/20 p-2">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Risk % based on
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`segmented ${riskBase === "CURRENT_BALANCE" ? "segmented-active" : ""}`}
                onClick={() => setRiskBase("CURRENT_BALANCE")}
                type="button"
              >
                Current balance
              </button>
              <button
                className={`segmented ${riskBase === "INITIAL_BALANCE" ? "segmented-active" : ""}`}
                onClick={() => setRiskBase("INITIAL_BALANCE")}
                type="button"
              >
                Initial balance
              </button>
            </div>
          </div>
        )}

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

        {riskRewardValues && (
          <div className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs text-emerald-100">
            Synced from latest RR: Entry {riskRewardValues.entry} · SL{" "}
            {riskRewardValues.stopLoss} · TP {riskRewardValues.takeProfit} ·{" "}
            {riskRewardValues.ratio.toFixed(2)}R
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="form-field">
            <span>Strategy</span>
            <input
              className="input-control h-10 cursor-not-allowed border-cyan-300/20 bg-cyan-300/5 text-cyan-100"
              readOnly
              title="Orders inherit the current session strategy"
              value={sessionStrategyLabel}
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

        <button
          className="control-button border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
          disabled={isSubmitting}
          type="submit"
        >
          <Send size={17} />
          {isSubmitting ? "Submitting" : "Submit Order"}
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

function loadRiskBase(): RiskBase {
  if (typeof window === "undefined") {
    return "CURRENT_BALANCE";
  }
  const saved = window.localStorage.getItem(RISK_BASE_STORAGE_KEY);
  return saved === "INITIAL_BALANCE" ? "INITIAL_BALANCE" : "CURRENT_BALANCE";
}

function extractRiskRewardOrderValues(
  drawing: ChartDrawing | null | undefined,
  currentPrice: number | undefined,
) {
  if (
    !drawing ||
    (drawing.tool !== "longPosition" && drawing.tool !== "shortPosition") ||
    drawing.points.length < 2
  ) {
    return null;
  }

  const normalizedDrawing = normalizeRiskRewardDrawing(drawing);
  const side: "BUY" | "SELL" =
    normalizedDrawing.tool === "longPosition" ? "BUY" : "SELL";
  const entry = normalizedDrawing.points[0].price;
  const takeProfit = normalizedDrawing.points[1].price;
  const stopLoss = normalizedDrawing.points[2].price;
  const orderType = inferEntryOrderType(side, entry, currentPrice);
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  return {
    entry: priceInputValue(entry),
    orderType,
    ratio: risk > 0 ? reward / risk : 0,
    side,
    stopLoss: priceInputValue(stopLoss),
    takeProfit: priceInputValue(takeProfit),
  };
}

function inferEntryOrderType(
  side: "BUY" | "SELL",
  entry: number,
  currentPrice: number | undefined,
): "LIMIT" | "STOP" {
  if (currentPrice == null || !Number.isFinite(currentPrice)) {
    return "LIMIT";
  }
  if (side === "BUY") {
    return entry <= currentPrice ? "LIMIT" : "STOP";
  }
  return entry >= currentPrice ? "LIMIT" : "STOP";
}

function priceInputValue(value: number) {
  return Number.isFinite(value) ? formatPrice(value) : "";
}
