import type { CanonicalTrade, JournalAccount, JournalTag } from "./journalApi";

export type JournalFilters = {
  accountIds: number[];
  dateFrom: string;
  dateTo: string;
  direction: "ALL" | "LONG" | "SHORT";
  market: string;
  rating: "ALL" | "UNRATED" | "1" | "2" | "3" | "4" | "5";
  strategy: string;
  symbol: string;
  tagIds: number[];
};

export const DEFAULT_JOURNAL_FILTERS: JournalFilters = {
  accountIds: [],
  dateFrom: "",
  dateTo: "",
  direction: "ALL",
  market: "ALL",
  rating: "ALL",
  strategy: "ALL",
  symbol: "ALL",
  tagIds: [],
};

export type JournalSummary = {
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
  expectancy: number;
  averageR: number | null;
  maxDrawdown: number;
  reviewedPercent: number;
};

export type JournalBreakdownDimension =
  | "account" | "direction" | "duration" | "grade" | "hour" | "market"
  | "rating" | "size" | "strategy" | "symbol" | "tag" | "weekday";

export type JournalBreakdownRow = JournalSummary & {
  key: string;
  label: string;
  tradeIds: number[];
};

export type JournalAssetMixDimension = "market" | "symbol";

export function journalAssetMix(trades: CanonicalTrade[], dimension: JournalAssetMixDimension) {
  const groups = new Map<string, number>();
  trades.forEach((trade) => {
    const label = dimension === "market" ? inferMarket(trade.symbol) : trade.symbol;
    groups.set(label, (groups.get(label) ?? 0) + 1);
  });
  const total = trades.length;
  return [...groups.entries()]
    .map(([label, count]) => ({ label, count, percent: total ? count / total * 100 : 0 }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function filterJournalTrades(trades: CanonicalTrade[], filters: JournalFilters) {
  const tagIds = new Set(filters.tagIds);
  const accountIds = new Set(filters.accountIds);
  const start = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00Z`) : Number.NEGATIVE_INFINITY;
  const end = filters.dateTo ? Date.parse(`${filters.dateTo}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  return trades.filter((trade) => {
    const entry = Date.parse(trade.entry_time);
    return (!accountIds.size || accountIds.has(trade.account_id))
      && entry >= start && entry <= end
      && (filters.direction === "ALL" || trade.side === filters.direction)
      && (filters.market === "ALL" || inferMarket(trade.symbol) === filters.market)
      && (filters.symbol === "ALL" || trade.symbol === filters.symbol)
      && (filters.strategy === "ALL" || (trade.strategy_name ?? "Unassigned") === filters.strategy)
      && (filters.rating === "ALL" || (filters.rating === "UNRATED" ? trade.rating == null : trade.rating === Number(filters.rating)))
      && (!tagIds.size || [...tagIds].every((id) => trade.tags.some((tag) => tag.id === id)));
  });
}

export function summarizeJournalTrades(trades: CanonicalTrade[]): JournalSummary {
  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const wins = closed.filter((trade) => numeric(trade.net_pnl) > 0);
  const losses = closed.filter((trade) => numeric(trade.net_pnl) < 0);
  const grossProfit = closed.reduce((sum, trade) => sum + Math.max(0, numeric(trade.net_pnl)), 0);
  const grossLoss = Math.abs(closed.reduce((sum, trade) => sum + Math.min(0, numeric(trade.net_pnl)), 0));
  const rValues = closed.map((trade) => nullableNumeric(trade.r_multiple)).filter((value): value is number => value != null);
  const equity = equityCurve(closed, 0);
  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    grossPnl: closed.reduce((sum, trade) => sum + numeric(trade.gross_pnl), 0),
    costs: closed.reduce((sum, trade) => sum + numeric(trade.commission) + numeric(trade.fees), 0),
    netPnl: closed.reduce((sum, trade) => sum + numeric(trade.net_pnl), 0),
    winRate: closed.length ? wins.length / closed.length * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    expectancy: closed.length ? closed.reduce((sum, trade) => sum + numeric(trade.net_pnl), 0) / closed.length : 0,
    averageR: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null,
    maxDrawdown: maxDrawdown(equity.map((point) => point.value)),
    reviewedPercent: trades.length ? trades.filter((trade) => trade.reviewed).length / trades.length * 100 : 0,
  };
}

export function equityCurve(trades: CanonicalTrade[], initialBalance: number) {
  let value = initialBalance;
  return trades
    .filter((trade) => trade.status === "CLOSED")
    .slice()
    .sort((left, right) => Date.parse(left.exit_time ?? left.entry_time) - Date.parse(right.exit_time ?? right.entry_time))
    .map((trade) => {
      value += numeric(trade.net_pnl);
      return { date: (trade.exit_time ?? trade.entry_time).slice(0, 10), tradeId: trade.id, value };
    });
}

export function journalCalendar(trades: CanonicalTrade[]) {
  const byDate = new Map<string, CanonicalTrade[]>();
  trades.forEach((trade) => {
    const date = trade.entry_time.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), trade]);
  });
  return [...byDate.entries()].map(([date, rows]) => ({ date, summary: summarizeJournalTrades(rows), trades: rows })).sort((a, b) => a.date.localeCompare(b.date));
}

