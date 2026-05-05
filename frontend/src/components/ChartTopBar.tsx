import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Bell,
  Camera,
  CandlestickChart,
  Check,
  ChevronDown,
  Columns3,
  Crosshair,
  ExternalLink,
  Eye,
  Gauge,
  Grid2X2,
  Link,
  LineChart,
  Maximize2,
  PanelLeftOpen,
  RotateCcw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  INDICATORS,
  TIMEFRAMES,
  getTimeframeSeconds,
  type ChartIndicatorId,
  type ChartStyle,
  type ChartTimeframe,
  type IndicatorSettings,
  type IndicatorSettingsMap,
} from "../lib/charting";
import { formatTradingViewSymbol } from "../lib/symbols";

type Props = {
  activeIndicators: ChartIndicatorId[];
  chartStyle: ChartStyle;
  currentTimestamp: string | null;
  indicatorSettings: IndicatorSettingsMap;
  isFullscreen: boolean;
  layoutName: string;
  onBackToSessions: () => void;
  onChartStyleChange: (style: ChartStyle) => void;
  onJumpToTimestamp: (timestamp: string) => void;
  onOpenTicket: (side: "BUY" | "SELL") => void;
  onOpenTools: () => void;
  onSaveLayout: () => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onToggleFullscreen: () => void;
  onToggleIndicator: (indicator: ChartIndicatorId) => void;
  onUpdateIndicatorSettings: (
    indicator: ChartIndicatorId,
    settings: Partial<IndicatorSettings>,
  ) => void;
  savedLabel: string | null;
  sessionLabel: string;
  sourceTimeframe: ChartTimeframe | null;
  symbol: string;
  timeframe: ChartTimeframe;
};

const CANDLE_TYPES: Array<{
  id: string;
  label: string;
  mappedStyle?: ChartStyle;
}> = [
  { id: "hlcBars", label: "HLC bars" },
  { id: "line", label: "Line", mappedStyle: "line" },
  { id: "lineMarkers", label: "Line with markers" },
  { id: "stepLine", label: "Step line" },
  { id: "area", label: "Area", mappedStyle: "area" },
  { id: "hlcArea", label: "HLC area" },
  { id: "baseline", label: "Baseline" },
  { id: "columns", label: "Columns" },
  { id: "highLow", label: "High-low" },
  { id: "candles", label: "Candlesticks", mappedStyle: "candles" },
  { id: "heikinAshi", label: "Heikin Ashi", mappedStyle: "heikinAshi" },
  { id: "renko", label: "Renko" },
  { id: "kagi", label: "Kagi" },
  { id: "lineBreak", label: "Line break" },
  { id: "pointFigure", label: "Point & figure" },
];

const INDICATOR_GROUPS: Array<{
  items: string[];
  title: string;
}> = [
  {
    title: "Moving Averages",
    items: ["SMA 200", "EMA 20", "EMA 50", "WMA 20", "DEMA 20", "TEMA 20", "HMA 20", "VWAP"],
  },
  {
    title: "Oscillators",
    items: ["RSI 14", "MACD", "Momentum 10", "Stochastic", "CCI", "Williams %R"],
  },
  {
    title: "Volume",
    items: ["Volume", "VWMA", "Volume Profile Fixed Range", "Volume Profile Visible Range", "OBV"],
  },
  {
    title: "Volatility",
    items: ["Bollinger 20", "ATR 14", "Keltner 20", "Donchian 20", "Volatility O-H-L-C"],
  },
  {
    title: "Trend",
    items: ["SuperTrend 10", "ADX", "Ichimoku Cloud", "Parabolic SAR", "Aroon"],
  },
  {
    title: "Other",
    items: ["Fractals", "Pivot Points", "Zig Zag", "Z-Score", "Vortex Indicator"],
  },
];

