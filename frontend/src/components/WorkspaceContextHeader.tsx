import type { ReactNode } from "react";
import type { WorkspaceView } from "../lib/workspace";
import { workspaceNavigationItem } from "../lib/workspaceNavigation";

export function WorkspaceContextHeader({
  actions,
  activeView,
  scope,
}: {
  actions?: ReactNode;
  activeView: WorkspaceView;
  scope?: string;
}) {
  const context = workspaceNavigationItem(activeView);
  return <header className="mb-4 flex min-w-0 flex-wrap items-center gap-3 border-b border-[var(--ui-border-subtle)] pb-3" aria-label="Workspace context">
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="ui-resilient-text text-lg font-semibold text-[var(--text-primary)]" dir="auto">{context.label}</h1>
        {scope ? <span className="ui-resilient-text max-w-full font-data text-xs text-[var(--text-secondary)]" dir="auto">{scope}</span> : null}
      </div>
      <p className="ui-resilient-text mt-0.5 text-xs text-[var(--text-secondary)]" dir="auto">{context.description}</p>
    </div>
    {actions}
  </header>;
}
