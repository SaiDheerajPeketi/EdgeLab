import type { ReactNode } from "react";
import { Undo2 } from "lucide-react";
import type { ChartSettingsDraft } from "../../lib/chartSettingsDraft";
import { SettingRow, SettingsSection, fieldClassName, type SaveState } from "./SettingsPrimitives";
import type { useChartSettings } from "./useChartSettings";
import type { useSettingsPreferences } from "./useSettingsPreferences";

type Chart = ReturnType<typeof useChartSettings>;
type Preferences = ReturnType<typeof useSettingsPreferences>;
export function ChartSettingsPanel({ settings, preferences, appearance = false, compatibility = false }: { settings: Chart; preferences: Preferences; appearance?: boolean; compatibility?: boolean }) {
  const field = compatibility ? "min-h-11 w-full min-w-0 border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50" : `${fieldClassName} min-h-11`;
  const button = compatibility ? "min-h-11 border border-amber-500 px-4 text-sm hover:bg-amber-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50" : "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-white/15 px-3 text-sm hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50";
  const muted = compatibility ? "text-stone-300" : "text-zinc-400";
  const invalid = compatibility ? "text-amber-200" : "text-rose-300";
  const chartId = appearance ? "palette-preview" : "chart-preset";
  const { draft, change } = settings;
  function row(id: string, label: string, description: string, state: SaveState, retry: () => void, children: ReactNode, effective?: string, validation?: string | null) {
    if (!compatibility) return <SettingRow controlId={id} label={label} description={description} scope={id === "settings-density" ? "Personal" : "Workspace"} saveState={state} onRetry={retry} effective={effective} validation={validation}>{children}</SettingRow>;
    return <section className="min-w-0 border-t border-stone-700 py-5" data-setting-control={id} id={`setting-${id}`}>
      <h3 className="text-base font-medium">{label}</h3><p className={`mt-1 max-w-[70ch] text-sm leading-6 ${muted}`}>{description}</p>
      {effective ? <p className={`mt-2 text-sm ${muted}`}>Effective: {effective}</p> : null}
      {validation ? <p className={`mt-2 text-sm ${invalid}`} role="alert" id={`setting-${id}-validation`}>{validation}</p> : null}
      {state !== "idle" ? <p className={`mt-2 text-sm ${muted}`} role={state === "error" ? "alert" : "status"}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed"}{state === "error" ? <button className={`${button} ml-3`} type="button" onClick={retry}>Retry</button> : null}</p> : null}
      <div className="mt-4 max-w-xl">{children}</div>
    </section>;
  }
  const undo = appearance ? preferences.undo : settings.undo;
  const content = <>
    {undo ? <div className={`my-4 flex flex-wrap items-center justify-between gap-3 border-y ${compatibility ? "border-amber-500/40" : "border-cyan-400/20"} py-3 text-sm`}><span>{appearance ? "Settings density changed" : "Chart defaults reset"}</span><button className={button} onClick={appearance ? preferences.undoChange : settings.undoChange} type="button"><Undo2 className="h-4 w-4" aria-hidden="true" />Undo</button></div> : null}
    {appearance ? <>
      {!preferences.ready || preferences.error ? <p className={`my-4 text-sm ${invalid}`} role={preferences.error ? "alert" : "status"}>{preferences.error ? "Preferences could not be loaded. Your draft is kept." : "Loading preferences…"}{preferences.error ? <button className={`${button} ml-3 mt-2`} disabled={preferences.loading} onClick={() => void preferences.reload()} type="button">Retry loading preferences</button> : null}</p> : null}
      {row("settings-density", "Settings density", "Preview row spacing immediately. Your saved preference changes after the server confirms it.", preferences.stateFor("density"), () => void preferences.retry("density"), <select aria-label="Settings density" className={field} disabled={!preferences.ready} value={preferences.draft.density} onChange={(event) => preferences.change({ density: event.target.value as "comfortable" | "compact" })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>, preferences.defaults.density)}
    </> : null}
    {!settings.ready || settings.error ? <p className={`my-4 text-sm ${invalid}`} role={settings.error ? "alert" : "status"}>{settings.error ? "Chart settings could not be loaded. Your draft is kept." : "Loading chart settings…"}{settings.error ? <button className={`${button} ml-3 mt-2`} disabled={settings.loading} onClick={() => void settings.reload()} type="button">Retry loading chart settings</button> : null}</p> : null}
    {row(chartId, appearance ? "Palette and display preview" : "Chart visual preset", "Edit Settings default. A new preset starts from the active chart. Apply saves the staged display and palette controls and activates Settings default for the next workspace load.", settings.saveState, () => void settings.save(), <fieldset disabled={!settings.ready} className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`text-sm ${muted}`}>Hours<select aria-label="Hours" className={`${field} mt-1`} value={draft.timeHoursFormat} onChange={(event) => change({ timeHoursFormat: event.target.value as ChartSettingsDraft["timeHoursFormat"] })}><option value="12-hour">12-hour</option><option value="24-hour">24-hour</option></select></label>
        <label className={`text-sm ${muted}`}>Date format<select aria-label="Date format" className={`${field} mt-1`} value={draft.dateFormat} onChange={(event) => change({ dateFormat: event.target.value as ChartSettingsDraft["dateFormat"] })}><option value="dd MMM yy">31 Dec 26</option><option value="MMM dd yyyy">Dec 31 2026</option><option value="yyyy-MM-dd">2026-12-31</option></select></label>
        <label className={`text-sm ${muted}`}>Text size<input aria-label="Text size" aria-invalid={Boolean(settings.validation)} aria-describedby={settings.validation ? `setting-${chartId}-validation` : undefined} className={`${field} mt-1`} inputMode="numeric" maxLength={100} value={draft.textSize} onChange={(event) => change({ textSize: event.target.value })} /></label>
        <label className={`text-sm ${muted}`}>Grid<select aria-label="Grid" className={`${field} mt-1`} value={draft.gridMode} onChange={(event) => change({ gridMode: event.target.value as ChartSettingsDraft["gridMode"] })}><option value="both">Horizontal and vertical</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="none">None</option></select></label>
      </div>
      <div className={`grid grid-cols-2 gap-3 ${compatibility ? "sm:grid-cols-5" : "sm:grid-cols-3"}`}>{([['backgroundColor','Background'],['textColor','Text color'],['gridColor','Grid color'],['candleUpColor','Up'],['candleDownColor','Down']] as const).map(([key, label]) => <label key={key} className={`text-sm ${muted}`}>{label}<input aria-label={label} type="color" value={draft[key]} onChange={(event) => change({ [key]: event.target.value })} className={`mt-1 min-h-11 w-full cursor-pointer border ${compatibility ? "border-stone-600" : "rounded border-white/15"} bg-transparent p-1`} /></label>)}</div>
      <div className="overflow-hidden rounded-md border border-white/15 p-3" style={{ backgroundColor: draft.backgroundColor, color: draft.textColor }} aria-label="Staged chart palette preview"><div className="relative h-24" style={{ backgroundImage: [draft.gridMode === "both" || draft.gridMode === "horizontal" ? `linear-gradient(${draft.gridColor} 1px, transparent 1px)` : null, draft.gridMode === "both" || draft.gridMode === "vertical" ? `linear-gradient(90deg, ${draft.gridColor} 1px, transparent 1px)` : null].filter(Boolean).join(", ") || undefined, backgroundSize: "28px 20px" }}>{[18,35,52,69].map((left, index) => <div key={left} className="absolute bottom-4 w-2" style={{ left: `${left}%`, height: [36,28,40,24][index], backgroundColor: index % 2 ? draft.candleDownColor : draft.candleUpColor }} />)}<span className="absolute left-2 top-1" style={{ fontSize: settings.validation ? 12 : Number(draft.textSize) }}>Preview</span></div></div>
      <button type="button" className={`${button} w-full ${compatibility ? "bg-amber-200 text-amber-950 hover:bg-amber-100" : "bg-white font-semibold text-zinc-950 hover:bg-zinc-200"}`} disabled={!settings.dirty || settings.pending || Boolean(settings.validation)} onClick={() => void settings.save()}>{appearance ? "Apply palette preset" : "Apply as active preset"}</button>
    </fieldset>, "Active on next workspace load", settings.validation)}
  </>;
  const title = appearance ? "Interface presentation" : "Staged chart preset";
  const description = appearance ? "Density saves immediately. Display and palette choices stay staged until you apply them. Reset changes density only." : "Applying saves an active preset for the next workspace load; the chart currently in use keeps its settings. Reset stages the nine controls shown here.";
  const ready = appearance ? preferences.ready : settings.ready;
  const reset = appearance ? () => preferences.reset("density") : settings.reset;
  return compatibility ? <section data-chart-settings aria-labelledby="chart-settings-title"><div className="mt-7 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold" id="chart-settings-title">{title}</h2><button type="button" className={button} disabled={!ready} onClick={reset}>Reset section</button></div><p className={`mt-2 max-w-[70ch] text-sm leading-6 ${muted}`}>{description}</p>{content}</section> : <SettingsSection title={title} description={description} dirty={appearance ? preferences.dirty : settings.dirty} onReset={ready ? reset : undefined}>{content}</SettingsSection>;
}
