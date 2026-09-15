import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  deleteAuthSession,
  type DatasetCatalog,
  type DatasetRefreshResponse,
  type DatasetRefreshStatus,
} from "../../lib/api";
import {
  hydrateOrderLineModificationConfirmation,
  loadOrderLineModificationConfirmation,
  saveOrderLineModificationConfirmation,
} from "../../lib/backtestSettings";
import {
  DEFAULT_CHART_VISUAL_SETTINGS,
  hydrateChartSettingsPresets,
  loadActiveChartSettingsPreset,
  saveChartSettingsPreset,
  type ChartVisualSettings,
} from "../../lib/chartSettings";
import { clearStoredAuthSession, getStoredAuthSession } from "../../lib/authSession";
import {
  hydrateOrderCommissionFixed,
  hydrateOrderCommissionMode,
  hydrateOrderCommissionPercent,
  hydrateOrderDefaultQuantity,
  hydrateOrderDefaultRiskPercent,
  hydrateOrderFeeFixed,
  hydrateOrderFeeMode,
  hydrateOrderFeePercent,
  hydrateOrderRiskBase,
  hydrateOrderSizingMode,
  loadOrderCommissionFixed,
  loadOrderCommissionMode,
  loadOrderCommissionPercent,
  loadOrderDefaultQuantity,
  loadOrderDefaultRiskPercent,
  loadOrderFeeFixed,
  loadOrderFeeMode,
  loadOrderFeePercent,
  loadOrderRiskBase,
  loadOrderSizingMode,
  saveOrderCommissionFixed,
  saveOrderCommissionMode,
  saveOrderCommissionPercent,
  saveOrderDefaultQuantity,
  saveOrderDefaultRiskPercent,
  saveOrderFeeFixed,
  saveOrderFeeMode,
  saveOrderFeePercent,
  saveOrderRiskBase,
  saveOrderSizingMode,
  type OrderCommissionMode,
  type OrderRiskBase,
  type OrderSizingMode,
} from "../../lib/orderSettings";
import { getCachedAppStorageItem, loadAppStorageItem, saveAppStorageItemConfirmed } from "../../lib/serverStorage";
import {
  DEFAULT_SETTINGS_PREFERENCES,
  hydrateSettingsPreferences,
  loadSettingsPreferences,
  saveSettingsPreferences,
  type SettingsPreferences,
} from "../../lib/settingsPreferences";
import { SettingsDataTransfer } from "./SettingsDataTransfer";
import { SettingsIntegrations } from "./SettingsIntegrations";
import { SettingRow, SettingsSection, SettingsToggle, fieldClassName, type SaveState } from "./SettingsPrimitives";
import { SettingsSearch } from "./SettingsSearch";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CONTROLS,
  parseSettingsDeepLink,
  settingsDeepLink,
  type SettingsCategoryId,
  type SettingsControl,
} from "./settingsCatalog";

const NOTE_TEMPLATE_KEY = "notebook-template.v1";
const DEFAULT_NOTE_TEMPLATE = [
  "Setup",
  "- Context:",
  "- Trigger:",
  "",
  "Execution",
  "- Side: {side}",
  "- Quantity: {quantity}",
  "- Entry: {entry}",
  "- Exit: {exit}",
  "- Result: {pnl} ({r}R)",
  "",
  "Review",
  "- What worked:",
  "- What needs correction:",
  "- Next action:",
].join("\n");

export type SettingsJournalDefaults = {
  default_broker: string;
  default_currency: string;
  default_entry_type: "MISSED" | "TAKEN";
  require_account_for_taken_trades: boolean;
};

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

