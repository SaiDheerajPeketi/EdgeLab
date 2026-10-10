import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ThemedColorPicker } from "../ThemedColorPicker";
import { Undo2 } from "lucide-react";
import type { ChartSettingsDraft } from "../../lib/chartSettingsDraft";
import { SettingRow, SettingsSection, SettingsSelect, fieldClassName, type SaveState } from "./SettingsPrimitives";
import type { useChartSettings } from "./useChartSettings";
import type { useSettingsPreferences } from "./useSettingsPreferences";

type Chart = ReturnType<typeof useChartSettings>;
type Preferences = ReturnType<typeof useSettingsPreferences>;
const PALETTE_FIELDS = [['backgroundColor', 'Background'], ['textColor', 'Text color'], ['gridColor', 'Grid color'], ['candleUpColor', 'Up'], ['candleDownColor', 'Down']] as const;
type PaletteField = typeof PALETTE_FIELDS[number][0];
type PaletteErrors = Partial<Record<PaletteField, string>>;
export function ChartSettingsPanel({ settings, preferences, appearance = false, compatibility = false, onLocalDraftDirty }: { settings: Chart; preferences: Preferences; appearance?: boolean; compatibility?: boolean; onLocalDraftDirty?: (dirty: boolean) => void }) {
  const field = compatibility ? "min-h-11 w-full min-w-0 border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50" : `${fieldClassName} min-h-11`;
  const button = compatibility ? "min-h-11 border border-amber-500 px-4 text-sm hover:bg-amber-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50" : "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--ui-border-strong)] px-3 text-sm hover:bg-[var(--ui-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] disabled:opacity-50";
  const muted = compatibility ? "text-stone-300" : "text-[var(--text-secondary)]";
  const invalid = compatibility ? "text-[var(--warning-text)]" : "text-[var(--loss-text)]";
  const chartId = appearance ? "palette-preview" : "chart-preset";
  const { draft, change } = settings;
  const [paletteErrors, setPaletteErrors] = useState<PaletteErrors>({});
  const paletteErrorsRef = useRef<PaletteErrors>({});
  const [paletteResetKey, setPaletteResetKey] = useState(0);
  const reportValidation = useCallback((key: PaletteField, error: string | null) => {
    const previous = paletteErrorsRef.current;
    if ((previous[key] ?? null) === error) return;
    const next = { ...previous };
    if (error) next[key] = error; else delete next[key];
    paletteErrorsRef.current = next;
    setPaletteErrors(next);
  }, []);
  const validationCallbacks = useMemo(() => Object.fromEntries(PALETTE_FIELDS.map(([key]) => [key, (error: string | null) => reportValidation(key, error)])) as Record<PaletteField, (error: string | null) => void>, [reportValidation]);
  const hasPaletteErrors = Object.keys(paletteErrors).length > 0;
  const localDirtyCallbackRef = useRef(onLocalDraftDirty);
  localDirtyCallbackRef.current = onLocalDraftDirty;
  useEffect(() => { localDirtyCallbackRef.current?.(hasPaletteErrors); }, [hasPaletteErrors]);
  useEffect(() => () => localDirtyCallbackRef.current?.(false), []);
  const paletteValidation = PALETTE_FIELDS.filter(([key]) => paletteErrors[key]).map(([, label]) => label).join(", ");
  function savePreset() {
    if (!settings.ready || Object.keys(paletteErrorsRef.current).length) return;
    void settings.save();
  }
  function changeColor(key: PaletteField, value: string) {
    // Hex letter case alone is not an explicit palette edit.
    if (value.toUpperCase() !== draft[key].toUpperCase()) change({ [key]: value.toLowerCase() });
  }
  function discardPaletteDrafts() {
    paletteErrorsRef.current = {};
    setPaletteErrors({});
    setPaletteResetKey((key) => key + 1);
  }
  function undoChange() {
    if (appearance) preferences.undoChange();
    else { discardPaletteDrafts(); settings.undoChange(); }
  }
  useEffect(() => {
    if (!hasPaletteErrors) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [hasPaletteErrors]);
  function row(id: string, label: string, description: string, state: SaveState, retry: (() => void) | undefined, children: ReactNode, effective?: string, validation?: string | null) {
    if (!compatibility) return <SettingRow controlId={id} label={label} description={description} scope={id === "settings-density" || id === "app-theme" ? "Personal" : "Workspace"} saveState={state} onRetry={retry} effective={effective} validation={validation}>{children}</SettingRow>;
    return <section className="min-w-0 border-t border-stone-700 py-5" data-setting-control={id} id={`setting-${id}`}>
      <h3 className="text-base font-medium">{label}</h3><p className={`mt-1 max-w-[70ch] text-sm leading-6 ${muted}`}>{description}</p>
      {effective ? <p className={`mt-2 text-sm ${muted}`}>Effective: {effective}</p> : null}
      {validation ? <p className={`mt-2 text-sm ${invalid}`} role="alert" id={`setting-${id}-validation`}>{validation}</p> : null}
      {state !== "idle" ? <p className={`mt-2 text-sm ${muted}`} role={state === "error" ? "alert" : "status"}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed"}{state === "error" && retry ? <button className={`${button} ml-3`} type="button" onClick={retry}>Retry</button> : null}</p> : null}
      <div className="mt-4 max-w-xl">{children}</div>
    </section>;
  }
  const undo = appearance ? preferences.undo : settings.undo;
  const content = <>
    {undo ? <div className={`my-4 flex flex-wrap items-center justify-between gap-3 border-y ${compatibility ? "border-amber-500/40" : "border-[var(--ui-border-subtle)]"} py-3 text-sm`}><span>{appearance ? "Appearance preference changed" : "Chart defaults reset"}</span><button className={button} onClick={undoChange} type="button"><Undo2 className="h-4 w-4" aria-hidden="true" />Undo</button></div> : null}
    {appearance ? <>
      {!preferences.ready || preferences.error ? <p className={`my-4 text-sm ${invalid}`} role={preferences.error ? "alert" : "status"}>{preferences.error ? "Preferences could not be loaded. Your draft is kept." : "Loading preferences…"}{preferences.error ? <button className={`${button} ml-3 mt-2`} disabled={preferences.loading} onClick={() => void preferences.reload()} type="button">Retry loading preferences</button> : null}</p> : null}
      {row("app-theme", "App theme", "Choose dark or light for the workspace. System follows your device appearance, including changes while EdgeLab is open. Chart palette presets remain independent.", preferences.stateFor("appTheme"), () => void preferences.retry("appTheme"), <SettingsSelect ariaLabel="App theme" nativeClassName={field} disabled={!preferences.ready} value={preferences.draft.appTheme} onChange={(value) => preferences.change({ appTheme: value as "dark" | "light" | "system" })} compatibility={compatibility} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />, preferences.defaults.appTheme)}
      {row("settings-density", "Settings density", "Preview row spacing immediately. Your saved preference changes after the server confirms it.", preferences.stateFor("density"), () => void preferences.retry("density"), <SettingsSelect ariaLabel="Settings density" nativeClassName={field} disabled={!preferences.ready} value={preferences.draft.density} onChange={(value) => preferences.change({ density: value as "comfortable" | "compact" })} compatibility={compatibility} options={[{"value": "comfortable", "label": "Comfortable"}, {"value": "compact", "label": "Compact"}]} />, preferences.defaults.density)}
    </> : null}
    {!settings.ready || settings.error ? <p className={`my-4 text-sm ${invalid}`} role={settings.error ? "alert" : "status"}>{settings.error ? "Chart settings could not be loaded. Your draft is kept." : "Loading chart settings…"}{settings.error ? <button className={`${button} ml-3 mt-2`} disabled={settings.loading} onClick={() => void settings.reload()} type="button">Retry loading chart settings</button> : null}</p> : null}
    {row(chartId, appearance ? "Palette and display preview" : "Chart visual preset", "Edit Settings default. A new preset starts from the active chart. Apply saves the staged display and palette controls and activates Settings default for the next workspace load.", hasPaletteErrors && settings.saveState === "saved" ? "idle" : settings.saveState, hasPaletteErrors ? undefined : savePreset, <fieldset disabled={!settings.ready} className="min-w-0 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`text-sm ${muted}`}>Hours<SettingsSelect ariaLabel="Hours" nativeClassName={field} className="mt-1" value={draft.timeHoursFormat} onChange={(value) => change({ timeHoursFormat: value as ChartSettingsDraft["timeHoursFormat"] })} disabled={!settings.ready} compatibility={compatibility} options={[{"value": "12-hour", "label": "12-hour"}, {"value": "24-hour", "label": "24-hour"}]} /></label>
        <label className={`text-sm ${muted}`}>Date format<SettingsSelect ariaLabel="Date format" nativeClassName={field} className="mt-1" value={draft.dateFormat} onChange={(value) => change({ dateFormat: value as ChartSettingsDraft["dateFormat"] })} disabled={!settings.ready} compatibility={compatibility} options={[{"value": "dd MMM yy", "label": "31 Dec 26"}, {"value": "MMM dd yyyy", "label": "Dec 31 2026"}, {"value": "yyyy-MM-dd", "label": "2026-12-31"}]} /></label>
        <label className={`text-sm ${muted}`}>Text size<input aria-label="Text size" aria-invalid={Boolean(settings.validation)} aria-describedby={settings.validation ? `setting-${chartId}-validation` : undefined} className={`${field} mt-1`} inputMode="numeric" maxLength={100} value={draft.textSize} onChange={(event) => change({ textSize: event.target.value })} /></label>
        <label className={`text-sm ${muted}`}>Grid<SettingsSelect ariaLabel="Grid" nativeClassName={field} className="mt-1" value={draft.gridMode} onChange={(value) => change({ gridMode: value as ChartSettingsDraft["gridMode"] })} disabled={!settings.ready} compatibility={compatibility} options={[{"value": "both", "label": "Horizontal and vertical"}, {"value": "horizontal", "label": "Horizontal"}, {"value": "vertical", "label": "Vertical"}, {"value": "none", "label": "None"}]} /></label>
      </div>
      <div className={`grid grid-cols-2 gap-3 ${compatibility ? "sm:grid-cols-5" : ""}`}>{PALETTE_FIELDS.map(([key, label]) => compatibility ? <label key={key} className={`text-sm ${muted}`}>{label}<input aria-label={label} type="color" value={draft[key]} onChange={(event) => change({ [key]: event.target.value })} className="mt-1 min-h-11 w-full cursor-pointer border border-stone-600 bg-transparent p-1" /></label> : <div key={key} className={`min-w-0 text-sm ${muted}`}><span>{label}</span><ThemedColorPicker ariaLabel={label} className="settings-color-picker mt-1" disabled={!settings.ready} onChange={(value) => changeColor(key, value)} onValidationChange={validationCallbacks[key]} resetKey={paletteResetKey} value={draft[key]} /></div>)}</div>
      <div className="overflow-hidden rounded-md border border-[var(--ui-border-strong)] p-3" style={{ backgroundColor: draft.backgroundColor, color: draft.textColor }} aria-label="Staged chart palette preview"><div className="relative h-24" style={{ backgroundImage: [draft.gridMode === "both" || draft.gridMode === "horizontal" ? `linear-gradient(${draft.gridColor} 1px, transparent 1px)` : null, draft.gridMode === "both" || draft.gridMode === "vertical" ? `linear-gradient(90deg, ${draft.gridColor} 1px, transparent 1px)` : null].filter(Boolean).join(", ") || undefined, backgroundSize: "28px 20px" }}>{[18,35,52,69].map((left, index) => <div key={left} className="absolute bottom-4 w-2" style={{ left: `${left}%`, height: [36,28,40,24][index], backgroundColor: index % 2 ? draft.candleDownColor : draft.candleUpColor }} />)}<span className="absolute left-2 top-1" style={{ fontSize: settings.validation ? 12 : Number(draft.textSize) }}>Preview</span></div></div>
      <button type="button" className={`${button} w-full ${compatibility ? "bg-amber-200 text-amber-950 hover:bg-amber-100" : "bg-[var(--text-primary)] font-semibold text-[var(--ui-canvas)] hover:brightness-95"}`} disabled={(!settings.dirty && !settings.needsActivation) || settings.pending || Boolean(settings.validation) || hasPaletteErrors} onClick={savePreset}>{appearance ? "Apply palette preset" : "Apply as active preset"}</button>
    </fieldset>, "Active on next workspace load", hasPaletteErrors ? `Fix the hex color for ${paletteValidation} before applying the preset.` : settings.validation)}
  </>;
  const title = appearance ? "Interface presentation" : "Staged chart preset";
  const description = appearance ? "Theme and density preview immediately and save after confirmation. Chart display and palette choices stay staged until you apply them. Reset restores dark appearance and comfortable density." : "Applying saves an active preset for the next workspace load; the chart currently in use keeps its settings. Reset stages the nine controls shown here.";
  const ready = appearance ? preferences.ready : settings.ready;
  const reset = appearance ? () => preferences.change({ appTheme: "dark", density: "comfortable" }) : () => { discardPaletteDrafts(); settings.reset(); };
  return compatibility ? <section data-chart-settings aria-labelledby="chart-settings-title"><div className="mt-7 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold" id="chart-settings-title">{title}</h2><button type="button" className={button} disabled={!ready} onClick={reset}>Reset section</button></div><p className={`mt-2 max-w-[70ch] text-sm leading-6 ${muted}`}>{description}</p>{content}</section> : <SettingsSection title={title} description={description} dirty={(appearance ? preferences.dirty || settings.dirty : settings.dirty) || hasPaletteErrors} onReset={ready ? reset : undefined}>{content}</SettingsSection>;
}
