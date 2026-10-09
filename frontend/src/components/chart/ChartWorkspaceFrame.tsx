import { useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import type { CanonicalTrade } from "../../lib/journalApi";
import { numeric } from "../../lib/journalAnalytics";
import { AlertsPanel, OrderBookPanel } from "./MarketToolsPanels";
import { JournalError, JournalScopeControl } from "../journal/JournalControls";
import { JournalPanelManager, type JournalPanelSlots } from "../journal/JournalPanelManager";
import { JournalReviewDrawer, type JournalChartFocusRequest } from "../journal/JournalReviewDrawer";
import { useJournalData } from "../journal/useJournalData";
import { CriticalStateSurface } from "../ui/CriticalStateSurface";

export function ChartWorkspaceFrame({ children, symbol, onChartFocus, slots = {} }: { children: ReactNode; symbol: string; onChartFocus?: (request: JournalChartFocusRequest) => void; slots?: JournalPanelSlots }) {
  const journal = useJournalData();
  const [selectedTradeId, setSelectedTradeId] = useState<number | null>(null);
  const selectedTrade = journal.trades.find((trade) => trade.id === selectedTradeId) ?? null;
  const panelSlots: JournalPanelSlots = {
    journal: <DockedJournalPanel journal={journal} symbol={symbol} onOpenTrade={(trade) => setSelectedTradeId(trade.id)} />,
    "order-book": <OrderBookPanel symbol={symbol} />,
    alerts: <AlertsPanel symbol={symbol} />,
    ...slots,
  };
  return <div className="ui-operating-surface" data-ui-surface="chart-live" data-active-symbol={symbol || undefined}>
    <JournalPanelManager label="Chart tools" slots={panelSlots} startCollapsed>{children}</JournalPanelManager>
    <JournalReviewDrawer trade={selectedTrade} tags={journal.tags} returnLabel={`${symbol || "Chart"} workspace`} onClose={() => setSelectedTradeId(null)} onSave={journal.updateReview} onCreateTag={journal.addTag} onShowOnChart={onChartFocus} />
  </div>;
}

function DockedJournalPanel({ journal, symbol, onOpenTrade }: { journal: ReturnType<typeof useJournalData>; symbol: string; onOpenTrade: (trade: CanonicalTrade) => void }) {
  const symbolRows = useMemo(() => journal.scopedTrades.filter((trade) => normalize(trade.symbol) === normalize(symbol)).sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time)), [journal.scopedTrades, symbol]);
  const queue = useMemo(() => journal.scopedTrades.filter((trade) => !trade.reviewed).sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time)), [journal.scopedTrades]);
  return <section aria-labelledby="chart-journal-heading" className="min-h-full"><header className="border-b border-[var(--ui-border-subtle)] p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><h2 id="chart-journal-heading" className="truncate text-sm font-semibold text-[var(--text-primary)]">Journal beside chart</h2><p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">{symbolRows.length} {symbol || "active-symbol"} trade{symbolRows.length === 1 ? "" : "s"} · {queue.length} pending</p></div><a href="#journal/trades" className="inline-flex min-h-9 [@media(pointer:coarse)]:min-h-11 items-center gap-1 text-xs font-semibold text-[var(--text-accent)] hover:underline"><ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />Full Journal</a></div><div className="mt-3"><JournalScopeControl accounts={journal.accounts} scope={journal.scope} onChange={journal.setScope} /></div></header>
    {journal.error ? <JournalError message={journal.error} onRetry={() => void journal.refresh()} onDismiss={journal.clearError} /> : null}
    {journal.loading && !journal.trades.length ? <CriticalStateSurface state="loading" title="Loading Journal trades" detail="Keeping the chart available while the review queue synchronizes." actionLabel={null} /> : <div><div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">{symbolRows.length ? `${symbol} history` : "Review queue"}</div><div className="divide-y divide-[var(--ui-border-subtle)] border-y border-[var(--ui-border-subtle)]">{(symbolRows.length ? symbolRows : queue).slice(0, 30).map((trade) => <button key={trade.id} type="button" data-motion="microfeedback" onClick={() => onOpenTrade(trade)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-3 text-left outline-none hover:bg-[var(--ui-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ui-focus)]"><span className="min-w-0"><span className="flex items-center gap-2"><strong className="text-sm text-[var(--text-primary)]">{trade.symbol}</strong><span className={`text-[10px] font-semibold ${trade.side === "LONG" ? "text-[var(--profit-text)]" : "text-[var(--loss-text)]"}`}>{trade.side === "LONG" ? "▲ LONG" : "▼ SHORT"}</span>{trade.reviewed ? <CheckCircle2 aria-label="Reviewed" className="h-3.5 w-3.5 text-[var(--profit-text)]" /> : null}</span><span className="mt-1 block truncate text-[11px] text-[var(--text-secondary)]">{new Date(trade.entry_time).toLocaleString()} · {trade.strategy_name ?? "Unassigned"}</span></span><span className={`self-center text-xs font-semibold tabular-nums ${numeric(trade.net_pnl) >= 0 ? "text-[var(--profit-text)]" : "text-[var(--loss-text)]"}`}>{signedMoney(numeric(trade.net_pnl), trade.currency)}</span></button>)}{!symbolRows.length && !queue.length ? <CriticalStateSurface state="empty" title="No trades in this chart context" detail="Open the full Journal to add or import a trade. Exact-symbol history and pending reviews then appear here." actionLabel={null} /> : null}</div></div>}
  </section>;
}

function normalize(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function signedMoney(value: number, currency: string) { try { const formatted = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Math.abs(value)); return `${value >= 0 ? "+" : "−"}${formatted}`; } catch { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)} ${currency}`; } }
