import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Plus, X } from "lucide-react";
import type { CanonicalTrade, CanonicalTradeCreate, JournalAccount, JournalEntryType, JournalSetupGrade, JournalTag } from "../../lib/journalApi";
import { JournalButton, journalFieldClass } from "./JournalControls";

type Draft = {
  accountId: string; symbol: string; currency: string; timezone: string; entryType: JournalEntryType; side: "LONG" | "SHORT";
  quantity: string; entryTime: string; exitTime: string; entryPrice: string; exitPrice: string; commission: string; fees: string;
  stopLoss: string; takeProfit: string; strategy: string; emotion: string; missedReason: string;
  rating: number | null; grade: JournalSetupGrade | null; tagIds: number[]; note: string; screenshots: string; reviewed: boolean;
};

export function JournalTradeFlow({ accounts, tags, preferredAccountId, onCancel, onCreate }: { accounts: JournalAccount[]; tags: JournalTag[]; preferredAccountId?: number | null; onCancel: () => void; onCreate: (payload: CanonicalTradeCreate) => Promise<CanonicalTrade> }) {
  const defaultAccount = accounts.find((account) => account.id === preferredAccountId) ?? accounts[0];
  const [draft, setDraft] = useState<Draft>(() => initialDraft(defaultAccount));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = accounts.find((candidate) => candidate.id === Number(draft.accountId)) ?? null;
  const validation = useMemo(() => validateStep(draft, step), [draft, step]);

  function chooseAccount(accountId: string) {
    const next = accounts.find((candidate) => candidate.id === Number(accountId));
    setDraft((current) => ({ ...current, accountId, currency: next?.currency ?? current.currency, timezone: next?.timezone ?? current.timezone }));
  }

  async function submit() {
    const finalError = validateStep(draft, 2);
    if (finalError) { setError(finalError); return; }
    setSaving(true); setError(null);
    try {
      await onCreate({
        account_id: Number(draft.accountId), symbol: draft.symbol.trim(), currency: draft.currency, source_timezone: draft.timezone,
        side: draft.side, entry_type: draft.entryType, entry_time: new Date(draft.entryTime).toISOString(),
        exit_time: draft.entryType === "TAKEN" && draft.exitTime ? new Date(draft.exitTime).toISOString() : null,
        entry_price: Number(draft.entryPrice), exit_price: draft.entryType === "TAKEN" && draft.exitPrice ? Number(draft.exitPrice) : null,
        quantity: draft.entryType === "TAKEN" ? Number(draft.quantity) : 0,
        commission: Number(draft.commission) || 0, fees: Number(draft.fees) || 0,
        stop_loss: numberOrNull(draft.stopLoss), take_profit: numberOrNull(draft.takeProfit),
        planned_entry_price: draft.entryType === "MISSED" ? Number(draft.entryPrice) : null,
        planned_stop_loss: draft.entryType === "MISSED" ? numberOrNull(draft.stopLoss) : null,
        planned_take_profit: draft.entryType === "MISSED" ? numberOrNull(draft.takeProfit) : null,
        strategy_name: draft.strategy.trim() || null, emotional_state: draft.emotion.trim() || null,
        missed_reason: draft.entryType === "MISSED" ? draft.missedReason.trim() : null,
        rating: draft.rating, setup_grade: draft.grade, reviewed: draft.reviewed, tag_ids: draft.tagIds,
        note: draft.note.trim() || null, screenshot_urls: lines(draft.screenshots),
      });
      onCancel();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Trade could not be created."); }
    finally { setSaving(false); }
  }

  return <section aria-labelledby="journal-add-trade-title" className="border-y border-cyan-300/20 bg-cyan-300/[0.025]">
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3"><div className="min-w-0 flex-1"><h2 id="journal-add-trade-title" className="text-base font-semibold text-white">Add trade</h2><p className="mt-0.5 text-xs text-slate-500">Step {step + 1} of 3 · {step === 0 ? "Destination" : step === 1 ? "Execution" : "Review"}</p></div><button type="button" onClick={onCancel} aria-label="Close add trade flow" className="grid h-10 w-10 place-items-center rounded-md text-slate-400 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><X aria-hidden="true" className="h-5 w-5" /></button></div>
    <div className="p-4 sm:p-5">
      {error ? <p role="alert" className="mb-4 rounded-md bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
      {step === 0 ? <div className="grid gap-4 sm:grid-cols-2"><Select label="Account" value={draft.accountId} onChange={chooseAccount}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.currency}</option>)}</Select><Select label="Entry type" value={draft.entryType} onChange={(entryType) => setDraft((current) => ({ ...current, entryType: entryType as JournalEntryType }))}><option value="TAKEN">Taken trade</option><option value="MISSED">Missed setup</option></Select><Field label="Symbol or contract" value={draft.symbol} onChange={(symbol) => setDraft((current) => ({ ...current, symbol: symbol.toUpperCase() }))} placeholder="MES" /><Select label="Direction" value={draft.side} onChange={(side) => setDraft((current) => ({ ...current, side: side as Draft["side"] }))}><option value="LONG">Long / buy</option><option value="SHORT">Short / sell</option></Select><Field label="Currency" value={draft.currency} onChange={(currency) => setDraft((current) => ({ ...current, currency: currency.toUpperCase() }))} /><Field label="Source time zone" value={draft.timezone} onChange={(timezone) => setDraft((current) => ({ ...current, timezone }))} /></div> : null}
      {step === 1 ? <div className="grid gap-4 sm:grid-cols-2"><Field label={draft.entryType === "MISSED" ? "Planned entry time" : "Entry fill time"} type="datetime-local" value={draft.entryTime} onChange={(entryTime) => setDraft((current) => ({ ...current, entryTime }))} /><Field label={draft.entryType === "MISSED" ? "Planned entry price" : "Entry fill price"} inputMode="decimal" value={draft.entryPrice} onChange={(entryPrice) => setDraft((current) => ({ ...current, entryPrice }))} />{draft.entryType === "TAKEN" ? <><Field label="Exit fill time · optional for open trade" type="datetime-local" value={draft.exitTime} onChange={(exitTime) => setDraft((current) => ({ ...current, exitTime }))} /><Field label="Exit fill price" inputMode="decimal" value={draft.exitPrice} onChange={(exitPrice) => setDraft((current) => ({ ...current, exitPrice }))} /><Field label="Quantity" inputMode="decimal" value={draft.quantity} onChange={(quantity) => setDraft((current) => ({ ...current, quantity }))} /><Field label="Commission" inputMode="decimal" value={draft.commission} onChange={(commission) => setDraft((current) => ({ ...current, commission }))} /><Field label="Fees" inputMode="decimal" value={draft.fees} onChange={(fees) => setDraft((current) => ({ ...current, fees }))} /></> : <label className="text-xs text-slate-500 sm:col-span-2">Why was it missed?<textarea value={draft.missedReason} onChange={(event) => setDraft((current) => ({ ...current, missedReason: event.target.value }))} rows={3} className={`${journalFieldClass} mt-1 resize-y py-2`} /></label>}<Field label="Stop" inputMode="decimal" value={draft.stopLoss} onChange={(stopLoss) => setDraft((current) => ({ ...current, stopLoss }))} /><Field label="Target" inputMode="decimal" value={draft.takeProfit} onChange={(takeProfit) => setDraft((current) => ({ ...current, takeProfit }))} /></div> : null}
      {step === 2 ? <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Strategy" value={draft.strategy} onChange={(strategy) => setDraft((current) => ({ ...current, strategy }))} placeholder="Optional" /><Field label="Emotional state" value={draft.emotion} onChange={(emotion) => setDraft((current) => ({ ...current, emotion }))} placeholder="Focused" /><Select label="Setup grade" value={draft.grade ?? ""} onChange={(grade) => setDraft((current) => ({ ...current, grade: (grade || null) as JournalSetupGrade | null }))}><option value="">Ungraded</option><option value="A+">A+</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></Select><fieldset><legend className="text-xs text-slate-500">Rating</legend><div className="mt-1 flex min-h-10 gap-1">{[1,2,3,4,5].map((rating) => <button key={rating} type="button" aria-pressed={draft.rating === rating} onClick={() => setDraft((current) => ({ ...current, rating: current.rating === rating ? null : rating }))} className={`h-10 w-10 rounded-md border text-sm ${draft.rating === rating ? "border-amber-300/50 bg-amber-300/10 text-amber-200" : "border-white/10 text-slate-500 hover:bg-white/5"}`}>{rating}</button>)}</div></fieldset></div><fieldset><legend className="text-xs text-slate-500">Tags</legend><div className="mt-1 flex max-h-28 flex-wrap gap-1.5 overflow-auto rounded-md border border-white/10 p-2">{tags.map((tag) => { const selected = draft.tagIds.includes(tag.id); return <button key={tag.id} type="button" aria-pressed={selected} onClick={() => setDraft((current) => ({ ...current, tagIds: selected ? current.tagIds.filter((id) => id !== tag.id) : [...current.tagIds, tag.id] }))} className={`min-h-8 rounded px-2 text-xs ${selected ? "bg-cyan-300/15 text-cyan-100" : "bg-white/[0.03] text-slate-400"}`}>{selected ? "✓ " : ""}{tag.name}</button>; })}{!tags.length ? <span className="text-xs text-slate-600">Tags can be created from the review drawer.</span> : null}</div></fieldset><label className="block text-xs text-slate-500">Notes<textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} rows={5} className={`${journalFieldClass} mt-1 resize-y py-2`} /></label><label className="block text-xs text-slate-500">Screenshot URLs · one per line<textarea value={draft.screenshots} onChange={(event) => setDraft((current) => ({ ...current, screenshots: event.target.value }))} rows={3} className={`${journalFieldClass} mt-1 resize-y py-2`} /></label><label className="flex min-h-10 items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={draft.reviewed} onChange={(event) => setDraft((current) => ({ ...current, reviewed: event.target.checked }))} />Mark reviewed when saved</label><div className="rounded-md border border-white/10 bg-black/20 p-3 text-xs leading-5 text-slate-400"><p className="font-medium text-slate-200">Review destination</p><p>{account?.name ?? "No account"} · {draft.symbol || "No symbol"} · {draft.side.toLowerCase()} · {draft.entryType.toLowerCase()}</p><p>Raw entry and exit fills are retained as canonical execution rows.</p></div></div> : null}
      {validation ? <p className="mt-4 text-sm text-rose-200" role="alert">{validation}</p> : null}
    </div>
    <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 sm:px-5"><JournalButton onClick={step === 0 ? onCancel : () => { setError(null); setStep((current) => current - 1); }}>{step === 0 ? <><X aria-hidden="true" className="h-4 w-4" />Cancel</> : <><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back</>}</JournalButton>{step < 2 ? <JournalButton tone="primary" disabled={Boolean(validation)} onClick={() => { setError(null); setStep((current) => current + 1); }}>Continue<ArrowRight aria-hidden="true" className="h-4 w-4" /></JournalButton> : <JournalButton tone="primary" disabled={Boolean(validation) || saving} onClick={() => void submit()}>{saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus aria-hidden="true" className="h-4 w-4" />}Add trade</JournalButton>}</footer>
  </section>;
}

