import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Layers3,
  LineChart,
  Sigma,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BacktestSession, Trade } from "../lib/api";
import { formatMoney, formatPercent, formatPrice } from "../lib/format";
import { formatTradingViewSymbol } from "../lib/symbols";

type Props = {
  activeSessionId: number | null;
  sessions: BacktestSession[];
  trades: Trade[];
  onInspectTrade?: (trade: Trade) => void;
};

type ResultsView = "strategy" | "session" | "trades";

type Aggregate = {
  averageHoldMinutes: number | null;
  averageR: number | null;
  bestTrade: number | null;
  breakevenTrades: number;
  closedTrades: Trade[];
  grossLosses: number;
  grossWins: number;
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
  winRate: number;
  wins: number;
};

type GroupRow = {
  aggregate: Aggregate;
  id: string;
  label: string;
  sessions: BacktestSession[];
  subtitle: string;
  trades: Trade[];
};

export function ResultsPanel({
  activeSessionId,
  sessions,
  trades,
  onInspectTrade,
}: Props) {
  const [view, setView] = useState<ResultsView>("strategy");
  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const closedTrades = useMemo(
    () =>
      trades
        .filter((trade) => trade.status === "CLOSED")
        .slice()
        .sort(compareTradesAscending),
    [trades],
  );
  const allAggregate = useMemo(() => aggregateTrades(closedTrades, trades), [
    closedTrades,
    trades,
  ]);
  const strategyRows = useMemo(
    () => buildStrategyRows(sessions, trades, sessionById),
    [sessionById, sessions, trades],
  );
  const sessionRows = useMemo(() => buildSessionRows(sessions, trades), [sessions, trades]);
  const activeSession = activeSessionId ? sessionById.get(activeSessionId) : null;
  const strategyCount = strategyRows.filter((row) => row.aggregate.totalTrades > 0).length;
  const tradedSessionCount = sessionRows.filter((row) => row.aggregate.totalTrades > 0).length;

  return (
    <section className="min-w-0 space-y-4">
      <div className="terminal-panel px-4 py-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              <LineChart size={15} />
              Results
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Strategy and Session Results
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Closed trades are aggregated across every saved session, then broken down by
              strategy and by session so the active replay stays focused.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <ResultTabButton active={view === "strategy"} onClick={() => setView("strategy")}>
              <Layers3 size={14} />
              By Strategy
            </ResultTabButton>
            <ResultTabButton active={view === "session"} onClick={() => setView("session")}>
              <CalendarDays size={14} />
              By Session
            </ResultTabButton>
            <ResultTabButton active={view === "trades"} onClick={() => setView("trades")}>
              <Activity size={14} />
              Trades
            </ResultTabButton>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <div className="terminal-panel min-w-0 p-4">
          <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">All Strategies</h3>
              <div className="mt-1 text-xs text-slate-500">
                {strategyCount} active strategies · {tradedSessionCount} traded sessions
              </div>
            </div>
            <span
              className={`rounded-md border px-2.5 py-1 text-sm font-semibold ${
                allAggregate.netPnl >= 0
                  ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                  : "border-rose-300/25 bg-rose-300/10 text-rose-200"
              }`}
            >
              {formatMoney(allAggregate.netPnl)}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <ResultMetric
              icon={Activity}
              label="Closed Trades"
              value={String(allAggregate.totalTrades)}
            />
            <ResultMetric
              icon={Target}
              label="Win Rate"
              tone="text-cyan-100"
              value={formatPercent(allAggregate.winRate)}
            />
            <ResultMetric
              icon={Sigma}
              label="Profit Factor"
              tone="text-amber-100"
              value={formatRatio(allAggregate.profitFactor)}
            />
            <ResultMetric
              icon={BarChart3}
              label="Avg R"
              tone={toneForNumber(allAggregate.averageR)}
              value={formatOptionalNumber(allAggregate.averageR)}
            />
            <ResultMetric
              icon={TrendingDown}
              label="Max Drawdown"
              tone="text-rose-200"
              value={formatMoney(allAggregate.maxDrawdown)}
            />
            <ResultMetric
              icon={TrendingUp}
              label="Recovery"
              tone="text-emerald-100"
              value={formatRatio(allAggregate.recoveryFactor)}
            />
            <ResultMetric
              icon={ChevronRight}
              label="Long / Short"
              value={`${allAggregate.longTrades} / ${allAggregate.shortTrades}`}
            />
            <ResultMetric
              icon={CalendarDays}
              label="Avg Hold"
              value={formatMinutes(allAggregate.averageHoldMinutes)}
            />
          </div>
        </div>

        <div className="terminal-panel min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Aggregate Equity</h3>
            <span className="text-xs text-slate-500">
              {activeSession ? `Active: ${activeSession.name}` : "All sessions"}
            </span>
          </div>
          <EquitySparkline trades={closedTrades} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <SidePill label="Long PnL" value={allAggregate.longPnl} />
            <SidePill label="Short PnL" value={allAggregate.shortPnl} />
          </div>
        </div>
      </div>

      {view === "strategy" && <StrategyResults rows={strategyRows} />}
      {view === "session" && <SessionResults rows={sessionRows} activeSessionId={activeSessionId} />}
      {view === "trades" && (
        <TradeResults
          onInspectTrade={onInspectTrade}
          sessionById={sessionById}
          trades={closedTrades}
        />
      )}
    </section>
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
      className={`workspace-tab inline-flex items-center justify-center gap-2 ${
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
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-2">
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

function StrategyResults({ rows }: { rows: GroupRow[] }) {
  return (
    <section className="terminal-panel min-w-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Strategies Aggregated</h3>
        <span className="text-xs text-slate-500">{rows.length} strategies</span>
      </div>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        {rows.map((row) => (
          <ResultGroupCard key={row.id} row={row} />
        ))}
        {rows.length === 0 && <EmptyResults message="No strategy results yet" />}
      </div>
    </section>
  );
}

function SessionResults({
  activeSessionId,
  rows,
}: {
  activeSessionId: number | null;
  rows: GroupRow[];
}) {
  return (
    <section className="terminal-panel min-w-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Session Results</h3>
        <span className="text-xs text-slate-500">{rows.length} saved sessions</span>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Session</th>
              <th className="px-3 py-2 font-medium">Strategy</th>
              <th className="px-3 py-2 font-medium">Trades</th>
              <th className="px-3 py-2 font-medium">Net PnL</th>
              <th className="px-3 py-2 font-medium">Win %</th>
              <th className="px-3 py-2 font-medium">PF</th>
              <th className="px-3 py-2 font-medium">Avg R</th>
              <th className="px-3 py-2 font-medium">Progress</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const session = row.sessions[0];
              const progress = session ? sessionProgress(session) : null;
              return (
                <tr
                  key={row.id}
                  className={`border-t border-white/10 text-slate-300 ${
                    session?.id === activeSessionId ? "bg-cyan-300/5" : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-100">
                      {row.label}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.subtitle}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-300">
                    {session?.strategy_name || "Unassigned"}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {row.aggregate.totalTrades}
                  </td>
                  <td className={`px-3 py-3 font-semibold ${toneForNumber(row.aggregate.netPnl)}`}>
                    {formatMoney(row.aggregate.netPnl)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatPercent(row.aggregate.winRate)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatRatio(row.aggregate.profitFactor)}
                  </td>
                  <td className={`px-3 py-3 tabular-nums ${toneForNumber(row.aggregate.averageR)}`}>
                    {formatOptionalNumber(row.aggregate.averageR)}
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-cyan-300"
                        style={{ width: `${progress?.percent ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {progress ? `${progress.percent.toFixed(0)}% · ${session?.status}` : "—"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyResults message="Create a session to see results here" />}
      </div>
    </section>
  );
}

function TradeResults({
  onInspectTrade,
  sessionById,
  trades,
}: {
  onInspectTrade?: (trade: Trade) => void;
  sessionById: Map<number, BacktestSession>;
  trades: Trade[];
}) {
  return (
    <section className="terminal-panel min-w-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Closed Trades</h3>
        <span className="text-xs text-slate-500">{trades.length} journaled exits</span>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Exit</th>
              <th className="px-3 py-2 font-medium">Session</th>
              <th className="px-3 py-2 font-medium">Strategy</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium">Entry</th>
              <th className="px-3 py-2 font-medium">Exit Price</th>
              <th className="px-3 py-2 font-medium">PnL</th>
              <th className="px-3 py-2 font-medium">R</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {trades.slice().reverse().map((trade) => {
              const session = sessionById.get(trade.session_id);
              return (
                <tr key={trade.id} className="border-t border-white/10 text-slate-300">
                  <td className="px-3 py-3 text-xs text-slate-500">
                    {trade.exit_time ? new Date(trade.exit_time).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-100">
                      {session?.name ?? `Session #${trade.session_id}`}
                    </div>
                    <div className="text-xs text-slate-500">
                      {session ? formatTradingViewSymbol(session.symbol) : "—"}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {strategyNameForTrade(trade, session)}
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
                  <td className="px-3 py-3 tabular-nums">
                    {formatPrice(trade.entry_price)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatPrice(trade.exit_price)}
                  </td>
                  <td className={`px-3 py-3 font-semibold ${toneForNumber(trade.realized_pnl)}`}>
                    {formatMoney(trade.realized_pnl)}
                  </td>
                  <td className={`px-3 py-3 tabular-nums ${toneForNumber(trade.r_multiple)}`}>
                    {formatOptionalNumber(trade.r_multiple)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {onInspectTrade && (
                      <button
                        className="control-button h-9"
                        onClick={() => onInspectTrade(trade)}
                        type="button"
                      >
                        Review
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {trades.length === 0 && <EmptyResults message="Closed trades will appear here" />}
      </div>
    </section>
  );
}

function ResultGroupCard({ row }: { row: GroupRow }) {
  const aggregate = row.aggregate;
  return (
    <article className="min-w-0 rounded-md border border-white/10 bg-black/20 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-white">{row.label}</h4>
          <div className="mt-1 text-xs text-slate-500">{row.subtitle}</div>
        </div>
        <span className={`shrink-0 text-sm font-semibold ${toneForNumber(aggregate.netPnl)}`}>
          {formatMoney(aggregate.netPnl)}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <CompactStat label="Trades" value={String(aggregate.totalTrades)} />
        <CompactStat label="Win" value={formatPercent(aggregate.winRate)} />
        <CompactStat label="PF" value={formatRatio(aggregate.profitFactor)} />
        <CompactStat
          label="Avg R"
          tone={toneForNumber(aggregate.averageR)}
          value={formatOptionalNumber(aggregate.averageR)}
        />
      </div>
      <div className="mt-3">
        <EquitySparkline compact trades={aggregate.closedTrades} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        <span>{row.sessions.length} sessions</span>
        <span>Best {formatMoney(aggregate.bestTrade ?? 0)}</span>
        <span>Worst {formatMoney(aggregate.largestLoss ?? 0)}</span>
      </div>
    </article>
  );
}

function CompactStat({
  label,
  tone = "text-slate-100",
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded bg-[#080c11] px-2 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}

function SidePill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </div>
      <div className={`mt-1 text-sm font-semibold ${toneForNumber(value)}`}>
        {formatMoney(value)}
      </div>
    </div>
  );
}

function EquitySparkline({ compact = false, trades }: { compact?: boolean; trades: Trade[] }) {
  const values = cumulativePnl(trades);
  const path = toSvgPath(values, 560, compact ? 72 : 150);
  const zeroY = zeroLineY(values, compact ? 72 : 150);

  return (
    <div className={`overflow-hidden rounded-md bg-[#080c11] ${compact ? "h-[72px]" : "h-[150px]"}`}>
      {values.length > 1 ? (
        <svg className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 560 ${compact ? 72 : 150}`}>
          <path
            d={`M 0 ${zeroY.toFixed(2)} L 560 ${zeroY.toFixed(2)}`}
            fill="none"
            stroke="rgba(148, 163, 184, 0.18)"
            strokeWidth="1"
          />
          <path d={path} fill="none" stroke="#32d3ee" strokeWidth={compact ? "2" : "2.5"} />
        </svg>
      ) : (
        <div className="grid h-full place-items-center text-sm text-slate-500">
          No closed trades
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

function buildStrategyRows(
  sessions: BacktestSession[],
  trades: Trade[],
  sessionById: Map<number, BacktestSession>,
) {
  const groups = new Map<string, { sessions: Map<number, BacktestSession>; trades: Trade[] }>();

  for (const session of sessions) {
    const key = normalizeStrategyName(session.strategy_name);
    if (!groups.has(key)) {
      groups.set(key, { sessions: new Map(), trades: [] });
    }
    groups.get(key)?.sessions.set(session.id, session);
  }

  for (const trade of trades) {
    const session = sessionById.get(trade.session_id);
    const key = strategyNameForTrade(trade, session);
    if (!groups.has(key)) {
      groups.set(key, { sessions: new Map(), trades: [] });
    }
    const group = groups.get(key);
    if (session) {
      group?.sessions.set(session.id, session);
    }
    group?.trades.push(trade);
  }

  return Array.from(groups.entries())
    .map(([label, group]) => {
      const groupSessions = Array.from(group.sessions.values());
      const closedTrades = group.trades.filter((trade) => trade.status === "CLOSED");
      return {
        aggregate: aggregateTrades(closedTrades, group.trades),
        id: label,
        label,
        sessions: groupSessions,
        subtitle: `${groupSessions.length} sessions · ${closedTrades.length} closed trades`,
        trades: group.trades,
      };
    })
    .sort((a, b) => b.aggregate.netPnl - a.aggregate.netPnl);
}

function buildSessionRows(sessions: BacktestSession[], trades: Trade[]) {
  const tradesBySession = new Map<number, Trade[]>();
  for (const trade of trades) {
    tradesBySession.set(trade.session_id, [
      ...(tradesBySession.get(trade.session_id) ?? []),
      trade,
    ]);
  }

  return sessions
    .map((session) => {
      const sessionTrades = tradesBySession.get(session.id) ?? [];
      const closedTrades = sessionTrades.filter((trade) => trade.status === "CLOSED");
      return {
        aggregate: aggregateTrades(closedTrades, sessionTrades),
        id: String(session.id),
        label: session.name,
        sessions: [session],
        subtitle: `${formatTradingViewSymbol(session.symbol)} · ${session.timeframe ?? "M1"} · ${formatDateRange(session)}`,
        trades: sessionTrades,
      };
    })
    .sort((a, b) => {
      if (a.aggregate.totalTrades !== b.aggregate.totalTrades) {
        return b.aggregate.totalTrades - a.aggregate.totalTrades;
      }
      return b.sessions[0].id - a.sessions[0].id;
    });
}

function aggregateTrades(closedTrades: Trade[], allTrades = closedTrades): Aggregate {
  const orderedTrades = closedTrades.slice().sort(compareTradesAscending);
  const netPnl = orderedTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const wins = orderedTrades.filter((trade) => (trade.realized_pnl ?? 0) > 0).length;
  const breakevenTrades = orderedTrades.filter((trade) => (trade.realized_pnl ?? 0) === 0).length;
  const grossWins = orderedTrades
    .filter((trade) => (trade.realized_pnl ?? 0) > 0)
    .reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const grossLosses = Math.abs(
    orderedTrades
      .filter((trade) => (trade.realized_pnl ?? 0) < 0)
      .reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0),
  );
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
    averageR: average(rValues),
    bestTrade,
    breakevenTrades,
    closedTrades: orderedTrades,
    grossLosses,
    grossWins,
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
    totalTrades: orderedTrades.length,
    winRate: orderedTrades.length > 0 ? wins / orderedTrades.length : 0,
    wins,
  };
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

function toSvgPath(values: number[], width: number, height: number) {
  if (values.length < 2) {
    return "";
  }
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function zeroLineY(values: number[], height: number) {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  return height - ((0 - min) / range) * height;
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

function strategyNameForTrade(trade: Trade, session: BacktestSession | undefined) {
  return normalizeStrategyName(trade.strategy_name || session?.strategy_name);
}

function normalizeStrategyName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Unassigned";
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