export function buildJournalBreakdown(
  trades: CanonicalTrade[],
  dimension: JournalBreakdownDimension,
  accounts: JournalAccount[] = [],
): JournalBreakdownRow[] {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const groups = new Map<string, { label: string; trades: CanonicalTrade[] }>();
  trades.forEach((trade) => {
    dimensionValues(trade, dimension, accountNames).forEach(({ key, label }) => {
      const group = groups.get(key) ?? { label, trades: [] };
      group.trades.push(trade);
      groups.set(key, group);
    });
  });
  return [...groups.entries()].map(([key, group]) => ({ key, label: group.label, tradeIds: group.trades.map((trade) => trade.id), ...summarizeJournalTrades(group.trades) }))
    .sort((left, right) => right.totalTrades - left.totalTrades || right.netPnl - left.netPnl || left.label.localeCompare(right.label));
}

export function inferMarket(symbol: string) {
  const value = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/(USDT|USDC|BTC|ETH)$/.test(value) || /^(BTC|ETH|SOL|ADA|DOGE)/.test(value)) return "Crypto";
  if (/^[A-Z]{6}$/.test(value) && /(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD)/.test(value)) return "Forex";
  if (/^(ES|MES|NQ|MNQ|YM|MYM|RTY|M2K|CL|GC|SI|ZB|ZN|6[A-Z])([A-Z]\d+)?$/.test(value)) return "Futures";
  if (/^[A-Z]{1,5}$/.test(value)) return "Stocks / ETFs";
  return "Other";
}

export function scopedCurrency(accounts: JournalAccount[], accountIds: number[], trades: CanonicalTrade[] = []) {
  const selected = accountIds.length ? accounts.filter((account) => accountIds.includes(account.id)) : accounts.filter((account) => account.status === "ACTIVE");
  const currencies = [...new Set([...selected.map((account) => account.currency), ...trades.map((trade) => trade.currency)])];
  return currencies.length === 1 ? { combinable: true, currency: currencies[0] } : { combinable: currencies.length <= 1, currency: currencies[0] ?? "USD", currencies };
}

export function computeEdgeScore(trades: CanonicalTrade[], now = new Date(), windowDays = 30) {
  const end = now.getTime();
  const windowMs = windowDays * 86_400_000;
  const recent = trades.filter((trade) => { const time = Date.parse(trade.entry_time); return time <= end && time > end - windowMs; });
  const previous = trades.filter((trade) => { const time = Date.parse(trade.entry_time); return time <= end - windowMs && time > end - windowMs * 2; });
  const recentSummary = summarizeJournalTrades(recent);
  const previousSummary = summarizeJournalTrades(previous);
  const winRate = boundedDelta(recentSummary.winRate - previousSummary.winRate, 25);
  const expectancy = boundedDelta(relativeDelta(recentSummary.expectancy, previousSummary.expectancy) * 100, 100);
  const reviewDiscipline = recentSummary.reviewedPercent / 100;
  const riskDiscipline = riskBehavior(recent).score / 100;
  const score = Math.round(Math.max(0, Math.min(100, 50 + winRate * 18 + expectancy * 17 + (reviewDiscipline - 0.5) * 18 + (riskDiscipline - 0.5) * 14)));
  return {
    score,
    direction: score > 55 ? "improving" as const : score < 45 ? "weakening" as const : "steady" as const,
    windowDays,
    recentCount: recent.length,
    previousCount: previous.length,
    confidence: recent.length >= 30 && previous.length >= 30 ? "high" as const : recent.length >= 10 && previous.length >= 10 ? "medium" as const : "low" as const,
    components: [
      { label: "Win-rate change", value: recentSummary.winRate - previousSummary.winRate, unit: "pp" },
      { label: "Expectancy change", value: recentSummary.expectancy - previousSummary.expectancy, unit: recent[0]?.currency ?? "" },
      { label: "Review discipline", value: recentSummary.reviewedPercent, unit: "%" },
      { label: "Risk behavior", value: riskBehavior(recent).score, unit: "/100" },
    ],
  };
}

