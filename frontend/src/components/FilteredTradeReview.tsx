import { useMemo, useState } from "react";
import { Activity, Filter, Gauge, Sigma, Target, TrendingDown, TrendingUp, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Trade } from "../lib/api";
import { formatMoney, formatPercent } from "../lib/format";
import { TradeLog } from "./TradeLog";

type Props = {
  onEdit: (trade: Trade) => void;
  onInspect: (trade: Trade) => void;
  trades: Trade[];
};

type SideFilter = "ALL" | "LONG" | "SHORT";
type StatusFilter = "ALL" | "OPEN" | "CLOSED";
type OutcomeFilter = "ALL" | "WIN" | "LOSS" | "BREAKEVEN";

export function FilteredTradeReview({ onEdit, onInspect, trades }: Props) {
  const [sideFilter, setSideFilter] = useState<SideFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("ALL");
  const [strategyFilter, setStrategyFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");

  const strategyOptions = useMemo(
    () => uniqueOptions(trades.map((trade) => trade.strategy_name || "Unassigned")),
    [trades],
  );
  const tagOptions = useMemo(
    () => uniqueOptions(trades.flatMap((trade) => trade.mistake_tags)),
    [trades],
  );
  const filteredTrades = useMemo(
    () =>
      trades.filter((trade) => {
        if (sideFilter !== "ALL" && trade.side !== sideFilter) {
          return false;
        }
        if (statusFilter !== "ALL" && trade.status !== statusFilter) {
          return false;
        }
        if (strategyFilter !== "ALL" && (trade.strategy_name || "Unassigned") !== strategyFilter) {
          return false;
        }
        if (tagFilter !== "ALL" && !trade.mistake_tags.includes(tagFilter)) {
          return false;
        }
        if (outcomeFilter !== "ALL") {
          if (trade.status !== "CLOSED") {
            return false;
          }
          const pnl = trade.realized_pnl ?? 0;
          if (outcomeFilter === "WIN" && pnl <= 0) {
            return false;
          }
          if (outcomeFilter === "LOSS" && pnl >= 0) {
            return false;
          }
          if (outcomeFilter === "BREAKEVEN" && pnl !== 0) {
            return false;
          }
        }
        return true;
      }),
    [outcomeFilter, sideFilter, statusFilter, strategyFilter, tagFilter, trades],
  );
  const metrics = useMemo(() => aggregateTrades(filteredTrades), [filteredTrades]);
  const hasFilters =
    sideFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    outcomeFilter !== "ALL" ||
    strategyFilter !== "ALL" ||
    tagFilter !== "ALL";

  function resetFilters() {
    setSideFilter("ALL");
    setStatusFilter("ALL");
    setOutcomeFilter("ALL");
    setStrategyFilter("ALL");
    setTagFilter("ALL");
  }

  return (
    <div className="min-w-0 space-y-4">
      <section className="terminal-panel min-w-0 p-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
              <Filter size={14} />
              Review Filters
            </div>
            <h3 className="mt-2 text-sm font-semibold text-white">
              Filtered Session Metrics
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {filteredTrades.length} of {trades.length} trades included
            </p>
          </div>
          {hasFilters && (
            <button className="control-button h-9" onClick={resetFilters} type="button">
              <X size={14} />
              Reset
            </button>
          )}
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <FilterSelect
            label="Side"
            onChange={(value) => setSideFilter(value as SideFilter)}
            options={["ALL", "LONG", "SHORT"]}
            value={sideFilter}
          />
          <FilterSelect
            label="Status"
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={["ALL", "CLOSED", "OPEN"]}
            value={statusFilter}
          />
          <FilterSelect
            label="Outcome"
            onChange={(value) => setOutcomeFilter(value as OutcomeFilter)}
            options={["ALL", "WIN", "LOSS", "BREAKEVEN"]}
            value={outcomeFilter}
          />
          <FilterSelect
            label="Strategy"
            onChange={setStrategyFilter}
            options={["ALL", ...strategyOptions]}
            value={strategyFilter}
          />
          <FilterSelect
            label="Tag"
            onChange={setTagFilter}
            options={["ALL", ...tagOptions]}
            value={tagFilter}
          />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard icon={TrendingUp} label="Net PnL" tone={toneForNumber(metrics.netPnl)} value={formatMoney(metrics.netPnl)} />
          <MetricCard icon={Target} label="Win Rate" tone="text-cyan-100" value={formatPercent(metrics.winRate)} />
          <MetricCard icon={Activity} label="Closed" value={String(metrics.closedCount)} />
          <MetricCard icon={Sigma} label="Profit Factor" tone="text-amber-100" value={formatRatio(metrics.profitFactor)} />
          <MetricCard icon={Gauge} label="Avg R" tone={toneForNumber(metrics.averageR)} value={formatOptionalNumber(metrics.averageR)} />
          <MetricCard icon={TrendingDown} label="Max DD" tone="text-rose-200" value={formatMoney(metrics.maxDrawdown)} />
        </div>
      </section>

      <TradeLog
        trades={filteredTrades}
        onEdit={onEdit}
        onInspect={onInspect}
      />
    </div>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="form-field">
      {label}
      <select
        className="input-control h-10 normal-case tracking-normal"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "ALL" ? `All ${label.toLowerCase()}` : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetricCard({
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

function aggregateTrades(trades: Trade[]) {
  const closedTrades = trades.filter((trade) => trade.status === "CLOSED");
  const orderedTrades = closedTrades.slice().sort(
    (a, b) => new Date(a.exit_time ?? a.entry_time).getTime() - new Date(b.exit_time ?? b.entry_time).getTime(),
  );
  const netPnl = orderedTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const wins = orderedTrades.filter((trade) => (trade.realized_pnl ?? 0) > 0);
  const grossWins = wins.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const grossLosses = Math.abs(
    orderedTrades
      .filter((trade) => (trade.realized_pnl ?? 0) < 0)
      .reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0),
  );
  const rValues = orderedTrades
    .map((trade) => trade.r_multiple)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    averageR: rValues.length > 0 ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null,
    closedCount: closedTrades.length,
    maxDrawdown: computeMaxDrawdown(orderedTrades),
    netPnl,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null,
    winRate: closedTrades.length > 0 ? wins.length / closedTrades.length : 0,
  };
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

function uniqueOptions(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function formatRatio(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }
  if (!Number.isFinite(value)) {
    return "∞";
  }
  return value.toFixed(2);
}

function formatOptionalNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(2);
}

function toneForNumber(value: number | null | undefined) {
  if (value == null || value === 0) {
    return "text-slate-100";
  }
  return value > 0 ? "text-emerald-300" : "text-rose-300";
}
