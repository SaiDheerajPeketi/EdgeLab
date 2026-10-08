import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
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
import { SettingRow, SettingsSection, SettingsSelect, SettingsToggle, fieldClassName, type SaveState } from "./SettingsPrimitives";
import { SettingsSearch } from "./SettingsSearch";
import {
  SETTINGS_CATEGORIES,
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

// Dataset drafts and receipts belong to one browser session, just like the
// owner-scoped journal/chart drafts. Remount before another identity can edit.
function sessionIdentity() {
  const session = getStoredAuthSession();
  return JSON.stringify([session?.user.id ?? null, session?.token ?? null]);
}
export function SettingsCenter(props: Props) {
  const identity = useSyncExternalStore(subscribeAuthSession, sessionIdentity, () => "anonymous");
  return <SettingsCenterContent key={identity} {...props} />;
}

function SettingsCenterContent({
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
  const [assetDrafts, setAssetDrafts] = useState<Record<string, { values: AssetDraft; baseline: AssetDraft }>>({});
  const assetDraft = assetDrafts[assetId]?.values ?? assetValues(selectedAsset);
  const datasetRootValue = useRef(datasetRoot);
  const assetDraftValues = useRef(assetDrafts);
  datasetRootValue.current = datasetRoot;
  assetDraftValues.current = assetDrafts;
  const pendingSaves = useRef(new Set<string>());
  const mounted = useRef(true);
  const identity = useRef(sessionIdentity());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refreshVersion = useRef(0);
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const authSession = getStoredAuthSession();

  const [chartLocalDirty, setChartLocalDirty] = useState(false);
  const chartDirty = chartSettings.dirty || chartSettings.pending || chartLocalDirty;
  const datasetRootDirty = datasetRoot !== datasetRootBaseline;
  const assetDirty = Object.values(assetDrafts).some(({ values, baseline }) => !sameAssetValues(values, baseline));
  const datasetPending = saveStates["dataset-root"] === "saving" || Object.entries(saveStates).some(([key, state]) => key.startsWith("asset:") && state === "saving");
  const hasDirty = journalDirty || noteDirty || chartDirty || datasetRootDirty || assetDirty || datasetPending || journalSettings.journalPending || journalSettings.notePending || backtestSettings.dirty || backtestSettings.pending || preferenceSettings.dirty || preferenceSettings.pending;

  const save = useCallback(async (key: string, action: () => Promise<unknown> | unknown) => {
    const currentSession = () => mounted.current && identity.current === sessionIdentity();
    if (!currentSession() || pendingSaves.current.has(key)) return false;
    pendingSaves.current.add(key);
    setSaveStates((current) => ({ ...current, [key]: "saving" }));
    try {
      await action();
      if (!currentSession()) return false;
      setSaveStates((current) => ({ ...current, [key]: "saved" }));
      return true;
    } catch {
      if (currentSession()) setSaveStates((current) => ({ ...current, [key]: "error" }));
      return false;
    } finally { pendingSaves.current.delete(key); }
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
    if (!datasets) return;
    setDatasetRoot((current) => !pendingSaves.current.has("dataset-root") && current === datasetRootBaseline ? datasets.root : current);
    setDatasetRootBaseline(datasets.root);
  }, [datasets?.root]);

  useEffect(() => {
    if (!datasets?.instruments.length) return;
    if (!datasets.instruments.some((asset) => asset.id === assetId)) setAssetId(datasets.instruments[0].id);
  }, [assetId, datasets]);

  useEffect(() => {
    if (!datasets) return;
    setAssetDrafts((current) => Object.fromEntries(datasets.instruments.map((asset) => {
      const baseline = assetValues(asset), previous = current[asset.id];
      const values = previous ? Object.fromEntries(Object.keys(baseline).map((key) => {
        const field = key as keyof AssetDraft;
        return [field, pendingSaves.current.has("asset:" + asset.id) || previous.values[field] !== previous.baseline[field] ? previous.values[field] : baseline[field]];
      })) as AssetDraft : baseline;
      return [asset.id, { values, baseline }];
    })));
  }, [datasets?.instruments]);

  function setAssetDraft(values: AssetDraft) {
    if (!selectedAsset) return;
    setAssetDrafts((current) => ({ ...current, [assetId]: { values, baseline: current[assetId]?.baseline ?? assetValues(selectedAsset) } }));
    setSaveStates((current) => ({ ...current, ["asset:" + assetId]: current["asset:" + assetId] === "saving" ? "saving" : "idle" }));
  }

  useEffect(() => {
    if (category !== "data-providers") return;
    let cancelled = false;
    const version = ++refreshVersion.current;
    void onGetDatasetRefreshStatus().then((status) => { if (!cancelled && version === refreshVersion.current) setRefreshStatus(status); }).catch(() => {
      if (!cancelled && version === refreshVersion.current) setSaveStates((current) => ({ ...current, refresh: "error" }));
    });
    return () => { cancelled = true; };
  }, [category, onGetDatasetRefreshStatus]);

  function navigate(nextCategory: SettingsCategoryId, controlId: string | null = null) {
    if (nextCategory !== category && hasDirty && !window.confirm(chartLocalDirty ? "Discard the invalid color entry and continue? Other staged settings will be kept." : "You have unapplied settings. Keep those drafts and continue to another category?")) return;
    setCategory(nextCategory);
    setFocusControl(controlId);
    window.history.replaceState(null, "", settingsDeepLink(nextCategory, controlId ?? undefined));
  }

  function selectResult(result: SettingsControl) { navigate(result.category, result.id); }

  function changeDatasetRoot(value: string) {
    setDatasetRoot(value);
    setSaveStates((current) => ({ ...current, ["dataset-root"]: current["dataset-root"] === "saving" ? "saving" : "idle" }));
  }

  function resetDatasets() {
    setDatasetRoot(datasetRootBaseline);
    setAssetDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, entry]) => [id, { ...entry, values: { ...entry.baseline } }])));
    setSaveStates((current) => Object.fromEntries(Object.entries(current).map(([key, state]) => [key,
      (key === "dataset-root" || key.startsWith("asset:")) && state !== "saving" ? "idle" : state,
    ])));
  }

  async function saveDatasetRoot() {
    if (!datasetRoot.trim()) return;
    const submitted = datasetRoot, root = submitted.trim();
    if (!await save("dataset-root", () => onUpdateDatasetSettings({ root_path: root }))) return;
    setDatasetRootBaseline(root);
    if (datasetRootValue.current !== submitted) setSaveStates((current) => ({ ...current, ["dataset-root"]: "idle" }));
    setDatasetRoot((current) => current === submitted ? root : current);
  }

  async function refreshDatasetsNow(checkOnly = false) {
    if (pendingSaves.current.has("refresh")) return;
    setRefreshing(true);
    const version = ++refreshVersion.current;
    await save("refresh", async () => {
      const status = checkOnly || refreshStatus?.running ? await onGetDatasetRefreshStatus() : (await onRefreshDatasets()).status;
      if (version === refreshVersion.current) setRefreshStatus(status);
    });
    if (mounted.current && identity.current === sessionIdentity()) setRefreshing(false);
  }

  async function saveAsset() {
    if (!selectedAsset || assetValidation(assetDraft)) return;
    const id = selectedAsset.id, submitted = { ...assetDraft };
    const confirmed = { currency: submitted.currency.trim().toUpperCase(), timezone: submitted.timezone.trim(), multiplier: String(Number(submitted.multiplier)) };
    if (!await save("asset:" + id, () => onUpdateDatasetAsset(id, {
      currency: confirmed.currency, timezone: confirmed.timezone, pnl_multiplier: Number(confirmed.multiplier),
    }))) return;
    if (assetDraftValues.current[id] && !sameAssetValues(assetDraftValues.current[id].values, submitted)) setSaveStates((current) => ({ ...current, ["asset:" + id]: "idle" }));
    setAssetDrafts((current) => {
      const latest = current[id];
      if (!latest) return current;
      const values = Object.fromEntries(Object.keys(confirmed).map((key) => {
        const field = key as keyof AssetDraft;
        return [field, latest.values[field] === submitted[field] ? confirmed[field] : latest.values[field]];
      })) as AssetDraft;
      return { ...current, [id]: { values, baseline: confirmed } };
    });
  }

  const activeCategory = SETTINGS_CATEGORIES.find((item) => item.id === category) ?? SETTINGS_CATEGORIES[0];

  return (
    <main className={`min-h-full bg-[var(--ui-canvas)] text-[var(--text-primary)] ${preferences.density === "compact" ? "[&_[data-setting-control]]:py-3" : ""}`}>
      <header className="border-b border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[88rem]">
          {onBack ? <button type="button" onClick={() => { if (!hasDirty || window.confirm(chartLocalDirty ? "Discard the invalid color entry and leave settings? Other staged settings will be kept." : "Leave settings without applying draft changes?")) onBack(); }} className="mb-3 inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{backLabel}</button> : null}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h1 className=" text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Settings</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Personal values override workspace defaults; system rows show effective read-only behavior.</p></div>
            {hasDirty ? <p className="text-sm text-[var(--warning-text)]" role="status">Draft changes not applied</p> : <p className="text-sm text-[var(--text-secondary)]">All explicit changes applied</p>}
          </div>
          <div className="mt-5"><SettingsSearch onSelect={selectResult} /></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[88rem] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-8">
        <aside className="lg:sticky lg:top-0 lg:h-fit">
          <label className="block text-xs font-medium text-[var(--text-secondary)] lg:hidden">Settings category
            <SettingsSelect ariaLabel="Settings category" value={category} onChange={(value) => navigate(value as SettingsCategoryId)} className="mt-1" options={SETTINGS_CATEGORIES.map((item) => ({ value: item.id, label: item.label }))} />
          </label>
          <nav aria-label="Settings categories" className="hidden space-y-0.5 lg:block">
            {SETTINGS_CATEGORIES.map((item) => {
              const Icon = CATEGORY_ICONS[item.id];
              const selected = item.id === category;
              const status = categoryStatus(item.id, { datasets, journalDirty, noteDirty, chartDirty, datasetRootDirty: datasetRootDirty || assetDirty || datasetPending, backtestDirty: backtestSettings.dirty || backtestSettings.pending, signedIn: Boolean(authSession) });
              return <button key={item.id} type="button" aria-current={selected ? "page" : undefined} onClick={() => navigate(item.id)} className={`flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${selected ? "bg-[var(--ui-selection)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)]"}`}><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="ui-resilient-text min-w-0 flex-1" dir="auto">{item.label}</span>{status ? <span className={`shrink-0 text-[11px] ${status === "Unsaved" ? "text-[var(--warning-text)]" : "text-[var(--text-secondary)]"}`}>{status}</span> : null}</button>;
            })}
          </nav>
          <a className="mt-4 inline-flex min-h-11 items-center px-2.5 text-sm text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]" href="/source/" target="_blank" rel="noreferrer">Application source</a>
        </aside>

        <div className="min-w-0">
          {preferenceSettings.conflict && category !== "privacy-security" ? <div className="mb-4 flex min-w-0 flex-col items-stretch gap-3 rounded-md bg-[var(--warning-soft)] px-3 py-3 text-sm text-[var(--warning-text)] sm:flex-row sm:items-center" data-settings-conflict role="alert"><span className="ui-resilient-text min-w-0 flex-1" data-settings-conflict-message>Settings changed in another EdgeLab tab. Reload its version or keep this tab’s values.</span><div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:shrink-0" data-settings-conflict-actions><button type="button" className="min-h-11 min-w-0 rounded px-2 text-xs font-semibold text-[var(--warning-text)] hover:bg-[var(--ui-hover)] sm:min-h-9" onClick={() => void preferenceSettings.useNewer()}>Use newer version</button><button type="button" className="min-h-11 min-w-0 rounded bg-[var(--warning-text)] px-2 text-xs font-semibold text-[var(--ui-canvas)] hover:brightness-95 sm:min-h-9" onClick={() => void preferenceSettings.keepVersion()}>Keep this version</button></div></div> : null}
          {undoAction ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--ui-border-subtle)] bg-[var(--ui-selection)] px-3 py-2 text-sm"><span className="text-[var(--text-primary)]">{undoAction.label}</span><button type="button" onClick={() => { undoAction.run(); setUndoAction(null); }} className="inline-flex min-h-8 items-center gap-1.5 rounded px-2 text-xs font-semibold text-[var(--text-accent)] hover:bg-[var(--ui-hover)]"><Undo2 aria-hidden="true" className="h-3.5 w-3.5" />Undo</button></div> : null}
          {saveStates.hydration === "error" ? <div className="mb-4 rounded-md bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning-text)]" role="alert">Some cross-device values could not be loaded. Local effective values remain available.</div> : null}
          <div className="mb-5 border-b border-[var(--ui-border-subtle)] pb-5"><h2 className=" text-xl font-semibold text-[var(--text-primary)]">{activeCategory.label}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{activeCategory.description}</p></div>

          {category === "global" ? <GlobalSettingsPanel /> : null}
          {category === "journal" ? <>
            {!journalSettings.ready || journalSettings.error ? <div className="mb-4 text-sm text-[var(--warning-text)]" role={journalSettings.error ? "alert" : "status"}>{journalSettings.error ? "Journal settings could not be loaded. Your draft is kept." : "Loading journal settings…"}{journalSettings.error ? <button type="button" onClick={() => void journalSettings.reload()} className="ml-3 min-h-11 rounded border border-[var(--ui-border-strong)] px-3" disabled={journalSettings.loading}>Retry loading settings</button> : null}</div> : null}
            <SettingsSection title="Journal defaults" description="These workspace defaults prefill new journal entries; existing trades are never rewritten." dirty={journalDirty} onReset={journalSettings.ready ? () => setJournalDraft(RESET_JOURNAL_SETTINGS) : undefined}>
              <fieldset disabled={!journalSettings.ready} className="min-w-0">
              <SettingRow controlId="journal-defaults" label="Capture defaults" description="Set the currency, broker label, entry type, and whether taken trades require an account." scope="Workspace" effective={`${journalBaseline.default_currency} · ${journalBaseline.default_entry_type.toLowerCase()}`} saveState={journalSettings.journalState} saveMessage={journalSettings.journalState === "saving" ? "Saving journal defaults…" : journalSettings.journalState === "saved" ? "Journal defaults saved" : journalSettings.journalState === "error" ? "Journal defaults could not be saved. Your draft is kept." : undefined} onRetry={() => void saveJournal()} validation={!/^[A-Za-z]{3}$/.test(journalDraft.default_currency) ? "Use a three-letter currency code, for example USD." : null}>
                <div className="space-y-2"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-[var(--text-secondary)]">Currency<input value={journalDraft.default_currency} maxLength={3} aria-invalid={!/^[A-Za-z]{3}$/.test(journalDraft.default_currency)} aria-describedby={!/^[A-Za-z]{3}$/.test(journalDraft.default_currency) ? "setting-journal-defaults-validation" : undefined} onChange={(event) => setJournalDraft((current) => ({ ...current, default_currency: event.target.value.toUpperCase() }))} className={`${fieldClassName} mt-1`} /></label><label className="text-xs text-[var(--text-secondary)]">Broker label<input value={journalDraft.default_broker} maxLength={80} placeholder="Optional" onChange={(event) => setJournalDraft((current) => ({ ...current, default_broker: event.target.value }))} className={`${fieldClassName} mt-1`} /></label></div><label className="block text-xs text-[var(--text-secondary)]">Default entry type<SettingsSelect ariaLabel="Default entry type" disabled={!journalSettings.ready} value={journalDraft.default_entry_type} onChange={(value) => setJournalDraft((current) => ({ ...current, default_entry_type: value as "MISSED" | "TAKEN" }))} className="mt-1" options={[{ value: "TAKEN", label: "Taken" }, { value: "MISSED", label: "Missed" }]} /></label><div className="flex items-center justify-between gap-3 rounded-md border border-[var(--ui-border-subtle)] p-2.5"><span className="text-xs text-[var(--text-secondary)]">Require account for taken trades</span><SettingsToggle checked={journalDraft.require_account_for_taken_trades} label="Require account for taken trades" onChange={(checked) => setJournalDraft((current) => ({ ...current, require_account_for_taken_trades: checked }))} /></div><button type="button" disabled={!journalDirty || !/^[A-Za-z]{3}$/.test(journalDraft.default_currency) || journalSettings.journalState === "saving"} onClick={() => void saveJournal()} className="min-h-11 w-full rounded-md bg-[var(--text-primary)] px-4 text-sm font-semibold text-[var(--ui-canvas)] hover:brightness-95 disabled:opacity-45 sm:min-h-10">Apply journal defaults</button></div>
              </SettingRow>
              <SettingRow controlId="note-template" label="Review note template" description="Supported placeholders: {side}, {quantity}, {entry}, {exit}, {pnl}, and {r}." scope="Personal" effective="Inserted when a new notebook note starts" validation={!noteDraft.trim() ? "The template cannot be empty." : null} saveState={journalSettings.noteState} saveMessage={journalSettings.noteState === "saving" ? "Saving note template…" : journalSettings.noteState === "saved" ? "Note template saved" : journalSettings.noteState === "error" ? "Note template could not be saved. Your draft is kept." : undefined} onRetry={() => void saveNote()}>
                <div><textarea aria-label="Review note template" maxLength={200000} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={10} className={`${fieldClassName} min-h-48 resize-y py-2 font-mono text-xs`} /><button type="button" onClick={() => void saveNote()} disabled={!noteDirty || !noteDraft.trim() || journalSettings.noteState === "saving"} className="mt-2 min-h-10 w-full rounded-md bg-[var(--text-primary)] px-4 text-sm font-semibold text-[var(--ui-canvas)] hover:brightness-95 disabled:opacity-45">Save note template</button></div>
              </SettingRow>
              </fieldset>
            </SettingsSection>
          </> : null}
          {category === "backtest" ? <BacktestSettingsPanel settings={backtestSettings} /> : null}
          {category === "chart" ? <ChartSettingsPanel settings={chartSettings} preferences={preferenceSettings} onLocalDraftDirty={setChartLocalDirty} /> : null}
          {category === "appearance" ? <ChartSettingsPanel appearance settings={chartSettings} preferences={preferenceSettings} onLocalDraftDirty={setChartLocalDirty} /> : null}
          {category === "data-providers" ? <>
            <DatasetSettings assetDraft={assetDraft} assetId={assetId} datasets={datasets} datasetRoot={datasetRoot} datasetRootDirty={datasetRootDirty} assetDirty={!sameAssetValues(assetDraft, assetDrafts[assetId]?.baseline ?? assetValues(selectedAsset))} datasetDirty={datasetRootDirty || assetDirty || datasetPending} assetPending={Object.entries(saveStates).some(([key, state]) => key.startsWith("asset:") && state === "saving")} refreshStatus={refreshStatus} refreshing={refreshing} saveStates={{ ...saveStates, asset: saveStates["asset:" + assetId] }} selectedAsset={selectedAsset} onAssetDraftChange={setAssetDraft} onAssetIdChange={setAssetId} onRefresh={() => void refreshDatasetsNow()} onRetryRefresh={() => void refreshDatasetsNow(true)} onRootChange={changeDatasetRoot} onReset={resetDatasets} onSaveAsset={() => void saveAsset()} onSaveRoot={() => void saveDatasetRoot()} />
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
function DatasetSettings(props: { assetDraft: AssetDraft; assetId: string; datasets: DatasetCatalog | null; datasetRoot: string; datasetRootDirty: boolean; assetDirty: boolean; datasetDirty: boolean; assetPending: boolean; refreshStatus: DatasetRefreshStatus | null; refreshing: boolean; saveStates: Record<string, SaveState>; selectedAsset: DatasetCatalog["instruments"][number] | null; onAssetDraftChange: (draft: AssetDraft) => void; onAssetIdChange: (id: string) => void; onRefresh: () => void; onRetryRefresh: () => void; onRootChange: (root: string) => void; onReset: () => void; onSaveAsset: () => void; onSaveRoot: () => void }) {
  return <SettingsSection title="Local market data" description="Folder paths refer to the server’s market data. Reset restores the last saved folder and instrument values." dirty={props.datasetDirty} onReset={props.onReset}>
    <SettingRow controlId="dataset-root" label="Dataset root" description="Absolute server-side folder containing instrument and timeframe CSV files." scope="Workspace" effective={props.datasets?.root || "Not configured"} validation={!props.datasetRoot.trim() ? "Enter a dataset folder path." : null} saveState={props.saveStates["dataset-root"]} saveMessage={props.saveStates["dataset-root"] === "error" ? "Dataset root could not be saved. Your draft is kept." : undefined} onRetry={props.onSaveRoot}><div><input value={props.datasetRoot} onChange={(event) => props.onRootChange(event.target.value)} placeholder="/data/market" className={fieldClassName} /><button type="button" onClick={props.onSaveRoot} disabled={!props.datasetRootDirty || !props.datasetRoot.trim() || props.saveStates["dataset-root"] === "saving"} className="mt-2 min-h-10 w-full rounded-md bg-[var(--text-primary)] px-4 text-sm font-semibold text-[var(--ui-canvas)] hover:brightness-95 disabled:opacity-45">Apply dataset root</button></div></SettingRow>
    <SettingRow controlId="dataset-refresh" label="Dataset refresh" description="Rescan configured files. A running scan can be checked again without starting another." effective={refreshText(props.refreshStatus, props.datasets)} saveState={props.saveStates.refresh} saveMessage={props.saveStates.refresh === "error" ? "Dataset refresh could not be confirmed. Retry the status check." : undefined} onRetry={props.onRetryRefresh}><button type="button" onClick={props.onRefresh} disabled={props.refreshing} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[var(--ui-border-strong)] px-4 text-sm font-medium hover:bg-[var(--ui-hover)] disabled:opacity-45"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${props.refreshing || props.refreshStatus?.running ? "animate-spin motion-reduce:animate-none" : ""}`} />{props.refreshing ? "Checking datasets…" : props.refreshStatus?.running ? "Check scan status" : "Rescan datasets"}</button></SettingRow>
    <SettingRow controlId="asset-calibration" label="Instrument calibration" description="Update the selected instrument’s currency, IANA time zone, and positive P&L multiplier." scope="Workspace" validation={assetValidation(props.assetDraft)} saveState={props.saveStates.asset} saveMessage={props.saveStates.asset === "error" ? "Instrument settings could not be saved. Your draft is kept." : undefined} onRetry={props.onSaveAsset}><div className="space-y-2"><SettingsSelect ariaLabel="Instrument" value={props.assetId} onChange={props.onAssetIdChange} disabled={!props.datasets?.instruments.length} options={[{ value: "", label: "No instruments" }, ...(props.datasets?.instruments.map((asset) => ({ value: asset.id, label: `${asset.name} · ${asset.symbol}` })) ?? [])]} />{props.selectedAsset ? <><div className="grid gap-2 sm:grid-cols-3"><label className="text-xs text-[var(--text-secondary)]">Currency<input value={props.assetDraft.currency} maxLength={3} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, currency: event.target.value.toUpperCase() })} className={`${fieldClassName} mt-1`} /></label><label className="text-xs text-[var(--text-secondary)] sm:col-span-2">Time zone<input value={props.assetDraft.timezone} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, timezone: event.target.value })} placeholder="UTC" className={`${fieldClassName} mt-1`} /></label></div><label className="block text-xs text-[var(--text-secondary)]">P&amp;L multiplier<input inputMode="decimal" value={props.assetDraft.multiplier} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, multiplier: event.target.value })} className={`${fieldClassName} mt-1`} /></label><button type="button" onClick={props.onSaveAsset} disabled={!props.assetDirty || props.assetPending || Boolean(assetValidation(props.assetDraft))} className="min-h-10 w-full rounded-md bg-[var(--text-primary)] px-4 text-sm font-semibold text-[var(--ui-canvas)] hover:brightness-95 disabled:opacity-45">Save instrument</button></> : null}</div></SettingRow>
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

function sameAssetValues(a: AssetDraft, b: AssetDraft) { return a.currency === b.currency && a.timezone === b.timezone && a.multiplier === b.multiplier; }

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