export function riskBehavior(trades: CanonicalTrade[]) {
  const taken = trades.filter((trade) => trade.entry_type === "TAKEN");
  const stopSet = taken.filter((trade) => trade.stop_loss != null);
  const plannedStops = taken.filter((trade) => trade.planned_stop_loss != null && trade.stop_loss != null);
  const stopAdherent = plannedStops.filter((trade) => Math.abs(numeric(trade.planned_stop_loss) - numeric(trade.stop_loss)) <= Math.max(0.000001, numeric(trade.entry_price) * 0.001));
  const sizes = taken.map((trade) => numeric(trade.quantity)).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const oversized = median > 0 ? taken.filter((trade) => numeric(trade.quantity) > median * 2) : [];
  const mistakeTagged = taken.filter((trade) => trade.tags.some((tag) => tag.category === "MISTAKE" || tag.category === "PROCESS"));
  const chronological = taken.slice().sort((a, b) => Date.parse(a.entry_time) - Date.parse(b.entry_time));
  let lossEscalations = 0;
  for (let index = 1; index < chronological.length; index += 1) {
    if (numeric(chronological[index - 1].net_pnl) < 0 && numeric(chronological[index].quantity) > numeric(chronological[index - 1].quantity) * 1.25) lossEscalations += 1;
  }
  const stopCoverage = taken.length ? stopSet.length / taken.length * 100 : 0;
  const adherence = plannedStops.length ? stopAdherent.length / plannedStops.length * 100 : null;
  const penalty = (taken.length ? oversized.length / taken.length * 20 : 0) + (taken.length ? mistakeTagged.length / taken.length * 20 : 0) + (taken.length ? lossEscalations / taken.length * 20 : 0);
  return {
    score: Math.round(Math.max(0, Math.min(100, stopCoverage * 0.65 + (adherence ?? stopCoverage) * 0.35 - penalty))),
    stopCoverage,
    plannedStopAdherence: adherence,
    oversizedCount: oversized.length,
    lossEscalations,
    ruleViolationCount: mistakeTagged.length,
    sampleSize: taken.length,
  };
}

export function weakSpots(trades: CanonicalTrade[], accounts: JournalAccount[]) {
  const dimensions: JournalBreakdownDimension[] = ["weekday", "hour", "market", "symbol", "direction", "duration", "size", "tag", "rating", "account"];
  return dimensions.flatMap((dimension) => {
    const rows = buildJournalBreakdown(trades, dimension, accounts).filter((row) => row.closedTrades > 0);
    if (!rows.length) return [];
    const best = rows.slice().sort((a, b) => b.expectancy - a.expectancy)[0];
    const worst = rows.slice().sort((a, b) => a.expectancy - b.expectancy)[0];
    return [{ dimension, best, worst }];
  });
}

export function tagOptions(tags: JournalTag[]) {
  return tags.filter((tag) => !tag.archived_at).slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function dimensionValues(trade: CanonicalTrade, dimension: JournalBreakdownDimension, accountNames: Map<number, string>) {
  const entry = new Date(trade.entry_time);
  const durationMinutes = trade.exit_time ? Math.max(0, (Date.parse(trade.exit_time) - Date.parse(trade.entry_time)) / 60_000) : null;
  const size = numeric(trade.quantity);
  switch (dimension) {
    case "account": return [{ key: String(trade.account_id), label: accountNames.get(trade.account_id) ?? `Account ${trade.account_id}` }];
    case "direction": return [{ key: trade.side, label: trade.side === "LONG" ? "Long" : "Short" }];
    case "duration": return [{ key: durationBucket(durationMinutes), label: durationBucket(durationMinutes) }];
    case "grade": return [{ key: trade.setup_grade ?? "Ungraded", label: trade.setup_grade ?? "Ungraded" }];
    case "hour": { const hour = entry.getHours(); return [{ key: String(hour), label: `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00` }]; }
    case "market": { const market = inferMarket(trade.symbol); return [{ key: market, label: market }]; }
    case "rating": return [{ key: trade.rating ? String(trade.rating) : "Unrated", label: trade.rating ? `${trade.rating} star${trade.rating === 1 ? "" : "s"}` : "Unrated" }];
    case "size": { const bucket = sizeBucket(size); return [{ key: bucket, label: bucket }]; }
    case "strategy": return [{ key: trade.strategy_name ?? "Unassigned", label: trade.strategy_name ?? "Unassigned" }];
    case "symbol": return [{ key: trade.symbol, label: trade.symbol }];
    case "tag": return trade.tags.length ? trade.tags.map((tag) => ({ key: String(tag.id), label: tag.name })) : [{ key: "untagged", label: "Untagged" }];
    case "weekday": return [{ key: String(entry.getDay()), label: entry.toLocaleDateString(undefined, { weekday: "long" }) }];
  }
}

function durationBucket(minutes: number | null) {
  if (minutes == null) return "Open / no exit";
  if (minutes < 5) return "Under 5 min";
  if (minutes < 30) return "5–30 min";
  if (minutes < 120) return "30 min–2 hr";
  if (minutes < 480) return "2–8 hr";
  return "8 hr or more";
}

function sizeBucket(size: number) {
  if (size <= 1) return "Up to 1 unit";
  if (size <= 10) return "1–10 units";
  if (size <= 100) return "10–100 units";
  return "Over 100 units";
}

function maxDrawdown(values: number[]) {
  let peak = 0;
  let drawdown = 0;
  values.forEach((value) => { peak = Math.max(peak, value); drawdown = Math.max(drawdown, peak - value); });
  return drawdown;
}

function relativeDelta(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : Math.sign(current);
  return (current - previous) / Math.abs(previous);
}

function boundedDelta(value: number, maximum: number) {
  return Math.max(-1, Math.min(1, value / maximum));
}

export function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumeric(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
