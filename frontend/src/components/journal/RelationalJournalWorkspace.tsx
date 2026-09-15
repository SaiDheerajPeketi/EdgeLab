import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, BookOpen, Database, FileBarChart, LoaderCircle, Plus, RefreshCw, RotateCcw, Rows3 } from "lucide-react";
import type { WorkspaceView } from "../../lib/workspace";
import { journalDeepLink, parseJournalDeepLink, type JournalDeepLink } from "../../lib/journalWorkspaceState";
import type { CanonicalTrade } from "../../lib/journalApi";
import type { JournalBreakdownDimension } from "../../lib/journalAnalytics";
import { JournalAccountsSurface } from "./JournalAccountsSurface";
import { JournalAnalyticsSurface } from "./JournalAnalyticsSurface";
import { JournalButton, JournalEmpty, JournalError, JournalScopeControl, JournalSkeleton } from "./JournalControls";
import { JournalDashboard } from "./JournalDashboard";
import { JournalNotesSurface } from "./JournalNotesSurface";
import { JournalPanelManager } from "./JournalPanelManager";
import { JournalReviewDrawer } from "./JournalReviewDrawer";
import { JournalTradesSurface } from "./JournalTradesSurface";
import { useJournalData } from "./useJournalData";

type Surface = "dashboard" | "trades" | "notes" | "accounts" | "analytics";

const NAV: Array<{ id: Surface; label: string; icon: typeof BarChart3 }> = [
  { id: "dashboard", label: "Overview", icon: BarChart3 },
  { id: "trades", label: "Trades", icon: Rows3 },
  { id: "notes", label: "Daily notes", icon: BookOpen },
  { id: "accounts", label: "Accounts & imports", icon: Database },
  { id: "analytics", label: "Analytics", icon: FileBarChart },
];

