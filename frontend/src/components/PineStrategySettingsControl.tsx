import { useId } from "react";
import { ThemedSelect } from "./ThemedSelect";
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
  ["process_orders_on_close", "Market order timing", [["false", "Next price update"], ["true", "Candle close"]]],
  ["calc_on_every_tick", "Live calculation", [["false", "At candle close"], ["true", "Every price update"]]],
  ["calc_on_order_fills", "Recalculate after fills", [["false", "No extra calculations"], ["true", "After each fill"]]],
  ["use_bar_magnifier", "Historical bar detail", [["false", "Chart candles"], ["true", "Loaded smaller candles"]]],
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
  return <details className="mt-5 min-w-0 border-y border-[var(--ui-border-subtle)] py-2">
    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ui-focus)]">Strategy test settings</summary>
    <div className="mt-2 space-y-4">
      <p className="text-xs leading-5 text-[var(--text-secondary)]">Set the trading assumptions for this strategy. Blank fields use its script defaults. {scope === "chart" ? "Changes apply to this chart instance; your saved library stays unchanged." : "Saving keeps your settings with the strategy."}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {numbers.map(([key, label, min, max, step]) => {
          let invalid = false;
          try { validatePineStrategySettings(value[key] === undefined ? {} : { [key]: value[key] }); } catch { invalid = true; }
          return <label className="grid min-w-0 gap-1 text-xs text-[var(--text-primary)]" key={key}><span>{label}</span>
            <input aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} className="input-control min-h-11 w-full font-mono text-sm tabular-nums" min={min} max={max} step={step} type="number" placeholder="Script default" value={Number.isFinite(value[key]) ? value[key] : ""} onChange={(event) => update(key, event.currentTarget.validity.badInput ? NaN : event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value))} />
          </label>;
        })}
        {selects.map(([key, label, options]) => <div className="grid min-w-0 gap-1 text-xs text-[var(--text-primary)]" key={key}><span>{label}</span>
          <ThemedSelect ariaLabel={label} className="min-h-11 w-full text-sm" portal value={value[key] === undefined ? "" : String(value[key])}
            options={[{ value: "", label: "Script default" }, ...options.map(([id, text]) => ({ value: id, label: text }))]}
            onChange={(next) => update(key, next === "" ? undefined : ["process_orders_on_close", "calc_on_every_tick", "calc_on_order_fills", "use_bar_magnifier"].includes(key) ? next === "true" : next)} />
        </div>)}
      </div>
      {validationError ? <p id={errorId} role="alert" className="text-xs leading-5 text-[var(--loss-text)]">{validationError}</p> : null}
      <p className="text-xs leading-5 text-[var(--text-secondary)]">Order size applies when the script leaves quantity unspecified. Cash and capital use its account currency; currency conversion is unavailable. Slippage is a number of price ticks, not a percentage.</p>
      <p className="text-xs leading-5 text-[var(--text-secondary)]">Entry limits apply to entry orders: 0 or 1 allows one entry; higher values allow multiple entries in the same direction. Candle-close timing applies to market orders and does not add extra script calculations.</p>
      <p className="text-xs leading-5 text-[var(--text-secondary)]">Live calculation follows received price updates. Historical runs still calculate at candle close. A new market order normally fills on the next price update, which is the next candle’s open in a historical run.</p>
      <p className="text-xs leading-5 text-[var(--text-secondary)]">Higher historical detail follows the loaded smaller candles for fills. Missing or incomplete coverage uses chart-candle assumptions and is disclosed with the results. Recalculating after fills can run your strategy several times in a candle; historical calculations still see the chart candle’s final prices.</p>
      <button className="studio-tool-button min-h-11" disabled={!Object.keys(value).length} onClick={() => onChange({})} type="button">Use script defaults</button>
    </div>
  </details>;
}
