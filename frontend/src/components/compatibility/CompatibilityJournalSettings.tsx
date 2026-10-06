import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { parseSettingsDeepLink } from "../settings/settingsCatalog";
import { RESET_JOURNAL_SETTINGS, useJournalSettings } from "../settings/useJournalSettings";

const field = "mt-2 min-h-11 w-full border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300";
const button = "min-h-11 border border-amber-500 px-4 text-sm font-medium hover:bg-amber-900/30 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300";

export function CompatibilityJournalSettings() {
  const settings = useJournalSettings();
  const location = useLocation();
  const { journalDraft, setJournalDraft } = settings;
  const invalidCurrency = !/^[A-Z]{3}$/.test(journalDraft.default_currency);
  useEffect(() => {
    const link = parseSettingsDeepLink(location.hash);
    if (link?.category !== "journal" || !link.controlId) return;
    const control = document.getElementById(`setting-${link.controlId}`);
    control?.scrollIntoView({ block: "nearest" });
    control?.querySelector<HTMLElement>("input,textarea,select,button")?.focus();
  }, [location.hash, settings.ready]);
  return <section className="min-w-0" data-journal-settings>
    <h1 className="text-2xl font-semibold">Journal settings</h1>
    <p className="mt-2 max-w-[70ch] text-sm leading-6 text-stone-300">Set defaults for new journal entries and the template for new notebook notes. Existing trades stay unchanged.</p>
    {!settings.ready || settings.error ? <div className="mt-5 text-sm text-amber-200" role={settings.error ? "alert" : "status"}>{settings.error ? "Journal settings could not be loaded. Your draft is kept." : "Loading journal settings…"}{settings.error ? <button className={`${button} ml-3 mt-2`} disabled={settings.loading} onClick={() => void settings.reload()} type="button">Retry loading settings</button> : null}</div> : null}
    <fieldset className="min-w-0" disabled={!settings.ready}>
      <section className="mt-8 border-t border-stone-700 pt-5" id="setting-journal-defaults">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Capture defaults</h2><button className={button} onClick={() => setJournalDraft(RESET_JOURNAL_SETTINGS)} type="button">Reset defaults</button></div>
        <p className="mt-2 text-sm text-stone-300">Effective: {settings.defaults.default_currency} · {settings.defaults.default_entry_type.toLowerCase()}{settings.journalDirty ? " · Unsaved changes" : ""}</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="text-sm text-stone-300">Currency<input aria-describedby={invalidCurrency ? "journal-currency-validation" : undefined} aria-invalid={invalidCurrency} className={field} maxLength={3} onChange={(event) => setJournalDraft((current) => ({ ...current, default_currency: event.target.value.toUpperCase() }))} value={journalDraft.default_currency} /></label>
          <label className="text-sm text-stone-300">Broker label<input className={field} maxLength={80} onChange={(event) => setJournalDraft((current) => ({ ...current, default_broker: event.target.value }))} placeholder="Optional" value={journalDraft.default_broker} /></label>
          <label className="text-sm text-stone-300">Default entry type<select className={field} onChange={(event) => setJournalDraft((current) => ({ ...current, default_entry_type: event.target.value as "TAKEN" | "MISSED" }))} value={journalDraft.default_entry_type}><option value="TAKEN">Taken</option><option value="MISSED">Missed</option></select></label>
          <div className="flex min-h-11 items-center gap-3 text-sm text-stone-300"><button aria-label="Require account for taken trades" aria-checked={journalDraft.require_account_for_taken_trades} className="flex h-11 w-11 shrink-0 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300" onClick={() => setJournalDraft((current) => ({ ...current, require_account_for_taken_trades: !current.require_account_for_taken_trades }))} role="switch" type="button"><span aria-hidden="true" className={`flex h-6 w-10 items-center rounded-full p-1 ${journalDraft.require_account_for_taken_trades ? "justify-end bg-amber-300" : "justify-start bg-stone-600"}`}><span className="h-4 w-4 rounded-full bg-stone-950" /></span></button><span>Require account for taken trades</span></div>
        </div>
        {invalidCurrency ? <p className="mt-3 text-sm text-amber-200" id="journal-currency-validation" role="alert">Use a three-letter currency code, for example USD.</p> : null}
        <button className={`${button} mt-5`} disabled={!settings.journalDirty || invalidCurrency || settings.journalPending} onClick={() => void settings.saveJournal()} type="button">{settings.journalPending ? "Saving journal defaults…" : "Apply journal defaults"}</button>
        <SaveFeedback state={settings.journalState} saved="Journal defaults saved" failed="Journal defaults could not be saved. Your draft is kept." onRetry={settings.saveJournal} />
      </section>
      <section className="mt-9 border-t border-stone-700 pt-5" id="setting-note-template">
        <h2 className="text-lg font-semibold">Review note template</h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-6 text-stone-300">Inserted when a new notebook note starts. Supported placeholders: {"{side}, {quantity}, {entry}, {exit}, {pnl}, and {r}."}</p>
        <textarea aria-label="Review note template" aria-invalid={!settings.noteDraft.trim()} aria-describedby={!settings.noteDraft.trim() ? "note-template-validation" : undefined} className={`${field} mt-4 min-h-60 resize-y py-3`} maxLength={200000} onChange={(event) => settings.setNoteDraft(event.target.value)} rows={10} value={settings.noteDraft} />
        {!settings.noteDraft.trim() ? <p className="mt-3 text-sm text-amber-200" id="note-template-validation" role="alert">The template cannot be empty.</p> : null}
        {settings.noteDirty ? <p className="mt-2 text-sm text-stone-300">Unsaved changes</p> : null}
        <button className={`${button} mt-4`} disabled={!settings.noteDirty || !settings.noteDraft.trim() || settings.notePending} onClick={() => void settings.saveNote()} type="button">{settings.notePending ? "Saving note template…" : "Save note template"}</button>
        <SaveFeedback state={settings.noteState} saved="Note template saved" failed="Note template could not be saved. Your draft is kept." onRetry={settings.saveNote} />
      </section>
    </fieldset>
  </section>;
}

function SaveFeedback({ state, saved, failed, onRetry }: { state: string; saved: string; failed: string; onRetry: () => Promise<void> }) {
  if (state !== "saved" && state !== "error") return null;
  return <p className="mt-3 text-sm text-stone-300" role={state === "error" ? "alert" : "status"}>{state === "saved" ? saved : failed}{state === "error" ? <button className={`${button} ml-3 mt-2`} onClick={() => void onRetry()} type="button">Retry save</button> : null}</p>;
}
