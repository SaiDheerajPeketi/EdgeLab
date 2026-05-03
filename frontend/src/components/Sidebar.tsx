import {
  BarChart3,
  BookOpen,
  ClipboardList,
  LineChart,
  Network,
  Settings,
} from "lucide-react";

const items = [
  { label: "Overview", icon: BarChart3, active: false },
  { label: "Backtest", icon: LineChart, active: true },
  { label: "Journal", icon: ClipboardList, active: false },
  { label: "Playbook", icon: BookOpen, active: false },
  { label: "Settings", icon: Settings, active: false },
];

export function Sidebar() {
  return (
    <aside className="hidden w-[76px] shrink-0 border-r border-white/10 bg-[#05070a] px-3 py-4 text-slate-300 lg:flex lg:flex-col lg:items-center">
      <div className="mb-6 grid h-12 w-12 place-items-center rounded-md border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
          <Network size={20} />
      </div>

      <nav className="flex flex-col gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className={`group relative grid h-12 w-12 place-items-center rounded-md transition ${
                item.active
                  ? "border border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
              title={item.label}
              type="button"
            >
              <Icon size={18} />
              <span className="pointer-events-none absolute left-14 z-20 hidden rounded-md border border-white/10 bg-ink-900 px-2 py-1 text-xs text-white shadow-panel group-hover:block">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
