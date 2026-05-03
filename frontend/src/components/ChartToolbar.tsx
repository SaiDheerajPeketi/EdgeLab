import {
  BarChart2,
  CandlestickChart,
  Crosshair,
  Layers,
  Magnet,
  MousePointer2,
  Ruler,
  Save,
  Settings2,
} from "lucide-react";
import type { ReactNode } from "react";

const intervals = ["1m", "5m", "15m", "1H", "4H", "1D"];

export function ChartToolbar() {
  return (
    <section className="terminal-panel mb-2 flex min-h-11 flex-wrap items-center justify-between gap-2 px-2 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <IconButton title="Cursor">
          <MousePointer2 size={16} />
        </IconButton>
        <IconButton title="Crosshair">
          <Crosshair size={16} />
        </IconButton>
        <IconButton title="Magnet">
          <Magnet size={16} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-white/10" />
        <IconButton title="Candles" active>
          <CandlestickChart size={16} />
        </IconButton>
        <IconButton title="Bars">
          <BarChart2 size={16} />
        </IconButton>
        <IconButton title="Measure">
          <Ruler size={16} />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {intervals.map((interval) => (
          <button
            className={`chart-tool-button px-2 text-xs ${interval === "1m" ? "chart-tool-active" : ""}`}
            key={interval}
            type="button"
          >
            {interval}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <IconButton title="Indicators">
          <Layers size={16} />
        </IconButton>
        <IconButton title="Settings">
          <Settings2 size={16} />
        </IconButton>
        <IconButton title="Save layout">
          <Save size={16} />
        </IconButton>
      </div>
    </section>
  );
}

function IconButton({
  children,
  title,
  active = false,
}: {
  children: ReactNode;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      className={`chart-tool-button ${active ? "chart-tool-active" : ""}`}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
