import {
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  LineChart,
  Network,
  PlaySquare,
  Settings,
  Target,
  WalletCards,
} from "lucide-react";
import type { WorkspaceView } from "../lib/workspace";

const items: Array<{
  id: WorkspaceView;
  label: string;
  icon: typeof BarChart3;
}> = [
  { id: "sessions", label: "Sessions", icon: PlaySquare },
  { id: "backtest", label: "Backtest", icon: LineChart },
  { id: "dashboard", label: "Dashboard", icon: BarChart3 },
  { id: "dayView", label: "Day View", icon: CalendarDays },
  { id: "tradeView", label: "Trade View", icon: ClipboardList },
  { id: "notebook", label: "Notebook", icon: BookOpen },
  { id: "reports", label: "Reports", icon: BadgeDollarSign },
  { id: "strategies", label: "Strategies", icon: Target },
  { id: "accounts", label: "Accounts", icon: WalletCards },
  { id: "settings", label: "Settings", icon: Settings },
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
      className={`hidden shrink-0 border-r border-white/10 bg-[#05070a] px-3 py-4 text-slate-300 transition-[width] lg:flex lg:flex-col ${
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
            <div className="truncate text-sm font-black text-white">Backtest Lab</div>
            <div className="truncate text-xs text-slate-500">TradeZella workspace</div>
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
          className="icon-button mb-4 h-9 w-9"
          onClick={onToggleCollapsed}
          title="Expand sidebar"
          type="button"
        >
          <ChevronRight size={15} />
        </button>
      )}

      <nav className="flex w-full flex-col gap-1.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeView;
          return (
            <button
              key={item.label}
              className={`group relative flex h-11 items-center rounded-md transition ${
                collapsed ? "w-12 justify-center" : "w-full justify-start gap-3 px-3"
              } ${
                active
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
              onClick={() => onNavigate(item.id)}
              title={item.label}
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
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
