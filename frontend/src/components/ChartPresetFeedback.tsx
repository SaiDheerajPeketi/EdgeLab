type Props = { kind: "Drawing" | "Fib"; loaded: boolean; pending: "save" | "delete" | null; error: string | null; notice: string | null; retryAction: "load" | "save" | "delete" | null; retry: () => void };

export function ChartPresetFeedback({ kind, loaded, pending, error, notice, retryAction, retry }: Props) {
  const message = error ?? (pending ? pending === "save" ? "Saving preset…" : "Deleting preset…" : notice ?? (!loaded ? "Loading saved presets…" : null));
  if (!message) return null;
  return (
    <div aria-label={`${kind} preset status`} className="flex w-full min-w-0 flex-wrap items-center gap-2 text-xs normal-case tracking-normal" role="group">
      <p className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${error ? "text-[var(--loss-text)]" : "text-[var(--text-secondary)]"}`} role={error ? "alert" : "status"}>{message}</p>
      {retryAction && <button className="control-button min-h-11 text-xs" disabled={Boolean(pending)} onClick={retry} type="button">Retry {retryAction}</button>}
    </div>
  );
}
