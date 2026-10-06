import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatDateTime, formatMoney } from "../../lib/format";
import {
  createJournalAccount, getCanonicalTrade, listCanonicalTrades, listJournalAccounts,
  updateCanonicalTradeReview, type CanonicalTrade, type JournalAccount,
  latestJournalRecord, subscribeJournalUpdates,
} from "../../lib/journalApi";
import { journalDeepLink, parseJournalDeepLink } from "../../lib/journalWorkspaceState";
import { emptyJournalAccountDraft, journalReviewDraft, useJournalDraft } from "../../lib/journalDrafts";
import { useJournalMutationPending } from "../../lib/journalMutationState";

const fieldClass = "mt-1 min-h-11 w-full min-w-0 border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50";
const buttonClass = "min-h-11 border border-stone-500 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400 disabled:opacity-50";
const PAGE_SIZE = 50;

export function CompatibilityJournalAccounts() {
  const [accounts, setAccounts] = useState<JournalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localSaving, setSaving] = useState(false);
  const saving = useJournalMutationPending("journal:account-create") || localSaving;
  const [notice, setNotice] = useState("");
  const [draft, setDraft, clearDraft] = useJournalDraft("journal:account-create", emptyJournalAccountDraft());
  const confirmedAccounts = useRef(new Map<number, JournalAccount>());
  useEffect(() => subscribeJournalUpdates((update) => {
    if (update.kind !== "account") return;
    confirmedAccounts.current.set(update.account.id, update.account);
    setAccounts((current) => [...current.filter((account) => account.id !== update.account.id), update.account]);
  }), []);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(null);
    void listJournalAccounts(true).then((value) => { if (active) setAccounts([
      ...value.map((account) => latestJournalRecord(account, confirmedAccounts.current.get(account.id))),
      ...[...confirmedAccounts.current.values()].filter((account) => !value.some((item) => item.id === account.id)),
    ]); })
      .catch((error) => { if (active) setLoadError(message(error, "Accounts could not be loaded. Refresh to retry.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  async function create() {
    if (saving || loading) return;
    const balance = Number(draft.initialBalance);
    if (!draft.name.trim() || !draft.currency.trim() || !draft.timezone.trim() || !Number.isFinite(balance) || balance < 0) {
      setSaveError("Enter an account name, currency, time zone, and a non-negative initial balance."); return;
    }
    try { new Intl.DateTimeFormat("en", { timeZone: draft.timezone.trim() }); }
    catch { setSaveError("Enter a valid time zone, such as UTC or America/New_York."); return; }
    setSaving(true); setSaveError(null); setNotice("");
    try {
      const account = await createJournalAccount({
        name: draft.name.trim(), provider: draft.provider.trim() || "Manual",
        currency: draft.currency.trim().toUpperCase(), timezone: draft.timezone.trim(),
        initial_balance: balance, notes: draft.notes.trim() || null,
        ...(draft.color !== emptyJournalAccountDraft().color ? { color: draft.color } : {}),
      });
      setAccounts((current) => [...current.filter((item) => item.id !== account.id), account]);
      clearDraft(undefined, draft); setNotice(`Account ${account.name} created`);
    } catch (error) { setSaveError(message(error, "Account could not be created. Your changes are kept; try again.")); }
    finally { setSaving(false); }
  }

  return <section>
    <h1 className="text-2xl font-semibold">Accounts</h1>
    <p className="mt-2 text-sm text-stone-300">Journal accounts retain their own currency, time zone, and opening balance.</p>
    <button className={`${buttonClass} mt-4`} disabled={loading || saving} onClick={() => setRevision((value) => value + 1)} type="button">Refresh accounts</button>
    {loadError ? <p className="mt-3 text-rose-200" role="alert">{loadError}</p> : null}
    <p className="mt-3 text-sm text-stone-300" role="status">{loading ? "Loading accounts…" : `${accounts.length} accounts available`}</p>
    <ul className="mt-4 divide-y divide-stone-700 border-y border-stone-700" aria-label="Journal accounts">
      {accounts.map((account) => <li className="break-words py-3" key={account.id}>
        <h2 className="font-semibold">{account.name}</h2>
        <p className="mt-1 text-sm text-stone-300">{account.provider} · {account.currency} · {account.timezone} · {account.status.toLowerCase()}</p>
        <p className="mt-1 text-sm">Initial balance {formatMoney(Number(account.initial_balance), account.currency)}</p>
        {account.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-stone-300">{account.notes}</p> : null}
      </li>)}
    </ul>
    {!loading && !loadError && !accounts.length ? <p className="mt-3">No accounts yet. Create a manual account below.</p> : null}
    <form className="mt-6 border-t border-stone-700 pt-5" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <h2 className="text-lg font-semibold">Manual account</h2>
      <fieldset className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2" disabled={saving}>
        <Field label="Account name"><input className={fieldClass} maxLength={160} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="Broker label"><input className={fieldClass} maxLength={80} value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} /></Field>
        <Field label="Currency"><input className={fieldClass} minLength={3} maxLength={12} pattern="[A-Za-z0-9]{3,12}" required value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })} /></Field>
        <Field label="Time zone"><input className={fieldClass} maxLength={80} required value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} /></Field>
        <Field label="Initial balance"><input className={fieldClass} min={0} step="any" type="number" required value={draft.initialBalance} onChange={(event) => setDraft({ ...draft, initialBalance: event.target.value })} /></Field>
        <Field label="Account notes"><textarea className={`${fieldClass} py-2`} rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field>
      </fieldset>
      {saveError ? <p className="mt-3 text-rose-200" role="alert">{saveError}</p> : null}
      <button className={`${buttonClass} mt-4`} disabled={saving || loading} type="submit">{saving ? "Creating…" : "Create account"}</button>
      <p className="mt-3 text-sm text-stone-300" role="status">{notice}</p>
    </form>
  </section>;
}

