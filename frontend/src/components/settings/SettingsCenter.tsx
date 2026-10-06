import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Bot,
  BriefcaseBusiness,
  ChartCandlestick,
  ChevronRight,
  Database,
  Download,
  Globe2,
  HardDrive,
  LoaderCircle,
  NotebookPen,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Undo2,
  UserRound,
} from "lucide-react";
import {
  type DatasetCatalog,
  type DatasetRefreshResponse,
  type DatasetRefreshStatus,
} from "../../lib/api";
import { getStoredAuthSession } from "../../lib/authSession";
import { BacktestSettingsPanel } from "./BacktestSettingsPanel";
import { useBacktestSettings } from "./useBacktestSettings";
import { useJournalSettings, RESET_JOURNAL_SETTINGS, type SettingsJournalDefaults } from "./useJournalSettings";
export type { SettingsJournalDefaults } from "./useJournalSettings";
import { AccountSettingsPanel, AiSettingsPanel, GlobalSettingsPanel, PrivacySettingsPanel } from "./SessionPrivacyPanels";
import { ChartSettingsPanel } from "./ChartSettingsPanel";
import { useChartSettings } from "./useChartSettings";
import { useSettingsPreferences } from "./useSettingsPreferences";
import { SettingsDataTransfer } from "./SettingsDataTransfer";
import { SettingsIntegrations } from "./SettingsIntegrations";
import { SettingRow, SettingsSection, SettingsToggle, fieldClassName, type SaveState } from "./SettingsPrimitives";
import { SettingsSearch } from "./SettingsSearch";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CONTROLS,
  parseSettingsDeepLink,
  settingsDeepLink,
  settingsCategoryForPath,
  type SettingsCategoryId,
  type SettingsControl,
} from "./settingsCatalog";

type Props = {
  datasets: DatasetCatalog | null;
  initialCategory?: SettingsCategoryId;
  journalDefaults: SettingsJournalDefaults;
  onBack?: () => void;
  backLabel?: string;
  onGetDatasetRefreshStatus: () => Promise<DatasetRefreshStatus>;
  onRefreshDatasets: () => Promise<DatasetRefreshResponse>;
  onUpdateDatasetAsset: (
    assetId: string,
    payload: { currency?: string | null; timezone?: string | null; pnl_multiplier?: number | null },
  ) => Promise<void>;
  onUpdateDatasetSettings: (payload: { root_path: string }) => Promise<void>;
  onUpdateJournalDefaults: (payload: Partial<SettingsJournalDefaults>) => void;
};

type UndoAction = { label: string; run: () => void };

const CATEGORY_ICONS: Record<SettingsCategoryId, LucideIcon> = {
  global: Globe2,
  journal: NotebookPen,
  backtest: BriefcaseBusiness,
  chart: ChartCandlestick,
  appearance: Palette,
  "data-providers": Database,
  account: UserRound,
  ai: Bot,
  "privacy-security": ShieldCheck,
  storage: HardDrive,
};