export function ChartTopBar({
  activeIndicators,
  chartStyle,
  currentTimestamp,
  indicatorSettings,
  isFullscreen,
  layoutName,
  onBackToSessions,
  onChartStyleChange,
  onJumpToTimestamp,
  onOpenTicket,
  onOpenTools,
  onSaveLayout,
  onTimeframeChange,
  onToggleFullscreen,
  onToggleIndicator,
  onUpdateIndicatorSettings,
  savedLabel,
  sessionLabel,
  sourceTimeframe,
  symbol,
  timeframe,
}: Props) {
  const [chartTypeOpen, setChartTypeOpen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goToOpen, setGoToOpen] = useState(false);
  const [jumpTime, setJumpTime] = useState("");
  const [quantity, setQuantity] = useState("100000");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setJumpTime(toReplayInputValue(currentTimestamp));
  }, [currentTimestamp]);

  useEffect(() => {
    function closeOnOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setChartTypeOpen(false);
        setIndicatorsOpen(false);
        setSettingsOpen(false);
        setGoToOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutside);
    return () => document.removeEventListener("mousedown", closeOnOutside);
  }, []);

  const activeStyleLabel =
    CANDLE_TYPES.find((item) => item.mappedStyle === chartStyle)?.label ?? "Candlesticks";

  return (
    <section className="tv-topbar" ref={rootRef}>
      <div className="tv-topbar-row">
        <div className="flex min-w-0 items-center gap-1.5">
          <button className="tv-icon-action" onClick={onBackToSessions} title="Back to sessions" type="button">
            <ArrowLeft size={16} />
          </button>
          <div className="tv-logo-mark">TZ</div>
          <div className="tv-timeframes">
            {TIMEFRAMES.slice(0, 7).map((interval) => {
              const unavailable = !isTimeframeAvailable(interval.id, sourceTimeframe);
              return (
                <button
                  className={`tv-timeframe ${interval.id === timeframe ? "tv-timeframe-active" : ""}`}
                  disabled={unavailable}
                  key={interval.id}
                  onClick={() => onTimeframeChange(interval.id)}
                  title={unavailable ? `Data not available from ${sourceTimeframe} source` : interval.label}
                  type="button"
                >
                  {interval.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <div className="relative">
            <button
              className="tv-toolbar-button"
              onClick={() => {
                setChartTypeOpen((value) => !value);
                setIndicatorsOpen(false);
                setSettingsOpen(false);
              }}
              type="button"
            >
              <CandlestickChart size={15} />
              {activeStyleLabel}
              <ChevronDown size={13} />
            </button>
            {chartTypeOpen && (
              <ChartTypeMenu
                activeStyle={chartStyle}
                onSelect={(style) => {
                  onChartStyleChange(style);
                  setChartTypeOpen(false);
                }}
              />
            )}
          </div>

          <button
            className="tv-toolbar-button"
            onClick={() => {
              setIndicatorsOpen(true);
              setChartTypeOpen(false);
              setSettingsOpen(false);
            }}
            type="button"
          >
            <Sparkles size={15} />
            Indicators
            {activeIndicators.length > 0 && <span className="tv-count-badge">{activeIndicators.length}</span>}
          </button>

          <button className="tv-icon-action" onClick={onOpenTools} title="Tools and layouts" type="button">
            <SlidersHorizontal size={15} />
          </button>
          <button className="tv-icon-action" title="Multi-chart layouts" type="button">
            <Grid2X2 size={15} />
          </button>

          <div className="relative">
            <button
              className="tv-toolbar-button"
              onClick={() => {
                setGoToOpen((value) => !value);
                setChartTypeOpen(false);
                setIndicatorsOpen(false);
                setSettingsOpen(false);
              }}
              type="button"
            >
              <Crosshair size={15} />
              Go to
            </button>
            {goToOpen && (
              <div className="tv-popover w-72">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                  Jump to candle
                </div>
                <input
                  className="input-control mt-3 h-10 normal-case tracking-normal"
                  onChange={(event) => setJumpTime(event.target.value)}
                  type="datetime-local"
                  value={jumpTime}
                />
                <button
                  className="control-button mt-3 w-full workspace-tab-active"
                  disabled={!jumpTime}
                  onClick={() => {
                    onJumpToTimestamp(toDatasetTimestamp(jumpTime));
                    setGoToOpen(false);
                  }}
                  type="button"
                >
                  Go to selected bar
                </button>
              </div>
            )}
          </div>

          <button className="tv-toolbar-button" type="button">
            <Eye size={15} />
            Show events
          </button>
          <button className="tv-icon-action" title="Undo" type="button">
            <RotateCcw size={15} />
          </button>
          <button className="tv-toolbar-button" onClick={onSaveLayout} type="button">
            <Save size={15} />
            {savedLabel ?? "Autosaved"}
          </button>
          <button className="tv-icon-action" title="Share link" type="button">
            <Link size={15} />
          </button>
          <button className="tv-icon-action" title="Snapshot" type="button">
            <Camera size={15} />
          </button>
          <button
            className="tv-icon-action"
            onClick={() => {
              setSettingsOpen(true);
              setChartTypeOpen(false);
              setIndicatorsOpen(false);
            }}
            title="Chart settings"
            type="button"
          >
            <Settings size={15} />
          </button>
          <button className="tv-icon-action" onClick={onToggleFullscreen} title="Fullscreen" type="button">
            <Maximize2 size={15} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden min-w-0 max-w-56 text-right xl:block">
            <div className="truncate text-xs font-semibold text-white">
              {formatTradingViewSymbol(symbol)}
            </div>
            <div className="truncate text-[11px] text-slate-500">{sessionLabel}</div>
          </div>
          <input
            aria-label="Order quantity"
            className="tv-qty-input"
            onChange={(event) => setQuantity(event.target.value)}
            title="Quick ticket quantity"
            value={quantity}
          />
          <button className="tv-buy-button" onClick={() => onOpenTicket("BUY")} type="button">
            Buy
          </button>
          <button className="tv-sell-button" onClick={() => onOpenTicket("SELL")} type="button">
            Sell
          </button>
        </div>
      </div>

      {indicatorsOpen && (
        <IndicatorsModal
          activeIndicators={activeIndicators}
          indicatorSettings={indicatorSettings}
          onClose={() => setIndicatorsOpen(false)}
          onToggleIndicator={onToggleIndicator}
          onUpdateIndicatorSettings={onUpdateIndicatorSettings}
        />
      )}

      {settingsOpen && (
        <ChartSettingsModal
          isFullscreen={isFullscreen}
          layoutName={layoutName}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </section>
  );
}

function ChartTypeMenu({
  activeStyle,
  onSelect,
}: {
  activeStyle: ChartStyle;
  onSelect: (style: ChartStyle) => void;
}) {
  return (
    <div className="tv-popover w-64 p-1">
      {CANDLE_TYPES.map((item) => {
        const active = item.mappedStyle === activeStyle;
        const disabled = !item.mappedStyle;
        return (
          <button
            className={`tv-menu-row ${active ? "tv-menu-row-active" : ""}`}
            disabled={disabled}
            key={item.id}
            onClick={() => item.mappedStyle && onSelect(item.mappedStyle)}
            title={disabled ? "Coming soon" : item.label}
            type="button"
          >
            {active ? <Check size={14} /> : <ChartTypeIcon id={item.id} />}
            <span>{item.label}</span>
            {disabled && <span className="ml-auto text-[10px] uppercase text-slate-600">Soon</span>}
          </button>
        );
      })}
    </div>
  );
}

function IndicatorsModal({
  activeIndicators,
  indicatorSettings,
  onClose,
  onToggleIndicator,
  onUpdateIndicatorSettings,
}: {
  activeIndicators: ChartIndicatorId[];
  indicatorSettings: IndicatorSettingsMap;
  onClose: () => void;
  onToggleIndicator: (indicator: ChartIndicatorId) => void;
  onUpdateIndicatorSettings: (
    indicator: ChartIndicatorId,
    settings: Partial<IndicatorSettings>,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const availableByLabel = useMemo(
    () => new Map(INDICATORS.map((indicator) => [indicator.label.toLowerCase(), indicator])),
    [],
  );
  const normalizedQuery = query.trim().toLowerCase();

  return (
    <div className="tv-modal-backdrop">
      <div className="tv-indicators-modal">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              Indicators, Metrics & Strategies
            </div>
            <h2 className="mt-1 text-lg font-semibold text-white">Indicator Library</h2>
          </div>
          <button className="icon-button h-8 w-8" onClick={onClose} type="button">
            <X size={15} />
          </button>
        </div>
        <div className="border-b border-white/10 p-3">
          <div className="flex h-10 items-center gap-2 rounded-md border border-cyan-300/20 bg-black/30 px-3">
            <Search size={15} className="text-cyan-200" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search SMA, RSI, MACD, SuperTrend..."
              value={query}
            />
          </div>
        </div>
        <div className="grid max-h-[68vh] gap-3 overflow-auto p-3 md:grid-cols-2">
          {INDICATOR_GROUPS.map((group) => {
            const visibleItems = group.items.filter((label) =>
              normalizedQuery
                ? `${group.title} ${label}`.toLowerCase().includes(normalizedQuery)
                : true,
            );
            if (visibleItems.length === 0) {
              return null;
            }
            return (
              <section className="rounded-md border border-white/10 bg-black/20 p-2" key={group.title}>
                <div className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                  {group.title}
                </div>
                <div className="grid gap-1">
                  {visibleItems.map((label) => {
                    const indicator = availableByLabel.get(label.toLowerCase());
                    const active = indicator ? activeIndicators.includes(indicator.id) : false;
                    const settings = indicator ? indicatorSettings[indicator.id] : null;
                    return (
                      <button
                        className={`tv-indicator-row ${active ? "tv-indicator-row-active" : ""}`}
                        disabled={!indicator}
                        key={label}
                        onClick={() => indicator && onToggleIndicator(indicator.id)}
                        title={indicator ? indicator.description : "Coming soon"}
                        type="button"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: settings?.color ?? "rgba(148, 163, 184, 0.35)",
                          }}
                        />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm font-semibold text-slate-100">
                            {label}
                          </span>
                          <span className="block truncate text-xs text-slate-500">
                            {indicator?.description ?? "Catalog placeholder"}
                          </span>
                        </span>
                        {indicator ? (
                          <span className={active ? "text-cyan-100" : "text-slate-500"}>
                            {active ? "Remove" : "Add"}
                          </span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-[0.12em] text-slate-600">
                            Soon
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        {activeIndicators.length > 0 && (
          <div className="border-t border-white/10 p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Active studies
            </div>
            <div className="flex flex-wrap gap-2">
              {activeIndicators.map((id) => {
                const indicator = INDICATORS.find((item) => item.id === id);
                const settings = indicatorSettings[id];
                return (
                  <div className="study-chip" key={id}>
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: settings.color }}
                    />
                    <span>{indicator?.label ?? id}</span>
                    {id !== "vwap" && (
                      <input
                        className="h-6 w-12 rounded border border-white/10 bg-ink-950 px-1 text-xs text-slate-100"
                        min={1}
                        onChange={(event) =>
                          onUpdateIndicatorSettings(id, {
                            period: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                        type="number"
                        value={settings.period}
                      />
                    )}
                    <input
                      className="h-6 w-7 cursor-pointer rounded border border-white/10 bg-ink-950 p-0.5"
                      onChange={(event) => onUpdateIndicatorSettings(id, { color: event.target.value })}
                      type="color"
                      value={settings.color}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartSettingsModal({
  isFullscreen,
  layoutName,
  onClose,
}: {
  isFullscreen: boolean;
  layoutName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"canvas" | "scales" | "status" | "symbol">("scales");

  return (
    <div className="tv-modal-backdrop">
      <div className="tv-settings-modal">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              Chart Settings
            </div>
            <h2 className="mt-1 text-lg font-semibold text-white">Layout: {layoutName}</h2>
          </div>
          <button className="icon-button h-8 w-8" onClick={onClose} type="button">
            <X size={15} />
          </button>
        </div>
        <div className="grid min-h-[420px] md:grid-cols-[190px_minmax(0,1fr)]">
          <aside className="border-b border-white/10 p-2 md:border-b-0 md:border-r">
            {[
              ["symbol", "Symbol"],
              ["status", "Status line"],
              ["scales", "Scales and lines"],
              ["canvas", "Canvas"],
            ].map(([id, label]) => (
              <button
                className={`tv-settings-tab ${tab === id ? "tv-settings-tab-active" : ""}`}
                key={id}
                onClick={() => setTab(id as typeof tab)}
                type="button"
              >
                {label}
              </button>
            ))}
          </aside>
          <div className="grid content-start gap-4 p-4">
            {tab === "scales" && (
              <>
                <SettingsSection title="Price scale">
                  <SettingsRow label="Scale modes">
                    <select className="input-control h-9 max-w-56 normal-case tracking-normal" defaultValue="Visible on mouse over">
                      <option>Visible on mouse over</option>
                      <option>Always visible</option>
                      <option>Hidden</option>
                    </select>
                  </SettingsRow>
                  <SettingsRow label="Lock price to bar ratio">
                    <input type="checkbox" />
                  </SettingsRow>
                  <SettingsRow label="Scales placement">
                    <select className="input-control h-9 max-w-40 normal-case tracking-normal" defaultValue="Auto">
                      <option>Auto</option>
                      <option>Right</option>
                      <option>Left</option>
                    </select>
                  </SettingsRow>
                </SettingsSection>
                <SettingsSection title="Price labels & lines">
                  <SettingsRow label="No overlapping labels">
                    <input defaultChecked type="checkbox" />
                  </SettingsRow>
                  <SettingsRow label="Plus button">
                    <input defaultChecked type="checkbox" />
                  </SettingsRow>
                  <SettingsRow label="Countdown to bar close">
                    <input type="checkbox" />
                  </SettingsRow>
                  <SettingsRow label="Symbol">
                    <select className="input-control h-9 max-w-48 normal-case tracking-normal" defaultValue="Value, line">
                      <option>Value, line</option>
                      <option>Value only</option>
                      <option>Line only</option>
                    </select>
                  </SettingsRow>
                </SettingsSection>
              </>
            )}
            {tab === "symbol" && (
              <SettingsSection title="Symbol">
                <SettingsRow label="Body colors">
                  <div className="flex gap-2">
                    <input type="color" defaultValue="#22c55e" />
                    <input type="color" defaultValue="#fb7185" />
                  </div>
                </SettingsRow>
                <SettingsRow label="Precision">
                  <span className="status-pill">5 decimals minimum</span>
                </SettingsRow>
              </SettingsSection>
            )}
            {tab === "status" && (
              <SettingsSection title="Status line">
                <SettingsRow label="OHLC values">
                  <input defaultChecked type="checkbox" />
                </SettingsRow>
                <SettingsRow label="Indicator values">
                  <input defaultChecked type="checkbox" />
                </SettingsRow>
                <SettingsRow label="Fullscreen">
                  <span className="status-pill">{isFullscreen ? "Active" : "Windowed"}</span>
                </SettingsRow>
              </SettingsSection>
            )}
            {tab === "canvas" && (
              <SettingsSection title="Canvas">
                <SettingsRow label="Background">
                  <input type="color" defaultValue="#0d1117" />
                </SettingsRow>
                <SettingsRow label="Grid opacity">
                  <input className="w-44 accent-cyan-300" defaultValue={8} max={40} min={0} type="range" />
                </SettingsRow>
              </SettingsSection>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 p-3">
          <button className="control-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="control-button workspace-tab-active" onClick={onClose} type="button">
            Ok
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function SettingsRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="flex min-h-9 items-center justify-between gap-4 text-sm text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ChartTypeIcon({ id }: { id: string }) {
  const icons: Record<string, LucideIcon> = {
    area: Gauge,
    baseline: LineChart,
    candles: CandlestickChart,
    columns: Columns3,
    heikinAshi: CandlestickChart,
    line: LineChart,
    lineMarkers: Sparkles,
  };
  const Icon = icons[id] ?? LineChart;
  return <Icon size={14} />;
}

function isTimeframeAvailable(
  timeframe: ChartTimeframe,
  sourceTimeframe: ChartTimeframe | null,
) {
  return (
    sourceTimeframe == null ||
    getTimeframeSeconds(timeframe) >= getTimeframeSeconds(sourceTimeframe)
  );
}

function toReplayInputValue(value: string | null) {
  if (!value) {
    return "";
  }
  const normalized = value.trim().replace(" ", "T");
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : "";
}

function toDatasetTimestamp(value: string) {
  return value.length === 16 ? `${value}:00` : value;
}
