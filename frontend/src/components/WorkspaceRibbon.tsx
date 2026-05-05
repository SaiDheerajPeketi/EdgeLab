import {
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  LineChart,
  PlaySquare,
  Settings,
  Target,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkspaceView } from "../lib/workspace";
import { formatMoney } from "../lib/format";

type Props = {
  activeView: WorkspaceView;
  balance: number;
  isPlaying: boolean;
  onNavigate: (view: WorkspaceView) => void;
  tradeCount: number;
};

const items: Array<{
  id: WorkspaceView;
  icon: LucideIcon;
  label: string;
}> = [
  { id: "sessions", icon: PlaySquare, label: "Sessions" },
  { id: "backtest", icon: LineChart, label: "Backtest" },
  { id: "dashboard", icon: BarChart3, label: "Dashboard" },
  { id: "dayView", icon: CalendarDays, label: "Day View" },
  { id: "tradeView", icon: ClipboardList, label: "Trade View" },
  { id: "notebook", icon: BookOpen, label: "Notebook" },
  { id: "reports", icon: BadgeDollarSign, label: "Reports" },
  { id: "strategies", icon: Target, label: "Strategies" },
  { id: "accounts", icon: WalletCards, label: "Accounts" },
  { id: "settings", icon: Settings, label: "Settings" },
];

export function WorkspaceRibbon({
  activeView,
  balance,
  isPlaying,
  onNavigate,
  tradeCount,
}: Props) {
  return (
    <section className="workspace-ribbon">
      <div className="flex min-w-0 items-center gap-2">
        <div className="workspace-ribbon-mark">TZ</div>
        <div className="hidden min-w-0 sm:block">
          <div className="truncate text-sm font-black text-white">TradeZella Workbench</div>
          <div className="truncate text-xs text-slate-500">
            {isPlaying ? "Replay running" : `${tradeCount} closed trades journaled`}
          </div>
        </div>
      </div>

      <nav className="workspace-ribbon-tabs" aria-label="Workspace views">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeView;
          return (
            <button
              className={`workspace-ribbon-tab ${active ? "workspace-ribbon-tab-active" : ""}`}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <Icon size={15} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="workspace-ribbon-balance">
        <span>Balance</span>
        <strong>{formatMoney(balance)}</strong>
      </div>
    </section>
  );
}

