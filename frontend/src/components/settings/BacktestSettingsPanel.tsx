import type { ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { BACKTEST_COST_FIELDS, backtestValidation, type BacktestField } from "../../lib/backtestSettingsModel";
import { SettingRow, SettingsSection, fieldClassName } from "./SettingsPrimitives";
import { useBacktestSettings } from "./useBacktestSettings";

type Settings = ReturnType<typeof useBacktestSettings>;
export function BacktestSettingsPanel({ settings, compatibility = false }: { settings: Settings; compatibility?: boolean }) {
  const { draft, defaults, change } = settings;
  const field = compatibility ? "min-h-11 w-full min-w-0 border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50" : fieldClassName;
  const button = compatibility ? "min-h-11 border border-amber-500 px-4 text-sm hover:bg-amber-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50" : "inline-flex min-h-11 items-center gap-2 rounded-md border border-white/15 px-3 text-sm hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50";
  function row(id: string, label: string, description: string, fields: BacktestField[], children: ReactNode, effective?: string) {
    const validation = fields.map((key) => backtestValidation(key, draft[key])).find(Boolean);
    const state = settings.stateFor(fields);
    const retry = () => void settings.retry(fields);
    if (!compatibility) return <SettingRow controlId={id} label={label} description={description} effective={effective} validation={validation} saveState={state} onRetry={retry}>{children}</SettingRow>;
    return <section className="min-w-0 border-t border-stone-700 py-5" id={`setting-${id}`} data-setting-control={id}>
      <h3 className="text-base font-medium">{label}</h3><p className="mt-1 max-w-[70ch] text-sm leading-6 text-stone-300">{description}</p>
      {effective ? <p className="mt-2 text-sm text-stone-300">Effective: {effective}</p> : null}
      <div className="mt-4 max-w-xl">{children}</div>
      {validation ? <p className="mt-2 text-sm text-amber-200" id={`setting-${id}-validation`} role="alert">{validation}</p> : null}
      {state !== "idle" ? <p className="mt-2 text-sm text-stone-300" role={state === "error" ? "alert" : "status"}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed"}{state === "error" ? <button className={`${button} ml-3`} onClick={retry} type="button">Retry</button> : null}</p> : null}
    </section>;
  }
  function numeric(key: "quantity" | "riskPercent" | "commissionFixed" | "commissionPercent" | "feeFixed" | "feePercent", label: string, id: string) {
    const invalid = Boolean(backtestValidation(key, draft[key]));
    return <input aria-label={label} aria-invalid={invalid} aria-describedby={invalid ? `setting-${id}-validation` : undefined} className={field} inputMode="decimal" maxLength={100} onChange={(event) => change({ [key]: event.target.value })} value={draft[key]} />;
  }
  function costs(prefix: "commission" | "fee", label: string) {
    const modeKey = `${prefix}Mode` as const;
    const mode = draft[modeKey];
    return <fieldset className="min-w-0"><legend className={`mb-2 text-sm ${compatibility ? "text-stone-300" : "text-zinc-400"}`}>{label}</legend><div className="grid grid-cols-2 gap-2">
      <select aria-label={`${label} mode`} className={field} value={mode} onChange={(event) => change({ [modeKey]: event.target.value as "NONE" | "FIXED" | "PERCENT" }, true)}><option value="NONE">None</option><option value="FIXED">Fixed</option><option value="PERCENT">Percent</option></select>
      {mode === "NONE" ? <span className={`grid min-h-11 place-items-center text-sm ${compatibility ? "text-stone-300" : "text-zinc-400"}`}>No value</span> : numeric(`${prefix}${mode === "FIXED" ? "Fixed" : "Percent"}`, `${label} ${mode === "FIXED" ? "fixed amount" : "percentage"}`, "trading-costs")}
    </div></fieldset>;
  }
  function effectiveCost(prefix: "commission" | "fee") {
    const mode = defaults[`${prefix}Mode`];
    return mode === "NONE" ? "none" : mode === "FIXED" ? `${defaults[`${prefix}Fixed`]} fixed` : `${defaults[`${prefix}Percent`]}%`;
  }
  const content = <>
    {!settings.ready || settings.error ? <p className={`my-4 text-sm ${compatibility ? "text-amber-200" : "text-rose-300"}`} role={settings.error ? "alert" : "status"}>{settings.error ? "Backtest settings could not be loaded. Your draft is kept." : "Loading Backtest settings…"}{settings.error ? <button className={`${button} ml-3 mt-2`} disabled={settings.loading} onClick={() => void settings.reload()} type="button">Retry loading settings</button> : null}</p> : null}
    <p className={`my-4 text-sm ${compatibility ? "text-stone-300" : "text-zinc-400"}`} role="status">{settings.dirty || settings.pending ? "Draft changes not applied" : "All explicit changes applied"}</p>
    {settings.undo ? <button className={`${button} mb-4`} onClick={settings.undoChange} disabled={!settings.ready} type="button"><Undo2 aria-hidden="true" className="mr-2 inline h-4 w-4" />Undo</button> : null}
    <fieldset disabled={!settings.ready} className="min-w-0">
      {row("sizing-mode", "Order sizing mode", "Fixed quantity uses units; percent risk requires a protective stop.", ["sizingMode"], <select aria-label="Sizing mode" className={field} value={draft.sizingMode} onChange={(event) => change({ sizingMode: event.target.value as "quantity" | "risk" }, true)}><option value="quantity">Fixed quantity</option><option value="risk">Percent risk</option></select>, defaults.sizingMode === "quantity" ? "Fixed quantity" : "Percent risk")}
      {row("default-quantity", "Default quantity", "Positive units used to prefill new fixed-size orders.", ["quantity"], numeric("quantity", "Default quantity", "default-quantity"), `${defaults.quantity} units`)}
      {row("default-risk", "Default risk", "Percent of the selected balance basis used for new risk-sized orders.", ["riskPercent"], numeric("riskPercent", "Default risk percentage", "default-risk"), `${defaults.riskPercent}%`)}
      {row("risk-basis", "Risk balance basis", "Choose whether percent risk follows current equity or the original session balance.", ["riskBase"], <select aria-label="Risk basis" className={field} value={draft.riskBase} onChange={(event) => change({ riskBase: event.target.value as "CURRENT_BALANCE" | "INITIAL_BALANCE" }, true)}><option value="CURRENT_BALANCE">Current balance</option><option value="INITIAL_BALANCE">Initial balance</option></select>, defaults.riskBase === "CURRENT_BALANCE" ? "Current balance" : "Initial balance")}
      {row("trading-costs", "Commissions and fees", "Confirmed costs prefill new replay sessions. Existing sessions keep their own costs.", BACKTEST_COST_FIELDS, <div className="space-y-4">{costs("commission", "Commission")}{costs("fee", "Fee")}</div>, `Commission ${effectiveCost("commission")} · Fee ${effectiveCost("fee")}`)}
      {row("line-confirmation", "Chart-line confirmation", "Ask before dragging a chart line changes a pending order.", ["lineConfirmation"], <button aria-label="Require chart-line confirmation" aria-checked={draft.lineConfirmation} role="switch" type="button" onClick={() => change({ lineConfirmation: !draft.lineConfirmation }, true)} className={`flex h-11 w-12 items-center justify-center focus-visible:outline-none focus-visible:ring-2 ${compatibility ? "focus-visible:ring-amber-300" : "focus-visible:ring-cyan-400"}`}><span aria-hidden="true" className={`flex h-6 w-10 items-center rounded-full p-1 ${draft.lineConfirmation ? compatibility ? "justify-end bg-amber-300" : "justify-end bg-cyan-300" : "justify-start bg-zinc-500"}`}><span className="h-4 w-4 rounded-full bg-zinc-950" /></span></button>, defaults.lineConfirmation ? "Required" : "Not required")}
    </fieldset>
  </>;
  const description = "Choices save immediately; valid numeric edits save after 600 ms. Sizing prefills new orders; confirmation governs future chart-line changes; costs prefill new replay sessions.";
  return compatibility ? <section aria-labelledby="backtest-defaults-title" data-backtest-settings><div className="mt-7 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold" id="backtest-defaults-title">Replay and order defaults</h2><button className={button} disabled={!settings.ready} onClick={settings.reset} type="button">Reset section</button></div><p className="mt-2 max-w-[70ch] text-sm leading-6 text-stone-300">{description}</p>{content}</section> : <SettingsSection title="Replay and order defaults" description={description} dirty={settings.dirty} onReset={settings.ready ? settings.reset : undefined}>{content}</SettingsSection>;
}
