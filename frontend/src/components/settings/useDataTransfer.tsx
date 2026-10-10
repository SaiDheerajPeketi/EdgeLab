import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { exportAppDataBundle, importAppDataBundle, recoverAccountDataOperations, validateAppDataBundle, type AppDataBundle, type AppDataImportResult } from "../../lib/api";
import { appDataRecoveryNeeded, appDataSessionKey, assertAppDataAccess, captureAppDataAccess, registerAppDataParticipant } from "../../lib/appDataBarrier";
import { getStoredAuthSession, isPersonalWorkspaceSession, subscribeAuthSession } from "../../lib/authSession";
import { getBillingStatus, hasActiveSubscription, refreshPersonalWorkspaceSession, type BillingStatus } from "../../lib/billing";
import { isPersonalMode } from "../../lib/deploymentMode";
import { Link } from "react-router-dom";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
type ImportDraft = { bundle: AppDataBundle; fileName: string; rows: number; tables: Array<{ name: string; rows: number }> };
const TransferContext = createContext<ReturnType<typeof useTransferController> | null>(null);

export function DataTransferProvider({ children }: { children: ReactNode }) {
  const transfer = useTransferController();
  const [exportNotice, setExportNotice] = useState("");
  useEffect(() => {
    const failed = (event: Event) => setExportNotice(String((event as CustomEvent).detail));
    const changed = () => setExportNotice("");
    window.addEventListener("edgelab:export-error", failed);
    window.addEventListener("edgelab:auth-session-change", changed);
    return () => { window.removeEventListener("edgelab:export-error", failed); window.removeEventListener("edgelab:auth-session-change", changed); };
  }, []);
  return <TransferContext.Provider value={transfer}>
    {exportNotice ? <div className="relative z-[130] flex flex-wrap items-center justify-between gap-3 bg-amber-950 px-4 py-3 text-sm leading-6 text-amber-100" role="alert">
      <p className="min-w-0 flex-1">{exportNotice} <Link className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-100" to="/account">{transfer.personal ? "Manage local access" : "Manage subscription"}</Link></p>
      <button className="min-h-11 px-3 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-100" type="button" onClick={() => setExportNotice("")}>Dismiss</button>
    </div> : null}
    {children}
  </TransferContext.Provider>;
}

export function useDataTransfer() {
  const value = useContext(TransferContext);
  if (!value) throw new Error("Storage controls require the account transfer provider.");
  return value;
}

