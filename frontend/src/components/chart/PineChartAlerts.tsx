import { createContext, useContext, useId, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bell, X } from "lucide-react";
import { createPineChartAlertAccount, type PineChartAlertStore, type PineChartAlertSignal, type PineConditionFrequency } from "../../lib/pineChartAlerts";
import { ThemedSelect } from "../ThemedSelect";
import { playAlertTone, readAlertChannels } from "../../lib/alertChannels";

const AlertContext = createContext<{ store: PineChartAlertStore; generation: number } | undefined>(undefined);
export const usePineChartAlerts = () => useContext(AlertContext);
function deliver(signal: PineChartAlertSignal) {
  const channels = readAlertChannels();
  if (channels.browser) new Notification("EdgeLab indicator alert", { body: signal.message, tag: signal.id });
  if (channels.sound) playAlertTone();
}
export function PineChartAlertsProvider({ children }: { children: ReactNode }) {
  const [account] = useState(() => createPineChartAlertAccount(deliver));
  useLayoutEffect(() => account.start(), [account]);
  const generation = useSyncExternalStore(account.store.subscribe, account.store.getGeneration);
  return <AlertContext.Provider value={{ store: account.store, generation }}>{children}</AlertContext.Provider>;
}
export function PineChartAlertsPanel() {
  const context = usePineChartAlerts();
  return context ? <IndicatorAlerts store={context.store} /> : null;
}
function IndicatorAlerts({ store }: { store: PineChartAlertStore }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const heading = useId();
  return <section aria-labelledby={heading} className="border-b border-[var(--ui-border-subtle)] p-3">
    <h3 id={heading} className="text-sm font-semibold text-[var(--text-primary)]">Indicator alerts</h3>
    <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Choose an indicator condition, then enable alerts. Alerts run while this chart is open.</p>
    <div className="mt-3 divide-y divide-[var(--ui-border-subtle)]">{snapshot.sources.map(source => <div key={source.id} className="py-2">
      <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="break-words text-xs font-semibold text-[var(--text-primary)]">{source.name}</p><p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{source.symbol} · {source.timeframe}</p></div>
        <button type="button" aria-label={`${source.enabled ? "Pause" : "Enable"} alerts for ${source.name}`} aria-pressed={source.enabled} disabled={!source.ready}
          onClick={() => store.setEnabled(source.id, !source.enabled)} className="min-h-11 shrink-0 rounded-md px-3 text-xs font-semibold text-[var(--text-accent)] hover:bg-[var(--ui-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-secondary)] disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]">{source.enabled ? "Pause" : source.ready ? "Enable" : "Preparing"}</button></div>
      {source.conditions.length ? <div className="mt-3 space-y-3">
        <div className="text-xs text-[var(--text-secondary)]">Condition
          <ThemedSelect ariaLabel={`Condition for ${source.name}`} value={source.conditionId} disabled={!source.ready} className="mt-1 h-11 w-full" portal
            onChange={conditionId => store.configure(source.id, { conditionId })}
            options={[{ value: "all_calls", label: "Script messages" }, ...source.conditions.map(condition => ({ value: condition.id, label: condition.title || "Untitled condition",
              sublabel: source.conditions.filter(item => item.title === condition.title).length > 1 ? condition.message : undefined }))]} />
        </div>
        {source.conditionId !== "all_calls" ? <div className="text-xs text-[var(--text-secondary)]">Frequency
          <ThemedSelect ariaLabel={`Frequency for ${source.name}`} value={source.frequency} disabled={!source.ready} className="mt-1 h-11 w-full" portal
            onChange={frequency => store.configure(source.id, { conditionId: source.conditionId, frequency: frequency as PineConditionFrequency })}
            options={[{ value: "once", label: "Once only" }, { value: "once_per_bar", label: "Once per candle" },
              { value: "once_per_bar_close", label: "At candle close" }, { value: "all", label: "Every update" }]} />
          <span className="mt-1 block text-[11px] leading-5">Uses the indicator’s calculation candles.</span>
        </div> : null}
      </div> : null}
      {source.reason ? <p className="mt-1 text-xs leading-5 text-[var(--warning-text)]">{source.reason}</p> : null}
    </div>)}</div>
    {!snapshot.sources.length ? <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">Add a Pine indicator to the live chart to enable its alerts.</p> : null}
    {snapshot.deliveryError ? <p role="alert" className="mt-2 text-xs leading-5 text-[var(--warning-text)]">{snapshot.deliveryError}</p> : null}
    {snapshot.events.length ? <><div className="mt-4 flex items-center justify-between gap-3"><h4 className="text-xs font-semibold text-[var(--text-primary)]">Recent indicator alerts</h4><button type="button" onClick={store.clearHistory} className="min-h-11 px-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]">Clear history</button></div><ol className="divide-y divide-[var(--ui-border-subtle)]">{snapshot.events.map(event => <li key={event.id} className="py-3">{event.condition ? <p className="mb-1 break-words text-xs font-semibold text-[var(--text-primary)]">{event.condition}</p> : null}<p className="whitespace-pre-wrap break-words text-xs leading-5 text-[var(--text-primary)]">{event.message || "Indicator alert"}</p><p className="mt-1 break-words text-[11px] text-[var(--text-secondary)]">{event.name} · {event.symbol} · {event.timeframe}</p><time dateTime={new Date(event.time * 1000).toISOString()} className="mt-1 block text-[11px] tabular-nums text-[var(--text-secondary)]">{new Date(event.time * 1000).toLocaleString()}</time></li>)}</ol></> : null}
  </section>;
}
export function PineChartAlertToast() {
  const context = usePineChartAlerts();
  return context ? <AlertToast store={context.store} /> : null;
}
function AlertToast({ store }: { store: PineChartAlertStore }) {
  const { toast } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none fixed bottom-[calc(6.25rem+env(safe-area-inset-bottom))] right-4 z-[var(--layer-popover)] max-w-[min(25rem,calc(100%-2rem))] lg:bottom-4">
    {toast ? <div className="pointer-events-auto rounded-[var(--radius-lg)] bg-[var(--ui-floating)] p-3 shadow-[var(--elevation-floating)]"><div className="flex items-start gap-2"><Bell aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-accent)]" /><div className="min-w-0 flex-1"><p className="break-words text-xs font-semibold text-[var(--text-primary)]">{toast.name} · {toast.symbol}</p><p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--text-primary)]">{toast.message || "Indicator alert"}</p></div><button type="button" aria-label="Dismiss indicator alert" onClick={store.dismissToast} className="grid h-11 w-11 shrink-0 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"><X aria-hidden="true" size={16} /></button></div></div> : null}
  </div>;
}
