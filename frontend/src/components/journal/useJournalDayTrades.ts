import { useEffect, useRef, useState } from "react";
import { latestJournalRecord, listCanonicalTrades, subscribeJournalUpdates, type CanonicalTrade } from "../../lib/journalApi";
import { isJournalDate, utcEntryDay } from "../../lib/journalDailyNotes";

export function useJournalDayTrades(date: string, accountId: number | null) {
  const scope = `${date}:${accountId ?? "all"}`;
  const [revision, setRevision] = useState(0);
  const [pageState, setPageState] = useState({ scope, page: 0 });
  const [state, setState] = useState<{ scope: string; trades: CanonicalTrade[]; loading: boolean; error: string | null }>({ scope, trades: [], loading: true, error: null });
  const confirmed = useRef(new Map<number, CanonicalTrade>());
  useEffect(() => subscribeJournalUpdates((update) => {
    if (update.kind !== "review") return;
    confirmed.current.set(update.trade.id, update.trade);
    setState((current) => {
      const [day, account] = current.scope.split(":");
      const belongs = utcEntryDay(update.trade.entry_time) === day && (account === "all" || update.trade.account_id === Number(account));
      return { ...current, trades: [...current.trades.filter((trade) => trade.id !== update.trade.id), ...(belongs && !current.loading ? [update.trade] : [])].sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time) || b.id - a.id) };
    });
  }), []);
  useEffect(() => {
    let active = true;
    setState({ scope, trades: [], loading: isJournalDate(date), error: null });
    if (isJournalDate(date)) void (async () => {
      try {
        const trades = new Map<number, CanonicalTrade>();
        for (let offset = 0; active; offset += 200) {
          const page = await listCanonicalTrades({ startDate: date, endDate: date, accountId: accountId ?? undefined, offset, limit: 200 });
          page.forEach((trade) => trades.set(trade.id, latestJournalRecord(trade, confirmed.current.get(trade.id))));
          if (page.length < 200) break;
        }
        confirmed.current.forEach((trade) => trades.set(trade.id, latestJournalRecord(trades.get(trade.id) ?? trade, trade)));
        if (active) setState({ scope, trades: [...trades.values()].filter((trade) => utcEntryDay(trade.entry_time) === date && (accountId == null || trade.account_id === accountId)).sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time) || b.id - a.id), loading: false, error: null });
      } catch { if (active) setState({ scope, trades: [], loading: false, error: "Day trades could not be loaded. Retry to see the complete day." }); }
    })();
    return () => { active = false; };
  }, [date, accountId, revision]);
  const current = state.scope === scope ? state : { scope, trades: [], loading: isJournalDate(date), error: null };
  const pageCount = Math.max(1, Math.ceil(current.trades.length / 100));
  const page = Math.min(pageState.scope === scope ? pageState.page : 0, pageCount - 1);
  return { ...current, page, pageCount, pageTrades: current.trades.slice(page * 100, (page + 1) * 100), setPage: (next: number) => setPageState({ scope, page: Math.max(0, Math.min(next, pageCount - 1)) }), retry: () => setRevision((value) => value + 1) };
}
