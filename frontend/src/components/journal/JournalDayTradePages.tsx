import type { useJournalDayTrades } from "./useJournalDayTrades";

export function JournalDayTradePages({ day, compatibility = false }: { day: ReturnType<typeof useJournalDayTrades>; compatibility?: boolean }) {
  if (day.pageCount <= 1) return null;
  const button = compatibility ? "border border-stone-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" : "border border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300";
  return <nav aria-label="Day trade pages" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
    <button className={`min-h-11 px-3 disabled:opacity-50 ${button}`} type="button" disabled={day.page === 0} onClick={() => day.setPage(day.page - 1)}>Previous day trades</button>
    <span>Page {day.page + 1} of {day.pageCount} · {day.trades.length} trades</span>
    <button className={`min-h-11 px-3 disabled:opacity-50 ${button}`} type="button" disabled={day.page + 1 >= day.pageCount} onClick={() => day.setPage(day.page + 1)}>Next day trades</button>
  </nav>;
}
