import { Send, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { OrderPayload, Playbook } from "../lib/api";
import type { ChartDrawing } from "../lib/charting";
import { normalizeRiskRewardDrawing } from "../lib/charting";
import { formatPrice } from "../lib/format";
import {
  hydrateOrderDefaultQuantity,
  hydrateOrderDefaultRiskPercent,
  hydrateOrderRiskBase,
  hydrateOrderSizingMode,
  loadOrderDefaultQuantity,
  loadOrderDefaultRiskPercent,
  loadOrderRiskBase,
  loadOrderSizingMode,
  type OrderCommissionMode,
  type OrderRiskBase,
  type OrderSizingMode,
  saveOrderRiskBase,
  saveOrderSizingMode,
  subscribeOrderDefaultQuantity,
  subscribeOrderDefaultRiskPercent,
  subscribeOrderRiskBase,
  subscribeOrderSizingMode,
} from "../lib/orderSettings";
import { useBacktestStore } from "../store/backtestStore";
import { ThemedSelect } from "./ThemedSelect";

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
  const [sizingMode, setSizingMode] = useState<OrderSizingMode>(() => loadOrderSizingMode());
  const [quantity, setQuantity] = useState(() => loadOrderDefaultQuantity());
  const [riskPercent, setRiskPercent] = useState(() => loadOrderDefaultRiskPercent());
  const [riskBase, setRiskBase] = useState<OrderRiskBase>(() => loadOrderRiskBase());
  const [commissionMode, setCommissionMode] = useState<OrderCommissionMode>("NONE");
  const [commissionValue, setCommissionValue] = useState("0");
  const [feeMode, setFeeMode] = useState<OrderCommissionMode>("NONE");
  const [feeValue, setFeeValue] = useState("0");
  const riskBaseHydratedRef = useRef(false);
  const sizingModeHydratedRef = useRef(false);
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
    const session = state?.session;
    setCommissionMode(session?.default_commission_mode ?? "NONE");
    setCommissionValue(formatCostValue(session?.default_commission_value));
    setFeeMode(session?.default_fee_mode ?? "NONE");
    setFeeValue(formatCostValue(session?.default_fee_value));
  }, [state?.session.id, state?.session.default_commission_mode, state?.session.default_commission_value, state?.session.default_fee_mode, state?.session.default_fee_value]);

  useEffect(() => {
    let active = true;
    void hydrateOrderSizingMode().then((nextSizingMode) => {
      if (active) {
        setSizingMode(nextSizingMode);
        sizingModeHydratedRef.current = true;
      }
    });
    const unsubscribe = subscribeOrderSizingMode((value) => {
      setSizingMode(value);
      sizingModeHydratedRef.current = true;
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sizingModeHydratedRef.current) {
      return;
    }
    void saveOrderSizingMode(sizingMode);
  }, [sizingMode]);

  useEffect(() => {
    let active = true;
    void hydrateOrderRiskBase().then((nextRiskBase) => {
      if (active) {
        setRiskBase(nextRiskBase);
        riskBaseHydratedRef.current = true;
      }
    });
    const unsubscribe = subscribeOrderRiskBase((value) => {
      setRiskBase(value);
      riskBaseHydratedRef.current = true;
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!riskBaseHydratedRef.current) {
      return;
    }
    void saveOrderRiskBase(riskBase);
  }, [riskBase]);

  useEffect(() => {
    let active = true;
    void hydrateOrderDefaultQuantity().then((nextQuantity) => {
      if (active) {
        setQuantity(nextQuantity);
      }
    });
    const unsubscribe = subscribeOrderDefaultQuantity((value) => {
      setQuantity(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void hydrateOrderDefaultRiskPercent().then((nextRiskPercent) => {
      if (active) {
        setRiskPercent(nextRiskPercent);
      }
    });
    const unsubscribe = subscribeOrderDefaultRiskPercent((value) => {
      setRiskPercent(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

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
      commission_mode: commissionMode,
      commission_value: costValueForPayload(commissionMode, commissionValue),
      fee_mode: feeMode,
      fee_value: costValueForPayload(feeMode, feeValue),
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
      aria-label="Order ticket"
      className="min-w-0 rounded-xl bg-[#080c11] p-4 shadow-panel ring-1 ring-inset ring-white/10"
      data-ui-panel="order-ticket"
      onSubmit={handleSubmit}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.01em] text-white">Order ticket</h2>
          <p className="text-xs text-slate-400">
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
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
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

        <div className="grid gap-2">
          <OrderCostControls
            mode={commissionMode}
            onModeChange={setCommissionMode}
            onValueChange={setCommissionValue}
            title="Commissions"
            value={commissionValue}
          />
          <OrderCostControls
            mode={feeMode}
            onModeChange={setFeeMode}
            onValueChange={setFeeValue}
            title="Fees"
            value={feeValue}
          />
        </div>

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
            <ThemedSelect
              ariaLabel="Order playbook"
              className="h-10"
              onChange={setPlaybookId}
              options={[
                { label: "None", value: "" },
                ...playbooks.map((playbook) => ({
                  label: playbook.name,
                  value: String(playbook.id),
                })),
              ]}
              value={playbookId}
            />
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

function costValueForPayload(mode: OrderCommissionMode, value: string) {
  if (mode === "NONE") {
    return 0;
  }
  return numberOrNull(value) ?? 0;
}

function formatCostValue(value: number | null | undefined) {
  return String(Number.isFinite(value) ? value : 0);
}

function OrderCostControls({
  mode,
  onModeChange,
  onValueChange,
  title,
  value,
}: {
  mode: OrderCommissionMode;
  onModeChange: (value: OrderCommissionMode) => void;
  onValueChange: (value: string) => void;
  title: string;
  value: string;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-black/20 p-2">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {([
          { label: "None", value: "NONE" },
          { label: "Fixed", value: "FIXED" },
          { label: "Percent", value: "PERCENT" },
        ] as Array<{ label: string; value: OrderCommissionMode }>).map((option) => (
          <button
            className={`segmented ${mode === option.value ? "segmented-active" : ""}`}
            key={option.value}
            onClick={() => onModeChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode !== "NONE" && (
        <label className="form-field mt-2">
          <span>{mode === "FIXED" ? "Fixed amount" : "Percent amount"}</span>
          <input
            className="input-control h-10"
            min="0"
            onChange={(event) => onValueChange(event.target.value)}
            step={mode === "FIXED" ? "0.01" : "0.0001"}
            type="number"
            value={value}
          />
        </label>
      )}
    </section>
  );
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