function Field({ label, value, onChange, type = "text", inputMode, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: "decimal"; placeholder?: string }) { return <label className="text-xs text-slate-500">{label}<input value={value} onChange={(event) => onChange(event.target.value)} type={type} inputMode={inputMode} placeholder={placeholder} className={`${journalFieldClass} mt-1`} /></label>; }
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <label className="text-xs text-slate-500">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className={`${journalFieldClass} mt-1`}>{children}</select></label>; }

function initialDraft(account?: JournalAccount): Draft { const now = localNow(); return { accountId: account ? String(account.id) : "", symbol: "", currency: account?.currency ?? "USD", timezone: account?.timezone ?? "UTC", entryType: "TAKEN", side: "LONG", quantity: "1", entryTime: now, exitTime: "", entryPrice: "", exitPrice: "", commission: "0", fees: "0", stopLoss: "", takeProfit: "", strategy: "", emotion: "", missedReason: "", rating: null, grade: null, tagIds: [], note: "", screenshots: "", reviewed: false }; }
function localNow() { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function numberOrNull(value: string) { const parsed = Number(value); return value.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function lines(value: string) { return value.split(/\n+/).map((line) => line.trim()).filter(Boolean); }
function validateStep(draft: Draft, step: number) {
  if (step >= 0 && (!Number.isInteger(Number(draft.accountId)) || !draft.symbol.trim() || !/^[A-Za-z0-9]{3,12}$/.test(draft.currency) || !draft.timezone.trim())) return "Choose an account and provide a symbol, currency, and source time zone.";
  if (step >= 1 && (!draft.entryTime || !Number.isFinite(Number(draft.entryPrice)) || Number(draft.entryPrice) <= 0)) return "Enter a valid entry time and positive entry price.";
  if (step >= 1 && draft.entryType === "TAKEN" && (!Number.isFinite(Number(draft.quantity)) || Number(draft.quantity) <= 0)) return "Taken trades require a quantity greater than zero.";
  if (step >= 1 && draft.entryType === "TAKEN" && Boolean(draft.exitTime) !== Boolean(draft.exitPrice)) return "Exit time and exit price must be provided together.";
  if (step >= 1 && draft.exitTime && Date.parse(draft.exitTime) < Date.parse(draft.entryTime)) return "Exit time cannot precede entry time.";
  if (step >= 1 && draft.entryType === "MISSED" && !draft.missedReason.trim()) return "Explain why the setup was missed.";
  if (step >= 1 && [draft.commission, draft.fees].some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) return "Costs must be zero or greater.";
  if (step >= 2 && lines(draft.screenshots).length > 12) return "Attach no more than 12 screenshot URLs.";
  return null;
}
