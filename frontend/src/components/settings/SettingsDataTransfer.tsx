import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileJson, LoaderCircle, Upload } from "lucide-react";
import {
  exportAppDataBundle,
  importAppDataBundle,
  validateAppDataBundle,
  type AppDataBundle,
  type AppDataImportResult,
} from "../../lib/api";
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

  async function exportData() {
    setExportState("working");
    setError(null);
    try {
      const bundle = await exportAppDataBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `edgelab-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportState("idle");
    } catch (caught) {
      setError(messageFor(caught, "Could not create the export. Your data was not changed."));
      setExportState("error");
    }
  }

  async function readFile(file: File | null) {
    setError(null);
    setDraft(null);
    setResult(null);
    setImportState("idle");
    setConfirmation("");
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError("That file is larger than 10 MB. Export or import a smaller EdgeLab bundle.");
      return;
    }
    try {
      const validated = validateAppDataBundle(JSON.parse(await file.text()));
      const tables = Object.entries(validated.tables).map(([name, rows]) => ({ name, rows: rows.length }));
      setDraft({ bundle: validated, fileName: file.name, rows: tables.reduce((sum, table) => sum + table.rows, 0), tables });
    } catch (caught) {
      setError(messageFor(caught, "This is not a valid EdgeLab export bundle."));
    }
  }

  async function importData() {
    if (!draft || confirmation !== "IMPORT") return;
    setImportState("working");
    setError(null);
    try {
      const nextResult = await importAppDataBundle(draft.bundle);
      setResult(nextResult);
      setImportState("done");
    } catch (caught) {
      setError(messageFor(caught, "Import failed before completion. Review the file and retry."));
      setImportState("error");
    }
  }

  return (
    <SettingsSection title="Portable data" description="Export is non-destructive. Import is a staged replacement flow: choose, validate, preview, confirm, then apply.">
      <SettingRow controlId="export-data" label="Export EdgeLab data" description="Download account-owned application tables as a versioned JSON bundle." scope="Personal" effective="No credentials or authentication tokens are included.">
        <button type="button" onClick={() => void exportData()} disabled={exportState === "working"} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-55">
          {exportState === "working" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" className="h-4 w-4" />}
          {exportState === "working" ? "Preparing…" : "Download export"}
        </button>
      </SettingRow>

      <SettingRow controlId="import-data" label="Import EdgeLab data" description="Replace supported account data only after a local schema check and a table-by-table preview." scope="Personal" validation={error}>
        <div className="space-y-3">
          <input ref={fileInputRef} type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-medium text-zinc-100 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
            <Upload aria-hidden="true" className="h-4 w-4" />
            {draft ? "Choose a different file" : "Choose JSON bundle"}
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
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} className={`${fieldClassName} mt-1`} autoComplete="off" />
                </label>
                <button type="button" onClick={() => void importData()} disabled={confirmation !== "IMPORT" || importState === "working"} className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-45">
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
              <button type="button" onClick={() => window.location.reload()} className="mt-2 text-xs font-semibold text-cyan-300 hover:underline">Reload workspace</button>
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
