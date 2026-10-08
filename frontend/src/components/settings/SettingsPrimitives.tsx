import type { ReactNode } from "react";
import { AlertCircle, Check, LoaderCircle, RotateCcw } from "lucide-react";

export type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export function SaveStatus({ state, message, onRetry }: { state: SaveState; message?: string; onRetry?: () => void }) {
  if (state === "idle") return null;
  const failed = state === "error" || state === "conflict";
  return (
    <span className={`inline-flex min-h-6 items-center gap-1.5 text-xs ${failed ? "text-[var(--loss-text)]" : "text-[var(--text-secondary)]"}`} role={failed ? "alert" : "status"}>
      {state === "saving" ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : null}
      {state === "saved" ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-300" /> : null}
      {failed ? <AlertCircle aria-hidden="true" className="h-3.5 w-3.5" /> : null}
      <span>{message ?? (state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "conflict" ? "Changed elsewhere" : "Save failed")}</span>
      {failed && onRetry ? <button type="button" className="underline underline-offset-2 hover:text-[var(--text-primary)]" onClick={onRetry}>Retry</button> : null}
    </span>
  );
}

export function SettingsSection({
  title,
  description,
  children,
  dirty,
  onReset,
}: {
  title: string;
  description: string;
  children: ReactNode;
  dirty?: boolean;
  onReset?: () => void;
}) {
  return (
    <section className="border-b border-[var(--ui-border-subtle)] py-7 first:pt-1 last:border-b-0" aria-labelledby={`settings-${slug(title)}`}>
      <div className="mb-1 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="ui-resilient-text text-base font-semibold text-[var(--text-primary)]" dir="auto" id={`settings-${slug(title)}`}>{title}</h2>
          <p className="ui-resilient-text mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]" dir="auto">{description}</p>
        </div>
        {onReset ? (
          <button type="button" onClick={onReset} className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
            Reset section{dirty ? " · Unsaved" : ""}
          </button>
        ) : null}
      </div>
      <div className="mt-4 divide-y divide-[var(--ui-border-subtle)]">{children}</div>
    </section>
  );
}

export function SettingRow({
  controlId,
  label,
  description,
  children,
  scope = "Personal",
  effective,
  validation,
  saveState = "idle",
  saveMessage,
  onRetry,
  learnMore,
}: {
  controlId: string;
  label: string;
  description: string;
  children: ReactNode;
  scope?: "Personal" | "Workspace" | "System";
  effective?: string;
  validation?: string | null;
  saveState?: SaveState;
  saveMessage?: string;
  onRetry?: () => void;
  learnMore?: { href: string; label: string };
}) {
  return (
    <div id={`setting-${controlId}`} data-setting-control={controlId} tabIndex={-1} className="scroll-mt-28 py-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(14rem,22rem)] sm:gap-8">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="ui-resilient-text min-w-0 text-sm font-medium text-[var(--text-primary)]" dir="auto">{label}</h3>
          {scope === "System" ? <span className="text-xs text-[var(--text-secondary)]">Managed by system</span> : null}
        </div>
        <p className="ui-resilient-text mt-1 text-sm leading-5 text-[var(--text-secondary)]" dir="auto">{description}</p>
        {learnMore ? <a href={learnMore.href} className="mt-1 inline-block text-xs text-cyan-300 underline-offset-2 hover:underline">{learnMore.label}</a> : null}
        {effective ? <p className="ui-resilient-text mt-2 text-xs text-[var(--text-secondary)]" dir="auto">Effective: {effective}</p> : null}
        {validation ? <p className="ui-resilient-text mt-2 text-xs text-[var(--loss-text)]" dir="auto" id={`setting-${controlId}-validation`} role="alert">{validation}</p> : null}
        <SaveStatus state={saveState} message={saveMessage} onRetry={onRetry} />
      </div>
      <div className="mt-4 min-w-0 sm:mt-0">{children}</div>
    </div>
  );
}

export function SettingsToggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative ml-auto block h-7 w-12 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "border-cyan-400/60 bg-cyan-400/30" : "border-[var(--ui-border-strong)] bg-black/30"}`}>
      <span aria-hidden="true" className={`absolute top-1 h-[18px] w-[18px] rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export const fieldClassName = "settings-field min-h-10 w-full min-w-0 rounded-md border px-3 text-start text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55";

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
