import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { downloadSubscribedTextFile } from "../lib/billing";
import { curveLinear } from "@visx/curve";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Copy,
  FileDown,
  LineChart,
  NotebookPen,
  Search,
  Sigma,
  Target,
  TrendingDown,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Grid as BacklitGrid } from "@/components/charts/grid";
import { Line as BacklitLine, LineChart as BacklitLineChart } from "@/components/charts/line-chart";
import { ChartTooltip as BacklitChartTooltip } from "@/components/charts/tooltip";
import {
  ProfitLossLine,
  profitLossColor,
} from "@/components/charts/profit-loss-line";
import { YAxis as BacklitYAxis } from "@/components/charts/y-axis";
import type { BacktestSession, Metrics, Trade } from "../lib/api";
import { formatDateTime, formatMoney, formatPercent, formatPrice } from "../lib/format";
import { formatMarketSymbol } from "../lib/symbols";
import { sessionStrategyName, tradeStrategyName } from "../lib/strategy";
import { useRestorableSurfaceState } from "../lib/useRestorableSurfaceState";

type Props = {
  activeSessionId: number | null;
  currency?: string;
  filter?: ResultsTradeOutcomeFilter;
  hideCsvAction?: boolean;
  metrics?: Metrics | null;
  onFilterChange?: (filter: ResultsTradeOutcomeFilter) => void;
  onTradeScrollChange?: (scroll: ResultsTradeScroll) => void;
  onTradeScrollRestored?: () => void;
  sessions: BacktestSession[];
  search?: string;
  restoreTradeScroll?: ResultsTradeScroll | null;
  trades: Trade[];
  onInspectTrade?: (trade: Trade) => void;
  onSearchChange?: (value: string) => void;
  showEquityCurve?: boolean;
  onViewChange?: (view: ResultsPanelView) => void;
  view?: ResultsPanelView;
};

export type ResultsPanelView = "overview" | "trades";
export type ResultsTradeScroll = { left: number; top: number };
export type ResultsTradeOutcomeFilter = "ALL" | "WIN" | "LOSS" | "BREAKEVEN";
const RESULTS_VIEW_SCHEMA = { version: 1, validate: (value: unknown): value is ResultsPanelView => value === "overview" || value === "trades" } as const;
type ReportControls = { search: string; outcome: ResultsTradeOutcomeFilter };
const REPORT_CONTROLS_SCHEMA = { version: 1, validate: (value: unknown): value is ReportControls => Boolean(value && typeof value === "object" && typeof (value as Partial<ReportControls>).search === "string" && ["ALL", "WIN", "LOSS", "BREAKEVEN"].includes((value as Partial<ReportControls>).outcome ?? "")) } as const;

type Aggregate = {
  averageHoldMinutes: number | null;
  averageLoss: number | null;
  averageR: number | null;
  averageWin: number | null;
  bestTrade: number | null;
  breakevenTrades: number;
  expectancy: number | null;
  grossPnl: number;
  largestLoss: number | null;
  longPnl: number;
  longTrades: number;
  maxDrawdown: number;
  netPnl: number;
  openTrades: number;
  profitFactor: number | null;
  recoveryFactor: number | null;
  shortPnl: number;
  shortTrades: number;
  totalTrades: number;
  totalCommissions: number;
  totalFees: number;
  winRate: number;
  wins: number;
};

