import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Check, ImagePlus, LoaderCircle, Plus, Star, X } from "lucide-react";
import type { CanonicalTrade, CanonicalTradeReviewUpdate, JournalTag, JournalTagCategory } from "../../lib/journalApi";
import { JournalButton, journalFieldClass } from "./JournalControls";
import { Drawer } from "../ui/Primitives";

export type JournalChartFocusRequest = {
  tradeId: number;
  symbol: string;
  sourceTimezone: string;
  startAt: string;
  endAt: string;
  markers: Array<{ kind: "entry" | "exit" | "stop" | "target" | "fill"; price: number; time: string; label: string }>;
};

export function JournalReviewDrawer({
  trade,
  tags,
  returnLabel,
  onClose,
  onSave,
  onCreateTag,
  onShowOnChart,
}: {
  trade: CanonicalTrade | null;
  tags: JournalTag[];
  returnLabel: string;
  onClose: () => void;
  onSave: (tradeId: number, payload: CanonicalTradeReviewUpdate) => Promise<unknown>;
  onCreateTag: (payload: { category: JournalTagCategory; name: string; color?: string | null }) => Promise<unknown>;
  onShowOnChart?: (request: JournalChartFocusRequest) => void;
}) {
  const titleId = useId();
  const descriptionId = `${titleId}-description`;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(() => reviewDraft(trade));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagName, setTagName] = useState("");
  const [tagCategory, setTagCategory] = useState<JournalTagCategory>("SETUP");

  useEffect(() => { setDraft(reviewDraft(trade)); setError(null); }, [trade]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(reviewDraft(trade)), [draft, trade]);
  if (!trade || typeof document === "undefined") return null;
  const activeTrade = trade;

  async function save() {
    const validation = validateReviewDraft(draft);
    if (validation) { setError(validation); return; }
    setSaving(true); setError(null);
    try {
      await onSave(activeTrade.id, {
        reviewed: draft.reviewed,
        rating: draft.rating,
        setup_grade: draft.setupGrade,
        tag_ids: draft.tagIds,
        entry_time: new Date(draft.entryTime).toISOString(),
        exit_time: draft.exitTime ? new Date(draft.exitTime).toISOString() : null,
        entry_price: Number(draft.entryPrice),
        exit_price: draft.exitPrice ? Number(draft.exitPrice) : null,
        stop_loss: draft.stopLoss ? Number(draft.stopLoss) : null,
        take_profit: draft.takeProfit ? Number(draft.takeProfit) : null,
        strategy_name: draft.strategy.trim() || null,
        emotional_state: draft.emotion.trim() || null,
        note: draft.note.trim() || null,
        screenshot_urls: draft.screenshotUrls.split(/\n+/).map((value) => value.trim()).filter(Boolean),
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review could not be saved.");
    } finally { setSaving(false); }
  }

  async function addTag() {
    if (!tagName.trim()) return;
    setSaving(true); setError(null);
    try { await onCreateTag({ category: tagCategory, name: tagName.trim() }); setTagName(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Tag could not be created."); }
    finally { setSaving(false); }
  }

  function showOnChart() {
    const request = chartFocusRequest(activeTrade);
    if (onShowOnChart) onShowOnChart(request);
    else window.dispatchEvent(new CustomEvent<JournalChartFocusRequest>("edgelab:journal-show-on-chart", { detail: request }));
    onClose();
  }

  return <Drawer open ariaLabelledBy={titleId} ariaDescribedBy={descriptionId} dismissBlocked={dirty} initialFocusRef={closeRef} onClose={onClose} className="max-w-2xl">
    <div data-journal-review-drawer className="flex min-h-full flex-col bg-[var(--ui-modal)]">
      <header className="flex min-h-16 min-w-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 sm:flex-nowrap sm:gap-3 sm:px-5"><button ref={closeRef} type="button" onClick={onClose} aria-label={`Close review and return to ${returnLabel}`} className="grid h-[var(--control-height)] w-[var(--control-height)] shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><X aria-hidden="true" className="h-5 w-5" /></button><div className="min-w-0 flex-1"><h2 id={titleId} className="truncate text-base font-semibold text-white">Review {trade.symbol}</h2><p id={descriptionId} className="truncate text-xs text-slate-500">{returnLabel} · {new Date(trade.entry_time).toLocaleString()} · {trade.source_type.replaceAll("_", " ").toLowerCase()}</p></div><div className="w-full min-w-0 sm:w-auto sm:shrink-0"><JournalButton onClick={showOnChart}><ArrowUpRight aria-hidden="true" className="h-4 w-4" />Show on chart</JournalButton></div></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
        {error ? <p role="alert" className="mb-4 rounded-md bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
        <section aria-labelledby={`${titleId}-quality`}><h3 id={`${titleId}-quality`} className="text-sm font-semibold text-white">Review quality</h3><div className="mt-3 grid gap-4 sm:grid-cols-2"><div className="flex min-h-[var(--control-height)] items-center justify-between gap-3 rounded-md border border-white/10 px-3 text-sm text-slate-300"><span>Reviewed <span className="text-slate-500">({draft.reviewed ? "yes" : "no"})</span></span><button type="button" role="switch" aria-label="Trade reviewed" aria-checked={draft.reviewed} onClick={() => setDraft((current) => ({ ...current, reviewed: !current.reviewed }))} className={`relative h-7 w-12 rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${draft.reviewed ? "border-cyan-300/50 bg-cyan-300/20" : "border-white/15 bg-black/30"}`}><span aria-hidden="true" className={`absolute top-1 h-[18px] w-[18px] rounded-full bg-white transition-transform motion-reduce:transition-none ${draft.reviewed ? "translate-x-6" : "translate-x-1"}`} /></button></div><label className="text-xs text-slate-500">Setup grade<select value={draft.setupGrade ?? ""} onChange={(event) => setDraft((current) => ({ ...current, setupGrade: (event.target.value || null) as typeof current.setupGrade }))} className={`${journalFieldClass} mt-1`}><option value="">Ungraded</option><option value="A+">A+</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></label></div><fieldset className="mt-4"><legend className="text-xs text-slate-500">Rating</legend><div className="mt-1 flex flex-wrap gap-1">{[1,2,3,4,5].map((rating) => <button key={rating} type="button" aria-label={`${rating} star rating`} aria-pressed={draft.rating === rating} onClick={() => setDraft((current) => ({ ...current, rating: current.rating === rating ? null : rating }))} className="grid h-[var(--control-height)] w-[var(--control-height)] place-items-center rounded-md hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><Star aria-hidden="true" className={`h-5 w-5 ${draft.rating != null && rating <= draft.rating ? "fill-amber-300 text-amber-300" : "text-slate-600"}`} /></button>)}</div></fieldset></section>
        <Section title="Execution"><div className="grid gap-3 sm:grid-cols-2"><TextField label="Entry time" type="datetime-local" value={draft.entryTime} onChange={(entryTime) => setDraft((current) => ({ ...current, entryTime }))} /><TextField label="Exit time" type="datetime-local" value={draft.exitTime} onChange={(exitTime) => setDraft((current) => ({ ...current, exitTime }))} /><TextField label="Entry price" inputMode="decimal" value={draft.entryPrice} onChange={(entryPrice) => setDraft((current) => ({ ...current, entryPrice }))} /><TextField label="Exit price" inputMode="decimal" value={draft.exitPrice} onChange={(exitPrice) => setDraft((current) => ({ ...current, exitPrice }))} /><TextField label="Stop" inputMode="decimal" value={draft.stopLoss} onChange={(stopLoss) => setDraft((current) => ({ ...current, stopLoss }))} /><TextField label="Target" inputMode="decimal" value={draft.takeProfit} onChange={(takeProfit) => setDraft((current) => ({ ...current, takeProfit }))} /><TextField label="Strategy" value={draft.strategy} onChange={(strategy) => setDraft((current) => ({ ...current, strategy }))} /><TextField label="Emotional state" value={draft.emotion} onChange={(emotion) => setDraft((current) => ({ ...current, emotion }))} /></div></Section>
        <Section title="Tags"><div className="grid gap-2 sm:grid-cols-2">{(["SETUP","POSITIVE","MISTAKE","PROCESS"] as JournalTagCategory[]).map((category) => <fieldset key={category} className="rounded-md border border-white/10 p-2"><legend className="px-1 text-[11px] font-medium text-slate-500">{category[0] + category.slice(1).toLowerCase()}</legend><div className="flex flex-wrap gap-1">{tags.filter((tag) => tag.category === category && !tag.archived_at).map((tag) => { const selected = draft.tagIds.includes(tag.id); return <button key={tag.id} type="button" aria-pressed={selected} onClick={() => setDraft((current) => ({ ...current, tagIds: selected ? current.tagIds.filter((id) => id !== tag.id) : [...current.tagIds, tag.id] }))} className={`inline-flex min-h-[var(--control-height)] items-center gap-1 rounded px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${selected ? "bg-cyan-300/15 text-cyan-100" : "bg-white/[0.03] text-slate-400 hover:bg-white/[0.07]"}`}>{selected ? <Check aria-hidden="true" className="h-3 w-3" /> : null}{tag.name}</button>; })}</div></fieldset>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"><select aria-label="New tag category" value={tagCategory} onChange={(event) => setTagCategory(event.target.value as JournalTagCategory)} className={journalFieldClass}>{(["SETUP","POSITIVE","MISTAKE","PROCESS"] as JournalTagCategory[]).map((category) => <option key={category}>{category}</option>)}</select><input aria-label="New tag name" value={tagName} onChange={(event) => setTagName(event.target.value)} placeholder="Add reusable tag" maxLength={80} className={journalFieldClass} /><JournalButton onClick={() => void addTag()} disabled={!tagName.trim() || saving}><Plus aria-hidden="true" className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Add</span></JournalButton></div></Section>
        <Section title="Notes and media"><label className="text-xs text-slate-500">Review note<textarea value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} rows={6} className={`${journalFieldClass} mt-1 resize-y py-2`} /></label><label className="mt-3 block text-xs text-slate-500"><span className="flex items-center gap-1.5"><ImagePlus aria-hidden="true" className="h-3.5 w-3.5" />Screenshot URLs · one per line</span><textarea value={draft.screenshotUrls} onChange={(event) => setDraft((current) => ({ ...current, screenshotUrls: event.target.value }))} rows={3} placeholder="https://…" className={`${journalFieldClass} mt-1 resize-y py-2`} /></label></Section>
        <Section title="Execution trail"><div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-xs"><caption className="sr-only">Raw fills and executions retained for this trade</caption><thead className="sticky top-0 bg-[#0a0d11] text-slate-500"><tr><th scope="col" className="py-2 pr-3 font-medium">Type</th><th scope="col" className="py-2 pr-3 font-medium">Time</th><th scope="col" className="py-2 pr-3 font-medium">Side</th><th scope="col" className="py-2 pr-3 text-right font-medium">Price</th><th scope="col" className="py-2 text-right font-medium">Quantity</th></tr></thead><tbody className="divide-y divide-white/8">{trade.executions.map((execution) => <tr key={execution.id}><td className="py-2 pr-3">{execution.execution_type}</td><td className="py-2 pr-3 text-slate-400">{new Date(execution.occurred_at).toLocaleString()}</td><td className="py-2 pr-3">{execution.side}</td><td className="py-2 pr-3 text-right tabular-nums">{Number(execution.price).toLocaleString()}</td><td className="py-2 text-right tabular-nums">{Number(execution.quantity).toLocaleString()}</td></tr>)}</tbody></table>{!trade.executions.length ? <p className="py-4 text-sm text-slate-500">No execution rows were retained for this record.</p> : null}</div></Section>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-[#0d1117] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5"><p className="text-xs text-slate-500" aria-live="polite">{saving ? "Saving review changes" : dirty ? "Unsaved review changes" : "No review changes"}</p><div className="flex gap-2"><JournalButton onClick={onClose}>Cancel</JournalButton><JournalButton tone="primary" onClick={() => void save()} disabled={!dirty || saving}>{saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" className="h-4 w-4" />}Save review</JournalButton></div></footer>
    </div>
  </Drawer>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mt-7 border-t border-white/10 pt-5 first:mt-0 first:border-t-0 first:pt-0"><h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>{children}</section>; }

function TextField({ label, value, onChange, type = "text", inputMode }: { label: string; value: string; onChange: (value: string) => void; type?: string; inputMode?: "decimal" }) { return <label className="text-xs text-slate-500">{label}<input type={type} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)} className={`${journalFieldClass} mt-1`} /></label>; }

function reviewDraft(trade: CanonicalTrade | null) {
  return {
    reviewed: trade?.reviewed ?? false,
    rating: trade?.rating ?? null,
    setupGrade: trade?.setup_grade ?? null,
    tagIds: trade?.tags.map((tag) => tag.id) ?? [],
    entryTime: localDateTime(trade?.entry_time),
    exitTime: localDateTime(trade?.exit_time),
    entryPrice: trade ? String(trade.entry_price) : "",
    exitPrice: trade?.exit_price == null ? "" : String(trade.exit_price),
    stopLoss: trade?.stop_loss == null ? "" : String(trade.stop_loss),
    takeProfit: trade?.take_profit == null ? "" : String(trade.take_profit),
    strategy: trade?.strategy_name ?? "",
    emotion: trade?.emotional_state ?? "",
    note: trade?.notes.at(-1)?.body ?? "",
    screenshotUrls: trade?.screenshots.map((screenshot) => screenshot.url).join("\n") ?? "",
  };
}

function localDateTime(value: string | null | undefined) { if (!value) return ""; const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function validateReviewDraft(draft: ReturnType<typeof reviewDraft>) {
  if (!draft.entryTime || !Number.isFinite(Number(draft.entryPrice)) || Number(draft.entryPrice) <= 0) return "Enter a valid entry time and positive entry price.";
  if (draft.exitTime && (!draft.exitPrice || Number(draft.exitPrice) <= 0)) return "An exit time requires a positive exit price.";
  if (draft.exitTime && Date.parse(draft.exitTime) < Date.parse(draft.entryTime)) return "Exit time cannot precede entry time.";
  const urls = draft.screenshotUrls.split(/\n+/).map((value) => value.trim()).filter(Boolean);
  if (urls.length > 12) return "Attach no more than 12 screenshot URLs.";
  if (urls.some((value) => { try { const url = new URL(value); return url.protocol !== "https:" && url.protocol !== "http:"; } catch { return true; } })) return "Every screenshot must be a valid http or https URL.";
  return null;
}

export function chartFocusRequest(trade: CanonicalTrade): JournalChartFocusRequest {
  const start = new Date(Date.parse(trade.entry_time) - 30 * 60_000).toISOString();
  const endBase = trade.exit_time ? Date.parse(trade.exit_time) : Date.parse(trade.entry_time) + 60 * 60_000;
  const end = new Date(endBase + 30 * 60_000).toISOString();
  const markers: JournalChartFocusRequest["markers"] = [{ kind: "entry", price: Number(trade.entry_price), time: trade.entry_time, label: `${trade.side} entry` }];
  if (trade.exit_time && trade.exit_price != null) markers.push({ kind: "exit", price: Number(trade.exit_price), time: trade.exit_time, label: "Exit" });
  if (trade.stop_loss != null) markers.push({ kind: "stop", price: Number(trade.stop_loss), time: trade.entry_time, label: "Stop" });
  if (trade.take_profit != null) markers.push({ kind: "target", price: Number(trade.take_profit), time: trade.entry_time, label: "Target" });
  trade.executions.forEach((execution) => markers.push({ kind: "fill", price: Number(execution.price), time: execution.occurred_at, label: `${execution.execution_type} fill` }));
  return { tradeId: trade.id, symbol: trade.symbol, sourceTimezone: trade.source_timezone, startAt: start, endAt: end, markers };
}
