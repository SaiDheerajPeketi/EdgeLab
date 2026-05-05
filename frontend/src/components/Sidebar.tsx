import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Network,
  PlaySquare,
  Settings,
  Target,
  WalletCards,
} from "lucide-react";
import type { WorkspaceView } from "../lib/workspace";

type SidebarItem = {
  id: WorkspaceView;
  label: string;
  icon: typeof BarChart3;
};

type SidebarGroup = {
  children: Array<{
    id: WorkspaceView;
    label: string;
  }>;
  icon: typeof BarChart3;
  label: string;
  primaryId: WorkspaceView;
};

type SidebarEntry = SidebarItem | SidebarGroup;

const sections: Array<{
  label: "Backtesting" | "Journal";
  shortLabel: string;
  items: SidebarEntry[];
}> = [
  {
    label: "Backtesting",
    shortLabel: "BT",
    items: [
      { id: "sessions", label: "Sessions", icon: PlaySquare },
      {
        children: [
          { id: "dashboard", label: "Overview" },
          { id: "reports", label: "Metrics" },
          { id: "dayView", label: "Day View" },
          { id: "tradeView", label: "Trades" },
          { id: "notebook", label: "Notes" },
        ],
        icon: BarChart3,
        label: "Results",
        primaryId: "dashboard",
      },
      { id: "strategies", label: "Strategies", icon: Target },
      { id: "playbooks", label: "Playbooks", icon: BookOpen },
      { id: "accounts", label: "Backtest Accounts", icon: WalletCards },
      { id: "settings", label: "Backtest Settings", icon: Settings },
    ],
  },
  {
    label: "Journal",
    shortLabel: "JR",
    items: [
      { id: "journalSessions", label: "Journal Sessions", icon: PlaySquare },
      {
        children: [
          { id: "journalDashboard", label: "Overview" },
          { id: "journalReports", label: "Metrics" },
          { id: "journalDayView", label: "Day View" },
          { id: "journalTrades", label: "Trades" },
          { id: "journalNotes", label: "Notes" },
        ],
        icon: BarChart3,
        label: "Journal Results",
        primaryId: "journalDashboard",
      },
      { id: "journalStrategies", label: "Journal Strategies", icon: Target },
      { id: "journalPlaybooks", label: "Journal Playbooks", icon: BookOpen },
      { id: "journalAccounts", label: "Journal Accounts", icon: WalletCards },
      { id: "journalSettings", label: "Journal Settings", icon: Settings },
    ],
  },
];

type Props = {
  activeView: WorkspaceView;
  collapsed: boolean;
  onNavigate: (view: WorkspaceView) => void;
  onToggleCollapsed: () => void;
};

export function Sidebar({
  activeView,
  collapsed,
  onNavigate,
  onToggleCollapsed,
}: Props) {
  return (
    <aside
      className={`edge-sidebar hidden h-screen shrink-0 overflow-y-auto overscroll-contain border-r border-white/10 bg-[#05070a] px-3 py-4 text-slate-300 transition-[width] lg:sticky lg:top-0 lg:flex lg:flex-col ${
        collapsed ? "w-[76px] items-center" : "w-[244px]"
      }`}
    >
      <div
        className={`mb-5 flex w-full items-center gap-3 ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
          <Network size={20} />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black text-white">EdgeLab</div>
            <div className="truncate text-xs text-slate-500">EdgeLab workspace</div>
          </div>
        )}
        {!collapsed && (
          <button
            className="icon-button h-9 w-9 shrink-0"
            onClick={onToggleCollapsed}
            title="Collapse sidebar"
            type="button"
          >
            <ChevronLeft size={15} />
          </button>
        )}
      </div>
      {collapsed && (
        <button
          className="icon-button mb-3 h-8 w-8"
          onClick={onToggleCollapsed}
          title="Expand sidebar"
          type="button"
        >
          <ChevronRight size={15} />
        </button>
      )}

      <nav className={`flex w-full flex-col ${collapsed ? "gap-3" : "gap-4"}`}>
        {sections.map((section) => (
          <div className="w-full" key={section.label}>
            <div
              className={`mb-2 flex items-center ${
                collapsed ? "h-5" : "h-6"
              } ${
                collapsed ? "justify-center" : "justify-between px-2"
              }`}
            >
              {collapsed ? (
                <span
                  className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-black text-slate-500"
                  title={section.label}
                >
                  {section.shortLabel}
                </span>
              ) : (
                <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                  {section.label}
                </span>
              )}
            </div>
            <div className={`flex w-full flex-col ${collapsed ? "gap-1" : "gap-1.5"}`}>
              {section.items.map((item) => {
                if ("children" in item) {
                  const Icon = item.icon;
                  const active = item.children.some((child) => child.id === activeView);
                  return (
                    <div className="min-w-0" key={item.label}>
                      <button
                        className={`group relative flex items-center rounded-md transition ${
                          collapsed ? "h-9 w-10 justify-center" : "h-11 w-full justify-start gap-3 px-3"
                        } ${
                          active
                            ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                            : "text-slate-400 hover:bg-white/5 hover:text-white"
                        }`}
                        onClick={() => onNavigate(item.primaryId)}
                        title={`${section.label} / ${item.label}`}
                        type="button"
                      >
                        <Icon size={18} />
                        {!collapsed && (
                          <span className="truncate text-sm font-semibold">{item.label}</span>
                        )}
                        <span
                          className={`pointer-events-none absolute left-14 z-20 rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-xs text-white shadow-panel ${
                            collapsed ? "hidden group-hover:block" : "hidden"
                          }`}
                        >
                          {section.label} / {item.label}
                        </span>
                      </button>
                      {!collapsed && active && (
                        <div className="mt-1 grid grid-cols-2 gap-1 pl-3">
                          {item.children.map((child) => (
                            <button
                              className={`h-8 rounded border px-2 text-xs font-semibold transition ${
                                child.id === activeView
                                  ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                                  : "border-white/10 bg-white/[0.03] text-slate-500 hover:bg-white/10 hover:text-white"
                              }`}
                              key={child.id}
                              onClick={() => onNavigate(child.id)}
                              type="button"
                            >
                              {child.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                const Icon = item.icon;
                const active = item.id === activeView || (item.id === "sessions" && activeView === "backtest");
                return (
                  <button
                    key={item.label}
                    className={`group relative flex items-center rounded-md transition ${
                      collapsed ? "h-9 w-10 justify-center" : "h-11 w-full justify-start gap-3 px-3"
                    } ${
                      active
                        ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                    onClick={() => onNavigate(item.id)}
                    title={`${section.label} / ${item.label}`}
                    type="button"
                  >
                    <Icon size={18} />
                    {!collapsed && (
                      <span className="truncate text-sm font-semibold">{item.label}</span>
                    )}
                    <span
                      className={`pointer-events-none absolute left-14 z-20 rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-xs text-white shadow-panel ${
                        collapsed ? "hidden group-hover:block" : "hidden"
                      }`}
                    >
                      {section.label} / {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