function useTransferController() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exportState, setExportState] = useState<"idle" | "working" | "error">("idle");
  const [subscription, setSubscription] = useState<BillingStatus | null>(null);
  const [subscriptionChecking, setSubscriptionChecking] = useState(false);
  const [subscriptionClock, setSubscriptionClock] = useState(Date.now());
  const subscriptionOwner = useRef<string | null>(null);
  const [draft, setDraftState] = useState<ImportDraft | null>(null);
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
  const picker = useRef<{ serial: number; identity: string | null; view: symbol } | null>(null);
  const [restoring, setRestoring] = useState(Boolean(identity.current));
  const [draftWarning, setDraftWarning] = useState("");
  const hydrating = useRef(Boolean(identity.current));
  const hydration = useRef(0);
  const draftStorage = useRef<{ key: string; binding: string } | null>(null);
  const views = useRef(new Set<symbol>());
  const busy = restoring || reading || exportState === "working" || importState === "working" || recovery.state === "checking";
  const personal = isPersonalMode();
  const canExport = subscriptionOwner.current === sessionIdentity() && (personal ? isPersonalWorkspaceSession(getStoredAuthSession(), subscriptionClock) : hasActiveSubscription(subscription, subscriptionClock));

  useEffect(() => {
    let alive = true, generation = 0, pending = false;
    const refresh = async () => {
      const owner = sessionIdentity();
      if (owner !== subscriptionOwner.current) {
        generation += 1; pending = false; subscriptionOwner.current = owner; setSubscription(null);
      }
      if (!owner) { setSubscriptionChecking(false); return; }
      if (pending) return;
      const run = ++generation;
      pending = true; setSubscriptionChecking(true);
      try {
        const status = personal ? (await refreshPersonalWorkspaceSession(), null) : await getBillingStatus();
        if (alive && run === generation && owner === sessionIdentity()) {
          setSubscription(status); setSubscriptionClock(Date.now());
        }
      } catch {
        if (alive && run === generation) setSubscription(null);
      } finally {
        if (alive && run === generation) { pending = false; setSubscriptionChecking(false); }
      }
    };
    void refresh();
    const unsubscribe = subscribeAuthSession(() => {
      if (subscriptionOwner.current !== sessionIdentity()) void refresh();
      else if (personal) setSubscriptionClock(Date.now());
    });
    const timer = window.setInterval(() => void refresh(), 30_000);
    const clock = window.setInterval(() => setSubscriptionClock(Date.now()), 1000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; generation += 1; unsubscribe(); window.clearInterval(timer); window.clearInterval(clock); document.removeEventListener("visibilitychange", visible); };
  }, []);

  function setDraft(next: ImportDraft | null) {
    setDraftState(next); setDraftWarning("");
    const storage = draftStorage.current;
    if (!storage) { if (next) setDraftWarning("This file is kept while the page stays open. Choose it again after a reload."); return; }
    try {
      window.sessionStorage.removeItem(storage.key);
      if (next) {
        const raw = JSON.stringify({ version: 1, binding: storage.binding, fileName: next.fileName, bundle: next.bundle });
        if (new Blob([raw]).size > MAX_IMPORT_BYTES) throw new Error("Draft exceeds browser storage limit");
        window.sessionStorage.setItem(storage.key, raw);
        if (window.sessionStorage.getItem(storage.key) !== raw) throw new Error("Draft was not retained");
      }
    } catch { if (next) setDraftWarning("This file is kept while the page stays open. Choose it again after a reload."); }
  }
  async function restoreDraft() {
    const generation = ++hydration.current, pinned = identity.current;
    hydrating.current = Boolean(pinned); setRestoring(Boolean(pinned)); draftStorage.current = null;
    if (!pinned) return;
    try {
      const access = captureAppDataAccess(); assertAppDataAccess(access);
      if (!access) return;
      const key = appDataSessionKey(`edgelab.data-transfer-draft.v1.${access.owner}`, access.owner);
      const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(pinned));
      if (!mounted.current || generation !== hydration.current || pinned !== sessionIdentity()) return;
      assertAppDataAccess(access);
      const binding = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      draftStorage.current = { key, binding };
      const raw = window.sessionStorage.getItem(key);
      if (raw) {
        try {
          if (new Blob([raw]).size > MAX_IMPORT_BYTES) throw new Error("Draft too large");
          const saved = JSON.parse(raw);
          if (saved?.version !== 1 || saved.binding !== binding || typeof saved.fileName !== "string" || !saved.fileName || saved.fileName.length > 255) throw new Error("Invalid draft");
          const bundle = validateAppDataBundle(saved.bundle);
          const tables = Object.entries(bundle.tables).map(([name, rows]) => ({ name, rows: rows.length }));
          setDraftState({ bundle, fileName: saved.fileName, tables, rows: tables.reduce((sum, table) => sum + table.rows, 0) });
        } catch { window.sessionStorage.removeItem(key); }
      }
    } catch { /* Transfer stays usable in memory when private draft storage is unavailable. */ }
    finally {
      if (mounted.current && generation === hydration.current) {
        if (pinned !== sessionIdentity()) syncIdentity();
        else { hydrating.current = false; setRestoring(false); }
      }
    }
  }
  function attachView(view: symbol) {
    views.current.add(view);
    return () => { views.current.delete(view); if (picker.current?.view === view) picker.current = null; };
  }
  function chooseFile(view: symbol) {
    if (!views.current.has(view) || syncIdentity()) return;
    refreshAdmission();
    if (!hydrating.current && active.current === null && !mustReload.current) fileInputRef.current?.click();
  }
  function onPickerClick(event: MouseEvent<HTMLInputElement>, view: symbol) {
    if (!views.current.has(view) || syncIdentity() || !identity.current || hydrating.current || active.current !== null || mustReload.current) { event.preventDefault(); return; }
    picker.current = { serial: serial.current, identity: identity.current, view }; event.currentTarget.value = "";
  }

  function requireReload() { mustReload.current = true; setReloadRequired(true); }
  function clearDraft() {
    setDraft(null); setConfirmation(""); picker.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function syncIdentity() {
    const current = sessionIdentity();
    if (current === identity.current) return false;
    clearDraft(); identity.current = current; serial.current += 1; active.current = null; activeKind.current = null;
    hydration.current += 1; draftStorage.current = null; setResult(null); setError(null); setReading(false);
    setImportState("idle"); setExportState("idle"); setRecovery({ state: "idle", message: "" });
    mustReload.current = false; setReloadRequired(false); refreshAdmission(); void restoreDraft();
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
    // Closing admission for our own operation does not itself advance data.
    // Owner, token and generation checks still apply during that pause.
    try { assertAppDataAccess(captureAppDataAccess(), false, activeKind.current === "import" || activeKind.current === "recover"); }
    catch (caught) { if (!(caught instanceof DOMException && caught.name === "AbortError")) requireReload(); }
  }
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { syncIdentity(); refreshAdmission(); };
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === "edgelab.auth.session.v1" || event.key.startsWith("edgelab.app-data-")) refresh();
      if (event.key === `edgelab.app-data-generation.v1.${captureAppDataAccess()?.owner}`) invalidateView();
    };
    refresh(); void restoreDraft();
    window.addEventListener("storage", storage);
    window.addEventListener("edgelab:auth-session-change", refresh);
    window.addEventListener("edgelab:app-data-state-change", refresh);
    const unregister = registerAppDataParticipant({ settle: async () => {}, invalidate: (owner) => {
      if (captureAppDataAccess()?.owner === owner) invalidateView();
    } });
    return () => {
      mounted.current = false; hydration.current += 1; serial.current += 1; active.current = null; activeKind.current = null;
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
    if (hydrating.current || active.current !== null || (kind !== "recover" && mustReload.current)) return null;
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

  async function exportData(view: symbol) {
    if (!views.current.has(view)) return;
    if (subscriptionOwner.current !== sessionIdentity() || !(personal ? isPersonalWorkspaceSession(getStoredAuthSession()) : hasActiveSubscription(subscription))) {
      setError(personal ? "Open your local workspace session to export data." : "An active paid subscription is required to export data. Check your subscription in Account.");
      return;
    }
    const ticket = begin("export");
    if (!ticket) return;
    setExportState("working");
    setError(null);
    try {
      if (personal) await refreshPersonalWorkspaceSession();
      if (!current(ticket)) return;
      const bundle = await exportAppDataBundle();
      if (!current(ticket)) return;
      if (personal ? !isPersonalWorkspaceSession(getStoredAuthSession()) : !hasActiveSubscription(subscription)) throw new Error(personal ? "Open your local workspace session to export data." : "Your subscription needs to be checked again before exporting. Open Account, refresh your status, and retry.");
      setExportState("idle");
      if (!views.current.has(view)) return;
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

  async function readFile(file: File | null, view: symbol) {
    if (syncIdentity()) return;
    const selected = picker.current;
    picker.current = null;
    if (!views.current.has(view) || !selected || selected.view !== view || selected.identity !== sessionIdentity() || selected.serial !== serial.current) {
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

  return { fileInputRef, exportState, draft, confirmation, setConfirmation, importState, error, result, reading, pendingSaves,
    reloadRequired, recovery, busy, restoring, draftWarning, canExport, personal, subscriptionChecking, identityKey: identity.current ?? "signed-out",
    attachView, chooseFile, onPickerClick, recoverSaves, exportData, readFile, importData };
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sessionIdentity() {
  const session = getStoredAuthSession();
  return session && Number.isSafeInteger(session.user.id) && session.user.id > 0 && typeof session.token === "string" && session.token.trim() && typeof session.expiresAt === "string" && Date.parse(session.expiresAt) > Date.now()
    ? `${session.user.id}:${session.token}` : null;
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