type CostDraft = {
  commissionFixed: string;
  commissionMode: OrderCommissionMode;
  commissionPercent: string;
  feeFixed: string;
  feeMode: OrderCommissionMode;
  feePercent: string;
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
  journalDefaults,
  onBack,
  backLabel = "Back",
  onGetDatasetRefreshStatus,
  onRefreshDatasets,
  onUpdateDatasetAsset,
  onUpdateDatasetSettings,
  onUpdateJournalDefaults,
}: Props) {
  const initialLink = typeof window === "undefined" ? null : parseSettingsDeepLink(window.location.hash);
  const [category, setCategory] = useState<SettingsCategoryId>(initialLink?.category ?? initialCategory);
  const [focusControl, setFocusControl] = useState<string | null>(initialLink?.controlId ?? null);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [preferences, setPreferences] = useState<SettingsPreferences>(() => loadSettingsPreferences());
  const [journalBaseline, setJournalBaseline] = useState(journalDefaults);
  const [journalDraft, setJournalDraft] = useState(journalDefaults);
  const [noteBaseline, setNoteBaseline] = useState(() => getCachedAppStorageItem(NOTE_TEMPLATE_KEY, DEFAULT_NOTE_TEMPLATE));
  const [noteDraft, setNoteDraft] = useState(noteBaseline);
  const activeChart = loadActiveChartSettingsPreset()?.settings ?? DEFAULT_CHART_VISUAL_SETTINGS;
  const [chartBaseline, setChartBaseline] = useState<ChartVisualSettings>(activeChart);
  const [chartDraft, setChartDraft] = useState<ChartVisualSettings>(activeChart);
  const [sizingMode, setSizingMode] = useState<OrderSizingMode>(() => loadOrderSizingMode());
  const [riskBase, setRiskBase] = useState<OrderRiskBase>(() => loadOrderRiskBase());
  const [quantity, setQuantity] = useState(() => loadOrderDefaultQuantity());
  const [riskPercent, setRiskPercent] = useState(() => loadOrderDefaultRiskPercent());
  const [costs, setCosts] = useState<CostDraft>(() => currentCosts());
  const [lineConfirmation, setLineConfirmation] = useState(() => loadOrderLineModificationConfirmation());
  const quantitySavedRef = useRef(quantity);
  const riskSavedRef = useRef(riskPercent);
  const costsSavedRef = useRef(costs);
  const hydratedRef = useRef(false);
  const [datasetRootBaseline, setDatasetRootBaseline] = useState(datasets?.root ?? "");
  const [datasetRoot, setDatasetRoot] = useState(datasets?.root ?? "");
  const [refreshStatus, setRefreshStatus] = useState<DatasetRefreshStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [assetId, setAssetId] = useState(datasets?.instruments[0]?.id ?? "");
  const selectedAsset = datasets?.instruments.find((asset) => asset.id === assetId) ?? null;
  const [assetDraft, setAssetDraft] = useState(() => assetValues(selectedAsset));
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null);
  const authSession = getStoredAuthSession();

  const journalDirty = !same(journalDraft, journalBaseline);
  const noteDirty = noteDraft !== noteBaseline;
  const chartDirty = !same(chartDraft, chartBaseline);
  const datasetRootDirty = datasetRoot !== datasetRootBaseline;
  const hasDirty = journalDirty || noteDirty || chartDirty || datasetRootDirty;

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
    let cancelled = false;
    void Promise.all([
      hydrateSettingsPreferences(),
      loadAppStorageItem(NOTE_TEMPLATE_KEY, DEFAULT_NOTE_TEMPLATE),
      hydrateChartSettingsPresets(),
      hydrateOrderSizingMode(), hydrateOrderRiskBase(), hydrateOrderDefaultQuantity(), hydrateOrderDefaultRiskPercent(),
      hydrateOrderCommissionMode(), hydrateOrderCommissionFixed(), hydrateOrderCommissionPercent(),
      hydrateOrderFeeMode(), hydrateOrderFeeFixed(), hydrateOrderFeePercent(),
      hydrateOrderLineModificationConfirmation(),
    ]).then(([nextPreferences, nextNote, presets, nextSizing, nextRiskBase, nextQuantity, nextRisk, commissionMode, commissionFixed, commissionPercent, feeMode, feeFixed, feePercent, nextConfirmation]) => {
      if (cancelled) return;
      const nextCosts = { commissionMode, commissionFixed, commissionPercent, feeMode, feeFixed, feePercent };
      setPreferences(nextPreferences);
      setNoteBaseline(nextNote); setNoteDraft(nextNote);
      const nextChart = loadActiveChartSettingsPreset(presets)?.settings ?? DEFAULT_CHART_VISUAL_SETTINGS;
      setChartBaseline(nextChart); setChartDraft(nextChart);
      setSizingMode(nextSizing); setRiskBase(nextRiskBase);
      quantitySavedRef.current = nextQuantity; setQuantity(nextQuantity);
      riskSavedRef.current = nextRisk; setRiskPercent(nextRisk);
      costsSavedRef.current = nextCosts; setCosts(nextCosts);
      setLineConfirmation(nextConfirmation);
      hydratedRef.current = true;
    }).catch(() => {
      hydratedRef.current = true;
      setSaveStates((current) => ({ ...current, hydration: "error" }));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || quantity === quantitySavedRef.current) return;
    if (!positiveNumber(quantity)) return;
    setSaveStates((current) => ({ ...current, quantity: "saving" }));
    const timer = window.setTimeout(() => {
      void saveOrderDefaultQuantity(quantity).then(() => {
        quantitySavedRef.current = quantity;
        setSaveStates((current) => ({ ...current, quantity: "saved" }));
      }).catch(() => setSaveStates((current) => ({ ...current, quantity: "error" })));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [quantity]);

  useEffect(() => {
    if (!hydratedRef.current || riskPercent === riskSavedRef.current) return;
    if (!validRisk(riskPercent)) return;
    setSaveStates((current) => ({ ...current, risk: "saving" }));
    const timer = window.setTimeout(() => {
      void saveOrderDefaultRiskPercent(riskPercent).then(() => {
        riskSavedRef.current = riskPercent;
        setSaveStates((current) => ({ ...current, risk: "saved" }));
      }).catch(() => setSaveStates((current) => ({ ...current, risk: "error" })));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [riskPercent]);

  useEffect(() => {
    if (!hydratedRef.current || same(costs, costsSavedRef.current) || costError(costs)) return;
    setSaveStates((current) => ({ ...current, costs: "saving" }));
    const timer = window.setTimeout(() => {
      void Promise.all([
        saveOrderCommissionFixed(costs.commissionFixed), saveOrderCommissionPercent(costs.commissionPercent),
        saveOrderFeeFixed(costs.feeFixed), saveOrderFeePercent(costs.feePercent),
      ]).then(() => {
        costsSavedRef.current = costs;
        setSaveStates((current) => ({ ...current, costs: "saved" }));
      }).catch(() => setSaveStates((current) => ({ ...current, costs: "error" })));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [costs]);

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

  function setImmediate<T>(key: string, label: string, previous: T, next: T, apply: (value: T) => Promise<unknown> | unknown, update: (value: T) => void) {
    update(next);
    setUndoAction({ label, run: () => { update(previous); void save(key, () => apply(previous)); } });
    void save(key, () => apply(next)).catch(() => update(previous));
  }

  async function saveJournal() {
    await save("journal", () => onUpdateJournalDefaults(journalDraft));
    setJournalBaseline(journalDraft);
  }

  async function saveNote() {
    if (!noteDraft.trim()) return;
    await save("note", () => saveAppStorageItemConfirmed(NOTE_TEMPLATE_KEY, noteDraft));
    setNoteBaseline(noteDraft);
  }

  async function saveChart() {
    await save("chart", () => saveChartSettingsPreset("Settings default", chartDraft));
    setChartBaseline(chartDraft);
  }

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

  async function signOut() {
    if (!authSession) return;
    setSaveStates((current) => ({ ...current, signout: "saving" }));
    try { await deleteAuthSession(authSession.token); } catch { /* Local session removal remains available. */ }
    clearStoredAuthSession();
    window.location.assign("/signin");
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
            {hasDirty ? <p className="text-sm text-amber-200" role="status">Draft changes not applied</p> : <p className="text-sm text-zinc-500">All explicit changes applied</p>}
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
              const status = categoryStatus(item.id, { datasets, journalDirty, noteDirty, chartDirty, datasetRootDirty, signedIn: Boolean(authSession) });
              return <button key={item.id} type="button" aria-current={selected ? "page" : undefined} onClick={() => navigate(item.id)} className={`flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${selected ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}><Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{item.label}</span>{status ? <span className={`text-[11px] ${status === "Unsaved" ? "text-amber-200" : "text-zinc-600"}`}>{status}</span> : null}</button>;
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          {undoAction ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-cyan-400/20 bg-cyan-400/[0.04] px-3 py-2 text-sm"><span className="text-cyan-50">{undoAction.label}</span><button type="button" onClick={() => { undoAction.run(); setUndoAction(null); }} className="inline-flex min-h-8 items-center gap-1.5 rounded px-2 text-xs font-semibold text-cyan-300 hover:bg-white/5"><Undo2 aria-hidden="true" className="h-3.5 w-3.5" />Undo</button></div> : null}
          {saveStates.hydration === "error" ? <div className="mb-4 border-l-2 border-amber-300 bg-amber-300/5 px-3 py-2 text-sm text-amber-100" role="alert">Some cross-device values could not be loaded. Local effective values remain available.</div> : null}
          <div className="mb-5 border-b border-white/10 pb-5"><p className="text-xs text-zinc-500">{controlsInCategory} supported control{controlsInCategory === 1 ? "" : "s"}</p><h2 className="mt-1 text-xl font-semibold text-white">{activeCategory.label}</h2><p className="mt-1 text-sm leading-6 text-zinc-400">{activeCategory.description}</p></div>

          {category === "global" ? <GlobalSettings /> : null}
          {category === "journal" ? <>
            <SettingsSection title="Journal defaults" description="These workspace defaults prefill new journal entries; existing trades are never rewritten." dirty={journalDirty} onReset={() => setJournalDraft({ default_broker: "", default_currency: "USD", default_entry_type: "TAKEN", require_account_for_taken_trades: false })}>
              <SettingRow controlId="journal-defaults" label="Capture defaults" description="Set the currency, broker label, entry type, and whether taken trades require an account." scope="Workspace" effective={`${journalBaseline.default_currency} · ${journalBaseline.default_entry_type.toLowerCase()}`} saveState={saveStates.journal} onRetry={() => void saveJournal()} validation={!/^[A-Za-z]{3}$/.test(journalDraft.default_currency) ? "Use a three-letter currency code, for example USD." : null}>
                <div className="space-y-2"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-zinc-400">Currency<input value={journalDraft.default_currency} maxLength={3} onChange={(event) => setJournalDraft((current) => ({ ...current, default_currency: event.target.value.toUpperCase() }))} className={`${fieldClassName} mt-1`} /></label><label className="text-xs text-zinc-400">Broker label<input value={journalDraft.default_broker} maxLength={80} placeholder="Optional" onChange={(event) => setJournalDraft((current) => ({ ...current, default_broker: event.target.value }))} className={`${fieldClassName} mt-1`} /></label></div><label className="block text-xs text-zinc-400">Default entry type<select value={journalDraft.default_entry_type} onChange={(event) => setJournalDraft((current) => ({ ...current, default_entry_type: event.target.value as "MISSED" | "TAKEN" }))} className={`${fieldClassName} mt-1`}><option value="TAKEN">Taken</option><option value="MISSED">Missed</option></select></label><div className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-2.5"><span className="text-xs text-zinc-300">Require account for taken trades</span><SettingsToggle checked={journalDraft.require_account_for_taken_trades} label="Require account for taken trades" onChange={(checked) => setJournalDraft((current) => ({ ...current, require_account_for_taken_trades: checked }))} /></div><button type="button" disabled={!journalDirty || !/^[A-Za-z]{3}$/.test(journalDraft.default_currency) || saveStates.journal === "saving"} onClick={() => void saveJournal()} className="min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Apply journal defaults</button></div>
              </SettingRow>
              <SettingRow controlId="note-template" label="Review note template" description="Supported placeholders: {side}, {quantity}, {entry}, {exit}, {pnl}, and {r}." scope="Personal" effective="Inserted when a new notebook note starts" validation={!noteDraft.trim() ? "The template cannot be empty." : null} saveState={saveStates.note} onRetry={() => void saveNote()}>
                <div><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={10} className={`${fieldClassName} min-h-48 resize-y py-2 font-mono text-xs`} /><button type="button" onClick={() => void saveNote()} disabled={!noteDirty || !noteDraft.trim() || saveStates.note === "saving"} className="mt-2 min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Save note template</button></div>
              </SettingRow>
            </SettingsSection>
          </> : null}
          {category === "backtest" ? <BacktestSettings
            costs={costs} lineConfirmation={lineConfirmation} quantity={quantity} riskBase={riskBase} riskPercent={riskPercent} saveStates={saveStates} sizingMode={sizingMode}
            onCostsChange={setCosts} onQuantityChange={setQuantity} onRiskPercentChange={setRiskPercent}
            onLineConfirmationChange={(next) => setImmediate("line", "Chart-line confirmation changed", lineConfirmation, next, saveOrderLineModificationConfirmation, setLineConfirmation)}
            onRiskBaseChange={(next) => setImmediate("risk-base", "Risk balance basis changed", riskBase, next, saveOrderRiskBase, setRiskBase)}
            onSizingModeChange={(next) => setImmediate("sizing", "Order sizing mode changed", sizingMode, next, saveOrderSizingMode, setSizingMode)}
            onCommissionModeChange={(next) => setImmediate("commission-mode", "Commission mode changed", costs.commissionMode, next, saveOrderCommissionMode, (value) => { costsSavedRef.current = { ...costsSavedRef.current, commissionMode: value }; setCosts((current) => ({ ...current, commissionMode: value })); })}
            onFeeModeChange={(next) => setImmediate("fee-mode", "Fee mode changed", costs.feeMode, next, saveOrderFeeMode, (value) => { costsSavedRef.current = { ...costsSavedRef.current, feeMode: value }; setCosts((current) => ({ ...current, feeMode: value })); })}
          /> : null}
          {category === "chart" ? <ChartSettings draft={chartDraft} baseline={chartBaseline} saveState={saveStates.chart} onChange={setChartDraft} onReset={() => setChartDraft(DEFAULT_CHART_VISUAL_SETTINGS)} onSave={() => void saveChart()} /> : null}
          {category === "appearance" ? <AppearanceSettings chartDraft={chartDraft} chartBaseline={chartBaseline} preferences={preferences} saveState={saveStates.preferences} onChartChange={setChartDraft} onSaveChart={() => void saveChart()} onPreferenceChange={(next) => setImmediate("preferences", "Settings density changed", preferences, next, saveSettingsPreferences, setPreferences)} /> : null}
          {category === "data-providers" ? <>
            <DatasetSettings assetDraft={assetDraft} assetId={assetId} datasets={datasets} datasetRoot={datasetRoot} datasetRootDirty={datasetRootDirty} refreshStatus={refreshStatus} refreshing={refreshing} saveStates={saveStates} selectedAsset={selectedAsset} onAssetDraftChange={setAssetDraft} onAssetIdChange={setAssetId} onRefresh={() => void refreshDatasetsNow()} onRootChange={setDatasetRoot} onSaveAsset={() => void saveAsset()} onSaveRoot={() => void saveDatasetRoot()} />
            <SettingsIntegrations />
          </> : null}
          {category === "account" ? <AccountSettings authSession={authSession} signOutState={saveStates.signout} onSignOut={() => void signOut()} /> : null}
          {category === "ai" ? <AiSettings /> : null}
          {category === "privacy-security" ? <PrivacySettings preferences={preferences} saveState={saveStates.preferences} onPreferenceChange={(next) => setImmediate("preferences", "Diagnostic sharing default changed", preferences, next, saveSettingsPreferences, setPreferences)} /> : null}
          {category === "storage" ? <SettingsDataTransfer /> : null}
        </div>
      </div>
    </main>
  );
}

function GlobalSettings() {
  const locale = typeof navigator === "undefined" ? "Unavailable" : navigator.language;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "System default";
  const sample = new Intl.NumberFormat(locale === "Unavailable" ? undefined : locale, { maximumFractionDigits: 2 }).format(12345.67);
  return <SettingsSection title="Effective regional behavior" description="EdgeLab currently follows this browser. These system values are read-only so the interface never implies a server preference that does not exist."><SettingRow controlId="regional-format" label="Language, time zone, and number format" description="Used for human-readable dates and numbers unless a dataset or session provides its own time zone." scope="System" effective={`${locale} · ${timeZone}`}><dl className="grid gap-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-zinc-500">Language</dt><dd>{locale}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Time zone</dt><dd className="text-right">{timeZone}</dd></div><div className="flex justify-between gap-3"><dt className="text-zinc-500">Number sample</dt><dd>{sample}</dd></div></dl></SettingRow></SettingsSection>;
}

function BacktestSettings(props: {
  costs: CostDraft; lineConfirmation: boolean; quantity: string; riskBase: OrderRiskBase; riskPercent: string; sizingMode: OrderSizingMode; saveStates: Record<string, SaveState>;
  onCostsChange: (value: CostDraft) => void; onQuantityChange: (value: string) => void; onRiskPercentChange: (value: string) => void;
  onLineConfirmationChange: (value: boolean) => void; onRiskBaseChange: (value: OrderRiskBase) => void; onSizingModeChange: (value: OrderSizingMode) => void;
  onCommissionModeChange: (value: OrderCommissionMode) => void; onFeeModeChange: (value: OrderCommissionMode) => void;
}) {
  return <SettingsSection title="New-order defaults" description="Immediate choices apply to the next order. Numeric fields debounce for 600 ms after valid input; active orders are unchanged." onReset={() => { props.onSizingModeChange("quantity"); props.onRiskBaseChange("CURRENT_BALANCE"); props.onQuantityChange("100000"); props.onRiskPercentChange("1"); props.onCommissionModeChange("NONE"); props.onFeeModeChange("NONE"); props.onCostsChange({ commissionMode: "NONE", commissionFixed: "0", commissionPercent: "0", feeMode: "NONE", feeFixed: "0", feePercent: "0" }); }}>
    <SettingRow controlId="sizing-mode" label="Order sizing mode" description="Fixed quantity uses units; percent risk requires a protective stop." effective={props.sizingMode === "quantity" ? "Fixed quantity" : "Percent risk"} saveState={props.saveStates.sizing}><select value={props.sizingMode} onChange={(event) => props.onSizingModeChange(event.target.value as OrderSizingMode)} className={fieldClassName}><option value="quantity">Fixed quantity</option><option value="risk">Percent risk</option></select></SettingRow>
    <SettingRow controlId="default-quantity" label="Default quantity" description="Positive units used to prefill new fixed-size orders." validation={positiveNumber(props.quantity) ? null : "Enter a number greater than zero."} saveState={props.saveStates.quantity}><div className="relative"><input inputMode="decimal" value={props.quantity} onChange={(event) => props.onQuantityChange(event.target.value)} className={`${fieldClassName} pr-16`} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">units</span></div></SettingRow>
    <SettingRow controlId="default-risk" label="Default risk" description="Percent of the selected balance basis used for new risk-sized orders." validation={validRisk(props.riskPercent) ? null : "Enter a percentage greater than 0 and no more than 100."} saveState={props.saveStates.risk}><div className="relative"><input inputMode="decimal" value={props.riskPercent} onChange={(event) => props.onRiskPercentChange(event.target.value)} className={`${fieldClassName} pr-10`} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">%</span></div></SettingRow>
    <SettingRow controlId="risk-basis" label="Risk balance basis" description="Choose whether percent risk follows current equity or the original session balance." effective={props.riskBase === "CURRENT_BALANCE" ? "Current balance" : "Initial balance"} saveState={props.saveStates["risk-base"]}><select value={props.riskBase} onChange={(event) => props.onRiskBaseChange(event.target.value as OrderRiskBase)} className={fieldClassName}><option value="CURRENT_BALANCE">Current balance</option><option value="INITIAL_BALANCE">Initial balance</option></select></SettingRow>
    <SettingRow controlId="trading-costs" label="Commissions and fees" description="Modes save immediately. Valid numeric values debounce and apply to new orders only." validation={costError(props.costs)} saveState={props.saveStates.costs}><div className="space-y-3"><CostEditor label="Commission" mode={props.costs.commissionMode} fixed={props.costs.commissionFixed} percent={props.costs.commissionPercent} onMode={props.onCommissionModeChange} onFixed={(value) => props.onCostsChange({ ...props.costs, commissionFixed: value })} onPercent={(value) => props.onCostsChange({ ...props.costs, commissionPercent: value })} /><CostEditor label="Fee" mode={props.costs.feeMode} fixed={props.costs.feeFixed} percent={props.costs.feePercent} onMode={props.onFeeModeChange} onFixed={(value) => props.onCostsChange({ ...props.costs, feeFixed: value })} onPercent={(value) => props.onCostsChange({ ...props.costs, feePercent: value })} /></div></SettingRow>
    <SettingRow controlId="line-confirmation" label="Chart-line confirmation" description="Ask before dragging a chart line changes a pending order." effective={props.lineConfirmation ? "Required" : "Not required"} saveState={props.saveStates.line}><SettingsToggle checked={props.lineConfirmation} label="Require chart-line confirmation" onChange={props.onLineConfirmationChange} /></SettingRow>
  </SettingsSection>;
}

function CostEditor({ label, mode, fixed, percent, onMode, onFixed, onPercent }: { label: string; mode: OrderCommissionMode; fixed: string; percent: string; onMode: (value: OrderCommissionMode) => void; onFixed: (value: string) => void; onPercent: (value: string) => void }) {
  return <fieldset><legend className="mb-1 text-xs font-medium text-zinc-400">{label}</legend><div className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,1fr)] gap-2"><select value={mode} onChange={(event) => onMode(event.target.value as OrderCommissionMode)} className={fieldClassName}><option value="NONE">None</option><option value="FIXED">Fixed</option><option value="PERCENT">Percent</option></select>{mode === "NONE" ? <div className="grid min-h-10 place-items-center rounded-md border border-white/8 text-xs text-zinc-600">No value</div> : <div className="relative"><input inputMode="decimal" value={mode === "FIXED" ? fixed : percent} onChange={(event) => mode === "FIXED" ? onFixed(event.target.value) : onPercent(event.target.value)} className={`${fieldClassName} pr-9`} aria-label={`${label} ${mode === "FIXED" ? "fixed amount" : "percentage"}`} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">{mode === "FIXED" ? "amt" : "%"}</span></div>}</div></fieldset>;
}

function ChartSettings({ draft, baseline, saveState, onChange, onReset, onSave }: { draft: ChartVisualSettings; baseline: ChartVisualSettings; saveState?: SaveState; onChange: (value: ChartVisualSettings) => void; onReset: () => void; onSave: () => void }) {
  const dirty = !same(draft, baseline);
  return <SettingsSection title="Staged chart preset" description="Preview a focused subset of supported chart defaults. Applying saves an active preset for the next workspace load; it does not mutate the chart currently in use." dirty={dirty} onReset={onReset}>
    <SettingRow controlId="chart-preset" label="Chart visual preset" description="Set time display, date labels, text size, grid, and core chart colors." scope="Workspace" effective="Active on next workspace load" saveState={saveState}>
      <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-2"><label className="text-xs text-zinc-400">Hours<select value={draft.timeHoursFormat} onChange={(event) => onChange({ ...draft, timeHoursFormat: event.target.value as ChartVisualSettings["timeHoursFormat"] })} className={`${fieldClassName} mt-1`}><option value="12-hour">12-hour</option><option value="24-hour">24-hour</option></select></label><label className="text-xs text-zinc-400">Date format<select value={draft.dateFormat} onChange={(event) => onChange({ ...draft, dateFormat: event.target.value as ChartVisualSettings["dateFormat"] })} className={`${fieldClassName} mt-1`}><option value="dd MMM yy">31 Dec 26</option><option value="MMM dd yyyy">Dec 31 2026</option><option value="yyyy-MM-dd">2026-12-31</option></select></label><label className="text-xs text-zinc-400">Text size<input type="number" min={9} max={24} step={1} value={draft.textSize} onChange={(event) => onChange({ ...draft, textSize: Math.min(24, Math.max(9, Number(event.target.value) || 9)) })} className={`${fieldClassName} mt-1`} /></label><label className="text-xs text-zinc-400">Grid<select value={draft.gridMode} onChange={(event) => onChange({ ...draft, gridMode: event.target.value as ChartVisualSettings["gridMode"] })} className={`${fieldClassName} mt-1`}><option value="both">Horizontal and vertical</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="none">None</option></select></label></div><PalettePreview draft={draft} onChange={onChange} /><button type="button" disabled={!dirty || saveState === "saving"} onClick={onSave} className="min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Apply as active preset</button></div>
    </SettingRow>
  </SettingsSection>;
}

function AppearanceSettings({ chartDraft, chartBaseline, preferences, saveState, onChartChange, onSaveChart, onPreferenceChange }: { chartDraft: ChartVisualSettings; chartBaseline: ChartVisualSettings; preferences: SettingsPreferences; saveState?: SaveState; onChartChange: (value: ChartVisualSettings) => void; onSaveChart: () => void; onPreferenceChange: (value: SettingsPreferences) => void }) {
  const chartDirty = !same(chartDraft, chartBaseline);
  return <SettingsSection title="Interface presentation" description="Density applies immediately to this settings workspace. Palette changes remain staged until you apply the chart preset." onReset={() => onPreferenceChange(DEFAULT_SETTINGS_PREFERENCES)}>
    <SettingRow controlId="settings-density" label="Settings density" description="Choose comfortable or compact row spacing without hiding explanations or status." effective={preferences.density} saveState={saveState}><select value={preferences.density} onChange={(event) => onPreferenceChange({ ...preferences, density: event.target.value as SettingsPreferences["density"] })} className={fieldClassName}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></SettingRow>
    <SettingRow controlId="palette-preview" label="Palette preview" description="Stage background, text, grid, up-candle, and down-candle colors with a representative preview." scope="Workspace" effective={chartDirty ? "Draft, not applied" : "Saved preset"}><div className="space-y-3"><PalettePreview draft={chartDraft} onChange={onChartChange} /><button type="button" disabled={!chartDirty} onClick={onSaveChart} className="min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Apply palette preset</button></div></SettingRow>
  </SettingsSection>;
}

function PalettePreview({ draft, onChange }: { draft: ChartVisualSettings; onChange: (value: ChartVisualSettings) => void }) {
  return <div><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{([['backgroundColor','Background'],['textColor','Text'],['gridColor','Grid'],['candleUpColor','Up'],['candleDownColor','Down']] as const).map(([key, label]) => <label key={key} className="text-[11px] text-zinc-500">{label}<input type="color" value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} className="mt-1 h-9 w-full cursor-pointer rounded border border-white/10 bg-transparent p-1" /></label>)}</div><div className="mt-3 overflow-hidden rounded-md border border-white/10 p-3" style={{ backgroundColor: draft.backgroundColor, color: draft.textColor }} aria-label="Staged chart palette preview"><div className="relative h-20" style={{ backgroundImage: draft.gridMode === "none" ? undefined : `linear-gradient(${draft.gridColor} 1px, transparent 1px), linear-gradient(90deg, ${draft.gridColor} 1px, transparent 1px)`, backgroundSize: "28px 20px" }}><div className="absolute bottom-3 left-[18%] h-9 w-2" style={{ backgroundColor: draft.candleUpColor }} /><div className="absolute bottom-5 left-[35%] h-7 w-2" style={{ backgroundColor: draft.candleDownColor }} /><div className="absolute bottom-6 left-[52%] h-10 w-2" style={{ backgroundColor: draft.candleUpColor }} /><div className="absolute bottom-4 left-[69%] h-6 w-2" style={{ backgroundColor: draft.candleDownColor }} /><span className="absolute left-2 top-1" style={{ fontSize: draft.textSize }}>Preview</span></div></div></div>;
}

type AssetDraft = { currency: string; timezone: string; multiplier: string };
function DatasetSettings(props: { assetDraft: AssetDraft; assetId: string; datasets: DatasetCatalog | null; datasetRoot: string; datasetRootDirty: boolean; refreshStatus: DatasetRefreshStatus | null; refreshing: boolean; saveStates: Record<string, SaveState>; selectedAsset: DatasetCatalog["instruments"][number] | null; onAssetDraftChange: (draft: AssetDraft) => void; onAssetIdChange: (id: string) => void; onRefresh: () => void; onRootChange: (root: string) => void; onSaveAsset: () => void; onSaveRoot: () => void }) {
  return <SettingsSection title="Local market data" description="Dataset controls use the configured server scan API. Folder paths are interpreted by the EdgeLab backend, not by this browser." dirty={props.datasetRootDirty} onReset={() => props.onRootChange("")}>
    <SettingRow controlId="dataset-root" label="Dataset root" description="Absolute server-side folder containing instrument and timeframe CSV files." scope="Workspace" effective={props.datasets?.root || "Not configured"} validation={!props.datasetRoot.trim() ? "Enter a dataset folder path." : null} saveState={props.saveStates["dataset-root"]} onRetry={props.onSaveRoot}><div><input value={props.datasetRoot} onChange={(event) => props.onRootChange(event.target.value)} placeholder="/data/market" className={fieldClassName} /><button type="button" onClick={props.onSaveRoot} disabled={!props.datasetRootDirty || !props.datasetRoot.trim()} className="mt-2 min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Apply dataset root</button></div></SettingRow>
    <SettingRow controlId="dataset-refresh" label="Dataset refresh" description="Rescan configured files. A running scan can be checked again without starting another." effective={refreshText(props.refreshStatus, props.datasets)} saveState={props.saveStates.refresh} onRetry={props.onRefresh}><button type="button" onClick={props.onRefresh} disabled={props.refreshing || props.refreshStatus?.running} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/15 px-4 text-sm font-medium hover:bg-white/5 disabled:opacity-45"><RefreshCw aria-hidden="true" className={`h-4 w-4 ${props.refreshing || props.refreshStatus?.running ? "animate-spin motion-reduce:animate-none" : ""}`} />{props.refreshStatus?.running ? `Scanning ${props.refreshStatus.current ?? "files"}…` : "Rescan datasets"}</button></SettingRow>
    <SettingRow controlId="asset-calibration" label="Instrument calibration" description="Update the selected instrument’s currency, IANA time zone, and positive P&L multiplier." scope="Workspace" validation={assetValidation(props.assetDraft)} saveState={props.saveStates.asset} onRetry={props.onSaveAsset}><div className="space-y-2"><select value={props.assetId} onChange={(event) => props.onAssetIdChange(event.target.value)} disabled={!props.datasets?.instruments.length} className={fieldClassName}><option value="">No instruments</option>{props.datasets?.instruments.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.symbol}</option>)}</select>{props.selectedAsset ? <><div className="grid gap-2 sm:grid-cols-3"><label className="text-xs text-zinc-400">Currency<input value={props.assetDraft.currency} maxLength={3} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, currency: event.target.value.toUpperCase() })} className={`${fieldClassName} mt-1`} /></label><label className="text-xs text-zinc-400 sm:col-span-2">Time zone<input value={props.assetDraft.timezone} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, timezone: event.target.value })} placeholder="UTC" className={`${fieldClassName} mt-1`} /></label></div><label className="block text-xs text-zinc-400">P&amp;L multiplier<input inputMode="decimal" value={props.assetDraft.multiplier} onChange={(event) => props.onAssetDraftChange({ ...props.assetDraft, multiplier: event.target.value })} className={`${fieldClassName} mt-1`} /></label><button type="button" onClick={props.onSaveAsset} disabled={Boolean(assetValidation(props.assetDraft))} className="min-h-10 w-full rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 disabled:opacity-45">Save instrument</button></> : null}</div></SettingRow>
  </SettingsSection>;
}

function AccountSettings({ authSession, signOutState, onSignOut }: { authSession: ReturnType<typeof getStoredAuthSession>; signOutState?: SaveState; onSignOut: () => void }) {
  return <SettingsSection title="Identity and session" description="Only the active browser session is exposed by the current API; EdgeLab does not claim visibility into other devices.">
    <SettingRow controlId="account-identity" label="Account identity" description="Approved beta identity attached to owned settings and records." scope="Personal" effective={authSession ? `${authSession.user.name} · ${authSession.user.provider}` : "No authenticated user"}><div className="text-sm"><p className="text-zinc-100">{authSession?.user.name ?? "Signed out"}</p><p className="mt-1 break-all text-xs text-zinc-500">{authSession?.user.email ?? "No email"}</p></div></SettingRow>
    <SettingRow controlId="current-session" label="Current browser session" description="Ending it removes the local token and asks the server to revoke the session." scope="Personal" effective={authSession ? `Expires ${new Date(authSession.expiresAt).toLocaleString()}` : "Inactive"} saveState={signOutState}><button type="button" onClick={onSignOut} disabled={!authSession || signOutState === "saving"} className="min-h-10 w-full rounded-md border border-rose-400/30 px-4 text-sm font-semibold text-rose-200 hover:bg-rose-400/10 disabled:opacity-45">End session and sign out</button></SettingRow>
  </SettingsSection>;
}

function AiSettings() {
  return <SettingsSection title="AI availability" description="Only supported behavior is shown. No controls are offered for services this build does not operate."><SettingRow controlId="ai-routing" label="AI model routing" description="No AI model is configured in this EdgeLab build." scope="System" effective="Off"><div className="space-y-2 text-xs leading-5 text-zinc-400"><p>Workspace content and conversations are not routed to an AI provider.</p><p>Conversation retention: not used. Microphone processing: not enabled. Generated-code execution: not enabled.</p></div></SettingRow></SettingsSection>;
}

function PrivacySettings({ preferences, saveState, onPreferenceChange }: { preferences: SettingsPreferences; saveState?: SaveState; onPreferenceChange: (value: SettingsPreferences) => void }) {
  return <SettingsSection title="Privacy and security boundaries" description="These rows distinguish actual preferences from enforced system behavior." onReset={() => onPreferenceChange(DEFAULT_SETTINGS_PREFERENCES)}>
    <SettingRow controlId="diagnostic-sharing" label="Diagnostic sharing" description="Set whether the feedback form initially includes browser diagnostics. You can still change it for each submission." effective={preferences.includeDiagnosticsByDefault ? "Included by default" : "Excluded by default"} saveState={saveState}><SettingsToggle checked={preferences.includeDiagnosticsByDefault} label="Include diagnostics by default" onChange={(checked) => onPreferenceChange({ ...preferences, includeDiagnosticsByDefault: checked })} /></SettingRow>
    <SettingRow controlId="credential-vault" label="Credential handling" description="Integration credentials are sent to the authenticated server vault, encrypted at rest, and returned only as metadata." scope="System" effective="Write-only values; owner-scoped metadata"><p className="text-xs leading-5 text-zinc-400">Use Data &amp; providers to verify decryptability, re-encrypt, or revoke a record. EdgeLab never displays the stored secret value.</p></SettingRow>
    <SettingRow controlId="workspace-sharing" label="Workspace sharing" description="Snapshots require an EdgeLab session and an exact owner-or-recipient match. Recipients see a read-only snapshot until they open it as a separate copy." scope="System" effective="Recipient-bound; bearer token alone is insufficient"><p className="text-xs leading-5 text-zinc-400">Credentials, orders, and unrelated session state are excluded by the snapshot sanitizer.</p></SettingRow>
    <SettingRow controlId="device-permissions" label="Device and code permissions" description="No microphone capture or generated-code execution is available in this build." scope="System" effective="Not enabled"><dl className="text-xs text-zinc-400"><div className="flex justify-between gap-3"><dt>Microphone</dt><dd>Not requested</dd></div><div className="mt-2 flex justify-between gap-3"><dt>Generated code</dt><dd>Not executed</dd></div></dl></SettingRow>
  </SettingsSection>;
}

function categoryStatus(category: SettingsCategoryId, state: { datasets: DatasetCatalog | null; journalDirty: boolean; noteDirty: boolean; chartDirty: boolean; datasetRootDirty: boolean; signedIn: boolean }) {
  if (category === "journal" && (state.journalDirty || state.noteDirty)) return "Unsaved";
  if ((category === "chart" || category === "appearance") && state.chartDirty) return "Unsaved";
  if (category === "data-providers") return state.datasetRootDirty ? "Unsaved" : `${state.datasets?.instruments.length ?? 0}`;
  if (category === "account") return state.signedIn ? "Signed in" : "Signed out";
  if (category === "ai") return "Off";
  return null;
}

function currentCosts(): CostDraft {
  return { commissionMode: loadOrderCommissionMode(), commissionFixed: loadOrderCommissionFixed(), commissionPercent: loadOrderCommissionPercent(), feeMode: loadOrderFeeMode(), feeFixed: loadOrderFeeFixed(), feePercent: loadOrderFeePercent() };
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
function validRisk(value: string) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 && parsed <= 100; }
function nonNegative(value: string) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0; }
function costError(costs: CostDraft) {
  if (!nonNegative(costs.commissionFixed) || !nonNegative(costs.commissionPercent) || !nonNegative(costs.feeFixed) || !nonNegative(costs.feePercent)) return "Cost values must be zero or greater.";
  if (Number(costs.commissionPercent) > 100 || Number(costs.feePercent) > 100) return "Percentage costs cannot exceed 100%.";
  return null;
}
function same(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