export function CompatibilityJournalTrades() {
  const location = useLocation();
  const navigate = useNavigate();
  const link = parseJournalDeepLink(location.hash);
  const accountId = link?.accountId ?? undefined;
  const tradeId = link?.tradeId ?? null;
  const [accounts, setAccounts] = useState<JournalAccount[]>([]);
  const [trades, setTrades] = useState<CanonicalTrade[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CanonicalTrade | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const confirmedTrades = useRef(new Map<number, CanonicalTrade>());
  useEffect(() => subscribeJournalUpdates((update) => {
    if (update.kind !== "review") return;
    confirmedTrades.current.set(update.trade.id, update.trade);
    setSelected((current) => current?.id === update.trade.id ? update.trade : current);
    setTrades((current) => current.map((trade) => trade.id === update.trade.id ? update.trade : trade));
  }), []);
  useEffect(() => { setOffset(0); }, [accountId]);
  useEffect(() => {
    let active = true;
    void listJournalAccounts(true).then((value) => { if (active) setAccounts(value); })
      .catch((error) => { if (active) setLoadError(message(error, "Accounts could not be loaded.")); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(null); setTrades([]);
    void listCanonicalTrades({ accountId, offset, limit: PAGE_SIZE }).then((value) => { if (active) setTrades(value.map((trade) => latestJournalRecord(trade, confirmedTrades.current.get(trade.id)))); })
      .catch((error) => { if (active) setLoadError(message(error, "Trades could not be loaded. Refresh to retry.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, offset, revision]);
  useEffect(() => {
    let active = true;
    setSelected(null); setSelectionError(null); setSelectionLoading(tradeId != null);
    if (tradeId != null) void getCanonicalTrade(tradeId).then((trade) => { if (active) setSelected(latestJournalRecord(trade, confirmedTrades.current.get(trade.id))); })
      .catch((error) => { if (active) setSelectionError(message(error, "This trade could not be opened. Refresh to retry.")); })
      .finally(() => { if (active) setSelectionLoading(false); });
    return () => { active = false; };
  }, [tradeId, revision]);

  function setLink(nextTrade: number | null, nextAccount: number | null = accountId ?? null) {
    const hash = journalDeepLink({ surface: "trades", tradeId: nextTrade, accountId: nextAccount ?? null, date: null, segment: null, returnTo: "trades" });
    navigate({ pathname: location.pathname, search: location.search, hash }, { replace: true });
  }

  return <section>
    <h1 className="text-2xl font-semibold">Trade log</h1>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <Field label="Account filter"><select className={fieldClass} value={accountId ?? ""} disabled={loading || selected != null} onChange={(event) => { setOffset(0); setLink(null, event.target.value ? Number(event.target.value) : null); }}>
        <option value="">All accounts</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
      </select></Field>
      <button className={buttonClass} disabled={loading || selected != null} onClick={() => setRevision((value) => value + 1)} type="button">Refresh journal</button>
    </div>
    {loadError ? <p className="mt-3 text-rose-200" role="alert">{loadError}</p> : null}
    <p className="mt-3 text-sm text-stone-300" role="status">{loading ? "Loading journal…" : `${trades.length} recent trades available`}</p>
    {selectionLoading ? <p className="mt-4" role="status">Loading selected trade…</p> : null}
    {selectionError ? <div className="mt-4"><p className="text-rose-200" role="alert">{selectionError}</p><button className={`${buttonClass} mt-2`} onClick={() => setRevision((value) => value + 1)} type="button">Retry trade</button></div> : null}
    {selected ? <TradeReview key={selected.id} trade={selected} onClose={() => setLink(null)} onSaved={(trade) => { setSelected(trade); setTrades((current) => current.map((item) => item.id === trade.id ? trade : item)); }} /> : null}
    <div className="mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-amber-400" role="region" aria-label="Canonical trade log" tabIndex={0}>
      <table className="w-full min-w-[42rem] text-left text-sm"><caption className="sr-only">Canonical trades, page {offset / PAGE_SIZE + 1}</caption>
        <thead><tr>{["Trade", "Account", "Entry", "Status", "Net P&L", "Review"].map((heading) => <th className="border-b border-stone-600 py-2 pr-3" key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{trades.map((trade) => <tr className="border-b border-stone-700" key={trade.id}>
          <td className="py-3 pr-3">{trade.symbol} · {trade.side.toLowerCase()}</td>
          <td className="pr-3">{accounts.find((account) => account.id === trade.account_id)?.name ?? `Account ${trade.account_id}`}</td>
          <td className="pr-3">{formatDateTime(trade.entry_time)}</td><td className="pr-3">{trade.status.toLowerCase()}</td>
          <td className="pr-3 tabular-nums">{formatMoney(Number(trade.net_pnl), trade.currency)}</td>
          <td><button className={`${buttonClass} my-1`} disabled={selected != null || selectionLoading} onClick={() => setLink(trade.id)} aria-label={`Review ${trade.symbol} trade ${trade.id}`} type="button">{trade.reviewed ? "Reviewed" : "Review"}</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    {!loading && !loadError && !trades.length ? <p className="mt-3">No trades on this page.</p> : null}
    <nav className="mt-4 flex flex-wrap items-center gap-3" aria-label="Trade pages">
      <button className={buttonClass} disabled={loading || offset === 0 || selected != null} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} type="button">Previous page</button>
      <span>Page {offset / PAGE_SIZE + 1}</span>
      <button className={buttonClass} disabled={loading || trades.length < PAGE_SIZE || selected != null} onClick={() => setOffset(offset + PAGE_SIZE)} type="button">Next page</button>
    </nav>
  </section>;
}

function TradeReview({ trade, onClose, onSaved }: { trade: CanonicalTrade; onClose: () => void; onSaved: (trade: CanonicalTrade) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft, clearDraft] = useJournalDraft(`journal:review:${trade.id}`, journalReviewDraft(trade));
  const [localSaving, setSaving] = useState(false);
  const saving = useJournalMutationPending(`journal:review:${trade.id}`) || localSaving;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { headingRef.current?.focus(); }, []);
  async function save() {
    if (saving) return;
    setSaving(true); setError(null); setNotice("");
    try {
      const saved = await updateCanonicalTradeReview(trade.id, { reviewed: draft.reviewed, rating: draft.rating, setup_grade: draft.setupGrade, note: draft.note.trim() || null });
      onSaved(saved); clearDraft(["reviewed", "rating", "setupGrade", "note"], draft); setNotice("Review saved");
    } catch (caught) { setError(message(caught, "Review could not be saved. Your changes are kept; try again.")); }
    finally { setSaving(false); }
  }
  return <form className="mt-6 border-t border-stone-600 pt-5" aria-label={`Review ${trade.symbol}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <h2 className="text-lg font-semibold" ref={headingRef} tabIndex={-1}>Review {trade.symbol}</h2>
    <p className="mt-1 text-sm text-stone-300">{formatDateTime(trade.entry_time)} · {trade.source_type.toLowerCase()}</p>
    <fieldset className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2" disabled={saving}>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input className="h-11 w-11 shrink-0 accent-amber-300" checked={draft.reviewed} onChange={(event) => setDraft({ ...draft, reviewed: event.target.checked })} type="checkbox" />Reviewed</label>
      <Field label="Rating"><select className={fieldClass} value={draft.rating ?? ""} onChange={(event) => setDraft({ ...draft, rating: event.target.value ? Number(event.target.value) : null })}><option value="">Unrated</option>{[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></Field>
      <Field label="Setup grade"><select className={fieldClass} value={draft.setupGrade ?? ""} onChange={(event) => setDraft({ ...draft, setupGrade: (event.target.value || null) as typeof draft.setupGrade })}><option value="">Ungraded</option>{["A+", "A", "B", "C", "D", "F"].map((grade) => <option key={grade}>{grade}</option>)}</select></Field>
      <Field label="Review note"><textarea className={`${fieldClass} py-2`} rows={4} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></Field>
    </fieldset>
    {trade.notes.length ? <ul className="mt-4 space-y-2" aria-label="Saved trade notes">{trade.notes.map((note) => <li className="break-words whitespace-pre-wrap text-sm text-stone-300" key={note.id}>{note.body}</li>)}</ul> : null}
    {error ? <p className="mt-3 text-rose-200" role="alert">{error}</p> : null}
    <div className="mt-4 flex gap-3"><button className={buttonClass} disabled={saving} type="submit">{saving ? "Saving…" : "Save review"}</button><button className={buttonClass} disabled={saving} onClick={onClose} type="button">Close review</button></div>
    <p className="mt-3 text-sm text-stone-300" role="status">{notice}</p>
  </form>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 text-sm text-stone-300">{label}{children}</label>; }
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
