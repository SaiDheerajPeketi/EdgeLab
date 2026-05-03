const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function computeSummary(trades) {
  const closed = trades.filter((trade) => trade.exit_timestamp);
  const wins = closed.filter((trade) => trade.net_pnl > 0);
  const losses = closed.filter((trade) => trade.net_pnl < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.net_pnl, 0));
  const totalNetPnl = closed.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const totalCommissions = closed.reduce((sum, trade) => sum + trade.commission, 0);
  const averageWin = wins.length ? grossWins / wins.length : 0;
  const averageLoss = losses.length ? grossLosses / losses.length : 0;
  const winRate = closed.length ? wins.length / closed.length : 0;
  const expectancy = averageWin * winRate - averageLoss * (1 - winRate);
  const averageR = closed.length
    ? closed.reduce((sum, trade) => sum + trade.r_multiple, 0) / closed.length
    : 0;
  const maxDrawdown = computeDrawdown(closed).maxDrawdown;
  const daily = groupDailyPnl(closed);
  const dailyPnls = Array.from(daily.values());
  const sharpeRatio = computeSharpe(dailyPnls);
  const streaks = computeStreaks(closed);
  const winStreaks = streaks.filter((streak) => streak.type === "win").map((streak) => streak.length);
  const lossStreaks = streaks.filter((streak) => streak.type === "loss").map((streak) => streak.length);

  return {
    total_trades: closed.length,
    win_rate: winRate,
    total_net_pnl: totalNetPnl,
    profit_factor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? null : 0,
    average_r_multiple: averageR,
    expectancy,
    max_drawdown: maxDrawdown.amount,
    max_drawdown_percent: maxDrawdown.percent,
    average_win: averageWin,
    average_loss: averageLoss,
    largest_win: wins.length ? Math.max(...wins.map((trade) => trade.net_pnl)) : 0,
    largest_loss: losses.length ? Math.min(...losses.map((trade) => trade.net_pnl)) : 0,
    average_hold_minutes: average(closed.map((trade) => trade.hold_duration_minutes ?? 0)),
    consecutive_wins: winStreaks.length ? Math.max(...winStreaks) : 0,
    consecutive_losses: lossStreaks.length ? Math.max(...lossStreaks) : 0,
    sharpe_ratio: sharpeRatio,
    recovery_factor: maxDrawdown.amount !== 0 ? totalNetPnl / Math.abs(maxDrawdown.amount) : null,
    total_commissions: totalCommissions,
  };
}

export function computeEquityCurve(trades) {
  let cumulative = 0;
  return trades
    .filter((trade) => trade.exit_timestamp)
    .sort((a, b) => a.exit_timestamp - b.exit_timestamp)
    .map((trade, index) => {
      cumulative += trade.net_pnl;
      return {
        trade_number: index + 1,
        trade_id: trade.id,
        date: new Date(trade.exit_timestamp).toISOString(),
        cumulative_pnl: cumulative,
      };
    });
}

export function computeDrawdown(trades) {
  const curve = computeEquityCurve(trades);
  let peak = 0;
  let maxAmount = 0;
  let maxPercent = 0;
  const points = curve.map((point) => {
    peak = Math.max(peak, point.cumulative_pnl);
    const amount = point.cumulative_pnl - peak;
    const percent = peak !== 0 ? amount / Math.abs(peak) : 0;
    maxAmount = Math.min(maxAmount, amount);
    maxPercent = Math.min(maxPercent, percent);
    return { ...point, drawdown: amount, drawdown_percent: percent };
  });

  return {
    points,
    maxDrawdown: {
      amount: maxAmount,
      percent: maxPercent,
    },
  };
}

export function computeByHour(trades) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    pnl: 0,
    wins: 0,
    count: 0,
    win_rate: 0,
  }));
  for (const trade of closedTrades(trades)) {
    const hour = new Date(trade.exit_timestamp).getUTCHours();
    rows[hour].pnl += trade.net_pnl;
    rows[hour].count += 1;
    if (trade.net_pnl > 0) rows[hour].wins += 1;
  }
  return rows.map((row) => ({
    ...row,
    win_rate: row.count ? row.wins / row.count : 0,
  }));
}

export function computeByDay(trades) {
  const rows = DAYS.map((day, index) => ({
    day,
    day_index: index,
    pnl: 0,
    wins: 0,
    count: 0,
    win_rate: 0,
  }));
  for (const trade of closedTrades(trades)) {
    const day = new Date(trade.exit_timestamp).getUTCDay();
    rows[day].pnl += trade.net_pnl;
    rows[day].count += 1;
    if (trade.net_pnl > 0) rows[day].wins += 1;
  }
  return rows.map((row) => ({
    ...row,
    win_rate: row.count ? row.wins / row.count : 0,
  }));
}

export function computeByStrategy(trades) {
  const map = new Map();
  for (const trade of closedTrades(trades)) {
    const key = trade.strategy_tag || "Unlabeled";
    const row = map.get(key) ?? { tag: key, pnl: 0, wins: 0, count: 0, win_rate: 0 };
    row.pnl += trade.net_pnl;
    row.count += 1;
    if (trade.net_pnl > 0) row.wins += 1;
    map.set(key, row);
  }
  return Array.from(map.values()).map((row) => ({
    ...row,
    win_rate: row.count ? row.wins / row.count : 0,
  }));
}

export function computeRDistribution(trades, binSize = 0.5) {
  const map = new Map();
  for (const trade of closedTrades(trades)) {
    const bucketStart = Math.floor(trade.r_multiple / binSize) * binSize;
    const bucket = `${bucketStart.toFixed(1)}R`;
    map.set(bucket, (map.get(bucket) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => Number.parseFloat(a.bucket) - Number.parseFloat(b.bucket));
}

export function computeMonthlyCalendar(trades) {
  const map = new Map();
  for (const trade of closedTrades(trades)) {
    const date = new Date(trade.exit_timestamp);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
    const current = map.get(key) ?? {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      pnl: 0,
      count: 0,
    };
    current.pnl += trade.net_pnl;
    current.count += 1;
    map.set(key, current);
  }
  return Array.from(map.values()).sort(
    (a, b) => Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day),
  );
}

export function computeStreaks(trades) {
  const closed = closedTrades(trades).sort((a, b) => a.exit_timestamp - b.exit_timestamp);
  const streaks = [];
  let active = null;

  for (const trade of closed) {
    const type = trade.net_pnl > 0 ? "win" : trade.net_pnl < 0 ? "loss" : "breakeven";
    if (!active || active.type !== type) {
      if (active) streaks.push(active);
      active = {
        type,
        length: 1,
        start_trade: trade.id,
        end_trade: trade.id,
      };
    } else {
      active.length += 1;
      active.end_trade = trade.id;
    }
  }
  if (active) streaks.push(active);
  return streaks;
}

function groupDailyPnl(trades) {
  const map = new Map();
  for (const trade of trades) {
    const date = new Date(trade.exit_timestamp).toISOString().slice(0, 10);
    map.set(date, (map.get(date) ?? 0) + trade.net_pnl);
  }
  return map;
}

function computeSharpe(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? 0 : avg / stdDev;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function closedTrades(trades) {
  return trades.filter((trade) => trade.exit_timestamp);
}