export function SettingsCenter({
  datasets,
  initialCategory = "global",
  onBack,
  backLabel = "Back",
  onGetDatasetRefreshStatus,
  onRefreshDatasets,
  onUpdateDatasetAsset,
  onUpdateDatasetSettings,
}: Props) {
  const location = useLocation();
  const initialLink = typeof window === "undefined" ? null : parseSettingsDeepLink(window.location.hash);
  const [category, setCategory] = useState<SettingsCategoryId>(initialLink?.category ?? settingsCategoryForPath(location.pathname) ?? initialCategory);
  const [focusControl, setFocusControl] = useState<string | null>(initialLink?.controlId ?? null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const preferenceSettings = useSettingsPreferences();
  const preferences = preferenceSettings.draft;
  const chartSettings = useChartSettings();
  const journalSettings = useJournalSettings();
  const { defaults: journalBaseline, journalDraft, setJournalDraft, noteDraft, setNoteDraft, journalDirty, noteDirty, saveJournal, saveNote } = journalSettings;
  const backtestSettings = useBacktestSettings();
  const [datasetRootBaseline, setDatasetRootBaseline] = useState(datasets?.root ?? "");
  const [datasetRoot, setDatasetRoot] = useState(datasets?.root ?? "");
  const [refreshStatus, setRefreshStatus] = useState<DatasetRefreshStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [assetId, setAssetId] = useState(datasets?.instruments[0]?.id ?? "");
  const selectedAsset = datasets?.instruments.find((asset) => asset.id === assetId) ?? null;
  const [assetDraft, setAssetDraft] = useState(() => assetValues(selectedAsset));
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const authSession = getStoredAuthSession();

  const chartDirty = chartSettings.dirty || chartSettings.pending;
  const datasetRootDirty = datasetRoot !== datasetRootBaseline;
  const hasDirty = journalDirty || noteDirty || chartDirty || datasetRootDirty || journalSettings.journalPending || journalSettings.notePending || backtestSettings.dirty || backtestSettings.pending || preferenceSettings.dirty || preferenceSettings.pending;

  const save = useCallback(async (key: string, action: () => Promise<unknown> | unknown) => {
    setSaveStates((current) => ({ ...current, [key]: "saving" }));
    try {
      await action();
      setSaveStates((current) => ({ ...current, [key]: "saved" }));
    } catch {
      setSaveStates((current) => ({ ...current, [key]: "error" }));
      throw new Error("save-failed");
    }
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasDirty]);

  useEffect(() => {
    const next = parseSettingsDeepLink(window.location.hash);
    setCategory(next?.category ?? settingsCategoryForPath(location.pathname) ?? initialCategory);
    if (next?.controlId) setFocusControl(next.controlId);
  }, [location.pathname, initialCategory]);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseSettingsDeepLink(window.location.hash);
      if (!next) return;
      setCategory(next.category);
      setFocusControl(next.controlId);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!focusControl) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`setting-${focusControl}`);
      target?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
      setFocusControl(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [category, focusControl]);

  useEffect(() => {
    if (!datasets || datasetRootDirty) return;
    setDatasetRootBaseline(datasets.root);
    setDatasetRoot(datasets.root);
  }, [datasets, datasetRootDirty]);

  useEffect(() => {
    if (!datasets?.instruments.length) return;
    if (!datasets.instruments.some((asset) => asset.id === assetId)) setAssetId(datasets.instruments[0].id);
  }, [assetId, datasets]);

  useEffect(() => { setAssetDraft(assetValues(selectedAsset)); }, [selectedAsset]);

  useEffect(() => {
    if (category !== "data-providers") return;
    let cancelled = false;
    void onGetDatasetRefreshStatus().then((status) => { if (!cancelled) setRefreshStatus(status); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [category, onGetDatasetRefreshStatus]);

  function navigate(nextCategory: SettingsCategoryId, controlId: string | null = null) {
    if (nextCategory !== category && hasDirty && !window.confirm("You have unapplied settings. Keep those drafts and continue to another category?")) return;
    setCategory(nextCategory);
    setFocusControl(controlId);
    window.history.replaceState(null, "", settingsDeepLink(nextCategory, controlId ?? undefined));
  }

  function selectResult(result: SettingsControl) { navigate(result.category, result.id); }

  async function saveDatasetRoot() {
    if (!datasetRoot.trim()) return;
    await save("dataset-root", () => onUpdateDatasetSettings({ root_path: datasetRoot.trim() }));
    setDatasetRootBaseline(datasetRoot.trim());
    setDatasetRoot(datasetRoot.trim());
  }

  async function refreshDatasetsNow() {
    setRefreshing(true);
    setSaveStates((current) => ({ ...current, refresh: "saving" }));
    try {
      const response = await onRefreshDatasets();
      setRefreshStatus(response.status);
      setSaveStates((current) => ({ ...current, refresh: "saved" }));
    } catch {
      setSaveStates((current) => ({ ...current, refresh: "error" }));
    } finally {
      setRefreshing(false);
    }
  }

  async function saveAsset() {
    if (!selectedAsset || assetValidation(assetDraft)) return;
    await save("asset", () => onUpdateDatasetAsset(selectedAsset.id, {
      currency: assetDraft.currency.trim().toUpperCase(), timezone: assetDraft.timezone.trim(), pnl_multiplier: Number(assetDraft.multiplier),
    }));
  }

  const activeCategory = SETTINGS_CATEGORIES.find((item) => item.id === category) ?? SETTINGS_CATEGORIES[0];
  const controlsInCategory = SETTINGS_CONTROLS.filter((item) => item.category === category).length;

  return (
    <main className={`min-h-full bg-[#090b0e] text-zinc-100 ${preferences.density === "compact" ? "[&_[data-setting-control]]:py-3" : ""}`}>
      <header className="border-b border-white/10 bg-[#0c0f13] px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[88rem]">
          {onBack ? <button type="button" onClick={() => { if (!hasDirty || window.confirm("Leave settings without applying draft changes?")) onBack(); }} className="mb-3 inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{backLabel}</button> : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Operate mode</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Settings</h1><p className="mt-1 text-sm text-zinc-400">Personal values override workspace defaults; system rows show effective read-only behavior.</p></div>
            {hasDirty ? <p className="text-sm text-amber-200" role="status">Draft changes not applied</p> : <p className="text-sm text-zinc-400">All explicit changes applied</p>}
          </div>
          <div className="mt-5"><SettingsSearch onSelect={selectResult} /></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[88rem] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-8">
        <aside className="lg:sticky lg:top-0 lg:h-fit">
          <label className="block text-xs font-medium text-zinc-400 lg:hidden">Settings category
            <select value={category} onChange={(event) => navigate(event.target.value as SettingsCategoryId)} className={`${fieldClassName} mt-1`}>
              {SETTINGS_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <nav aria-label="Settings categories" className="hidden space-y-0.5 lg:block">
            {SETTINGS_CATEGORIES.map((item) => {
              const Icon = CATEGORY_ICONS[item.id];
              const selected = item.id === category;
              const status = categoryStatus(item.id, { datasets, journalDirty, noteDirty, chartDirty, datasetRootDirty, backtestDirty: backtestSettings.dirty || backtestSettings.pending, signedIn: Boolean(authSession) });
              return <button key={item.id} type="button" aria-current={selected ? "page" : undefined} onClick={() => navigate(item.id)} className={`flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${selected ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="ui-resilient-text min-w-0 flex-1" dir="auto">{item.label}</span>{status ? <span className={`shrink-0 text-[11px] ${status === "Unsaved" ? "text-amber-200" : "text-zinc-400"}`}>{status}</span> : null}</button>;
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          {preferenceSettings.conflict && category !== "privacy-security" ? <div className="mb-4 flex min-w-0 flex-col items-stretch gap-3 rounded-md bg-amber-300/[0.08] px-3 py-3 text-sm text-amber-100 sm:flex-row sm:items-center" data-settings-conflict role="alert"><span className="ui-resilient-text min-w-0 flex-1" data-settings-conflict-message>Settings changed in another EdgeLab tab. Reload its version or keep this tab’s values.</span><div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:shrink-0" data-settings-conflict-actions><button type="button" className="min-h-11 min-w-0 rounded px-2 text-xs font-semibold text-amber-100 hover:bg-white/[0.06] sm:min-h-9" onClick={() => void preferenceSettings.useNewer()}>Use newer version</button><button type="button" className="min-h-11 min-w-0 rounded bg-amber-200 px-2 text-xs font-semibold text-slate-950 hover:bg-amber-100 sm:min-h-9" onClick={() => void preferenceSettings.keepVersion()}>Keep this version</button></div></div> : null}
          {undoAction ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-cyan-400/20 bg-cyan-400/[0.04] px-3 py-2 text-sm"><span className="text-cyan-50">{undoAction.label}</span><button type="button" onClick={() => { undoAction.run(); setUndoAction(null); }} className="inline-flex min-h-8 items-center gap-1.5 rounded px-2 text-xs font-semibold text-cyan-300 hover:bg-white/5"><Undo2 aria-hidden="true" className="h-3.5 w-3.5" />Undo</button></div> : null}
          {saveStates.hydration === "error" ? <div className="mb-4 border-l-2 border-amber-300 bg-amber-300/5 px-3 py-2 text-sm text-amber-100" role="alert">Some cross-device values could not be loaded. Local effective values remain available.</div> : null}
          <div className="mb-5 border-b border-white/10 pb-5"><p className="text-xs text-zinc-400">{controlsInCategory} supported control{controlsInCategory === 1 ? "" : "s"}</p><h2 className="mt-1 text-xl font-semibold text-white">{activeCategory.label}</h2><p className="mt-1 text-sm leading-6 text-zinc-400">{activeCategory.description}</p></div>

          {category === "global" ? <GlobalSettingsPanel /> : null}
          {category === "journal" ? <>
            {!journalSettings.ready || journalSettings.error ? <div className="mb-4 text-sm text-amber-100" role={journalSettings.error ? "alert" : "status"}>{journalSettings.error ? "Journal settings could not be loaded. Your draft is kept." : "Loading journal settings…"}{journalSettings.error ? <button type="button" onClick={() => void journalSettings.reload()} className="ml-3 min-h-11 rounded border border-amber-200 px-3" disabled={journalSettings.loading}>Retry loading settings</button> : null}</div> : null}
            <SettingsSection title="Journal defaults" description="These workspace defaults prefill new journal entries; existing trades are never rewritten." dirty={journalDirty} onReset={journalSettings.ready ? () => setJournalDraft(RESET_JOURNAL_SETTINGS) : undefined}>
              <fieldset disabled={!journalSettings.ready} className="min-w-0">
              <SettingRow controlId="journal-defaults" label="Capture defaults" description="Set the currency, broker label, entry type, and whether taken trades require an account." scope="Workspace" effective={`${journalBaseline.default_currency} · ${journalBaseline.default_entry_type.toLowerCase()}`} saveState={journalSettings.journalState} saveMessage={journalSettings.journalState === "saving" ? "Saving journal defaults…" : journalSettings.journalState === "saved" ? "Journal defaults saved" : journalSettings.journalState === "error" ? "Journal defaults could not be saved. Your draft is kept." : undefined} onRetry={() => void saveJournal()} validation={!/^[A-Za-z]{3}$/.test(journalDraft.default_currency) ? "Use a three-letter currency code, for example USD." : null}>
                <div className="space-y-2"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-zinc-400">Currency<input value={journalDraft.default_currency} maxLength={3} aria-invalid={!/^[A-Za-z]{3}$/.test(journalDraft.default_currency)} aria-describedby={!/^[A-Za-z]{3}$/.test(journalDraft.default_currency) ? "setting-journal-defaults-validation" : undefined} onChange={(event) => setJournalDraft((current) => ({ ...current, default_currency: event.target.value.toUpperCase() }))} className={`${fieldClassName} mt-1`} /></label><label className="text-xs text-zinc-400">Broker label<input value={journalDraft.default_broker} maxLength={80} placeholder="Optional" onChange={(event) => setJournalDraft((current) => ({ ...current, default_broker: event.target.value }))} className={`${fieldClassName} mt-1`} /></label></div><label className="block text-xs text-zinc-400">Default entry type<select value={journalDraft.default_entry_type} onChange={(event) => setJournalDraft((current) => ({ ...current, default_entry_type: event.target.value as "MISSED" | "TAKEN" }))} className={`${fieldClassName} mt-1`}><option value="TAKEN">Taken</option><option value="MISSED">Missed</option></select></label><div className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-2.5"><span className="text-xs text-zinc-300">Require account for taken trades</span><SettingsToggle checked={journalDraft.require_account_for_taken_trades} label="Require account for taken trades" onChange={(checked) => setJournalDraft((current) => ({ ...current, require_account_for_taken_trades: checked }))} /></div><button type="button" disabled={!journalDirty || !/^[A-Za-z]{3}$/.test(journalDraft.default_currency) || journalSettings.journalState === "saving"} onClick={() => void saveJournal()} className="min-h-11 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45 sm:min-h-10">Apply journal defaults</button></div>
              </SettingRow>
              <SettingRow controlId="note-template" label="Review note template" description="Supported placeholders: {side}, {quantity}, {entry}, {exit}, {pnl}, and {r}." scope="Personal" effective="Inserted when a new notebook note starts" validation={!noteDraft.trim() ? "The template cannot be empty." : null} saveState={journalSettings.noteState} saveMessage={journalSettings.noteState === "saving" ? "Saving note template…" : journalSettings.noteState === "saved" ? "Note template saved" : journalSettings.noteState === "error" ? "Note template could not be saved. Your draft is kept." : undefined} onRetry={() => void saveNote()}>
                <div><textarea aria-label="Review note template" maxLength={200000} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={10} className={`${fieldClassName} min-h-48 resize-y py-2 font-mono text-xs`} /><button type="button" onClick={() => void saveNote()} disabled={!noteDirty || !noteDraft.trim() || journalSettings.noteState === "saving"} className="mt-2 min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Save note template</button></div>
              </SettingRow>
              </fieldset>
            </SettingsSection>
          </> : null}
          {category === "backtest" ? <BacktestSettingsPanel settings={backtestSettings} /> : null}
          {category === "chart" ? <ChartSettingsPanel settings={chartSettings} preferences={preferenceSettings} /> : null}
          {category === "appearance" ? <ChartSettingsPanel appearance settings={chartSettings} preferences={preferenceSettings} /> : null}
          {category === "data-providers" ? <>
            <DatasetSettings assetDraft={assetDraft} assetId={assetId} datasets={datasets} datasetRoot={datasetRoot} datasetRootDirty={datasetRootDirty} refreshStatus={refreshStatus} refreshing={refreshing} saveStates={saveStates} selectedAsset={selectedAsset} onAssetDraftChange={setAssetDraft} onAssetIdChange={setAssetId} onRefresh={() => void refreshDatasetsNow()} onRootChange={setDatasetRoot} onSaveAsset={() => void saveAsset()} onSaveRoot={() => void saveDatasetRoot()} />
            <SettingsIntegrations />
          </> : null}
          {category === "account" ? <AccountSettingsPanel /> : null}
          {category === "ai" ? <AiSettingsPanel /> : null}
          {category === "privacy-security" ? <PrivacySettingsPanel settings={preferenceSettings} /> : null}
          {category === "storage" ? <SettingsDataTransfer /> : null}
        </div>
      </div>
    </main>
  );
}

type AssetDraft = { currency: string; timezone: string; multiplier: string };
function DatasetSettings(props: { assetDraft: AssetDraft; assetId: string; datasets: DatasetCatalog | null; datasetRoot: string; datasetRootDirty: boolean; refreshStatus: DatasetRefreshStatus | null; refreshing: boolean; saveStates: Record<string, SaveState>; selectedAsset: DatasetCatalog["instruments"][number] | null; onAssetDraftChange: (draft: AssetDraft) => void; onAssetIdChange: (id: string) => void; onRefresh: () => void; onRootChange: (root: string) => void; onSaveAsset: () => void; onSaveRoot: () => void }) {
  return <SettingsSection title="Local market data" description="Dataset controls use the configured server scan API. Folder paths are interpreted by the EdgeLab backend, not by this browser." dirty={props.datasetRootDirty} onReset={() => props.onRootChange("")}>
    <SettingRow controlId="dataset-root" label="Dataset root" description="Absolute server-side folder containing instrument and timeframe CSV files." scope="Workspace" effective={props.datasets?.root || "Not configured"} validation={!props.datasetRoot.trim() ? "Enter a dataset folder path." : null} saveState={props.saveStates["dataset-root"]} onRetry={props.onSaveRoot}><div><input value={props.datasetRoot} onChange={(event) => props.onRootChange(event.target.value)} placeholder="/data/market" className={fieldClassName} /><button type="button" onClick={props.onSaveRoot} disabled={!props.datasetRootDirty || !props.datasetRoot.trim()} className="mt-2 min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Apply dataset root</button></div></SettingRow>
    <SettingRow controlId="dataset-refresh" label="Dataset refresh" description="Rescan configured files. A running scan can be checked again without starting another." effective={refreshText(props.refreshStatus, props.datasets)} saveState={props.saveStates.refresh} onRetry={props.onRefresh}><button type="button" onClick={props.onRefresh} disabled={props.refreshing || props.refreshStatus?.running} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/15 px-4 text-sm font-medium hover:bg-white/5 disabled:opacity-45"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${props.refreshing || props.refreshStatus?.running ? "animate-spin motion-reduce:animate-none" : ""}`} />{props.refreshStatus?.running ? `Scanning ${props.refreshStatus.current ?? "files"}…` : "Rescan datasets"}</button></SettingRow>
    <SettingRow controlId="asset-calibration" label="Instrument calibration" description="Update the selected instrument’s currency, IANA time zone, and positive P&L multiplier." scope="Workspace" validation={assetValidation(props.assetDraft)} saveState={props.saveStates.asset} onRetry={props.onSaveAsset}><div className="space-y-2"><select aria-label="Instrument" value={props.assetId} onChange={(event) => props.onAssetIdChange(event.target.value)} disabled={!props.datasets?.instruments.length} className={fieldClassName}><option value="">No instruments</option>{props.datasets?.instruments.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.symbol}</option>)}</select>{props.selectedAsset ? <><div className="grid gap-2 sm:grid-cols-3"><label className="text-xs text-zinc-400">Currency<input value={props.assetDraft.currency} maxLength={3} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, currency: event.target.value.toUpperCase() })} className={`${fieldClassName} mt-1`} /></label><label className="text-xs text-zinc-400 sm:col-span-2">Time zone<input value={props.assetDraft.timezone} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, timezone: event.target.value })} placeholder="UTC" className={`${fieldClassName} mt-1`} /></label></div><label className="block text-xs text-zinc-400">P&amp;L multiplier<input inputMode="decimal" value={props.assetDraft.multiplier} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, multiplier: event.target.value })} className={`${fieldClassName} mt-1`} /></label><button type="button" onClick={props.onSaveAsset} disabled={Boolean(assetValidation(props.assetDraft))} className="min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Save instrument</button></> : null}</div></SettingRow>
  </SettingsSection>;
}

