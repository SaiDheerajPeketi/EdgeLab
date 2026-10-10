import { Command, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import type { WorkspaceView } from "../lib/workspace";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  WORKSPACE_NAVIGATION_SECTIONS,
  isWorkspaceNavigationItem,
  workspaceNavigationEntryIsActive,
  workspaceNavigationItemIsActive,
} from "../lib/workspaceNavigation";
import { AccountSystemMenu } from "./AccountSystemMenu";
import { EdgeLabMark, EdgeLabWordmark } from "./brand/EdgeLabBrand";
import { IconButton } from "./ui/Primitives";

const SIDEBAR_ICON_SIZE = 18;

type Props = {
  activeView: WorkspaceView;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onNavigate: (view: WorkspaceView) => void;
};

function sidebarItemClass(collapsed: boolean, active: boolean) {
  return `group relative flex min-h-11 items-center rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${
    collapsed ? "w-11 justify-center" : "w-full gap-3 px-3 text-left"
  } ${
    active
      ? "bg-[var(--ui-navigation-active)] font-semibold text-[var(--text-primary)] ring-1 ring-inset ring-[var(--ui-border-strong)]"
      : "text-[var(--text-secondary)] hover:bg-[var(--ui-navigation-hover)] hover:text-[var(--text-primary)]"
  }`;
}

export function Sidebar({
  activeView,
  collapsed,
  onCollapsedChange,
  onNavigate,
}: Props) {
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [focusExpanded, setFocusExpanded] = useState(false);
  const compact = collapsed && !hoverExpanded && !focusExpanded;

  return (
    <aside
      aria-label="Workspace navigation"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHoverExpanded(true); }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") setHoverExpanded(false); }}
      onFocusCapture={(event) => { if (event.target.matches(":focus-visible")) setFocusExpanded(true); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusExpanded(false); }}
      className={`edge-sidebar fixed inset-y-0 left-0 z-40 hidden h-screen shrink-0 border-r border-[var(--ui-divider)] bg-[var(--ui-navigation)] text-[var(--text-secondary)] transition-[width] duration-[var(--motion-app-base)] ease-el-out lg:flex lg:flex-col ${
        compact ? "items-center px-4 py-4" : "px-4 py-4"
      }`}
      style={{ width: compact ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH }}
    >
      <div className={`flex w-full ${compact ? "flex-col items-center gap-2" : "h-12 items-center justify-between gap-3"}`}>
        <div className={`flex min-w-0 ${compact ? "h-12 w-full items-center justify-center" : "flex-1"}`}>
          {compact ? (
            <div
              className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] border border-[var(--ui-border-strong)] bg-[var(--ui-selection)] text-[var(--text-primary)] outline-none transition hover:bg-[var(--ui-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"
              title="EdgeLab"
            >
              <EdgeLabMark className="h-8 w-8" />
            </div>
          ) : (
            <EdgeLabWordmark markFrame="bare" showTagline={false} size="sm" />
          )}
        </div>
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? (compact ? "Expand workspace navigation" : "Keep workspace navigation expanded") : "Collapse workspace navigation"}
          className="h-11 w-11 shrink-0"
          onClick={() => onCollapsedChange(!collapsed)}
        />
      </div>

      <nav aria-label="Trading workspace" className="mt-4 min-h-0 w-full flex-1 overflow-y-auto overscroll-contain">
        <div className="flex w-full flex-col gap-5 pb-4">
          {WORKSPACE_NAVIGATION_SECTIONS.filter((section) => section.sidebar).map((section) => (
            <section className="w-full" key={section.label}>
              <h2
                className={`mb-2 flex min-h-5 items-center text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)] ${
                  compact ? "justify-center" : "px-3"
                }`}
                title={compact ? section.label : undefined}
              >
                {compact ? section.shortLabel : section.label}
              </h2>
              <div className="grid gap-1">
                {section.entries.map((entry) => {
                  const active = workspaceNavigationEntryIsActive(entry, activeView);
                  if (!isWorkspaceNavigationItem(entry)) {
                    const Icon = entry.icon;
                    return (
                      <div className="min-w-0" key={entry.label}>
                        <button
                          aria-current={active ? "page" : undefined}
                          aria-label={compact ? `${section.label}: ${entry.label}` : undefined}
                          className={sidebarItemClass(compact, active)}
                          onClick={() => onNavigate(entry.primaryId)}
                          title={compact ? entry.label : undefined}
                          type="button"
                        >
                          <span className="grid h-5 w-5 shrink-0 place-items-center">
                            <Icon aria-hidden="true" size={SIDEBAR_ICON_SIZE} />
                          </span>
                          {!compact ? <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span> : null}
                        </button>
                        {!compact && active ? (
                          <div className="mt-1 grid grid-cols-2 gap-1 pl-3">
                            {entry.children.map((child) => {
                              const childActive = workspaceNavigationItemIsActive(child.id, activeView);
                              return (
                                <button
                                  aria-current={childActive ? "page" : undefined}
                                  className={`flex min-h-9 items-center justify-between gap-2 rounded-lg px-3 text-left text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${
                                    childActive
                                      ? "bg-[var(--ui-navigation-active)] font-semibold text-[var(--text-primary)]"
                                      : "text-[var(--text-secondary)] hover:bg-[var(--ui-navigation-hover)] hover:text-[var(--text-primary)]"
                                  }`}
                                  key={child.id}
                                  onClick={() => onNavigate(child.id)}
                                  type="button"
                                >
                                  <span className="truncate">{child.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  const Icon = entry.icon;
                  return (
                    <button
                      aria-current={active ? "page" : undefined}
                      aria-label={compact ? `${section.label}: ${entry.label}` : undefined}
                      className={sidebarItemClass(compact, active)}
                      key={entry.id}
                      onClick={() => onNavigate(entry.id)}
                      title={compact ? `${entry.label} — ${entry.description}` : undefined}
                      type="button"
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center">
                        <Icon aria-hidden="true" size={SIDEBAR_ICON_SIZE} />
                      </span>
                      {!compact ? <span className="min-w-0 flex-1 truncate text-sm">{entry.label}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className="w-full border-t border-[var(--ui-divider)] pt-3">
        <button
          aria-label={compact ? "Open command palette" : undefined}
          className={`${sidebarItemClass(compact, false)} mb-2`}
          onClick={() => window.dispatchEvent(new Event("edgelab:open-command-palette"))}
          title={compact ? "Open command palette" : undefined}
          type="button"
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center">
            <Command aria-hidden="true" size={SIDEBAR_ICON_SIZE} />
          </span>
          {!compact ? <><span className="min-w-0 flex-1 truncate text-sm">Commands</span><kbd className="text-[10px] text-[var(--text-muted)]">⌘K</kbd></> : null}
        </button>
        <AccountSystemMenu collapsed={compact} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}