export function RelationalJournalWorkspace({ view }: { view: WorkspaceView }) {
  const journal = useJournalData();
  const initialLink = typeof window === "undefined" ? null : parseJournalDeepLink(window.location.hash);
  const [surface, setSurface] = useState<Surface>(() => initialLink ? linkSurface(initialLink.surface) : viewSurface(view));
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(initialLink?.tradeId ?? null);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialLink?.date ?? null);
  const [initialDimension, setInitialDimension] = useState<JournalBreakdownDimension>(() => viewDimension(view));
  const [sampleBusy, setSampleBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedTrade = journal.trades.find((trade) => trade.id === selectedTradeId) ?? null;
  const routePresentation = journalRoutePresentation(view);

  useEffect(() => { const next = viewSurface(view); setSurface(next); setInitialDimension(viewDimension(view)); }, [view]);
  useEffect(() => {
    const handleHash = () => { const link = parseJournalDeepLink(window.location.hash); if (!link) return; setSurface(linkSurface(link.surface)); setSelectedTradeId(link.tradeId); setSelectedDate(link.date); if (link.segment && isDimension(link.segment)) setInitialDimension(link.segment); if (link.accountId && journal.accounts.some((account) => account.id === link.accountId)) journal.setScope({ mode: "selected", accountIds: [link.accountId] }); };
    window.addEventListener("hashchange", handleHash); handleHash();
    return () => window.removeEventListener("hashchange", handleHash);
  }, [journal.accounts]);

  const navigate = useCallback((next: Surface, options: Partial<JournalDeepLink> = {}) => {
    setSurface(next); setSelectedDate(options.date ?? null); setSelectedTradeId(options.tradeId ?? null);
    const hash = journalDeepLink({ surface: next === "notes" && options.date ? "calendar" : next, tradeId: options.tradeId ?? null, date: options.date ?? null, accountId: options.accountId ?? null, segment: options.segment ?? null, returnTo: options.returnTo ?? null });
    window.history.pushState(null, "", hash);
  }, []);
  const openTrade = useCallback((trade: CanonicalTrade) => { setSelectedTradeId(trade.id); window.history.replaceState(null, "", journalDeepLink({ surface, tradeId: trade.id, date: selectedDate, accountId: null, segment: null, returnTo: surface })); }, [selectedDate, surface]);

  async function importSample() { setSampleBusy(true); setNotice(null); try { const result = await journal.importSample(); setNotice(`Sample ready: ${result.run.imported_rows} trades imported. You can remove them with Reset sample.`); navigate("dashboard"); } catch { /* hook exposes the error */ } finally { setSampleBusy(false); } }
  async function resetSample() { setSampleBusy(true); setNotice(null); try { await journal.resetSample(); setNotice("Sample trades were rolled back; your other Journal records were unchanged."); } catch { /* hook exposes the error */ } finally { setSampleBusy(false); } }

  if (journal.loading && !journal.accounts.length && !journal.trades.length) return <JournalSkeleton rows={9} />;

  const panel = <JournalDock trades={journal.scopedTrades} onOpen={openTrade} onOpenAll={() => navigate("trades")} />;
  return <div className="ui-operating-surface min-h-0 bg-[var(--ui-surface)] text-[var(--text-primary)]" data-ui-surface="journal" data-active-view={surface}>
    <header className="sticky top-0 z-20 border-b border-[var(--ui-divider)] bg-[var(--ui-surface)]"><div className="flex min-h-14 items-center gap-2 overflow-x-auto px-3 sm:px-5"><span className="mr-1 shrink-0 text-sm font-semibold text-[var(--text-primary)]" title={routePresentation.description}>Journal <span className="text-[var(--text-secondary)]">/ {routePresentation.label}</span></span>{NAV.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" aria-current={surface === item.id ? "page" : undefined} onClick={() => navigate(item.id)} data-motion="microfeedback" className={`inline-flex min-h-[var(--control-height)] shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${surface === item.id ? "bg-[var(--ui-selection)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)]"}`}><Icon aria-hidden="true" className="h-[var(--icon-sm)] w-[var(--icon-sm)]" />{item.label}</button>; })}<button type="button" onClick={() => void journal.refresh()} disabled={journal.loading} className="ml-auto grid h-[var(--control-height)] w-[var(--control-height)] shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]" aria-label="Refresh Journal"><RefreshCw aria-hidden="true" className={`h-[var(--icon-md)] w-[var(--icon-md)] ${journal.loading ? "animate-spin motion-reduce:animate-none" : ""}`} /></button></div></header>
    <JournalPanelManager slots={{ journal: panel }} label="Journal review panel"><section aria-label="Journal workspace" className="min-w-0 px-3 py-5 sm:px-5 lg:px-6"><div className="mx-auto max-w-[96rem]">
      <div className="mb-5 grid gap-3 border-b border-white/10 pb-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><JournalScopeControl accounts={journal.accounts} scope={journal.scope} onChange={journal.setScope} /><div className="flex flex-wrap gap-2"><JournalButton onClick={() => navigate("trades")} disabled={!journal.accounts.length}><Plus aria-hidden="true" className="h-4 w-4" />Quick add</JournalButton>{journal.imports.some((run) => run.source_name === "EdgeLab sample trades" && run.status === "COMPLETED") ? <JournalButton tone="danger" disabled={sampleBusy} onClick={() => void resetSample()}><RotateCcw aria-hidden="true" className="h-4 w-4" />Reset sample</JournalButton> : null}</div></div>
      {journal.error ? <div className="mb-5"><JournalError message={journal.error} onRetry={() => void journal.refresh()} onDismiss={journal.clearError} /></div> : null}
      {notice ? <p role="status" className="mb-5 border-y border-emerald-300/20 bg-emerald-300/[0.04] px-3 py-2 text-sm text-emerald-100">{notice}</p> : null}
      {journal.migration === "migrating" ? <p className="mb-5 flex items-center gap-2 text-xs text-slate-500"><LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />Checking the safe one-time legacy Journal backfill…</p> : null}
      {!journal.accounts.length ? <Onboarding busy={sampleBusy} onAccounts={() => navigate("accounts")} onSample={() => void importSample()} /> : <div key={`${view}-${surface}`} data-motion="route-surface" data-journal-route={view}><SurfaceContent surface={surface} journal={journal} initialDimension={initialDimension} selectedDate={selectedDate} navigate={navigate} openTrade={openTrade} /></div>}
    </div></section></JournalPanelManager>
    <JournalReviewDrawer trade={selectedTrade} tags={journal.tags} returnLabel={NAV.find((item) => item.id === surface)?.label ?? "Journal"} onClose={() => { setSelectedTradeId(null); window.history.replaceState(null, "", journalDeepLink({ surface, tradeId: null, date: selectedDate, accountId: null, segment: null, returnTo: null })); }} onSave={journal.updateReview} onCreateTag={journal.addTag} />
  </div>;
}

function SurfaceContent({ surface, journal, initialDimension, selectedDate, navigate, openTrade }: { surface: Surface; journal: ReturnType<typeof useJournalData>; initialDimension: JournalBreakdownDimension; selectedDate: string | null; navigate: (surface: Surface, options?: Partial<JournalDeepLink>) => void; openTrade: (trade: CanonicalTrade) => void }) {
  if (surface === "dashboard") return <JournalDashboard accounts={journal.accounts.filter((account) => journal.scope.mode === "all" || journal.scope.accountIds.includes(account.id))} notes={journal.scopedNotes} trades={journal.scopedTrades} onOpenDate={(date) => navigate("notes", { date })} onOpenTrade={openTrade} onSaveNote={journal.saveDailyNote} />;
  if (surface === "trades") return <JournalTradesSurface accounts={journal.accounts} tags={journal.tags} trades={journal.scopedTrades} onAddTrade={journal.addTrade} onOpenTrade={openTrade} onMarkReviewed={(tradeId) => journal.updateReview(tradeId, { reviewed: true })} />;
  if (surface === "notes") return <JournalNotesSurface accounts={journal.accounts} notes={journal.scopedNotes} trades={journal.scopedTrades} initialDate={selectedDate} onOpenTrade={openTrade} onSaveNote={journal.saveDailyNote} />;
  if (surface === "accounts") return <JournalAccountsSurface accounts={journal.accounts} trades={journal.trades} imports={journal.imports} onAddAccount={journal.addAccount} onImport={journal.importCsv} onRollback={journal.rollbackImport} onSyncConnection={journal.syncConnection} />;
  return <JournalAnalyticsSurface key={initialDimension} accounts={journal.accounts} tags={journal.tags} trades={journal.scopedTrades} initialDimension={initialDimension} onOpenTrade={openTrade} />;
}

