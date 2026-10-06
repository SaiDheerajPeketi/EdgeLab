import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCanonicalTrade, latestJournalRecord, listJournalAccounts, listJournalDailyNotes, subscribeJournalUpdates, upsertJournalDailyNote, type CanonicalTrade, type JournalAccount, type JournalDailyNote } from "../../lib/journalApi";
import { exactDailyNote, isJournalDate } from "../../lib/journalDailyNotes";
import { journalDeepLink, parseJournalDeepLink } from "../../lib/journalWorkspaceState";
import { formatLocaleCurrency, formatLocaleDateTime } from "../../lib/locale";
import { JournalMonthPicker } from "../journal/JournalMonthPicker";
import { JournalDayTradePages } from "../journal/JournalDayTradePages";
import { useDailyNoteDraft } from "../journal/useDailyNoteDraft";
import { useJournalDayTrades } from "../journal/useJournalDayTrades";
import { TradeReview } from "./CompatibilityJournal";

const field = "mt-1 min-h-11 w-full min-w-0 border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50";
const button = "min-h-11 border border-stone-500 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50";

export function CompatibilityJournalNotes({ calendarMode = false }: { calendarMode?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const link = parseJournalDeepLink(location.hash);
  const [defaultDate, setDefaultDate] = useState(new Date().toISOString().slice(0, 10));
  const date = link?.date ?? defaultDate;
  const accountId = link?.accountId ?? null;
  const tradeId = link?.tradeId ?? null;
  const [accounts, setAccounts] = useState<JournalAccount[]>([]);
  const [notes, setNotes] = useState<JournalDailyNote[]>([]);
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const confirmedNotes = useRef(new Map<number, JournalDailyNote>());
  const confirmedTrades = useRef(new Map<number, CanonicalTrade>());
  const [selected, setSelected] = useState<CanonicalTrade | null>(null);
  const [tradeError, setTradeError] = useState(false);
  const selectedNote = exactDailyNote(notes, date, accountId);
  const editor = useDailyNoteDraft(date, accountId, selectedNote, upsertJournalDailyNote);
  const day = useJournalDayTrades(date, accountId);
  const validScope = isJournalDate(date) && (accountId == null || accounts.some((account) => account.id === accountId));
  const library = notes.filter((note) => (accountId == null || note.account_id == null || note.account_id === accountId) && `${note.note_date} ${note.body}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.note_date.localeCompare(a.note_date) || b.id - a.id);

  useEffect(() => subscribeJournalUpdates((update) => {
    if (update.kind === "daily-note") {
      confirmedNotes.current.set(update.note.id, update.note);
      setNotes((current) => [update.note, ...current.filter((note) => note.id !== update.note.id)]);
    } else if (update.kind === "review") {
      confirmedTrades.current.set(update.trade.id, update.trade);
      setSelected((current) => current?.id === update.trade.id ? update.trade : current);
    }
  }), []);
  useEffect(() => {
    let active = true;
    setLoadError(null);
    void Promise.all([listJournalAccounts(), listJournalDailyNotes()]).then(([nextAccounts, nextNotes]) => {
      if (!active) return;
      setAccounts(nextAccounts);
      setNotes([...nextNotes.map((note) => latestJournalRecord(note, confirmedNotes.current.get(note.id))), ...[...confirmedNotes.current.values()].filter((note) => !nextNotes.some((item) => item.id === note.id))]);
      if (nextNotes[0]) setDefaultDate(nextNotes[0].note_date);
      setLoaded(true);
    }).catch(() => { if (active) setLoadError("Daily notes could not be loaded. Retry before editing a saved note."); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setSelected(null); setTradeError(false);
    if (tradeId != null) void getCanonicalTrade(tradeId).then((trade) => { if (active) setSelected(latestJournalRecord(trade, confirmedTrades.current.get(trade.id))); }).catch(() => { if (active) setTradeError(true); });
    return () => { active = false; };
  }, [tradeId, revision]);

  function select(nextDate: string, nextAccount: number | null, nextTrade: number | null = null) {
    navigate({ pathname: location.pathname, search: location.search, hash: journalDeepLink({ surface: calendarMode ? "calendar" : "notes", date: nextDate, accountId: nextAccount, tradeId: nextTrade, segment: null, returnTo: nextTrade ? calendarMode ? "calendar" : "notes" : null }) }, { replace: true });
  }
  useEffect(() => {
    if (loaded && link?.date == null) select(date, accountId, tradeId);
  }, [loaded, link?.date, date, accountId, tradeId]);

  return <section>
    <h1 className="text-2xl font-semibold">{calendarMode ? "Day review" : "Daily notes"}</h1>
    <p className="mt-2 text-sm text-stone-300">Saved reflections and trades for the UTC entry day. Shared and account notes are saved separately.</p>
    {loadError ? <div className="mt-4"><p role="alert" className="text-rose-200">{loadError}</p><button className={`${button} mt-2`} type="button" onClick={() => setRevision((value) => value + 1)}>Retry notes</button></div> : null}
    {!loaded && !loadError ? <p className="mt-4" role="status">Loading daily notes…</p> : null}
    {loaded ? <>
      {calendarMode && isJournalDate(date) ? <JournalMonthPicker date={date} onSelect={(nextDate) => select(nextDate, accountId)} compatibility /> : null}
      <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-[minmax(12rem,.7fr)_minmax(0,1.3fr)]">
        <aside className="min-w-0" aria-label="Daily note library">
          <label className="block text-sm text-stone-300">Search notes<input className={field} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="mt-4 max-h-96 divide-y divide-stone-700 overflow-auto border-y border-stone-700">
            {library.map((note) => <button className={`min-h-11 w-full px-2 py-3 text-left focus-visible:outline focus-visible:outline-amber-400 ${selectedNote?.id === note.id ? "bg-stone-800" : "hover:bg-stone-800"}`} type="button" key={note.id} onClick={() => select(note.note_date, note.account_id)} aria-current={selectedNote?.id === note.id ? "true" : undefined}>
              <span className="block text-sm font-medium">{formatLocaleDateTime(`${note.note_date}T12:00:00Z`, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · {note.account_id == null ? "All accounts" : accounts.find((account) => account.id === note.account_id)?.name ?? "Account"}</span>
              <span className="mt-1 block line-clamp-2 break-words text-sm text-stone-300">{note.body || "Empty note"}</span>
            </button>)}
            {!library.length ? <p className="py-4 text-sm text-stone-300">{query.trim() ? "No saved notes match this search." : "No saved notes yet."}</p> : null}
          </div>
        </aside>
        <div className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-stone-300">Date<input className={field} type="date" value={date} onChange={(event) => select(event.target.value, accountId)} /></label>
            <label className="block text-sm text-stone-300">Note scope<select className={field} value={accountId ?? "all"} onChange={(event) => select(date, event.target.value === "all" ? null : Number(event.target.value))}><option value="all">All accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
          </div>
          {!validScope ? <p className="mt-3 text-rose-200" role="alert">Choose a valid date and one of your accounts before saving.</p> : null}
          <label className="mt-4 block text-sm text-stone-300">Daily note<textarea className={`${field} resize-y py-3 leading-6`} rows={10} maxLength={200000} disabled={!validScope || editor.saving || Boolean(loadError)} value={editor.body} onChange={(event) => editor.setBody(event.target.value)} /></label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className={`text-sm ${editor.state === "error" ? "text-rose-200" : "text-stone-300"}`} role={editor.state === "error" ? "alert" : "status"}>{editor.saving ? "Saving…" : editor.state === "error" ? "Save failed; your text is kept. Retry save." : editor.state === "saved" ? "Note saved" : editor.dirty ? "Unsaved changes" : "Explicit save"}</p><button className={button} type="button" disabled={!validScope || !editor.dirty || editor.saving || Boolean(loadError)} onClick={() => void editor.save()}>{editor.state === "error" ? "Retry save" : "Save note"}</button></div>
          <h2 className="mt-6 text-lg font-semibold">Trades on this date</h2>
          <p className="mt-1 text-sm text-stone-300">UTC entry day · {day.loading ? "Loading complete day…" : `${day.trades.length} trades`} · Amounts retain each trade’s currency.</p>
          {day.error ? <div className="mt-3"><p className="text-rose-200" role="alert">{day.error}</p><button className={`${button} mt-2`} onClick={day.retry} type="button">Retry day trades</button></div> : null}
          <div className="mt-3 divide-y divide-stone-700 border-y border-stone-700">
            {day.pageTrades.map((trade) => <button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 px-2 py-3 text-left focus-visible:outline focus-visible:outline-amber-400 hover:bg-stone-800" key={trade.id} type="button" aria-label={`Open ${trade.symbol} trade ${trade.id}`} onClick={() => select(date, accountId, trade.id)}><span><strong>{trade.symbol}</strong><span className="ml-2 text-sm text-stone-300">{formatLocaleDateTime(trade.entry_time, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</span></span><span className="text-sm tabular-nums">{formatLocaleCurrency(Number(trade.net_pnl), trade.currency)} {trade.currency}</span></button>)}
            {!day.loading && !day.error && !day.trades.length ? <p className="py-4 text-sm text-stone-300">No trades on this date. You can still save a planning note.</p> : null}
          </div>
          <JournalDayTradePages day={day} compatibility />
        </div>
      </div>
      {tradeId != null && !selected && !tradeError ? <p className="mt-5" role="status">Loading selected trade…</p> : null}
      {tradeError ? <div className="mt-5"><p className="text-rose-200" role="alert">This trade could not be opened.</p><button className={`${button} mt-2`} onClick={() => setRevision((value) => value + 1)} type="button">Retry trade</button><button className={`${button} ml-2`} onClick={() => select(date, accountId)} type="button">Close review</button></div> : null}
      {selected ? <TradeReview key={selected.id} trade={selected} onClose={() => select(date, accountId)} onSaved={setSelected} /> : null}
    </> : null}
  </section>;
}