function categoryStatus(category: SettingsCategoryId, state: { datasets: DatasetCatalog | null; journalDirty: boolean; noteDirty: boolean; chartDirty: boolean; datasetRootDirty: boolean; backtestDirty: boolean; signedIn: boolean }) {
  if (category === "backtest" && state.backtestDirty) return "Unsaved";
  if (category === "journal" && (state.journalDirty || state.noteDirty)) return "Unsaved";
  if ((category === "chart" || category === "appearance") && state.chartDirty) return "Unsaved";
  if (category === "data-providers") return state.datasetRootDirty ? "Unsaved" : `${state.datasets?.instruments.length ?? 0}`;
  if (category === "account") return state.signedIn ? "Signed in" : "Signed out";
  return null;
}

function assetValues(asset: DatasetCatalog["instruments"][number] | null): AssetDraft {
  return { currency: asset?.currency ?? "USD", timezone: asset?.timezone ?? "UTC", multiplier: String(asset?.pnl_multiplier ?? 1) };
}

function assetValidation(draft: AssetDraft) {
  if (!/^[A-Za-z]{3}$/.test(draft.currency)) return "Use a three-letter currency code.";
  if (!draft.timezone.trim()) return "Enter an IANA time zone such as UTC or America/New_York.";
  if (!positiveNumber(draft.multiplier)) return "P&L multiplier must be greater than zero.";
  return null;
}

function refreshText(status: DatasetRefreshStatus | null, datasets: DatasetCatalog | null) {
  if (status?.running) return `Running · ${status.current ?? "scanning"}`;
  if (status?.error) return `Last scan failed · ${status.error}`;
  if (status?.finished_at) return `${status.summary.assets} assets · ${status.summary.timeframes} timeframes · finished ${new Date(status.finished_at).toLocaleString()}`;
  return `${datasets?.instruments.length ?? 0} instruments loaded · no refresh status`;
}

function positiveNumber(value: string) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0; }
