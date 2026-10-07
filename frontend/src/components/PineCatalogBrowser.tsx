import { useEffect, useRef, useState } from "react";
import { CURATED_PINE_CATALOG, loadPineCatalog, loadPineCatalogSource, loadPineCatalogMigration, pineCatalogMigration, pineCatalogCanRun, pineCatalogLicenseUrl, type PineCatalogImport } from "../lib/pineCatalog";

/** Standalone integration: import opens an unsaved draft; preparation remains in the editor. */
export function PineCatalogBrowser({ onImport, draftIdentity }: { onImport: (script: PineCatalogImport) => void; draftIdentity: unknown }) {
  const [catalog, setCatalog] = useState(CURATED_PINE_CATALOG);
  const [selectedId, setSelectedId] = useState(CURATED_PINE_CATALOG.entries[0].id);
  const [loaded, setLoaded] = useState<PineCatalogImport | null>(null);
  const [download, setDownload] = useState<{ source: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const activeRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);
  const draftRef = useRef(draftIdentity);
  draftRef.current = draftIdentity;
  const selected = catalog.entries.find((entry) => entry.id === selectedId)!;
  const migration = pineCatalogMigration(catalog, selectedId);
  const downloadUrl = loaded && download && download.source === loaded.source ? download.url : null;
  useEffect(() => {
    if (!loaded) { setDownload(null); return; }
    const url = URL.createObjectURL(new Blob([loaded.source], { type: "text/plain;charset=utf-8" }));
    setDownload({ source: loaded.source, url });
    return () => URL.revokeObjectURL(url);
  }, [loaded]);
  useEffect(() => () => { attemptRef.current++; activeRef.current?.abort(); }, []);
  useEffect(() => {
    attemptRef.current++; activeRef.current?.abort(); activeRef.current = null; setBusy(false);
  }, [draftIdentity]);
  const invalidate = () => { attemptRef.current++; activeRef.current?.abort(); activeRef.current = null; setLoaded(null); setError(null); setBusy(false); };

  async function checkUpdates() {
    invalidate(); const attempt = attemptRef.current;
    const controller = new AbortController(); activeRef.current = controller; setBusy(true);
    try {
      const next = await loadPineCatalog(controller.signal);
      if (attempt !== attemptRef.current) return;
      setCatalog(next); setNotice(next.upstreamCommit === catalog.upstreamCommit ? "Showing the latest packaged catalog revision." : "New catalog revision loaded. Saved scripts and chart copies are unchanged.");
    } catch (cause) { if (attempt === attemptRef.current) setError(cause instanceof Error ? cause.message : "Catalog update check failed."); }
    finally { if (attempt === attemptRef.current) { activeRef.current = null; setBusy(false); } }
  }
  async function viewSource() {
    invalidate(); const attempt = attemptRef.current;
    const controller = new AbortController(); activeRef.current = controller; setBusy(true);
    try {
      const script = await loadPineCatalogSource(catalog, selectedId, controller.signal);
      if (attempt === attemptRef.current) setLoaded(script);
    } catch (cause) { if (attempt === attemptRef.current) setError(cause instanceof Error ? cause.message : "Source could not be loaded."); }
    finally { if (attempt === attemptRef.current) { activeRef.current = null; setBusy(false); } }
  }
  async function importMigrated() {
    attemptRef.current++; activeRef.current?.abort();
    const attempt = attemptRef.current;
    const controller = new AbortController(); activeRef.current = controller; setBusy(true); setError(null);
    try {
      const script = await loadPineCatalogMigration(catalog, selectedId, controller.signal);
      if (attempt === attemptRef.current && draftRef.current === draftIdentity) { onImport(script); setNotice("A separate Pine v5 migration opened as an unsaved draft. The original source is unchanged."); }
    } catch (cause) { if (attempt === attemptRef.current) setError(cause instanceof Error ? cause.message : "Migration could not be verified."); }
    finally { if (attempt === attemptRef.current) { activeRef.current = null; setBusy(false); } }
  }
  return <details className="mt-4 min-w-0 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
    <summary className="min-h-11 cursor-pointer rounded py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">Community Pine catalog</summary>
    <p className="mt-3 leading-5">Original scripts by Alex Orekhov (everget). Community implementations; experimental execution. Attribution and original source are preserved. Pine alerts are not connected to notifications.</p>
    <label className="mt-3 grid gap-1.5">Script<select className="input-control min-h-11 w-full min-w-0 text-xs" disabled={busy} onChange={(event) => { invalidate(); setSelectedId(event.target.value); setNotice(""); }} value={selectedId}>
      {catalog.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · v{entry.pineVersion}{pineCatalogCanRun(entry) ? " · experimental" : " · migration needed"}</option>)}
    </select></label>
    <p className="mt-2 leading-5">Pine v{selected.pineVersion} · GPL-3.0 · source revision {catalog.upstreamCommit.slice(0, 8)}</p>
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2"><a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" href={selected.originUrl} rel="noreferrer" target="_blank">Original source</a><a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" href={pineCatalogLicenseUrl(catalog)} rel="noreferrer" target="_blank">Full licence</a></div>
    {!pineCatalogCanRun(selected) ? <p className="mt-2 leading-5 text-amber-100">Preserved original. Pine v{selected.pineVersion} needs an explicit migration before this runtime can execute it. {migration ? "A separately verified Pine v5 copy is available. Check the migrated draft and review its inputs before running; execution is experimental." : "No reviewed migration matches this source revision."}</p> : <p className="mt-2 leading-5">Pine version supported; execution is experimental. Import opens a draft. Check the script and review its inputs before running.</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button className="studio-tool-button min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" disabled={busy} onClick={() => void viewSource()} type="button">{busy ? "Loading…" : "View source"}</button><button className="studio-tool-button min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" disabled={busy} onClick={() => void checkUpdates()} type="button">Reload catalog</button>
      <button className="studio-tool-button studio-tool-button-active min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" disabled={busy || !loaded || !pineCatalogCanRun(selected)} onClick={() => { if (loaded) onImport(loaded); }} type="button">Import draft</button>
      {migration ? <button className="studio-tool-button studio-tool-button-active min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" disabled={busy || !loaded} onClick={() => void importMigrated()} type="button">Import migrated draft</button> : null}
      {downloadUrl ? <a className="inline-flex min-h-11 items-center text-cyan-200 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" download={selected.path.split("/").pop()} href={downloadUrl}>Download original</a> : null}</div>
    {error ? <p className="mt-2 leading-5 text-rose-200" role="alert">{error}</p> : null}
    {notice ? <p className="mt-2 leading-5" role="status">{notice}</p> : null}
    {loaded ? <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-[11px] leading-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300" tabIndex={0} aria-label={`${selected.name} original source`}>{loaded.source}</pre> : null}
  </details>;
}
