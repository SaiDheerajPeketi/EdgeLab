import { useId } from "react";
import { validatePineStrategySettings, type PineStrategySettings } from "../lib/pineProtocol";

type Props = { value: PineStrategySettings; onChange(value: PineStrategySettings): void; error?: string | null; scope?: "library" | "chart" };
const numbers = [
  ["initial_capital", "Starting capital", 0, 1e12, "any"],
  ["default_qty_value", "Order size", 0, 1e9, "any"],
  ["commission_value", "Commission", 0, 1e9, "any"],
  ["slippage", "Slippage (ticks)", 0, 10_000, 1],
  ["pyramiding", "Entries in same direction", 0, 1_000, 1],
] as const;
const selects = [
  ["default_qty_type", "Position sizing", [["fixed", "Contracts or units"], ["cash", "Cash amount"], ["percent_of_equity", "Percent of equity"]]],
  ["commission_type", "Commission type", [["percent", "Percent of order value"], ["cash_per_contract", "Per contract or unit"], ["cash_per_order", "Per order"]]],
  ["process_orders_on_close", "Market order timing", [["false", "Next candle open"], ["true", "Candle close"]]],
] as const;

export function PineStrategySettingsControl({ value, onChange, error, scope = "library" }: Props) {
  const errorId = useId();
  let validationError = error;
  try { validatePineStrategySettings(value); } catch (cause) { validationError = cause instanceof Error ? cause.message : "Check your strategy test settings."; }
  function update(key: keyof PineStrategySettings, next: number | string | boolean | undefined) {
    const settings = { ...value };
    if (next === undefined) delete settings[key];
    else Object.assign(settings, { [key]: next });
    onChange(settings);
  }
  return <details className="mt-5 min-w-0 border-y border-white/10 py-2">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Strategy test settings</summary>
    <div className="mt-2 space-y-4">
      <p className="text-xs leading-5 text-slate-300">Set the trading assumptions for this strategy. Blank fields use its script defaults. {scope === "chart" ? "Changes apply to this chart instance; your saved library stays unchanged." : "Saving keeps your settings with the strategy."}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {numbers.map(([key, label, min, max, step]) => {
          let invalid = false;
          try { validatePineStrategySettings(value[key] === undefined ? {} : { [key]: value[key] }); } catch { invalid = true; }
          return <label className="grid min-w-0 gap-1 text-xs text-slate-200" key={key}><span>{label}</span>
            <input aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} className="input-control min-h-11 w-full font-mono text-sm tabular-nums" min={min} max={max} step={step} type="number" placeholder="Script default" value={Number.isFinite(value[key]) ? value[key] : ""} onChange={(event) => update(key, event.currentTarget.validity.badInput ? NaN : event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value))} />
          </label>;
        })}
        {selects.map(([key, label, options]) => <label className="grid min-w-0 gap-1 text-xs text-slate-200" key={key}><span>{label}</span>
          <select className="input-control min-h-11 w-full text-sm" value={value[key] === undefined ? "" : String(value[key])} onChange={(event) => update(key, event.target.value === "" ? undefined : key === "process_orders_on_close" ? event.target.value === "true" : event.target.value)}>
            <option value="">Script default</option>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </label>)}
      </div>
      {validationError ? <p id={errorId} role="alert" className="text-xs leading-5 text-rose-200">{validationError}</p> : null}
      <p className="text-xs leading-5 text-slate-300">Order size applies when the script leaves quantity unspecified. Cash and capital use its account currency; currency conversion is unavailable. Slippage is a number of price ticks, not a percentage.</p>
      <p className="text-xs leading-5 text-slate-300">Entry limits apply to entry orders: 0 or 1 allows one entry; higher values allow multiple entries in the same direction. Candle-close timing applies to market orders and does not add extra script calculations.</p>
      <button className="studio-tool-button min-h-11" disabled={!Object.keys(value).length} onClick={() => onChange({})} type="button">Use script defaults</button>
    </div>
  </details>;
}
