import { ArrowLeft, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkspaceView } from "../lib/workspace";
import { workspaceNavigationItem } from "../lib/workspaceNavigation";
import { Button } from "./ui/Primitives";

type ConnectionState = "connected" | "delayed" | "offline" | "local";

export function WorkspaceContextHeader({
  actions,
  activeView,
  connection = "local",
  onBack,
  onOpenSettings,
  scope,
}: {
  actions?: ReactNode;
  activeView: WorkspaceView;
  connection?: ConnectionState;
  onBack?: () => void;
  onOpenSettings: () => void;
  scope?: string;
}) {
  const context = workspaceNavigationItem(activeView);
  const connectionCopy: Record<ConnectionState, { label: string; detail: string; className: string }> = {
    connected: { label: "Live connection", detail: "Receiving verified updates", className: "text-emerald-200" },
    delayed: { label: "Delayed data", detail: "Check the last verified timestamp", className: "text-amber-200" },
    offline: { label: "Offline", detail: "Local work remains available", className: "text-rose-200" },
    local: { label: "Saved workspace", detail: "Changes persist to your account", className: "text-slate-300" },
  };
  const state = connectionCopy[connection];
  return <header className="mb-4 flex min-w-0 flex-wrap items-center gap-3 border-b border-[var(--ui-border-subtle)] pb-3" aria-label="Workspace context">
    {onBack ? <Button tone="quiet" onClick={onBack} aria-label="Return to replay sessions" className="px-2"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back</Button> : null}
    <div className="min-w-[12rem] flex-1">
      <p className="ui-resilient-text text-xs text-[var(--text-secondary)]" dir="auto">{context.section}</p>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="ui-resilient-text text-lg font-semibold text-[var(--text-primary)]" dir="auto">{context.label}</h1>
        {scope ? <span className="ui-resilient-text max-w-full font-data text-xs text-cyan-100" dir="auto">{scope}</span> : null}
      </div>
      <p className="ui-resilient-text mt-0.5 text-xs text-[var(--text-secondary)]" dir="auto">{context.description}</p>
    </div>
    <div className="flex min-w-0 items-center gap-2" title={state.detail}>
      <span className={`text-xs font-medium ${state.className}`}>{state.label}</span>
    </div>
    {actions}
    <Button tone="quiet" onClick={onOpenSettings} className="px-2"><Settings2 aria-hidden="true" className="h-4 w-4" />Settings</Button>
  </header>;
}
