import { useEffect, useRef, type ComponentProps } from "react";
import { AlertTriangle, CheckCircle2, Download, FileJson, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import { SettingRow, SettingsSection, fieldClassName } from "./SettingsPrimitives";
import { useDataTransfer } from "./useDataTransfer";
import { Link } from "react-router-dom";

const compatibilityField = "min-h-11 w-full min-w-0 border border-stone-600 bg-stone-900 px-3 text-sm text-stone-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-55";
const compatibilityButton = "inline-flex min-h-11 w-full items-center justify-center gap-2 border border-stone-600 bg-stone-900 px-4 text-sm font-medium text-stone-100 hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-55";

export function SettingsDataTransfer({ compatibility = false }: { compatibility?: boolean }) {
  const transfer = useDataTransfer();
  const view = useRef(Symbol("data-transfer-view")).current;
  useEffect(() => transfer.attachView(view), []);
  const { fileInputRef, exportState, draft, confirmation, setConfirmation, importState, error, result, reading, pendingSaves,
    reloadRequired, recovery, busy, restoring, draftWarning, canExport, subscriptionChecking, identityKey, chooseFile, onPickerClick, recoverSaves, exportData, readFile, importData } = transfer;
  const muted = compatibility ? "text-stone-300" : "text-[var(--text-secondary)]";
  const errorColor = compatibility ? "text-rose-300" : "text-[var(--loss-text)]";
  const secondary = compatibility ? compatibilityButton : "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--ui-border-strong)] bg-[var(--ui-inset)] px-4 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--ui-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] disabled:cursor-not-allowed disabled:opacity-55";
  const primary = compatibility ? `${compatibilityButton} border-amber-500 text-amber-100` : "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--interaction)] px-4 text-sm font-semibold text-[var(--on-interaction)] hover:bg-[var(--interaction-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] disabled:opacity-55";
  return (
    <TransferSection compatibility={compatibility} title="Portable data" description="Export is non-destructive. Import is a staged replacement flow: choose, validate, preview, confirm, then apply.">
      <TransferRow compatibility={compatibility} controlId="recover-data" label="Interrupted saves" description="Check whether interrupted saves have finished before continuing. This checks completion without repeating a save or import." scope="Personal">
        <div className="space-y-3">
          <button type="button" disabled={busy} onClick={() => void recoverSaves()} className={secondary}>
            {recovery.state === "checking" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
            {recovery.state === "checking" ? "Checking saves…" : "Check interrupted saves"}
          </button>
          <p className={`text-sm leading-5 ${recovery.state === "error" ? errorColor : muted}`} role={recovery.state === "error" ? "alert" : "status"} aria-atomic="true">{recovery.message || (reloadRequired ? "Account data changed. Check interrupted saves, then reload the workspace." : pendingSaves ? "A save needs confirmation. Further imports are paused until completion is checked." : "Use this if a save was interrupted or its result could not be confirmed.")}</p>
          {reloadRequired ? <button type="button" disabled={busy} onClick={() => window.location.reload()} className={primary}>Reload workspace</button> : null}
        </div>
      </TransferRow>
      <TransferRow compatibility={compatibility} controlId="export-data" label="Export EdgeLab data" description="Download account-owned application tables as a versioned JSON bundle." scope="Personal" effective="No credentials or authentication tokens are included.">
        <div className="space-y-3">
        <button type="button" aria-describedby="export-subscription-requirement" onClick={() => void exportData(view)} disabled={busy || reloadRequired || !canExport} className={primary}>
          {exportState === "working" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" className="h-4 w-4" />}
          {exportState === "working" ? "Preparing…" : "Download export"}
        </button>
        <p id="export-subscription-requirement" className={`text-sm leading-6 ${muted}`} role="status">{canExport ? "Your subscription is active. Exports are available." : subscriptionChecking ? "Checking your subscription…" : "Data exports require an active paid subscription."} <Link className={`inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 ${compatibility ? "focus-visible:ring-cyan-300" : "text-[var(--interaction)] focus-visible:ring-[var(--ui-focus)]"}`} to="/account">Manage subscription</Link></p>
        </div>
      </TransferRow>

      <TransferRow compatibility={compatibility} controlId="import-data" label="Import EdgeLab data" description="Replace supported account data only after a local schema check and a table-by-table preview." scope="Personal" validation={error}>
        <div className="space-y-3">
          {importState === "working" ? <p className={`text-sm leading-5 ${muted}`} role="status">Importing account data…</p> : null}
          <input key={identityKey} ref={fileInputRef} type="file" tabIndex={-1} aria-label="Import JSON bundle" disabled={busy || reloadRequired} accept="application/json,.json" className="sr-only" onClick={(event) => onPickerClick(event, view)} onChange={(event) => void readFile(event.target.files?.[0] ?? null, view)} />
          <button type="button" disabled={busy || reloadRequired} onClick={() => chooseFile(view)} className={secondary}>
            <Upload aria-hidden="true" className="h-4 w-4" />
            {restoring ? "Restoring staged file…" : reading ? "Validating file…" : draft ? "Choose a different file" : "Choose JSON bundle"}
          </button>
          {draftWarning ? <p className={`text-sm leading-5 ${compatibility ? "text-amber-200" : "text-[var(--warning-text)]"}`} role="status">{draftWarning}</p> : null}
          {draft ? (
            <div className={compatibility ? "border border-stone-700 bg-stone-900 p-3" : "rounded-md border border-[var(--ui-border-subtle)] bg-[var(--ui-inset)] p-3"} aria-live="polite">
              <p className={`flex items-center gap-2 text-sm font-medium ${compatibility ? "text-zinc-100" : "text-[var(--text-primary)]"}`}><FileJson aria-hidden="true" className={`h-4 w-4 shrink-0 ${compatibility ? "text-amber-200" : "text-[var(--interaction)]"}`} /><bdi className="min-w-0 break-all">{draft.fileName}</bdi></p>
              <p className={`mt-1 text-xs ${muted}`}>Validated bundle v{draft.bundle.version} · {draft.tables.length} tables · {draft.rows} rows</p>
              <ul className={`mt-3 grid gap-1 text-xs ${muted} sm:grid-cols-2`}>
                {draft.tables.map((table) => <li key={table.name} className="flex justify-between gap-3"><span className="truncate">{table.name}</span><span>{table.rows}</span></li>)}
              </ul>
              <div className={`mt-4 border-t pt-4 ${compatibility ? "border-rose-400/20" : "border-[var(--ui-border-strong)]"}`}>
                <p className={`flex gap-2 text-xs leading-5 ${compatibility ? "text-rose-200" : "text-[var(--loss-text)]"}`}><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />Import replaces supported account tables. Keep the downloaded export if you may need to recover.</p>
                <label className={`mt-3 block text-xs font-medium ${compatibility ? "text-zinc-300" : "text-[var(--text-secondary)]"}`}>Type IMPORT to confirm
                  <input disabled={busy || reloadRequired || pendingSaves} value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} className={`${compatibility ? compatibilityField : fieldClassName} mt-1`} autoComplete="off" />
                </label>
                <button type="button" onClick={() => void importData()} disabled={confirmation !== "IMPORT" || busy || reloadRequired || pendingSaves} className={`mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-45 ${compatibility ? "bg-rose-700 text-white hover:bg-rose-600 focus-visible:ring-rose-300" : "bg-[var(--danger-action)] text-[var(--on-danger-action)] hover:bg-[var(--danger-action-hover)] focus-visible:ring-[var(--ui-focus)]"}`}>
                  {importState === "working" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                  {importState === "working" ? "Importing…" : importState === "error" ? "Retry import" : "Replace data"}
                </button>
              </div>
            </div>
          ) : null}
          {result ? (
            <div className={compatibility ? "rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3" : "rounded-md border border-[var(--ui-border-subtle)] bg-[var(--profit-soft)] p-3"} role="status">
              <p className={`flex items-center gap-2 text-sm font-medium ${compatibility ? "text-emerald-200" : "text-[var(--profit-text)]"}`}><CheckCircle2 aria-hidden="true" className="h-4 w-4" />Import complete</p>
              <p className={`mt-1 text-xs leading-5 ${compatibility ? muted : "text-[var(--profit-text)]"}`}>{Object.values(result.summary).reduce((sum, count) => sum + count, 0)} records applied. Reload to hydrate every workspace view.</p>
            </div>
          ) : null}
        </div>
      </TransferRow>
    </TransferSection>
  );
}

export { validateAppDataBundle } from "../../lib/api";

function TransferSection({ compatibility, ...props }: ComponentProps<typeof SettingsSection> & { compatibility: boolean }) {
  if (!compatibility) return <SettingsSection {...props} />;
  return <section className="mt-7 min-w-0" aria-labelledby="settings-portable-data"><h2 id="settings-portable-data" className="text-lg font-semibold">{props.title}</h2><p className="mt-2 max-w-[70ch] text-sm leading-6 text-stone-300">{props.description}</p><div className="mt-4">{props.children}</div></section>;
}

function TransferRow({ compatibility, ...props }: ComponentProps<typeof SettingRow> & { compatibility: boolean }) {
  if (!compatibility) return <SettingRow {...props} />;
  return <section className="min-w-0 border-t border-stone-700 py-5 outline-none focus-visible:ring-2 focus-visible:ring-amber-300" tabIndex={-1} data-setting-control={props.controlId} id={`setting-${props.controlId}`}><div className="flex flex-wrap items-center gap-3"><h3 className="text-base font-medium">{props.label}</h3><span className="text-xs text-stone-300">{props.scope}</span></div><p className="mt-1 max-w-[70ch] text-sm leading-6 text-stone-300">{props.description}</p>{props.effective ? <p className="mt-2 text-xs text-stone-300">Effective: {props.effective}</p> : null}{props.validation ? <p className="mt-2 text-sm text-rose-300" role="alert">{props.validation}</p> : null}<div className="mt-4 max-w-xl">{props.children}</div></section>;
}
