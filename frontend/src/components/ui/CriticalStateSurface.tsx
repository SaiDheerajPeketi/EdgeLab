import { AlertTriangle, CheckCircle2, CircleOff, CloudOff, LoaderCircle, LockKeyhole, type LucideIcon } from "lucide-react";
import { UI_STATE_DESCRIPTORS, type UiAsyncState } from "../../lib/uiFoundation";
import type { ReactNode } from "react";

const STATE_ICONS: Record<UiAsyncState, LucideIcon> = {
  empty: CircleOff,
  loading: LoaderCircle,
  partial: AlertTriangle,
  offline: CloudOff,
  stale: AlertTriangle,
  "permission-denied": LockKeyhole,
  unsupported: CircleOff,
  error: AlertTriangle,
  retrying: LoaderCircle,
  success: CheckCircle2,
};

type CriticalStateSurfaceProps = {
  state: UiAsyncState;
  title?: string;
  detail?: string;
  actionLabel?: string | null;
  onAction?: () => void;
  timestamp?: string;
  action?: ReactNode;
};

export function CriticalStateSurface({ state, title, detail, actionLabel, onAction, timestamp, action }: CriticalStateSurfaceProps) {
  const descriptor = UI_STATE_DESCRIPTORS[state];
  const Icon = STATE_ICONS[state];
  const label = actionLabel === undefined ? descriptor.actionLabel : actionLabel;
  const busy = state === "loading" || state === "retrying";
  const urgent = state === "error" || state === "permission-denied";

  return (
    <section
      aria-atomic="true"
      aria-busy={busy}
      aria-live={urgent ? "assertive" : "polite"}
      className="ui-critical-state"
      data-state={state}
      role={urgent ? "alert" : "status"}
    >
      <Icon aria-hidden="true" className={busy ? "ui-critical-state__icon motion-safe:animate-spin" : "ui-critical-state__icon"} />
      <div className="min-w-0">
        <h2 className="ui-critical-state__title">{title ?? descriptor.title}</h2>
        <p className="ui-critical-state__detail">{detail ?? descriptor.detail}</p>
        {timestamp ? <p className="ui-critical-state__timestamp">Last verified {timestamp}</p> : null}
      </div>
      {action ?? (label && onAction ? <button className="ui-critical-state__action" onClick={onAction} type="button">{label}</button> : null)}
    </section>
  );
}