function Onboarding({ busy, onAccounts, onSample }: { busy: boolean; onAccounts: () => void; onSample: () => void }) { return <JournalEmpty title="Build your relational Journal" detail="Create an account for your real trades, or import a reversible sample set to explore reviews, calendar notes, dashboard metrics, and analytics." action={<div className="flex flex-wrap justify-center gap-2"><JournalButton tone="primary" onClick={onAccounts}><Plus aria-hidden="true" className="h-4 w-4" />Create or connect account</JournalButton><JournalButton onClick={onSample} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}Try sample trades</JournalButton></div>} />; }

function JournalDock({ trades, onOpen, onOpenAll }: { trades: CanonicalTrade[]; onOpen: (trade: CanonicalTrade) => void; onOpenAll: () => void }) { const pending = useMemo(() => trades.filter((trade) => !trade.reviewed).slice().sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time)), [trades]); return <div><div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3"><div><p className="text-sm font-semibold text-white">Review queue</p><p className="text-[11px] text-slate-500">{pending.length} awaiting review</p></div><button type="button" onClick={onOpenAll} className="min-h-8 text-xs font-semibold text-cyan-300 hover:underline">All trades</button></div><div className="divide-y divide-white/8">{pending.slice(0, 12).map((trade) => <button key={trade.id} type="button" onClick={() => onOpen(trade)} className="block w-full px-3 py-3 text-left outline-none hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-300"><span className="flex items-center justify-between gap-2"><span className="font-semibold text-white">{trade.symbol}</span><span className="text-[10px] text-amber-200">Pending</span></span><span className="mt-1 block truncate text-xs text-slate-500">{new Date(trade.entry_time).toLocaleString()} · {trade.strategy_name ?? "Unassigned"}</span></button>)}{!pending.length ? <p className="px-3 py-8 text-center text-sm text-slate-500">Queue clear. New and imported trades appear here until reviewed.</p> : null}</div></div>; }

function viewSurface(view: WorkspaceView): Surface { if (view === "journalAccounts") return "accounts"; if (view === "journalDashboard") return "dashboard"; if (view === "journalNotes" || view === "journalDayView") return "notes"; if (view === "journalReports" || view === "journalStrategies" || view === "journalPlaybooks" || view === "journalSessions") return "analytics"; return "trades"; }
function viewDimension(view: WorkspaceView): JournalBreakdownDimension { if (view === "journalStrategies" || view === "journalPlaybooks") return "strategy"; if (view === "journalSessions") return "account"; if (view === "journalReports") return "market"; return "market"; }
function linkSurface(surface: JournalDeepLink["surface"]): Surface { return surface === "calendar" ? "notes" : surface; }
function isDimension(value: string): value is JournalBreakdownDimension { return ["account","direction","duration","grade","hour","market","rating","size","strategy","symbol","tag","weekday"].includes(value); }

const JOURNAL_ROUTE_PRESENTATION: Partial<Record<WorkspaceView, { label: string; description: string }>> = {
  journal: { label: "Trades", description: "Capture and review journaled executions" },
  journalTrades: { label: "Trade log", description: "Filter, select, and review canonical trades" },
  journalDashboard: { label: "Overview", description: "Account-scoped performance and review discipline" },
  journalDayView: { label: "Day & week review", description: "Calendar-linked trading days and weekly patterns" },
  journalNotes: { label: "Notes", description: "Daily and trade-linked reflections" },
  journalAccounts: { label: "Accounts & imports", description: "Connections, account comparison, and imports" },
  journalReports: { label: "Reports", description: "Segmented Journal analytics and drill-down" },
  journalStrategies: { label: "Strategies", description: "Strategy performance and review evidence" },
  journalPlaybooks: { label: "Playbooks", description: "Playbook adherence and outcomes" },
  journalSessions: { label: "Sessions", description: "Session-scoped Journal performance" },
};
function journalRoutePresentation(view: WorkspaceView) { return JOURNAL_ROUTE_PRESENTATION[view] ?? { label: "Workspace", description: "Relational trading Journal" }; }
