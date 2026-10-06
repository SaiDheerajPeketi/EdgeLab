import { useEffect, useState } from "react";
import { journalMonthDays, shiftJournalMonth } from "../../lib/journalDailyNotes";
import { formatLocaleDateTime } from "../../lib/locale";

export function JournalMonthPicker({ date, onSelect, compatibility = false }: { date: string; onSelect: (date: string) => void; compatibility?: boolean }) {
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => { setMonth(date.slice(0, 7)); }, [date]);
  const button = compatibility ? "border border-stone-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 hover:bg-stone-800" : "border border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 hover:bg-white/5";
  return <section className="my-5 max-w-xl" aria-label="Review calendar">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <button className={`min-h-11 px-3 text-sm ${button}`} type="button" aria-label="Previous month" onClick={() => setMonth(shiftJournalMonth(month, -1))}>Previous</button>
      <h2 className="text-sm font-semibold">{formatLocaleDateTime(`${month}-01T12:00:00Z`, { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
      <button className={`min-h-11 px-3 text-sm ${button}`} type="button" aria-label="Next month" onClick={() => setMonth(shiftJournalMonth(month, 1))}>Next</button>
    </div>
    <div className="grid grid-cols-7 gap-1">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <span className="py-2 text-center text-xs" key={day}>{day}</span>)}
      {journalMonthDays(month).map((day) => <button key={day} type="button" aria-label={day} aria-pressed={date === day} onClick={() => onSelect(day)} className={`min-h-11 min-w-0 text-sm tabular-nums ${button} ${date === day ? compatibility ? "bg-amber-200 text-amber-950" : "bg-cyan-300 text-cyan-950" : day.startsWith(month) ? "" : compatibility ? "text-stone-400" : "text-slate-400"}`}>{Number(day.slice(8))}</button>)}
    </div>
    <p className={`mt-2 text-xs ${compatibility ? "text-stone-300" : "text-slate-400"}`}>UTC entry day · Select a date to review its note and trades.</p>
  </section>;
}