export function ResultsPanel({
  activeSessionId,
  currency = "USD",
  filter,
  hideCsvAction = false,
  metrics = null,
  onFilterChange,
  onTradeScrollChange,
  onTradeScrollRestored,
  sessions,
  search,
  restoreTradeScroll,
  trades,
  onInspectTrade,
  onSearchChange,
  showEquityCurve = true,
  onViewChange,
  view,
}: Props) {
  const [localView, setLocalView] = useRestorableSurfaceState<ResultsPanelView>("reports:results", "openPanel", "overview", RESULTS_VIEW_SCHEMA);
  const [reportControls, setReportControls] = useRestorableSurfaceState<ReportControls>("reports:results", "filters", { search: "", outcome: "ALL" }, REPORT_CONTROLS_SCHEMA);
  const localTradeSearch = reportControls.search;
  const localOutcomeFilter = reportControls.outcome;
  const currentView = view ?? localView;
  const currentTradeSearch = search ?? localTradeSearch;
  const currentOutcomeFilter = filter ?? localOutcomeFilter;
  const scopedSessions = useMemo(
    () =>
      activeSessionId == null
        ? sessions
        : sessions.filter((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  );
  const scopedTrades = useMemo(
    () =>
      activeSessionId == null
        ? trades
        : trades.filter((trade) => trade.session_id === activeSessionId),
    [activeSessionId, trades],
  );
  const sessionById = useMemo(
    () => new Map(scopedSessions.map((session) => [session.id, session])),
    [scopedSessions],
  );
  const activeSession =
    (activeSessionId == null ? scopedSessions[0] : sessionById.get(activeSessionId)) ?? null;
  const closedTrades = useMemo(
    () =>
      scopedTrades
        .filter((trade) => trade.status === "CLOSED")
        .slice()
        .sort(compareTradesAscending),
    [scopedTrades],
  );
  const aggregate = useMemo(
    () => (metrics ? aggregateFromMetrics(metrics) : aggregateTrades(closedTrades, scopedTrades)),
    [closedTrades, metrics, scopedTrades],
  );
  const filteredTrades = useMemo(
    () => {
      if (currentView !== "trades") {
        return [];
      }
      return closedTrades.filter((trade) => {
        const pnl = trade.realized_pnl ?? 0;
        if (currentOutcomeFilter === "WIN" && pnl <= 0) {
          return false;
        }
        if (currentOutcomeFilter === "LOSS" && pnl >= 0) {
          return false;
        }
        if (currentOutcomeFilter === "BREAKEVEN" && pnl !== 0) {
          return false;
        }
        const normalizedSearch = currentTradeSearch.trim().toLowerCase();
        if (!normalizedSearch) {
          return true;
        }
        const session = sessionById.get(trade.session_id);
        return [
          String(trade.id),
          trade.side,
          tradeStrategyName(trade, session),
          session?.name,
          session?.symbol,
          session?.instrument,
          trade.mistake_tags.join(" "),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch));
      });
    },
    [closedTrades, currentOutcomeFilter, currentTradeSearch, currentView, sessionById],
  );
  const progress = activeSession ? sessionProgress(activeSession) : null;
  const sessionLabel = activeSession?.name ?? "Current replay";
  const sessionMeta = activeSession
    ? `${formatMarketSymbol(activeSession.symbol)} · ${activeSession.timeframe ?? "M1"} · ${sessionStrategyName(activeSession)}`
    : "Open a replay session to populate this report.";

  function setPanelView(nextView: ResultsPanelView) {
    onViewChange?.(nextView);
    if (view == null) {
      setLocalView(nextView);
    }
  }

  function setPanelSearch(nextSearch: string) {
    onSearchChange?.(nextSearch);
    if (search == null) {
      setReportControls((current) => ({ ...current, search: nextSearch }));
    }
  }

  function setPanelFilter(nextFilter: ResultsTradeOutcomeFilter) {
    onFilterChange?.(nextFilter);
    if (filter == null) {
      setReportControls((current) => ({ ...current, outcome: nextFilter }));
    }
  }

  function copySummary() {
    void copyTextToClipboard(
      buildResultsSummaryText({
        aggregate,
        currency,
        label: sessionLabel,
        session: activeSession,
      }),
    );
  }

  function exportCsv() {
    exportSessionResultsCsv({
      aggregate,
      currency,
      session: activeSession,
      trades: closedTrades,
    });
  }

  return (
    <section className="min-w-0 space-y-3">
      <div className="terminal-panel px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              <LineChart size={15} />
              Results
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-3">
              <h2 className="truncate text-xl font-semibold text-white">
                Current Session Results
              </h2>
              <span className="status-pill">
                {aggregate.totalTrades} closed
              </span>
              <span className="status-pill">
                {aggregate.openTrades} open
              </span>
              {progress && (
                <span className="status-pill">
                  {progress.percent.toFixed(0)}% replayed
                </span>
              )}
            </div>
            <p className="mt-1 max-w-4xl truncate text-sm text-slate-500">
              {sessionMeta}
            </p>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <button className="control-button h-9 px-3 text-xs" onClick={copySummary} type="button">
              <Copy size={14} />
              Copy
            </button>
            {!hideCsvAction ? (
              <button
                className="control-button h-9 px-3 text-xs"
                disabled={closedTrades.length === 0}
                onClick={exportCsv}
                type="button"
              >
                <FileDown size={14} />
                CSV
              </button>
            ) : null}
            <div className="flex rounded-md border border-white/10 bg-black/20 p-1">
              <ResultTabButton active={currentView === "overview"} onClick={() => setPanelView("overview")}>
                <BarChart3 size={14} />
                Overview
              </ResultTabButton>
              <ResultTabButton active={currentView === "trades"} onClick={() => setPanelView("trades")}>
                <Activity size={14} />
                Trades
              </ResultTabButton>
            </div>
          </div>
        </div>
      </div>

      {currentView === "overview" ? (
        <OverviewResults
          aggregate={aggregate}
          currency={currency}
          showEquityCurve={showEquityCurve}
          session={activeSession}
          trades={closedTrades}
        />
      ) : (
        <TradeResults
          currency={currency}
          filter={currentOutcomeFilter}
          onFilterChange={setPanelFilter}
          onInspectTrade={onInspectTrade}
          onSearchChange={setPanelSearch}
          onTradeScrollChange={onTradeScrollChange}
          onTradeScrollRestored={onTradeScrollRestored}
          restoreTradeScroll={restoreTradeScroll}
          search={currentTradeSearch}
          sessionById={sessionById}
          trades={filteredTrades}
          totalTrades={aggregate.totalTrades}
        />
      )}
    </section>
  );
}

function OverviewResults({
  aggregate,
  currency,
  showEquityCurve,
  session,
  trades,
}: {
  aggregate: Aggregate;
  currency: string;
  showEquityCurve: boolean;
  session: BacktestSession | null;
  trades: Trade[];
}) {
  return (
    <div className={`grid min-w-0 gap-3 ${showEquityCurve ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]" : ""}`}>
      <div className="terminal-panel min-w-0 p-4">
        <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-white">
              {session?.name ?? "Active Session"}
            </h3>
            <div className="mt-1 text-xs text-slate-500">
              {session
                ? `${formatMarketSymbol(session.symbol)} · ${session.timeframe ?? "M1"} · ${formatDateRange(session)}`
                : "No session is currently active"}
            </div>
          </div>
          <div
            className={`rounded-md border px-3 py-1.5 text-base font-semibold tabular-nums ${
              aggregate.netPnl >= 0
                ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                : "border-rose-300/25 bg-rose-300/10 text-rose-200"
            }`}
          >
            {formatMoney(aggregate.netPnl, currency)}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <ResultMetric icon={Activity} label="Closed Trades" value={String(aggregate.totalTrades)} />
          <ResultMetric icon={Target} label="Win Rate" tone="text-cyan-100" value={formatPercent(aggregate.winRate)} />
          <ResultMetric icon={Sigma} label="Profit Factor" tone="text-amber-100" value={formatRatio(aggregate.profitFactor)} />
          <ResultMetric icon={BarChart3} label="Avg R" tone={toneForNumber(aggregate.averageR)} value={formatOptionalNumber(aggregate.averageR)} />
          <ResultMetric icon={WalletCards} label="Gross P&L" tone={toneForNumber(aggregate.grossPnl)} value={formatMoney(aggregate.grossPnl, currency)} />
          <ResultMetric icon={WalletCards} label="Commissions" value={formatMoney(aggregate.totalCommissions, currency)} />
          <ResultMetric icon={WalletCards} label="Fees" value={formatMoney(aggregate.totalFees, currency)} />
          <ResultMetric icon={TrendingDown} label="Max Drawdown" tone="text-rose-200" value={formatMoney(aggregate.maxDrawdown, currency)} />
          <ResultMetric icon={TrendingUp} label="Recovery" tone="text-emerald-100" value={formatRatio(aggregate.recoveryFactor)} />
          <ResultMetric icon={ChevronRight} label="Long / Short" value={`${aggregate.longTrades} / ${aggregate.shortTrades}`} />
          <ResultMetric icon={CalendarDays} label="Avg Hold" value={formatMinutes(aggregate.averageHoldMinutes)} />
        </div>
      </div>

      {showEquityCurve ? (
        <div className="terminal-panel min-w-0 p-4">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
            <h3 className="truncate text-base font-semibold text-white">Equity Curve</h3>
            <span className="shrink-0 text-xs text-slate-500">
              {trades.length} exits
            </span>
          </div>
          <EquitySparkline currency={currency} trades={trades} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SidePill currency={currency} label="Long P&L" value={aggregate.longPnl} />
            <SidePill currency={currency} label="Short P&L" value={aggregate.shortPnl} />
          </div>
        </div>
      ) : null}

      <div className={`terminal-panel min-w-0 p-4 ${showEquityCurve ? "xl:col-span-2" : ""}`}>
        <div className="grid gap-3 lg:grid-cols-4">
          <ResultSummaryCard title="Outcome Mix">
            <OutcomeBars aggregate={aggregate} />
          </ResultSummaryCard>
          <ResultSummaryCard title="Cost Breakdown">
            <SummaryLine label="Gross P&L" tone={toneForNumber(aggregate.grossPnl)} value={formatMoney(aggregate.grossPnl, currency)} />
            <SummaryLine label="Commissions" value={formatMoney(aggregate.totalCommissions, currency)} />
            <SummaryLine label="Fees" value={formatMoney(aggregate.totalFees, currency)} />
          </ResultSummaryCard>
          <ResultSummaryCard title="Trade Quality">
            <SummaryLine label="Best trade" tone={toneForNumber(aggregate.bestTrade)} value={formatMoney(aggregate.bestTrade, currency)} />
            <SummaryLine label="Worst trade" tone={toneForNumber(aggregate.largestLoss)} value={formatMoney(aggregate.largestLoss, currency)} />
            <SummaryLine label="Expectancy" tone={toneForNumber(aggregate.expectancy)} value={formatMoney(aggregate.expectancy, currency)} />
          </ResultSummaryCard>
          <ResultSummaryCard title="Average Result">
            <SummaryLine label="Average win" tone="text-emerald-300" value={formatMoney(aggregate.averageWin, currency)} />
            <SummaryLine label="Average loss" tone="text-rose-300" value={formatMoney(aggregate.averageLoss, currency)} />
            <SummaryLine label="Breakeven trades" value={String(aggregate.breakevenTrades)} />
          </ResultSummaryCard>
        </div>
      </div>
    </div>
  );
}

function ResultTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`workspace-tab inline-flex h-8 items-center justify-center gap-2 px-3 text-xs ${
        active ? "workspace-tab-active" : ""
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ResultMetric({
  icon: Icon,
  label,
  tone = "text-slate-100",
  value,
}: {
  icon: LucideIcon;
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-3">
      <div className="flex items-center justify-between gap-3 text-slate-500">
        <span className="truncate text-[10px] font-bold uppercase tracking-[0.16em]">
          {label}
        </span>
        <Icon size={14} />
      </div>
      <div className={`mt-2 truncate text-lg font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function ResultSummaryCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function SummaryLine({
  label,
  tone = "text-slate-100",
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
      <span className="truncate text-slate-500">{label}</span>
      <span className={`shrink-0 font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function OutcomeBars({ aggregate }: { aggregate: Aggregate }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const losses = Math.max(0, aggregate.totalTrades - aggregate.wins - aggregate.breakevenTrades);
  const rows = [
    { label: "Wins", value: aggregate.wins, tone: "bg-emerald-300", text: "text-emerald-300" },
    { label: "Losses", value: losses, tone: "bg-rose-300", text: "text-rose-300" },
    { label: "Breakeven", value: aggregate.breakevenTrades, tone: "bg-slate-400", text: "text-slate-300" },
  ];

  return (
    <div className="grid gap-2" onPointerLeave={() => setActiveIndex(null)}>
      {rows.map((row, rowIndex) => {
        const width = aggregate.totalTrades > 0 ? (row.value / aggregate.totalTrades) * 100 : 0;
        const active = activeIndex === rowIndex;
        return (
          <button
            aria-label={`${row.label}: ${row.value} trades, ${width.toFixed(1)}%`}
            className={`grid gap-1 rounded-md px-1 py-1 text-left outline-none transition ${
              active ? "bg-white/5" : "hover:bg-white/[0.03]"
            } focus-visible:ring-1 focus-visible:ring-cyan-300/40`}
            key={row.label}
            onBlur={() => setActiveIndex(null)}
            onFocus={() => setActiveIndex(rowIndex)}
            onPointerEnter={() => setActiveIndex(rowIndex)}
            title={`${row.label}: ${row.value} trades · ${width.toFixed(1)}%`}
            type="button"
          >
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-slate-500">{row.label}</span>
              <span className={`font-semibold tabular-nums ${row.text}`}>
                {row.value} <span className="text-slate-600">/ {width.toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${row.tone} ${
                  active ? "brightness-125" : "opacity-80"
                }`}
                style={{ width: `${width}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function TradeResults({
  currency,
  filter,
  onFilterChange,
  onInspectTrade,
  onSearchChange,
  onTradeScrollChange,
  onTradeScrollRestored,
  restoreTradeScroll,
  search,
  sessionById,
  trades,
  totalTrades,
}: {
  currency: string;
  filter: ResultsTradeOutcomeFilter;
  onFilterChange: (filter: ResultsTradeOutcomeFilter) => void;
  onInspectTrade?: (trade: Trade) => void;
  onSearchChange: (value: string) => void;
  onTradeScrollChange?: (scroll: ResultsTradeScroll) => void;
  onTradeScrollRestored?: () => void;
  restoreTradeScroll?: ResultsTradeScroll | null;
  search: string;
  sessionById: Map<number, BacktestSession>;
  trades: Trade[];
  totalTrades: number;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!restoreTradeScroll) {
      return;
    }
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    scrollContainer.scrollLeft = Math.min(restoreTradeScroll.left, maxScrollLeft);
    scrollContainer.scrollTop = Math.min(restoreTradeScroll.top, maxScrollTop);
    onTradeScrollRestored?.();
  }, [onTradeScrollRestored, restoreTradeScroll, trades.length]);

  return (
    <section className="terminal-panel min-w-0 p-4">
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">Closed Trades</h3>
          <p className="mt-1 text-xs text-slate-500">
            Showing {trades.length} of {totalTrades} session exits.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <label className="relative min-w-[220px] max-w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              className="input-control h-9 pl-9 normal-case tracking-normal"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search trades"
              value={search}
            />
          </label>
          <div className="flex rounded-md border border-white/10 bg-black/20 p-1">
            {(["ALL", "WIN", "LOSS", "BREAKEVEN"] as const).map((option) => (
              <button
                className={`workspace-tab h-8 px-3 text-xs ${filter === option ? "workspace-tab-active" : ""}`}
                key={option}
                onClick={() => onFilterChange(option)}
                type="button"
              >
                {option === "ALL" ? "All" : option === "BREAKEVEN" ? "Flat" : option[0] + option.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div
        className="overflow-auto"
        onScroll={(event) => {
          onTradeScrollChange?.({
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          });
        }}
        ref={scrollContainerRef}
      >
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Exit</th>
              <th className="px-3 py-2 font-medium">Strategy</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Entry</th>
              <th className="px-3 py-2 font-medium">Exit Price</th>
              <th className="px-3 py-2 font-medium">Stop</th>
              <th className="px-3 py-2 font-medium">Target</th>
              <th className="px-3 py-2 font-medium">Gross P&L</th>
              <th className="px-3 py-2 font-medium">Commission</th>
              <th className="px-3 py-2 font-medium">Fees</th>
              <th className="px-3 py-2 font-medium">Net P&L</th>
              <th className="px-3 py-2 font-medium">R</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {trades.slice().reverse().map((trade) => {
              const session = sessionById.get(trade.session_id);
              return (
                <tr key={trade.id} className="border-t border-white/10 text-slate-300 transition hover:bg-white/[0.03]">
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {formatDateTime(trade.exit_time)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-100">
                      {tradeStrategyName(trade, session)}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      #{trade.id}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        trade.side === "LONG"
                          ? "bg-emerald-300/10 text-emerald-200"
                          : "bg-rose-300/10 text-rose-200"
                      }`}
                    >
                      {trade.side}
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums">{formatCompactNumber(trade.quantity)}</td>
                  <td className="px-3 py-3 tabular-nums">{formatPrice(trade.entry_price)}</td>
                  <td className="px-3 py-3 tabular-nums">{formatPrice(trade.exit_price)}</td>
                  <td className="px-3 py-3 tabular-nums">{formatPrice(trade.stop_loss)}</td>
                  <td className="px-3 py-3 tabular-nums">{formatPrice(trade.take_profit)}</td>
                  <td className={`px-3 py-3 font-semibold ${toneForNumber(tradeGrossPnl(trade))}`}>
                    {formatMoney(tradeGrossPnl(trade), currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatMoney(trade.commission_amount ?? 0, currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatMoney(trade.fee_amount ?? 0, currency)}
                  </td>
                  <td className={`px-3 py-3 font-semibold ${toneForNumber(trade.realized_pnl)}`}>
                    {formatMoney(trade.realized_pnl, currency)}
                  </td>
                  <td className={`px-3 py-3 tabular-nums ${toneForNumber(trade.r_multiple)}`}>
                    {formatOptionalNumber(trade.r_multiple)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {onInspectTrade && (
                      <button
                        className="control-button h-9 px-3 text-xs"
                        onClick={() => onInspectTrade(trade)}
                        type="button"
                      >
                        <NotebookPen size={14} />
                        Review
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && <EmptyResults message="No matching closed trades in this session." />}
      </div>
    </section>
  );
}

function SidePill({ currency, label, value }: { currency: string; label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${toneForNumber(value)}`}>
        {formatMoney(value, currency)}
      </div>
    </div>
  );
}

function EquitySparkline({ currency, trades }: { currency: string; trades: Trade[] }) {
  const orderedTrades = useMemo(() => trades.slice().sort(compareTradesAscending), [trades]);
  const data = useMemo(() => {
    if (orderedTrades.length === 0) {
      return [];
    }
    const firstTimestamp = new Date(orderedTrades[0].exit_time ?? orderedTrades[0].entry_time).getTime();
    let cumulative = 0;
    return [
      {
        date: new Date(firstTimestamp - 60_000),
        tradePnl: null,
        value: 0,
        when: "Start",
      },
      ...orderedTrades.map((trade) => {
        cumulative += trade.realized_pnl ?? 0;
        const timestamp = trade.exit_time ?? trade.entry_time;
        return {
          date: new Date(timestamp),
          tradePnl: trade.realized_pnl ?? 0,
          value: cumulative,
          when: formatDateTime(timestamp),
        };
      }),
    ];
  }, [orderedTrades]);

  return (
    <div className="rounded-md border border-white/10 bg-[#070b10] p-2" style={{ height: 170 }}>
      {data.length > 1 ? (
        <BacklitLineChart
          aspectRatio={undefined}
          className="h-full w-full"
          data={data}
          margin={{ top: 18, right: 18, bottom: 30, left: 76 }}
          style={{ height: "100%" }}
        >
          <BacklitGrid highlightRowValues={[0]} horizontal />
          <BacklitYAxis formatValue={(value) => formatCompactNumber(value)} numTicks={4} />
          <BacklitLine
            curve={curveLinear}
            dataKey="value"
            fadeEdges={false}
            showHighlight={false}
            stroke="transparent"
            strokeWidth={0}
          />
          <ProfitLossLine curve={curveLinear} dataKey="value" fadeEdges={false} />
          <BacklitChartTooltip
            content={({ point }) => {
              const value = Number(point.value ?? 0);
              const tradePnl = typeof point.tradePnl === "number" ? point.tradePnl : null;
              return (
                <div className="min-w-[160px] px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    {String(point.when ?? "Point")}
                  </div>
                  <div className={`mt-1 text-sm font-semibold tabular-nums ${toneForNumber(value)}`}>
                    {formatMoney(value, currency)}
                  </div>
                  <div className={`mt-1 text-xs tabular-nums ${tradePnl == null ? "text-slate-500" : toneForNumber(tradePnl)}`}>
                    {tradePnl == null ? "Session start" : `Trade ${formatMoney(tradePnl, currency)}`}
                  </div>
                </div>
              );
            }}
            indicatorColor={(point) => profitLossColor(Number(point.value ?? 0))}
            showDatePill={false}
            showDots={false}
          />
        </BacklitLineChart>
      ) : (
        <div className="grid h-full place-items-center text-sm text-slate-500">
          No closed trades yet
        </div>
      )}
    </div>
  );
}

function EmptyResults({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function aggregateFromMetrics(metrics: Metrics): Aggregate {
  const longBreakdown = metrics.side_breakdown.find((row) => row.side === "LONG");
  const shortBreakdown = metrics.side_breakdown.find((row) => row.side === "SHORT");
  const losingTrades =
    metrics.total_trades - metrics.winning_trades - metrics.breakeven_trades;

  return {
    averageHoldMinutes: metrics.average_hold_minutes,
    averageLoss: metrics.average_loss,
    averageR: metrics.average_r,
    averageWin: metrics.average_win,
    bestTrade: metrics.best_trade,
    breakevenTrades: metrics.breakeven_trades,
    expectancy: metrics.expectancy,
    grossPnl: metrics.gross_pnl,
    largestLoss: metrics.worst_trade,
    longPnl: longBreakdown?.net_pnl ?? 0,
    longTrades: longBreakdown?.trades ?? 0,
    maxDrawdown: metrics.max_drawdown > 0 ? -metrics.max_drawdown : 0,
    netPnl: metrics.net_pnl,
    openTrades: metrics.open_trades,
    profitFactor:
      metrics.profit_factor ?? (metrics.winning_trades > 0 && losingTrades === 0 ? Number.POSITIVE_INFINITY : null),
    recoveryFactor: metrics.recovery_factor,
    shortPnl: shortBreakdown?.net_pnl ?? 0,
    shortTrades: shortBreakdown?.trades ?? 0,
    totalCommissions: metrics.total_commissions,
    totalFees: metrics.total_fees,
    totalTrades: metrics.total_trades,
    winRate: metrics.win_rate,
    wins: metrics.winning_trades,
  };
}

function aggregateTrades(closedTrades: Trade[], allTrades = closedTrades): Aggregate {
  const orderedTrades = closedTrades.slice().sort(compareTradesAscending);
  const netPnl = orderedTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const winningTrades = orderedTrades.filter((trade) => (trade.realized_pnl ?? 0) > 0);
  const losingTrades = orderedTrades.filter((trade) => (trade.realized_pnl ?? 0) < 0);
  const wins = winningTrades.length;
  const breakevenTrades = orderedTrades.filter((trade) => (trade.realized_pnl ?? 0) === 0).length;
  const grossWins = winningTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const grossLosses = Math.abs(losingTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0));
  const grossPnl = orderedTrades.reduce((sum, trade) => sum + tradeGrossPnl(trade), 0);
  const totalCommissions = orderedTrades.reduce((sum, trade) => sum + (trade.commission_amount ?? 0), 0);
  const totalFees = orderedTrades.reduce((sum, trade) => sum + (trade.fee_amount ?? 0), 0);
  const rValues = orderedTrades
    .map((trade) => trade.r_multiple)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const holdValues = orderedTrades
    .map(holdMinutes)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const bestTrade =
    orderedTrades.length > 0
      ? Math.max(...orderedTrades.map((trade) => trade.realized_pnl ?? 0))
      : null;
  const largestLoss =
    orderedTrades.length > 0
      ? Math.min(...orderedTrades.map((trade) => trade.realized_pnl ?? 0))
      : null;
  const maxDrawdown = computeMaxDrawdown(orderedTrades);
  const longTrades = orderedTrades.filter((trade) => trade.side === "LONG");
  const shortTrades = orderedTrades.filter((trade) => trade.side === "SHORT");

  return {
    averageHoldMinutes: average(holdValues),
    averageLoss: average(losingTrades.map((trade) => trade.realized_pnl ?? 0)),
    averageR: average(rValues),
    averageWin: average(winningTrades.map((trade) => trade.realized_pnl ?? 0)),
    bestTrade,
    breakevenTrades,
    expectancy: orderedTrades.length > 0 ? netPnl / orderedTrades.length : null,
    grossPnl,
    largestLoss,
    longPnl: longTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0),
    longTrades: longTrades.length,
    maxDrawdown,
    netPnl,
    openTrades: allTrades.filter((trade) => trade.status === "OPEN").length,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null,
    recoveryFactor: maxDrawdown < 0 ? netPnl / Math.abs(maxDrawdown) : null,
    shortPnl: shortTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0),
    shortTrades: shortTrades.length,
    totalCommissions,
    totalFees,
    totalTrades: orderedTrades.length,
    winRate: orderedTrades.length > 0 ? wins / orderedTrades.length : 0,
    wins,
  };
}

function tradeGrossPnl(trade: Trade) {
  const grossPnl = trade.gross_pnl;
  if (Number.isFinite(grossPnl)) {
    return grossPnl;
  }
  return (trade.realized_pnl ?? 0) + (trade.commission_amount ?? 0) + (trade.fee_amount ?? 0);
}

function compareTradesAscending(a: Trade, b: Trade) {
  return tradeSortTime(a) - tradeSortTime(b);
}

function tradeSortTime(trade: Trade) {
  return new Date(trade.exit_time ?? trade.entry_time).getTime();
}

function cumulativePnl(trades: Trade[]) {
  const values = [0];
  let cumulative = 0;
  for (const trade of trades.slice().sort(compareTradesAscending)) {
    cumulative += trade.realized_pnl ?? 0;
    values.push(cumulative);
  }
  return values;
}

function computeMaxDrawdown(trades: Trade[]) {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    cumulative += trade.realized_pnl ?? 0;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
  }
  return maxDrawdown;
}

function sparklineDomain(values: number[]) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.12);
    return { max: max + padding, min: min - padding };
  }
  const padding = (max - min) * 0.08;
  return { max: max + padding, min: min - padding };
}

function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  domain: { max: number; min: number },
) {
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const range = domain.max - domain.min || 1;
  return values
    .map((value, index) => {
      const x = index * step;
      const y = sparklineY(value, height, domain, range);
      return { x, y };
    });
}

function sparklineY(
  value: number,
  height: number,
  domain: { max: number; min: number },
  range = domain.max - domain.min || 1,
) {
  return height - ((value - domain.min) / range) * height;
}

function toSvgPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) {
    return "";
  }
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function clampPercent(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function holdMinutes(trade: Trade) {
  if (!trade.exit_time) {
    return null;
  }
  const entry = new Date(trade.entry_time).getTime();
  const exit = new Date(trade.exit_time).getTime();
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit < entry) {
    return null;
  }
  return (exit - entry) / 60000;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatRatio(value: number | null | undefined) {
  if (value == null) {
    return "—";
  }
  if (!Number.isFinite(value)) {
    return "∞";
  }
  return value.toFixed(2);
}

function formatOptionalNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function formatMinutes(value: number | null) {
  if (value == null) {
    return "—";
  }
  if (value < 60) {
    return `${value.toFixed(0)}m`;
  }
  return `${(value / 60).toFixed(1)}h`;
}

function formatCompactNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function toneForNumber(value: number | null | undefined) {
  if (value == null || value === 0) {
    return "text-slate-100";
  }
  return value > 0 ? "text-emerald-300" : "text-rose-300";
}

function sessionProgress(session: BacktestSession) {
  const end = session.end_offset ?? session.current_offset;
  const total = Math.max(end - session.start_offset, 1);
  const done = Math.max(session.current_offset - session.start_offset, 0);
  return {
    percent: Math.min(100, Math.max(0, (done / total) * 100)),
  };
}

function formatDateRange(session: BacktestSession) {
  const start = shortDate(session.start_at);
  const end = shortDate(session.end_at);
  if (!start && !end) {
    return "Full dataset";
  }
  return `${start ?? "Start"} to ${end ?? "End"}`;
}

function shortDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function buildResultsSummaryText({
  aggregate,
  currency,
  label,
  session,
}: {
  aggregate: Aggregate;
  currency: string;
  label: string;
  session: BacktestSession | null;
}) {
  return [
    label,
    session ? `${formatMarketSymbol(session.symbol)} ${session.timeframe ?? ""}`.trim() : null,
    `Gross P&L: ${formatMoney(aggregate.grossPnl, currency)}`,
    `Commissions: ${formatMoney(aggregate.totalCommissions, currency)}`,
    `Fees: ${formatMoney(aggregate.totalFees, currency)}`,
    `Net P&L: ${formatMoney(aggregate.netPnl, currency)}`,
    `Closed trades: ${aggregate.totalTrades}`,
    `Open trades: ${aggregate.openTrades}`,
    `Win rate: ${formatPercent(aggregate.winRate)}`,
    `Profit factor: ${formatRatio(aggregate.profitFactor)}`,
    `Average R: ${formatOptionalNumber(aggregate.averageR)}`,
    `Max drawdown: ${formatMoney(aggregate.maxDrawdown, currency)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator === "undefined") {
    return;
  }
  await navigator.clipboard?.writeText(text);
}

function exportSessionResultsCsv({
  aggregate,
  currency,
  session,
  trades,
}: {
  aggregate: Aggregate;
  currency: string;
  session: BacktestSession | null;
  trades: Trade[];
}) {
  const rows: unknown[][] = [
    ["Section", "Metric", "Value", "Extra"],
    ["Summary", "Session", session?.name ?? "Current replay", ""],
    ["Summary", "Symbol", session?.symbol ?? "", ""],
    ["Summary", "Timeframe", session?.timeframe ?? "", ""],
    ["Summary", "Currency", currency, ""],
    ["Summary", "Gross P&L", aggregate.grossPnl, currency],
    ["Summary", "Commissions", aggregate.totalCommissions, currency],
    ["Summary", "Fees", aggregate.totalFees, currency],
    ["Summary", "Net P&L", aggregate.netPnl, currency],
    ["Summary", "Closed trades", aggregate.totalTrades, ""],
    ["Summary", "Open trades", aggregate.openTrades, ""],
    ["Summary", "Win rate", `${(aggregate.winRate * 100).toFixed(1)}%`, ""],
    ["Summary", "Profit factor", formatRatio(aggregate.profitFactor), ""],
    ["Summary", "Average R", formatOptionalNumber(aggregate.averageR), ""],
    ["Summary", "Max drawdown", aggregate.maxDrawdown, currency],
    ["Summary", "Recovery factor", formatRatio(aggregate.recoveryFactor), ""],
    [],
    ["Trade ID", "Exit Time", "Side", "Quantity", "Entry", "Exit", "Stop", "Target", "Gross P&L", "Commission", "Fees", "Net P&L", "R", "Strategy", "Tags"],
    ...trades.map((trade) => [
      trade.id,
      trade.exit_time ?? "",
      trade.side,
      trade.quantity,
      trade.entry_price,
      trade.exit_price ?? "",
      trade.stop_loss ?? "",
      trade.take_profit ?? "",
      tradeGrossPnl(trade),
      trade.commission_amount ?? 0,
      trade.fee_amount ?? 0,
      trade.realized_pnl,
      trade.r_multiple ?? "",
      tradeStrategyName(trade, session ?? undefined),
      trade.mistake_tags.join("; "),
    ]),
  ];

  downloadTextFile(
    `session-results-${safeFilePart(session?.name ?? "current")}-${new Date().toISOString().slice(0, 10)}.csv`,
    rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8",
  );
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename: string, contents: string, type: string) {
  void downloadSubscribedTextFile(filename, contents, type);
}

function safeFilePart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "current";
}
