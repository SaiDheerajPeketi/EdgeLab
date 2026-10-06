import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileJson, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import {
  exportAppDataBundle,
  importAppDataBundle,
  recoverAccountDataOperations,
  validateAppDataBundle,
  type AppDataBundle,
  type AppDataImportResult,
} from "../../lib/api";
import { appDataRecoveryNeeded, assertAppDataAccess, captureAppDataAccess, registerAppDataParticipant } from "../../lib/appDataBarrier";
import { getStoredAuthSession } from "../../lib/authSession";
import { SettingRow, SettingsSection, fieldClassName } from "./SettingsPrimitives";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

type ImportDraft = {
  bundle: AppDataBundle;
  fileName: string;
  rows: number;
  tables: Array<{ name: string; rows: number }>;
};

export function SettingsDataTransfer() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exportState, setExportState] = useState<"idle" | "working" | "error">("idle");
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [importState, setImportState] = useState<"idle" | "working" | "error" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppDataImportResult | null>(null);
  const [reading, setReading] = useState(false);
  const [pendingSaves, setPendingSaves] = useState(interruptedSaves);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [recovery, setRecovery] = useState<{ state: "idle" | "checking" | "done" | "error"; message: string }>({ state: "idle", message: "" });
  const mounted = useRef(true);
  const serial = useRef(0);
  const active = useRef<number | null>(null);
  const activeKind = useRef<"file" | "export" | "import" | "recover" | null>(null);
  const identity = useRef(sessionIdentity());
  const mustReload = useRef(false);
  const picker = useRef<{ serial: number; identity: string | null } | null>(null);
  const busy = reading || exportState === "working" || importState === "working" || recovery.state === "checking";

  function requireReload() { mustReload.current = true; setReloadRequired(true); }
  function clearDraft() {
    setDraft(null); setConfirmation(""); picker.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function syncIdentity() {
    const current = sessionIdentity();
    if (current === identity.current) return false;
    identity.current = current; serial.current += 1; active.current = null; activeKind.current = null;
    clearDraft(); setResult(null); setError(null); setReading(false);
    setImportState("idle"); setExportState("idle"); setRecovery({ state: "idle", message: "" });
    mustReload.current = false; setReloadRequired(false); refreshAdmission();
    return true;
  }
  function invalidateView() {
    requireReload(); clearDraft(); setResult(null);
    if (activeKind.current !== "import" && activeKind.current !== "recover") {
      serial.current += 1; active.current = null; activeKind.current = null;
      setReading(false); setExportState("idle");
    }
  }
  function refreshAdmission() {
    setPendingSaves(interruptedSaves());
    try { assertAppDataAccess(captureAppDataAccess()); }
    catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) requireReload(); }
  }
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { syncIdentity(); refreshAdmission(); };
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === "edgelab.auth.session.v1" || event.key.startsWith("edgelab.app-data-")) refresh();
      if (event.key === `edgelab.app-data-generation.v1.${captureAppDataAccess()?.owner}`) invalidateView();
    };
    refresh();
    window.addEventListener("storage", storage);
    window.addEventListener("edgelab:auth-session-change", refresh);
    window.addEventListener("edgelab:app-data-state-change", refresh);
    const unregister = registerAppDataParticipant({ settle: async () => {}, invalidate: (owner) => {
      if (captureAppDataAccess()?.owner === owner) invalidateView();
    } });
    return () => {
      mounted.current = false; serial.current += 1; active.current = null; activeKind.current = null;
      window.removeEventListener("storage", storage);
      window.removeEventListener("edgelab:auth-session-change", refresh);
      window.removeEventListener("edgelab:app-data-state-change", refresh);
      unregister();
    };
  }, []);

  function begin(kind: "file" | "export" | "import" | "recover") {
    // Resetting state does not replace this event handler's captured draft.
    // Any identity transition requires a fresh action from the new render.
    if (syncIdentity()) return null;
    refreshAdmission();
    if (active.current !== null || (kind !== "recover" && mustReload.current)) return null;
    if (!identity.current) {
      if (kind === "recover") setRecovery({ state: "error", message: "Sign in to an approved account before checking interrupted saves." });
      else setError("Sign in to an approved account before transferring data.");
      return null;
    }
    const ticket = { serial: ++serial.current, identity: identity.current };
    active.current = ticket.serial;
    activeKind.current = kind;
    return ticket;
  }
  function current(ticket: { serial: number; identity: string | null }) {
    if (!mounted.current) return false;
    if (syncIdentity()) return false;
    if (activeKind.current !== "import" && activeKind.current !== "recover") {
      try { assertAppDataAccess(captureAppDataAccess()); }
      catch { invalidateView(); return false; }
    }
    return ticket.serial === serial.current && ticket.identity === identity.current;
  }
  function finish(ticket: { serial: number; identity: string | null }) {
    if (current(ticket) && active.current === ticket.serial) { active.current = null; activeKind.current = null; refreshAdmission(); }
  }

  async function recoverSaves() {
    const ticket = begin("recover");
    if (!ticket) return;
    setRecovery({ state: "checking", message: "Checking interrupted saves…" });
    try {
      const checked = await recoverAccountDataOperations();
      if (!current(ticket)) return;
      if (checked.requiresReload) { requireReload(); clearDraft(); setResult(null); setError(null); setImportState("idle"); }
      setRecovery({ state: "done", message: checked.requiresReload || mustReload.current
        ? "Completion checked. Reload the workspace before saving or importing again."
        : "No interrupted saves need recovery." });
    } catch (caught) {
      if (current(ticket)) setRecovery({ state: "error", message: recoveryMessage(caught) });
    } finally { finish(ticket); }
  }

  async function exportData() {
    const ticket = begin("export");
    if (!ticket) return;
    setExportState("working");
    setError(null);
    try {
      const bundle = await exportAppDataBundle();
      if (!current(ticket)) return;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `edgelab-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportState("idle");
    } catch (caught) {
      if (!current(ticket)) return;
      setError(messageFor(caught, "Could not create the export. Your data was not changed."));
      setExportState("error");
    } finally { finish(ticket); }
  }

  async function readFile(file: File | null) {
    if (syncIdentity()) return;
    const selected = picker.current;
    picker.current = null;
    if (!selected || selected.identity !== sessionIdentity() || selected.serial !== serial.current) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const ticket = begin("file");
    if (!ticket) return;
    setError(null);
    setDraft(null);
    setResult(null);
    setImportState("idle");
    setConfirmation("");
    setReading(true);
    try {
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) throw new Error("That file is larger than 10 MB. Export or import a smaller EdgeLab bundle.");
      const validated = validateAppDataBundle(JSON.parse(await file.text()));
      if (!current(ticket)) return;
      const tables = Object.entries(validated.tables).map(([name, rows]) => ({ name, rows: rows.length }));
      setDraft({ bundle: validated, fileName: file.name, rows: tables.reduce((sum, table) => sum + table.rows, 0), tables });
    } catch (caught) {
      if (!current(ticket)) return;
      setError(messageFor(caught, "This is not a valid EdgeLab export bundle."));
    } finally { if (current(ticket)) setReading(false); finish(ticket); }
  }

  async function importData() {
    if (!draft || confirmation !== "IMPORT") return;
    const ticket = begin("import");
    if (!ticket) return;
    if (interruptedSaves()) { active.current = null; activeKind.current = null; setPendingSaves(true); return; }
    setImportState("working");
    setError(null);
    try {
      const nextResult = await importAppDataBundle(draft.bundle);
      if (!current(ticket)) return;
      requireReload(); clearDraft();
      setResult(nextResult);
      setImportState("done");
    } catch (caught) {
      if (!current(ticket)) return;
      if (caught && typeof caught === "object" && "requiresReload" in caught && caught.requiresReload) requireReload();
      setError(messageFor(caught, "Import failed before completion. Review the file and retry."));
      setImportState("error");
    } finally { finish(ticket); }
  }

  return (
    <SettingsSection title="Portable data" description="Export is non-destructive. Import is a staged replacement flow: choose, validate, preview, confirm, then apply.">
      <SettingRow controlId="recover-data" label="Interrupted saves" description="Check whether interrupted saves have finished before continuing. This checks completion without repeating a save or import." scope="Personal">
        <div className="space-y-3">
          <button type="button" disabled={busy} onClick={() => void recoverSaves()} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-medium text-zinc-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-55">
            {recovery.state === "checking" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
            {recovery.state === "checking" ? "Checking saves…" : "Check interrupted saves"}
          </button>
          <p className={`text-sm leading-5 ${recovery.state === "error" ? "text-rose-300" : "text-zinc-400"}`} role={recovery.state === "error" ? "alert" : "status"} aria-atomic="true">{recovery.message || (reloadRequired ? "Account data changed. Check interrupted saves, then reload the workspace." : pendingSaves ? "A save needs confirmation. Further imports are paused until completion is checked." : "Use this if a save was interrupted or its result could not be confirmed.")}</p>
          {reloadRequired ? <button type="button" disabled={busy} onClick={() => window.location.reload()} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-55">Reload workspace</button> : null}
        </div>
      </SettingRow>
      <SettingRow controlId="export-data" label="Export EdgeLab data" description="Download account-owned application tables as a versioned JSON bundle." scope="Personal" effective="No credentials or authentication tokens are included.">
        <button type="button" onClick={() => void exportData()} disabled={busy || reloadRequired} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-55">
          {exportState === "working" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" className="h-4 w-4" />}
          {exportState === "working" ? "Preparing…" : "Download export"}
        </button>
      </SettingRow>

      <SettingRow controlId="import-data" label="Import EdgeLab data" description="Replace supported account data only after a local schema check and a table-by-table preview." scope="Personal" validation={error}>
        <div className="space-y-3">
          <input key={identity.current ?? "signed-out"} ref={fileInputRef} type="file" disabled={busy || reloadRequired} accept="application/json,.json" className="sr-only" onClick={(event) => { if (syncIdentity() || !identity.current) { event.preventDefault(); return; } picker.current = { serial: serial.current, identity: identity.current }; event.currentTarget.value = ""; }} onChange={(event) => void readFile(event.target.files?.[0] ?? null)} />
          <button type="button" disabled={busy || reloadRequired} onClick={() => { if (syncIdentity()) return; refreshAdmission(); if (active.current === null && !mustReload.current) fileInputRef.current?.click(); }} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-medium text-zinc-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-55">
            <Upload aria-hidden="true" className="h-4 w-4" />
            {reading ? "Validating file…" : draft ? "Choose a different file" : "Choose JSON bundle"}
          </button>
          {draft ? (
            <div className="rounded-md border border-white/10 bg-black/20 p-3" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-medium text-zinc-100"><FileJson aria-hidden="true" className="h-4 w-4 text-cyan-300" />{draft.fileName}</p>
              <p className="mt-1 text-xs text-zinc-400">Validated bundle v{draft.bundle.version} · {draft.tables.length} tables · {draft.rows} rows</p>
              <ul className="mt-3 grid gap-1 text-xs text-zinc-400 sm:grid-cols-2">
                {draft.tables.map((table) => <li key={table.name} className="flex justify-between gap-3"><span className="truncate">{table.name}</span><span>{table.rows}</span></li>)}
              </ul>
              <div className="mt-4 border-t border-rose-400/20 pt-4">
                <p className="flex gap-2 text-xs leading-5 text-rose-200"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />Import replaces supported account tables. Keep the downloaded export if you may need to recover.</p>
                <label className="mt-3 block text-xs font-medium text-zinc-300">Type IMPORT to confirm
                  <input disabled={busy || reloadRequired || pendingSaves} value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} className={`${fieldClassName} mt-1`} autoComplete="off" />
                </label>
                <button type="button" onClick={() => void importData()} disabled={confirmation !== "IMPORT" || busy || reloadRequired || pendingSaves} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-45">
                  {importState === "working" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                  {importState === "working" ? "Importing…" : importState === "error" ? "Retry import" : "Replace data"}
                </button>
              </div>
            </div>
          ) : null}
          {result ? (
            <div className="rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3" role="status">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-200"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Import complete</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">{Object.values(result.summary).reduce((sum, count) => sum + count, 0)} records applied. Reload to hydrate every workspace view.</p>
            </div>
          ) : null}
        </div>
      </SettingRow>
    </SettingsSection>
  );
}

export { validateAppDataBundle } from "../../lib/api";

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sessionIdentity() {
  const session = getStoredAuthSession();
  return session?.user.approved === true && Number.isSafeInteger(session.user.id) && session.user.id > 0 && typeof session.token === "string" && session.token.trim() && Date.parse(session.expiresAt) > Date.now()
    ? window.localStorage.getItem("edgelab.auth.session.v1") : null;
}

function interruptedSaves() {
  try { const access = captureAppDataAccess(); return access ? appDataRecoveryNeeded(access.owner) : false; }
  catch { return true; }
}

function recoveryMessage(error: unknown) {
  const message = messageFor(error, "");
  if (/still running/i.test(message)) return "A save is still running. Saves remain paused; check again after it finishes.";
  if (/no (?:valid )?server receipt|no server receipt|no valid server receipt/i.test(message)) return "Automatic recovery is unavailable for this interrupted save. Saves remain paused.";
  return "Could not confirm interrupted saves. Saves remain paused; check again when the connection is available.";
}
