import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileUp, LoaderCircle, RotateCcw } from "lucide-react";
import type { JournalAccount, JournalImportCreate, JournalImportRun } from "../../lib/journalApi";
import { JournalButton, journalFieldClass } from "./JournalControls";

const IMPORT_FIELDS = ["entry_time", "exit_time", "side", "entry_price", "exit_price", "quantity", "realized_pnl", "commission_amount", "fee_amount", "symbol", "strategy_name", "stop_loss", "take_profit", "r_multiple", "notes", "tags"] as const;
const MAX_CSV_BYTES = 20_000_000;

export function JournalImportFlow({ accounts, imports, onImport, onRollback }: { accounts: JournalAccount[]; imports: JournalImportRun[]; onImport: (payload: JournalImportCreate) => Promise<{ run: JournalImportRun }>; onRollback: (runId: number) => Promise<unknown> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [preset, setPreset] = useState("generic");
  const [accountMode, setAccountMode] = useState<"existing" | "new">(accounts.length ? "existing" : "new");
  const [accountId, setAccountId] = useState(accounts[0] ? String(accounts[0].id) : "");
  const [accountName, setAccountName] = useState("");
  const [currency, setCurrency] = useState(accounts[0]?.currency ?? "USD");
  const [timezone, setTimezone] = useState(accounts[0]?.timezone ?? "UTC");
  const [defaultSymbol, setDefaultSymbol] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [groupMode, setGroupMode] = useState<"ROW" | "COLUMN">("ROW");
  const [groupColumn, setGroupColumn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<JournalImportRun | null>(null);
  const [rollbackId, setRollbackId] = useState<number | null>(null);
  const localDuplicates = useMemo(() => rows.length - new Set(rows.map((row) => row.join("\u001f"))).size, [rows]);

  async function selectFile(file: File | null) {
    setError(null); setCompleted(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) { setError("The CSV exceeds the 20 MB Journal import limit."); return; }
    const text = await file.text();
    const parsed = previewCsv(text);
    if (parsed.headers.length < 2 || !parsed.rows.length) { setError("The CSV needs a header row and at least one data row."); return; }
    setCsvText(text); setFileName(file.name); setHeaders(parsed.headers); setRows(parsed.rows);
    setMapping(autoMapping(parsed.headers)); setStep(1); setOpen(true);
  }

  async function runImport() {
    const validation = importValidation();
    if (validation) { setError(validation); return; }
    setBusy(true); setError(null);
    try {
      const result = await onImport({
        csv_text: csvText,
        ...(accountMode === "existing" ? { destination_account_id: Number(accountId) } : { destination_account: { name: accountName.trim(), provider: preset === "tradovate" ? "Tradovate CSV" : preset === "ninjatrader" ? "NinjaTrader CSV" : "CSV import", currency, timezone, initial_balance: 0 } }),
        source_name: fileName || "CSV import", source_timezone: timezone, currency,
        default_symbol: defaultSymbol.trim() || null, column_mapping: mapping,
        grouping: { mode: groupMode, column: groupMode === "COLUMN" ? groupColumn : null },
      });
      setCompleted(result.run); setStep(3);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Import failed. Correct the mapping and retry."); }
    finally { setBusy(false); }
  }

  function reset() { setOpen(false); setStep(0); setCsvText(""); setFileName(""); setHeaders([]); setRows([]); setMapping({}); setCompleted(null); setError(null); }

  function importValidation() {
    if (!csvText) return "Choose a CSV export.";
    if (accountMode === "existing" && !Number(accountId)) return "Choose a destination account.";
    if (accountMode === "new" && !accountName.trim()) return "Name the new destination account.";
    if (!timezone.trim() || !/^[A-Za-z0-9]{3,12}$/.test(currency)) return "Provide a source time zone and valid currency.";
    if (groupMode === "COLUMN" && !groupColumn) return "Choose a grouping column.";
    const mapped = new Set(Object.values(mapping));
    if (!["entry_time", "side", "entry_price", "quantity"].every((field) => mapped.has(field))) return "Map entry time, side, entry price, and quantity before importing.";
    return null;
  }

  function destinationValidation() {
    if (!csvText) return "Choose a CSV export.";
    if (accountMode === "existing" && !Number(accountId)) return "Choose a destination account.";
    if (accountMode === "new" && !accountName.trim()) return "Name the new destination account.";
    if (!timezone.trim() || !/^[A-Za-z0-9]{3,12}$/.test(currency)) return "Provide a source time zone and valid currency.";
    return null;
  }

  return <section className="border-t border-white/10 py-6" aria-labelledby="journal-import-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="journal-import-title" className="text-base font-semibold text-white">CSV imports</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">Staged account ingestion with mapping, grouping, duplicate review, durable diagnostics, and single-import rollback.</p></div>{!open ? <JournalButton onClick={() => { setOpen(true); setStep(0); }}><FileUp aria-hidden="true" className="h-4 w-4" />Import CSV</JournalButton> : null}</div>
    {open ? <div className="mt-4 border-y border-white/10 bg-white/[0.015]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><p className="text-sm font-medium text-slate-200">Step {step + 1} of 4 · {step === 0 ? "Choose export" : step === 1 ? "Destination" : step === 2 ? "Map and review" : "Result"}</p><button type="button" onClick={reset} className="min-h-9 rounded px-2 text-xs text-slate-400 hover:bg-white/5">Close</button></div>
      <div className="p-4">
        {error ? <p role="alert" className="mb-4 rounded-md bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}
        {step === 0 ? <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]"><label className="text-xs text-slate-500">Broker export guide<select value={preset} onChange={(event) => setPreset(event.target.value)} className={`${journalFieldClass} mt-1`}><option value="generic">Generic CSV</option><option value="tradovate">Tradovate</option><option value="ninjatrader">NinjaTrader</option></select></label><div className="rounded-md border border-white/10 p-3 text-sm leading-6 text-slate-400">{preset === "tradovate" ? <><strong className="text-slate-200">Export Orders, not Performance.</strong> Include order timestamps, action/side, filled quantity, fill price, contract, commission, and fees. EdgeLab groups rows into trades during import.</> : preset === "ninjatrader" ? <><strong className="text-slate-200">Export executions or orders.</strong> Include instrument, market position, entry/exit time and price, quantity, commission, and net P&amp;L.</> : <>Use one row per completed trade or map a grouping column for multi-fill exports. Required data: entry time, side, entry price, and quantity.</>}</div><div className="lg:col-span-2"><input ref={inputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void selectFile(event.target.files?.[0] ?? null)} /><JournalButton tone="primary" onClick={() => inputRef.current?.click()}><FileUp aria-hidden="true" className="h-4 w-4" />Choose CSV export</JournalButton></div></div> : null}
        {step === 1 ? <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs text-slate-500">Destination<select value={accountMode} onChange={(event) => setAccountMode(event.target.value as typeof accountMode)} className={`${journalFieldClass} mt-1`}><option value="existing" disabled={!accounts.length}>Existing account</option><option value="new">Create account</option></select></label>{accountMode === "existing" ? <label className="text-xs text-slate-500">Account<select value={accountId} onChange={(event) => { const value = event.target.value; setAccountId(value); const account = accounts.find((item) => item.id === Number(value)); if (account) { setCurrency(account.currency); setTimezone(account.timezone); } }} className={`${journalFieldClass} mt-1`}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label> : <label className="text-xs text-slate-500">New account name<input value={accountName} onChange={(event) => setAccountName(event.target.value)} className={`${journalFieldClass} mt-1`} /></label>}<label className="text-xs text-slate-500">Source time zone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" className={`${journalFieldClass} mt-1`} /></label><label className="text-xs text-slate-500">Currency<input value={currency} maxLength={12} onChange={(event) => setCurrency(event.target.value.toUpperCase())} className={`${journalFieldClass} mt-1`} /></label><label className="text-xs text-slate-500 sm:col-span-2">Default symbol · only used when the file has no symbol column<input value={defaultSymbol} onChange={(event) => setDefaultSymbol(event.target.value.toUpperCase())} placeholder="Optional" className={`${journalFieldClass} mt-1`} /></label></div> : null}
        {step === 2 ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-500">Trade grouping<select value={groupMode} onChange={(event) => setGroupMode(event.target.value as typeof groupMode)} className={`${journalFieldClass} mt-1`}><option value="ROW">One trade per row</option><option value="COLUMN">Group fills by a column</option></select></label>{groupMode === "COLUMN" ? <label className="text-xs text-slate-500">Grouping column<select value={groupColumn} onChange={(event) => setGroupColumn(event.target.value)} className={`${journalFieldClass} mt-1`}><option value="">Choose column</option>{headers.map((header) => <option key={header}>{header}</option>)}</select></label> : null}</div><div><p className="text-xs font-medium text-slate-400">Column mapping</p><div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{headers.map((header) => <label key={header} className="text-xs text-slate-500"><span className="block truncate" title={header}>{header}</span><select value={mapping[header] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value }))} className={`${journalFieldClass} mt-1`}><option value="">Ignore</option>{IMPORT_FIELDS.map((field) => <option key={field} value={field}>{field.replaceAll("_", " ")}</option>)}</select></label>)}</div></div><div className="rounded-md border border-white/10 p-3"><p className="text-sm font-medium text-slate-200">Local preview</p><dl className="mt-2 grid gap-2 text-xs sm:grid-cols-3"><div><dt className="text-slate-600">Rows</dt><dd className="mt-0.5 tabular-nums text-slate-200">{rows.length}</dd></div><div><dt className="text-slate-600">Repeated source rows</dt><dd className="mt-0.5 tabular-nums text-slate-200">{localDuplicates}</dd></div><div><dt className="text-slate-600">Grouping</dt><dd className="mt-0.5 text-slate-200">{groupMode === "ROW" ? `${rows.length} candidate trades` : `${new Set(rows.map((row) => row[headers.indexOf(groupColumn)] ?? "")).size} candidate groups`}</dd></div></dl><p className="mt-3 text-xs leading-5 text-slate-500">The server performs authoritative normalization and duplicate checks against prior imports. This preview does not mutate Journal data.</p></div></div> : null}
        {step === 3 && completed ? <div><p className="flex items-center gap-2 text-sm font-semibold text-emerald-200"><Check aria-hidden="true" className="h-4 w-4" />Import complete</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4"><Result label="Imported" value={completed.imported_rows} /><Result label="Skipped" value={completed.skipped_rows} /><Result label="Duplicates" value={completed.duplicate_rows} /><Result label="Errors" value={completed.error_rows} /></dl>{completed.diagnostics.length ? <details className="mt-4"><summary className="cursor-pointer text-sm text-slate-300">View {completed.diagnostics.length} diagnostics</summary><ul className="mt-2 max-h-48 overflow-auto border-y border-white/10 text-xs text-slate-400">{completed.diagnostics.map((diagnostic) => <li key={diagnostic.id} className="border-b border-white/5 px-2 py-2 last:border-b-0">{diagnostic.row_number ? `Row ${diagnostic.row_number}: ` : ""}{diagnostic.message}</li>)}</ul></details> : null}<div className="mt-5 flex gap-2"><JournalButton tone="primary" onClick={reset}>Done</JournalButton>{completed.status === "COMPLETED" ? <JournalButton tone="danger" onClick={() => setRollbackId(completed.id)}>Roll back this import</JournalButton> : null}</div></div> : null}
      </div>
      {step < 3 && step > 0 ? <footer className="flex justify-between border-t border-white/10 px-4 py-3"><JournalButton onClick={() => { setError(null); setStep((current) => current - 1); }}><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back</JournalButton>{step === 1 ? <JournalButton tone="primary" onClick={() => { const message = destinationValidation(); if (message) setError(message); else { setError(null); setStep(2); } }}>Review mapping<ArrowRight aria-hidden="true" className="h-4 w-4" /></JournalButton> : <JournalButton tone="primary" disabled={busy || Boolean(importValidation())} onClick={() => void runImport()}>{busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileUp aria-hidden="true" className="h-4 w-4" />}Import</JournalButton>}</footer> : null}
    </div> : null}
    <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[48rem] text-left text-xs"><thead className="sticky top-0 bg-[#090b0e] text-slate-500"><tr><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium">Created</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 pr-3 text-right font-medium">Imported</th><th className="py-2 pr-3 text-right font-medium">Skipped</th><th className="py-2 pr-3 text-right font-medium">Duplicates</th><th className="py-2 text-right font-medium">Action</th></tr></thead><tbody className="divide-y divide-white/8">{imports.map((run) => <tr key={run.id}><td className="py-3 pr-3 text-slate-200">{run.source_name}</td><td className="py-3 pr-3 text-slate-500">{new Date(run.created_at).toLocaleString()}</td><td className="py-3 pr-3">{run.status}</td><td className="py-3 pr-3 text-right tabular-nums">{run.imported_rows}</td><td className="py-3 pr-3 text-right tabular-nums">{run.skipped_rows}</td><td className="py-3 pr-3 text-right tabular-nums">{run.duplicate_rows}</td><td className="py-3 text-right">{run.status === "COMPLETED" ? <button type="button" onClick={() => setRollbackId(run.id)} className="min-h-8 text-rose-300 hover:underline">Roll back</button> : <span className="text-slate-600">—</span>}</td></tr>)}</tbody></table>{!imports.length ? <p className="border-y border-white/8 py-6 text-center text-sm text-slate-500">No import history yet. Completed imports and row diagnostics remain available here.</p> : null}</div>
    {rollbackId ? <div className="mt-3 flex flex-col gap-3 border-y border-rose-400/25 bg-rose-400/[0.05] px-3 py-3 sm:flex-row sm:items-center"><AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-rose-200" /><p className="min-w-0 flex-1 text-sm text-rose-100">Rollback removes trades created only by this import and retains its audit history.</p><JournalButton onClick={() => setRollbackId(null)}>Cancel</JournalButton><JournalButton tone="danger" onClick={() => { const id = rollbackId; setBusy(true); void onRollback(id).then(() => setRollbackId(null)).catch((caught) => setError(caught instanceof Error ? caught.message : "Rollback failed.")).finally(() => setBusy(false)); }} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw aria-hidden="true" className="h-4 w-4" />}Confirm rollback</JournalButton></div> : null}
  </section>;
}

function Result({ label, value }: { label: string; value: number }) { return <div><dt className="text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</dd></div>; }

export function previewCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).slice(0, 101);
  const parsed = lines.map(parseCsvLine);
  return { headers: parsed[0]?.map((header) => header.trim()).filter(Boolean) ?? [], rows: parsed.slice(1) };
}

export function autoMapping(headers: string[]) {
  const aliases: Record<string, string[]> = {
    entry_time: ["entrytime","entrydate","opentime","openedat"], exit_time: ["exittime","exitdate","closetime","closedat"],
    side: ["side","direction","type","action","buysell"], entry_price: ["entryprice","openprice","entryfill","avgentry"], exit_price: ["exitprice","closeprice","exitfill","avgexit"],
    quantity: ["quantity","qty","contracts","shares","lots","volume","size","filledqty"], realized_pnl: ["pnl","pl","profit","netpnl","netprofit","grosspnl","result"],
    commission_amount: ["commission","commissions"], fee_amount: ["fee","fees","cost","costs"], symbol: ["symbol","ticker","instrument","market","contract","asset"],
    strategy_name: ["strategy","strategyname","setup","playbook"], stop_loss: ["stoploss","stop","sl"], take_profit: ["takeprofit","target","tp"], r_multiple: ["r","rmultiple","rr"], notes: ["notes","note","comment","review"], tags: ["tags","tag","mistakes","labels"],
  };
  return Object.fromEntries(headers.map((header) => { const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, ""); const field = Object.entries(aliases).find(([, values]) => values.includes(normalized))?.[0] ?? ""; return [header, field]; }));
}

function parseCsvLine(line: string) { const fields: string[] = []; let value = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const character = line[index]; if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; } else if (character === '"') quoted = !quoted; else if (character === "," && !quoted) { fields.push(value); value = ""; } else value += character; } fields.push(value); return fields; }
