import {
  Activity,
  AreaChart,
  ArrowDown,
  ArrowUp,
  CandlestickChart,
  Camera,
  Check,
  ChevronDown,
  Command,
  Eye,
  EyeOff,
  Globe2,
  Layers,
  LineChart,
  Magnet,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  TvCrosshairIcon,
  TvCursorIcon,
  TvFibIcon,
  TvHorizontalLineIcon,
  TvLongPositionIcon,
  TvMeasureIcon,
  TvRectangleIcon,
  TvShortPositionIcon,
  TvTextIcon,
  TvTrendLineIcon,
  TvVerticalLineIcon,
  type ChartToolIcon,
} from "./ChartToolIcons";
import {
  canAggregateTimeframe,
  formatChartTimeframeLabel,
  INDICATORS,
  TIMEFRAMES,
  getTimeframeSeconds,
  indicatorDisplayName,
  normalizeChartTimeframe,
  type ChartIndicatorInstance,
  type ChartIndicatorKind,
  type ChartStyle,
  type ChartTimeframe,
  type DrawingTool,
  type IndicatorSettings,
  type MagnetMode,
} from "../lib/charting";
import {
  deleteChartSettingsPreset,
  hydrateChartSettingsPresets,
  loadActiveChartSettingsPresetName,
  loadChartSettingsPresets,
  normalizeChartSettingsPresetName,
  persistActiveChartSettingsPresetName,
  saveChartSettingsPreset,
  subscribeChartSettingsPresets,
  type ChartLineStyle,
  type ChartSettingsPreset,
  type ChartVisualSettings,
} from "../lib/chartSettings";
import {
  CHART_PANE_LAYOUTS,
  type ChartPaneLayoutDefinition,
  type ChartPaneLayoutId,
} from "../lib/chartLayouts";
import type { ChartCaptureStatus } from "../lib/chartCapture";
import {
  hydrateDrawingToolFavorites,
  isFavoriteDrawingTool,
  loadCachedDrawingToolFavorites,
  MAX_DRAWING_TOOL_FAVORITES,
  moveDrawingToolFavorite,
  persistDrawingToolFavorites,
  sanitizeDrawingToolFavorites,
  subscribeDrawingToolFavorites,
  toggleDrawingToolFavorite,
  type FavoriteDrawingTool,
} from "../lib/drawingToolFavorites";
import {
  INDICATOR_CATALOG,
  getIndicatorCatalogItem,
  isSingleInstanceIndicator,
} from "../lib/indicatorCatalog";
import {
  hydrateIndicatorFavorites,
  loadCachedIndicatorFavorites,
  persistIndicatorFavorites,
  sanitizeIndicatorFavorites,
  subscribeIndicatorFavorites,
  toggleIndicatorFavorite,
  type FavoriteIndicator,
} from "../lib/indicatorFavorites";
import {
  CHART_TIMEZONES,
  getChartTimeZoneLabel,
  searchChartTimeZones,
  type ChartTimeZone,
} from "../lib/chartTimezones";
import { IndicatorCatalogPanel } from "./IndicatorCatalogPanel";
import { ThemedColorPicker } from "./ThemedColorPicker";
import { ThemedSelect } from "./ThemedSelect";

type Props = {
  activePaneLabel: string;
  captureMessage?: string;
  captureStatus?: ChartCaptureStatus;
  chartSettings: ChartVisualSettings;
  chartStyle: ChartStyle;
  clearableDrawingsCount: number;
  drawingTool: DrawingTool;
  drawingsCount: number;
  indicatorInstances: ChartIndicatorInstance[];
  keepDrawingAfterPlacement?: boolean;
  layoutName: string;
  layoutNames: string[];
  magnetMode: MagnetMode;
  onAddIndicator: (kind: ChartIndicatorKind) => void;
  onCaptureChart?: () => void;
  onChartSettingsChange: (settings: ChartVisualSettings) => void;
  onChartSettingsReset: () => void;
  onClearDrawings: () => void;
  onChartStyleChange: (style: ChartStyle) => void;
  onDeleteLayout: (name: string) => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onLayoutNameChange: (name: string) => void;
  onKeepDrawingAfterPlacementChange?: (value: boolean) => void;
  onLoadLayout: (name: string) => void;
  onMagnetModeChange: (mode: MagnetMode) => void;
  onPaneLayoutChange: (layout: ChartPaneLayoutId) => void;
  onReplayTimeframeChange: (timeframe: ChartTimeframe) => void;
  onSaveLayout: () => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onRemoveIndicator: (instanceId: string) => void;
  onToggleOrderOverlays: () => void;
  onSmoothCandlesChange: (value: boolean) => void;
  onUpdateIndicatorSettings: (
    instanceId: string,
    settings: Partial<IndicatorSettings>,
  ) => void;
  onSettingsClose?: () => void;
  onShowDrawingRailChange?: (value: boolean) => void;
  orderOverlaysVisible: boolean;
  paneLayout: ChartPaneLayoutId;
  replayTimeframe: ChartTimeframe;
  replayTimeframeOptions: Array<{
    label: string;
    sublabel?: string;
    value: ChartTimeframe;
  }>;
  savedLabel: string | null;
  settingsOpenSignal?: number;
  showDrawingRail?: boolean;
  smoothCandles: boolean;
  sourceTimeframe: ChartTimeframe | null;
  timeframe: ChartTimeframe;
  toolsOpen?: boolean;
};

const FALLBACK_SETTING: IndicatorSettings = {
  color: "#32d3ee",
  period: 20,
};

const DRAWING_TOOLS: Array<{
  icon: ChartToolIcon;
  label: string;
  shortcut?: string;
  tool: DrawingTool;
}> = [
  { icon: TvCursorIcon, label: "Select", tool: "cursor" },
  { icon: TvCrosshairIcon, label: "Inspect", tool: "crosshair" },
  { icon: TvTrendLineIcon, label: "Trend", shortcut: "T", tool: "trendline" },
  { icon: TvHorizontalLineIcon, label: "H-Line", shortcut: "H", tool: "horizontal" },
  { icon: TvVerticalLineIcon, label: "V-Line", shortcut: "V", tool: "vertical" },
  { icon: TvRectangleIcon, label: "Zone", shortcut: "R", tool: "rectangle" },
  { icon: TvFibIcon, label: "Fib", shortcut: "F", tool: "fib" },
  { icon: TvMeasureIcon, label: "Measure", shortcut: "M", tool: "measure" },
  { icon: TvLongPositionIcon, label: "Long", tool: "longPosition" },
  { icon: TvShortPositionIcon, label: "Short", tool: "shortPosition" },
  { icon: TvTextIcon, label: "Text", shortcut: "L", tool: "text" },
];

const MAGNET_MODES: Array<{
  description: string;
  id: MagnetMode;
  label: string;
}> = [
  {
    description: "Freehand drawing anchors",
    id: "off",
    label: "Off",
  },
  {
    description: "Snap only near candle OHLC",
    id: "weak",
    label: "Weak",
  },
  {
    description: "Always snap to nearest candle OHLC",
    id: "strong",
    label: "Strong",
  },
];

const CHART_STYLES: Array<{
  icon: LucideIcon;
  id: ChartStyle;
  label: string;
}> = [
  { icon: CandlestickChart, id: "candles", label: "Candles" },
  { icon: Activity, id: "heikinAshi", label: "Heikin Ashi" },
  { icon: LineChart, id: "line", label: "Line" },
  { icon: AreaChart, id: "area", label: "Area" },
];

function ChartPaneLayoutGlyph({ layout }: { layout: ChartPaneLayoutDefinition }) {
  return (
    <span
      aria-hidden="true"
      className="chart-pane-layout-glyph"
      style={{
        gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: layout.panes }, (_, index) => (
        <span key={index} />
      ))}
    </span>
  );
}

export function ChartToolbar({
  activePaneLabel,
  captureMessage = "",
  captureStatus = "idle",
  chartSettings,
  chartStyle,
  clearableDrawingsCount,
  drawingTool,
  drawingsCount,
  indicatorInstances,
  keepDrawingAfterPlacement = false,
  layoutName,
  layoutNames,
  magnetMode,
  onAddIndicator,
  onCaptureChart,
  onChartSettingsChange,
  onChartSettingsReset,
  onChartStyleChange,
  onClearDrawings,
  onDeleteLayout,
  onDrawingToolChange,
  onLayoutNameChange,
  onKeepDrawingAfterPlacementChange,
  onLoadLayout,
  onMagnetModeChange,
  onPaneLayoutChange,
  onReplayTimeframeChange,
  onSaveLayout,
  onTimeframeChange,
  onRemoveIndicator,
  onToggleOrderOverlays,
  onSmoothCandlesChange,
  onUpdateIndicatorSettings,
  onSettingsClose,
  onShowDrawingRailChange,
  orderOverlaysVisible,
  paneLayout,
  replayTimeframe,
  replayTimeframeOptions,
  savedLabel,
  settingsOpenSignal = 0,
  showDrawingRail = true,
  sourceTimeframe,
  timeframe,
  toolsOpen = true,
}: Props) {
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false);
  const [indicatorFavorites, setIndicatorFavorites] = useState<FavoriteIndicator[]>(() =>
    loadCachedIndicatorFavorites(),
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [customTimeframe, setCustomTimeframe] = useState("");
  const [drawingFavoritesOpen, setDrawingFavoritesOpen] = useState(false);
  const [drawingFavorites, setDrawingFavorites] = useState<FavoriteDrawingTool[]>(() =>
    loadCachedDrawingToolFavorites(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPresets, setSettingsPresets] = useState<ChartSettingsPreset[]>(() =>
    loadChartSettingsPresets(),
  );
  const [settingsPresetName, setSettingsPresetName] = useState(() => {
    const presets = loadChartSettingsPresets();
    return loadActiveChartSettingsPresetName(presets) ?? "Default";
  });
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const indicatorCatalogId = useId();
  const commandRef = useRef<HTMLDivElement | null>(null);
  const drawingFavoritesRef = useRef<HTMLDivElement | null>(null);
  const drawingFavoritesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const indicatorMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const settingsWasOpenRef = useRef(false);
  const normalizedCustomTimeframe = normalizeChartTimeframe(customTimeframe);
  const customTimeframeAvailable =
    normalizedCustomTimeframe != null &&
    isTimeframeAvailable(normalizedCustomTimeframe, sourceTimeframe);
  const customTimeframeTitle =
    customTimeframe.trim().length === 0
      ? "Enter a custom interval"
      : normalizedCustomTimeframe == null
        ? "Use formats like 2m, 10m, 3H, 2D, or 2W"
        : customTimeframeAvailable
          ? `Switch to ${formatChartTimeframeLabel(normalizedCustomTimeframe)}`
          : `Cannot build ${formatChartTimeframeLabel(normalizedCustomTimeframe)} from ${sourceTimeframe} source`;
  const favoriteDrawingToolOptions = [
    ...drawingFavorites.flatMap((tool) => {
      const option = DRAWING_TOOLS.find((item) => item.tool === tool);
      return option ? [option] : [];
    }),
    ...DRAWING_TOOLS.filter(
      (item) =>
        isFavoriteDrawingTool(item.tool) &&
        !drawingFavorites.includes(item.tool as FavoriteDrawingTool),
    ),
  ];
  const favoriteIndicatorOptions = indicatorFavorites.flatMap((kind) => {
    const indicator = getIndicatorCatalogItem(kind);
    return indicator ? [indicator] : [];
  });

  const closeIndicatorMenu = useCallback((restoreFocus = false) => {
    setIndicatorMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => indicatorMenuTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (TIMEFRAMES.some((interval) => interval.id === timeframe)) {
      return;
    }
    setCustomTimeframe(formatChartTimeframeLabel(timeframe));
  }, [timeframe]);

  function selectChartStyle(style: ChartStyle) {
    onChartStyleChange(style);
    onSmoothCandlesChange(style === "heikinAshi");
  }

  function applyCustomTimeframe() {
    if (!normalizedCustomTimeframe || !customTimeframeAvailable) {
      return;
    }
    onTimeframeChange(normalizedCustomTimeframe);
  }

  function refreshSettingsPresets(preferredName?: string | null) {
    const nextPresets = loadChartSettingsPresets();
    const nextName =
      preferredName && nextPresets.some((preset) => preset.name === preferredName)
        ? preferredName
        : loadActiveChartSettingsPresetName(nextPresets) ?? "Default";
    setSettingsPresets(nextPresets);
    setSettingsPresetName(nextName);
    return nextPresets;
  }

  useEffect(() => {
    let active = true;
    void hydrateChartSettingsPresets().then((nextPresets) => {
      if (!active) {
        return;
      }
      const nextName = loadActiveChartSettingsPresetName(nextPresets) ?? "Default";
      setSettingsPresets(nextPresets);
      setSettingsPresetName(nextName);
    });
    const unsubscribe = subscribeChartSettingsPresets((nextPresets) => {
      const nextName = loadActiveChartSettingsPresetName(nextPresets) ?? "Default";
      setSettingsPresets(nextPresets);
      setSettingsPresetName((current) =>
        nextPresets.some((preset) => preset.name === current) ? current : nextName,
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void hydrateIndicatorFavorites().then((value) => {
      if (active) {
        setIndicatorFavorites(value);
      }
    });
    const unsubscribe = subscribeIndicatorFavorites((value) => {
      if (active) {
        setIndicatorFavorites(value);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void hydrateDrawingToolFavorites().then((value) => {
      if (active) {
        setDrawingFavorites(value);
      }
    });
    const unsubscribe = subscribeDrawingToolFavorites((value) => {
      if (active) {
        setDrawingFavorites(value);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    function closeOnOutsideClick(event: globalThis.PointerEvent) {
      const target = event.target as Node;
      const targetElement = target instanceof Element ? target : null;
      if (targetElement?.closest("[data-chart-header-control]")) {
        return;
      }
      if (settingsOpen && settingsRef.current && !settingsRef.current.contains(target)) {
        setSettingsOpen(false);
      }
      if (menuRef.current && !menuRef.current.contains(target)) {
        setIndicatorMenuOpen(false);
      }
      if (commandRef.current && !commandRef.current.contains(target)) {
        setCommandOpen(false);
      }
      if (
        drawingFavoritesOpen &&
        drawingFavoritesRef.current &&
        !drawingFavoritesRef.current.contains(target)
      ) {
        setDrawingFavoritesOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [drawingFavoritesOpen, settingsOpen]);

  useEffect(() => {
    if (settingsOpenSignal <= 0 || toolsOpen) {
      return;
    }

    setCommandOpen(false);
    setIndicatorMenuOpen(false);
    refreshSettingsPresets();
    setSettingsOpen(true);
  }, [settingsOpenSignal, toolsOpen]);

  useEffect(() => {
    if (toolsOpen) {
      setSettingsOpen(false);
      return;
    }
    setCommandOpen(false);
    setDrawingFavoritesOpen(false);
    setIndicatorMenuOpen(false);
  }, [toolsOpen]);

  useEffect(() => {
    if (settingsOpen) {
      settingsWasOpenRef.current = true;
      window.requestAnimationFrame(() => {
        settingsRef.current
          ?.querySelector<HTMLElement>(".chart-settings-nav-button")
          ?.focus({ preventScroll: true });
      });
      return;
    }
    if (!settingsWasOpenRef.current) {
      return;
    }
    settingsWasOpenRef.current = false;
    onSettingsClose?.();
  }, [onSettingsClose, settingsOpen]);

  function openCommandSearch(
    event?: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>,
  ) {
    if ((event?.target as HTMLElement | undefined)?.closest(".chart-command-menu")) {
      return;
    }
    setDrawingFavoritesOpen(false);
    setIndicatorMenuOpen(false);
    setSettingsOpen(false);
    setCommandOpen(true);
    commandInputRef.current?.focus();
  }

  function updateDrawingFavorites(next: FavoriteDrawingTool[]) {
    const sanitized = sanitizeDrawingToolFavorites(next);
    setDrawingFavorites(sanitized);
    void persistDrawingToolFavorites(sanitized);
  }

  function toggleDrawingFavorite(tool: FavoriteDrawingTool) {
    updateDrawingFavorites(toggleDrawingToolFavorite(drawingFavorites, tool));
  }

  function moveDrawingFavorite(tool: FavoriteDrawingTool, direction: -1 | 1) {
    updateDrawingFavorites(moveDrawingToolFavorite(drawingFavorites, tool, direction));
  }

  function updateIndicatorFavorites(next: FavoriteIndicator[]) {
    const sanitized = sanitizeIndicatorFavorites(next);
    setIndicatorFavorites(sanitized);
    void persistIndicatorFavorites(sanitized);
  }

  function toggleFavoriteIndicator(kind: FavoriteIndicator) {
    updateIndicatorFavorites(toggleIndicatorFavorite(indicatorFavorites, kind));
  }

  function handlePaneLayoutKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % CHART_PANE_LAYOUTS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + CHART_PANE_LAYOUTS.length) % CHART_PANE_LAYOUTS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = CHART_PANE_LAYOUTS.length - 1;
    }
    if (nextIndex == null) {
      return;
    }
    event.preventDefault();
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    onPaneLayoutChange(CHART_PANE_LAYOUTS[nextIndex].id);
    window.requestAnimationFrame(() => buttons?.[nextIndex]?.focus());
  }

  const settingsPanel = settingsOpen ? (
    <ChartSettingsPanel
      indicatorInstances={indicatorInstances}
      onClose={() => setSettingsOpen(false)}
      onDeletePreset={(name) => {
        const nextPresets = deleteChartSettingsPreset(name);
        const nextName =
          normalizeChartSettingsPresetName(name) === settingsPresetName
            ? loadActiveChartSettingsPresetName(nextPresets) ?? "Default"
            : settingsPresetName;
        setSettingsPresets(nextPresets);
        setSettingsPresetName(nextName);
      }}
      onLoadPreset={(name) => {
        const nextPresets = refreshSettingsPresets(name);
        const preset = nextPresets.find((item) => item.name === name);
        if (!preset) {
          return;
        }
        setSettingsPresetName(preset.name);
        persistActiveChartSettingsPresetName(preset.name);
        onChartSettingsChange(preset.settings);
      }}
      onPresetNameChange={setSettingsPresetName}
      onRemoveIndicator={onRemoveIndicator}
      onReset={onChartSettingsReset}
      onSavePreset={() => {
        const presetName = normalizeChartSettingsPresetName(settingsPresetName);
        const nextPresets = saveChartSettingsPreset(presetName, chartSettings);
        setSettingsPresets(nextPresets);
        setSettingsPresetName(presetName);
        setSettingsOpen(false);
      }}
      onSettingsChange={onChartSettingsChange}
      onUpdateIndicatorSettings={onUpdateIndicatorSettings}
      presetName={settingsPresetName}
      presets={settingsPresets}
      settings={chartSettings}
    />
  ) : null;

  if (!toolsOpen) {
    return (
      <div ref={settingsRef} className="chart-settings-host">
        {settingsPanel}
      </div>
    );
  }

  return (
    <section className="chart-studio-toolbar">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
              <SlidersHorizontal size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Chart Workbench</div>
              <div className="truncate text-xs text-slate-500">
                {formatChartTimeframeLabel(timeframe)} / {chartStyleLabel(chartStyle)} / {getChartTimeZoneLabel(chartSettings.timeZone)} / {indicatorInstances.length} studies / {drawingsCount} drawings
              </div>
            </div>
          </div>
        </div>

        <div
          ref={commandRef}
          className="chart-command-box"
          onClickCapture={openCommandSearch}
          onPointerDownCapture={openCommandSearch}
        >
          <Command size={15} className="text-cyan-200" />
          <input
            ref={commandInputRef}
            onChange={(event) => {
              setCommandQuery(event.target.value);
              setCommandOpen(true);
            }}
            onClick={() => setCommandOpen(true)}
            onFocus={() => setCommandOpen(true)}
            onPointerDown={() => setCommandOpen(true)}
            placeholder="Search tools, indicators, styles, intervals"
            value={commandQuery}
          />
          <Search size={14} className="text-slate-500" />
          {commandOpen && (
            <CommandMenu
              indicatorInstances={indicatorInstances}
              onChartStyleChange={selectChartStyle}
              onClose={() => {
                setCommandOpen(false);
                setCommandQuery("");
              }}
              onDrawingToolChange={onDrawingToolChange}
              onMagnetModeChange={onMagnetModeChange}
              onTimeframeChange={onTimeframeChange}
              onAddIndicator={onAddIndicator}
              query={commandQuery}
              sourceTimeframe={sourceTimeframe}
            />
          )}
        </div>

        <div className="timeframe-strip">
          {TIMEFRAMES.map((interval) => {
            const unavailable = !isTimeframeAvailable(interval.id, sourceTimeframe);
            const unavailableLabel = `${interval.label} data not available from ${sourceTimeframe} source`;
            return (
              <button
                aria-label={unavailable ? unavailableLabel : interval.label}
                className={`timeframe-button ${interval.id === timeframe ? "timeframe-button-active" : ""} ${unavailable ? "timeframe-button-unavailable" : ""}`}
                disabled={unavailable}
                key={interval.id}
                onClick={() => onTimeframeChange(interval.id)}
                title={unavailable ? unavailableLabel : interval.label}
                type="button"
              >
                <span>{interval.label}</span>
                {unavailable && <span className="timeframe-unavailable-label">N/A</span>}
              </button>
            );
          })}
          <form
            className="timeframe-custom-form"
            onSubmit={(event) => {
              event.preventDefault();
              applyCustomTimeframe();
            }}
          >
            <input
              aria-label="Custom timeframe"
              className="timeframe-custom-input"
              onChange={(event) => setCustomTimeframe(event.target.value)}
              placeholder="10m"
              title={customTimeframeTitle}
              value={customTimeframe}
            />
            <button
              aria-label="Apply custom timeframe"
              className="timeframe-custom-apply"
              disabled={!customTimeframeAvailable}
              title={customTimeframeTitle}
              type="submit"
            >
              <Check size={13} />
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onCaptureChart ? (
            <>
              <button
                aria-describedby={captureMessage ? "chart-capture-toolbar-status" : undefined}
                className="chart-mode-button"
                disabled={captureStatus === "capturing"}
                onClick={onCaptureChart}
                type="button"
              >
                <Camera size={15} />
                {captureStatus === "capturing"
                  ? "Capturing…"
                  : captureStatus === "error"
                    ? "Retry PNG"
                    : "Capture PNG"}
              </button>
              <span aria-live="polite" className="sr-only" id="chart-capture-toolbar-status">
                {captureMessage}
              </span>
            </>
          ) : null}
          {onShowDrawingRailChange ? (
            <button
              aria-pressed={showDrawingRail}
              className={`chart-mode-button ${showDrawingRail ? "chart-mode-active" : ""}`}
              onClick={() => onShowDrawingRailChange(!showDrawingRail)}
              type="button"
            >
              {showDrawingRail ? <Eye size={16} /> : <EyeOff size={16} />}
              Rail {showDrawingRail ? "on" : "off"}
            </button>
          ) : null}
          {onKeepDrawingAfterPlacementChange ? (
            <button
              aria-pressed={keepDrawingAfterPlacement}
              className={`chart-mode-button ${keepDrawingAfterPlacement ? "chart-mode-active" : ""}`}
              onClick={() => onKeepDrawingAfterPlacementChange(!keepDrawingAfterPlacement)}
              title="Keep the selected drawing tool active after placing an object"
              type="button"
            >
              <Command size={15} />
              Stay {keepDrawingAfterPlacement ? "on" : "off"}
            </button>
          ) : null}
          <button
            className="chart-mode-button"
            onClick={() => selectChartStyle("candles")}
            type="button"
          >
            <CandlestickChart size={15} />
            {chartStyleLabel(chartStyle)}
          </button>
          <button
            className={`chart-mode-button ${orderOverlaysVisible ? "chart-mode-active" : ""}`}
            onClick={onToggleOrderOverlays}
            type="button"
          >
            {orderOverlaysVisible ? <Eye size={16} /> : <EyeOff size={16} />}
            Overlays
          </button>
          <button
            className="chart-mode-button"
            onClick={onClearDrawings}
            disabled={clearableDrawingsCount === 0}
            title={
              clearableDrawingsCount === 0 && drawingsCount > 0
                ? "Unlock drawings to clear them"
                : "Clear unlocked drawings"
            }
            type="button"
          >
            Clear {clearableDrawingsCount}
          </button>
          <button
            className="chart-mode-button chart-mode-primary"
            onClick={onSaveLayout}
            type="button"
          >
            <Save size={15} />
            {savedLabel ?? "Save Layout"}
          </button>
        </div>
      </div>

      <div className="chart-style-strip">
        {CHART_STYLES.map((style) => {
          const Icon = style.icon;
          return (
            <button
              className={`chart-style-button ${chartStyle === style.id ? "chart-style-button-active" : ""}`}
              key={style.id}
              onClick={() => {
                selectChartStyle(style.id);
              }}
              type="button"
            >
              <Icon size={14} />
              {style.label}
            </button>
          );
        })}
      </div>

      <div className="chart-pane-layout-strip">
        <span className="study-manager-label">Chart layout</span>
        <div
          aria-label="Chart pane layout"
          aria-orientation="horizontal"
          className="chart-pane-layout-buttons"
          role="radiogroup"
        >
          {CHART_PANE_LAYOUTS.map((layout, index) => {
            return (
              <button
                aria-checked={paneLayout === layout.id}
                aria-label={layout.label}
                className={`chart-pane-layout-button ${
                  paneLayout === layout.id ? "chart-pane-layout-button-active" : ""
                }`}
                key={layout.id}
                onKeyDown={(event) => handlePaneLayoutKeyDown(event, index)}
                onClick={() => onPaneLayoutChange(layout.id)}
                role="radio"
                tabIndex={paneLayout === layout.id ? 0 : -1}
                title={layout.label}
                type="button"
              >
                <ChartPaneLayoutGlyph layout={layout} />
                <span className="chart-pane-layout-count">{layout.panes}</span>
              </button>
            );
          })}
        </div>
        <span className="chart-pane-active-label">{activePaneLabel}</span>
        {replayTimeframeOptions.length > 1 && (
          <div className="chart-replay-timeframe-control">
            <span className="chart-replay-timeframe-label">Replay</span>
            <ThemedSelect
              ariaLabel="Replay timeframe"
              className="chart-replay-timeframe-select h-8 w-28"
              onChange={(value) => onReplayTimeframeChange(value)}
              options={replayTimeframeOptions}
              value={replayTimeframe}
            />
          </div>
        )}
      </div>

      <div className="layout-manager-strip">
        <span className="study-manager-label">Layouts</span>
        <ThemedSelect
          ariaLabel="Saved layouts"
          className="h-8 w-44"
          onChange={onLoadLayout}
          options={
            layoutNames.length > 0
              ? [
                  { disabled: true, label: "Saved layouts", value: "" },
                  ...layoutNames.map((name) => ({ label: name, value: name })),
                ]
              : [{ disabled: true, label: "No saved layouts", value: "" }]
          }
          value={layoutNames.includes(layoutName) ? layoutName : ""}
        />
        <input
          className="input-control h-8 max-w-56 text-xs"
          onChange={(event) => onLayoutNameChange(event.target.value)}
          placeholder="Layout name"
          value={layoutName}
        />
        <button
          className="studio-tool-button studio-tool-button-active"
          onClick={onSaveLayout}
          type="button"
        >
          <Save size={13} />
          Save
        </button>
        <button
          className="studio-tool-button"
          disabled={layoutNames.length === 0 || !layoutNames.includes(layoutName)}
          onClick={() => onDeleteLayout(layoutName)}
          type="button"
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="drawing-tool-strip" aria-label="Drawing tools">
          {DRAWING_TOOLS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`studio-tool-button ${drawingTool === item.tool ? "studio-tool-button-active" : ""}`}
                key={item.tool}
                onClick={() => onDrawingToolChange(item.tool)}
                title={`${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}`}
                type="button"
              >
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <button
            className="studio-tool-button"
            disabled={clearableDrawingsCount === 0}
            onClick={onClearDrawings}
            title={
              clearableDrawingsCount === 0 && drawingsCount > 0
                ? "Unlock drawings to clear them"
                : "Clear unlocked drawings"
            }
            type="button"
          >
            <Trash2 size={14} />
            <span>{clearableDrawingsCount}</span>
          </button>
          <div
            className="relative"
            onKeyDown={(event) => {
              if (event.key === "Escape" && drawingFavoritesOpen) {
                event.preventDefault();
                setDrawingFavoritesOpen(false);
                window.requestAnimationFrame(() => drawingFavoritesTriggerRef.current?.focus());
              }
            }}
            ref={drawingFavoritesRef}
          >
            <button
              aria-controls="chart-drawing-favorites"
              aria-expanded={drawingFavoritesOpen}
              aria-haspopup="dialog"
              className={`studio-tool-button ${drawingFavoritesOpen ? "studio-tool-button-active" : ""}`}
              onClick={() => {
                setDrawingFavoritesOpen((value) => !value);
                setCommandOpen(false);
                setIndicatorMenuOpen(false);
                setSettingsOpen(false);
              }}
              title="Edit circular toolbox favorites"
              type="button"
              ref={drawingFavoritesTriggerRef}
            >
              <Star fill="currentColor" size={14} />
              <span>Quick wheel</span>
              <span className="drawing-favorites-count">{drawingFavorites.length}</span>
            </button>
            {drawingFavoritesOpen && (
              <div
                aria-label="Circular toolbox favorites"
                className="drawing-favorites-panel"
                id="chart-drawing-favorites"
                role="dialog"
              >
                <div className="drawing-favorites-header">
                  <div>
                    <strong>Quick wheel</strong>
                    <span>Hold Alt/Option on the active chart</span>
                  </div>
                  <span>{drawingFavorites.length}/{MAX_DRAWING_TOOL_FAVORITES}</span>
                </div>
                <div className="drawing-favorites-list">
                  {favoriteDrawingToolOptions.map((item) => {
                    const tool = item.tool as FavoriteDrawingTool;
                    const favoriteIndex = drawingFavorites.indexOf(tool);
                    const isFavorite = favoriteIndex >= 0;
                    const atLimit =
                      !isFavorite && drawingFavorites.length >= MAX_DRAWING_TOOL_FAVORITES;
                    const Icon = item.icon;
                    return (
                      <div
                        className={`drawing-favorites-row ${isFavorite ? "drawing-favorites-row-active" : ""}`}
                        key={tool}
                      >
                        <button
                          aria-pressed={isFavorite}
                          className="drawing-favorites-toggle"
                          disabled={atLimit || (isFavorite && drawingFavorites.length === 1)}
                          onClick={() => toggleDrawingFavorite(tool)}
                          title={
                            atLimit
                              ? `Keep up to ${MAX_DRAWING_TOOL_FAVORITES} favorites`
                              : isFavorite && drawingFavorites.length === 1
                                ? "Keep at least one favorite"
                                : `${isFavorite ? "Remove" : "Add"} ${item.label}`
                          }
                          type="button"
                        >
                          <Star fill={isFavorite ? "currentColor" : "none"} size={14} />
                          <Icon size={15} />
                          <span>{item.label}</span>
                        </button>
                        {isFavorite && (
                          <div className="drawing-favorites-order" aria-label={`Reorder ${item.label}`}>
                            <button
                              aria-label={`Move ${item.label} earlier`}
                              disabled={favoriteIndex === 0}
                              onClick={() => moveDrawingFavorite(tool, -1)}
                              type="button"
                            >
                              <ArrowUp size={13} />
                            </button>
                            <span>{favoriteIndex + 1}</span>
                            <button
                              aria-label={`Move ${item.label} later`}
                              disabled={favoriteIndex === drawingFavorites.length - 1}
                              onClick={() => moveDrawingFavorite(tool, 1)}
                              type="button"
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="drawing-favorites-hint">
                  Hover and release Alt/Option, click a tool, or use arrows and Enter. Number keys 1–8 select directly.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="magnet-mode-strip" aria-label="Magnet mode">
          <span className="magnet-mode-label">
            <Magnet size={13} />
            Magnet
          </span>
          {MAGNET_MODES.map((mode) => (
            <button
              className={`magnet-mode-button ${magnetMode === mode.id ? "magnet-mode-button-active" : ""}`}
              key={mode.id}
              onClick={() => onMagnetModeChange(mode.id)}
              title={mode.description}
              type="button"
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div ref={menuRef} className="relative">
          <button
            aria-controls={indicatorCatalogId}
            aria-expanded={indicatorMenuOpen}
            aria-haspopup="dialog"
            className={`chart-dropdown-trigger ${indicatorMenuOpen ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : ""}`}
            onClick={() => {
              setIndicatorMenuOpen((value) => !value);
              setCommandOpen(false);
              setDrawingFavoritesOpen(false);
              setSettingsOpen(false);
            }}
            ref={indicatorMenuTriggerRef}
            type="button"
          >
            <Layers size={15} />
            Indicators
            <ChevronDown size={14} />
          </button>
          {indicatorMenuOpen && (
            <div id={indicatorCatalogId}>
              <IndicatorCatalogPanel
                favorites={indicatorFavorites}
                indicatorInstances={indicatorInstances}
                onAddIndicator={onAddIndicator}
                onClose={closeIndicatorMenu}
                onToggleFavorite={toggleFavoriteIndicator}
              />
            </div>
          )}
        </div>

        {favoriteIndicatorOptions.length > 0 && (
          <div
            aria-label="Favorite indicators quick add"
            className="flex min-h-10 min-w-0 flex-wrap items-center gap-1 rounded-md border border-white/10 bg-black/25 p-1"
          >
            <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              <Star fill="currentColor" size={12} />
              Quick add
            </span>
            {favoriteIndicatorOptions.map((indicator) => {
              const count = indicatorInstances.filter(
                (instance) => instance.kind === indicator.kind,
              ).length;
              const disabled = isSingleInstanceIndicator(indicator.kind) && count > 0;
              return (
                <button
                  aria-label={
                    disabled
                      ? `${indicator.label} is already active`
                      : count > 0
                        ? `Add another ${indicator.label} indicator; ${count} active`
                        : `Add ${indicator.label} indicator`
                  }
                  className={`studio-tool-button ${count > 0 ? "text-cyan-100" : ""}`}
                  disabled={disabled}
                  key={indicator.kind}
                  onClick={() => onAddIndicator(indicator.kind)}
                  title={disabled ? `${indicator.label} supports one instance` : indicator.description}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: indicator.color }}
                  />
                  <span>{indicator.label}</span>
                  {count > 0 && <span className="text-[10px] tabular-nums">{count}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div ref={settingsRef} className="relative">
          <button
            className="chart-dropdown-trigger"
            onClick={() => {
              setSettingsOpen((value) => !value);
              setIndicatorMenuOpen(false);
            }}
            type="button"
          >
            <Settings2 size={15} />
            Settings
          </button>
          {settingsPanel}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {indicatorInstances.map((indicator) => {
            const settings = indicator.settings ?? FALLBACK_SETTING;
            return (
              <button
                className="indicator-chip indicator-chip-active"
                key={indicator.id}
                onClick={() => onRemoveIndicator(indicator.id)}
                type="button"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: settings.color }}
                />
                {indicatorDisplayName(indicator)}
                <X size={12} />
              </button>
            );
          })}
        </div>
      </div>

      {indicatorInstances.length > 0 && (
        <div className="study-manager-strip">
          <span className="study-manager-label">Active studies</span>
          {indicatorInstances.map((indicator) => {
            const settings = indicator.settings ?? FALLBACK_SETTING;
            const isMacd = indicator.kind === "macd";
            const isGapStudy = indicator.kind === "fvg" || indicator.kind === "ifvg";
            return (
              <div className="study-chip" key={indicator.id}>
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: settings.color }}
                />
                <span className="min-w-0 font-semibold">
                  {indicatorDisplayName(indicator)}
                </span>
                {isMacd ? (
                  <>
                    <NumberPill
                      label="F"
                      onChange={(value) => onUpdateIndicatorSettings(indicator.id, { fastPeriod: value })}
                      value={settings.fastPeriod ?? 12}
                    />
                    <NumberPill
                      label="S"
                      onChange={(value) => onUpdateIndicatorSettings(indicator.id, { slowPeriod: value })}
                      value={settings.slowPeriod ?? 26}
                    />
                    <NumberPill
                      label="Sig"
                      onChange={(value) => onUpdateIndicatorSettings(indicator.id, { signalPeriod: value })}
                      value={settings.signalPeriod ?? 9}
                    />
                  </>
                ) : isGapStudy ? (
                  <>
                    <span className="rounded bg-white/5 px-2 py-1 text-[10px] text-slate-500">
                      {settings.unmitigatedOnly === true ? "Unmitigated only" : "All zones"}
                    </span>
                  </>
                ) : indicator.kind !== "vwap" ? (
                  <NumberPill
                    label="Len"
                    onChange={(value) => onUpdateIndicatorSettings(indicator.id, { period: value })}
                    value={settings.period}
                  />
                ) : (
                  <span className="rounded bg-white/5 px-2 py-1 text-[10px] text-slate-500">
                    Session
                  </span>
                )}
                <ThemedColorPicker
                  ariaLabel="Study color"
                  className="study-chip-color"
                  compact
                  onChange={(color) =>
                    onUpdateIndicatorSettings(indicator.id, { color })
                  }
                  value={settings.color}
                />
                <button
                  className="grid h-6 w-6 place-items-center rounded hover:bg-white/10 hover:text-white"
                  onClick={() => onRemoveIndicator(indicator.id)}
                  title="Remove study"
                  type="button"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NumberPill({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="study-number-pill">
      <span>{label}</span>
      <input
        min={1}
        onChange={(event) => onChange(clampInteger(event.target.value, 1, 500))}
        type="number"
        value={value}
      />
    </label>
  );
}

type ChartSettingsTab = "canvas" | "scales" | "status" | "symbol";

const CHART_SETTINGS_TABS: Array<{ id: ChartSettingsTab; label: string }> = [
  { id: "symbol", label: "Symbol" },
  { id: "status", label: "Status line" },
  { id: "scales", label: "Scales and lines" },
  { id: "canvas", label: "Canvas" },
];

function ChartSettingsPanel({
  indicatorInstances,
  onClose,
  onDeletePreset,
  onLoadPreset,
  onPresetNameChange,
  onRemoveIndicator,
  onReset,
  onSavePreset,
  onSettingsChange,
  onUpdateIndicatorSettings,
  presetName,
  presets,
  settings,
}: {
  indicatorInstances: ChartIndicatorInstance[];
  onClose: () => void;
  onDeletePreset: (name: string) => void;
  onLoadPreset: (name: string) => void;
  onPresetNameChange: (name: string) => void;
  onRemoveIndicator: (instanceId: string) => void;
  onReset: () => void;
  onSavePreset: () => void;
  onSettingsChange: (settings: ChartVisualSettings) => void;
  onUpdateIndicatorSettings: (
    instanceId: string,
    settings: Partial<IndicatorSettings>,
  ) => void;
  presetName: string;
  presets: ChartSettingsPreset[];
  settings: ChartVisualSettings;
}) {
  const [activeTab, setActiveTab] = useState<ChartSettingsTab>("symbol");

  function updateSettings(patch: Partial<ChartVisualSettings>) {
    onSettingsChange({ ...settings, ...patch });
  }

  return (
    <div className="chart-settings-popover">
      <div className="chart-settings-header">
        <div>
          <div className="text-sm font-semibold text-white">Settings</div>
          <div className="text-xs text-slate-500">
            Chart display, scales, labels, and canvas styling
          </div>
        </div>
        <button className="icon-button h-8 w-8" onClick={onClose} type="button">
          <X size={14} />
        </button>
      </div>

      <div className="chart-settings-body">
        <nav className="chart-settings-nav" aria-label="Chart settings sections">
          {CHART_SETTINGS_TABS.map((tab) => (
            <button
              className={`chart-settings-nav-button ${activeTab === tab.id ? "chart-settings-nav-button-active" : ""}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="chart-settings-content">
          <section className="chart-settings-template-switcher">
            <div className="min-w-0">
              <div className="chart-settings-section-title">Templates</div>
              <div className="mt-1 text-xs text-slate-500">
                {presets.length > 0
                  ? "Switch chart settings without changing drawings or indicators."
                  : "Save the current settings to create your first template."}
              </div>
            </div>
            {presets.length > 0 ? (
              <div className="chart-settings-template-list">
                {presets.map((preset) => {
                  const active = preset.name === presetName;
                  return (
                    <button
                      className={`chart-settings-template-chip ${active ? "chart-settings-template-chip-active" : ""}`}
                      key={preset.name}
                      onClick={() => onLoadPreset(preset.name)}
                      type="button"
                    >
                      <span className="truncate">{preset.name}</span>
                      <span>{active ? "Active" : "Use"}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>

          {activeTab === "symbol" && (
            <>
              <SettingsSection title="Visibility">
                <SettingToggle
                  checked={settings.title}
                  label="Title"
                  onChange={(title) => updateSettings({ title })}
                />
                <SettingToggle
                  checked={settings.chartValues}
                  label="Chart values"
                  onChange={(chartValues) => updateSettings({ chartValues })}
                />
                <SettingToggle
                  checked={settings.barChangeValues}
                  label="Bar change values"
                  onChange={(barChangeValues) => updateSettings({ barChangeValues })}
                />
                <SettingToggle
                  checked={settings.volume}
                  label="Volume"
                  onChange={(volume) => updateSettings({ volume })}
                />
              </SettingsSection>

              <SettingsSection title="Candles">
                <SettingToggle
                  checked={settings.colorBarsByPreviousClose}
                  label="Color bars based on previous close"
                  onChange={(colorBarsByPreviousClose) =>
                    updateSettings({ colorBarsByPreviousClose })
                  }
                />
                <CandleColorSetting
                  downColor={settings.bodyDownColor}
                  label="Body"
                  onDownColorChange={(bodyDownColor) =>
                    updateSettings({ bodyDownColor, candleDownColor: bodyDownColor })
                  }
                  onUpColorChange={(bodyUpColor) =>
                    updateSettings({ bodyUpColor, candleUpColor: bodyUpColor })
                  }
                  onVisibleChange={(bodyVisible) => updateSettings({ bodyVisible })}
                  upColor={settings.bodyUpColor}
                  visible={settings.bodyVisible}
                />
                <CandleColorSetting
                  downColor={settings.borderDownColor}
                  label="Borders"
                  onDownColorChange={(borderDownColor) => updateSettings({ borderDownColor })}
                  onUpColorChange={(borderUpColor) => updateSettings({ borderUpColor })}
                  onVisibleChange={(borderVisible) => updateSettings({ borderVisible })}
                  upColor={settings.borderUpColor}
                  visible={settings.borderVisible}
                />
                <CandleColorSetting
                  downColor={settings.wickDownColor}
                  label="Wick"
                  onDownColorChange={(wickDownColor) => updateSettings({ wickDownColor })}
                  onUpColorChange={(wickUpColor) => updateSettings({ wickUpColor })}
                  onVisibleChange={(wickVisible) => updateSettings({ wickVisible })}
                  upColor={settings.wickUpColor}
                  visible={settings.wickVisible}
                />
                <NumberSetting
                  label="Precision"
                  max={8}
                  min={0}
                  onChange={(pricePrecision) => updateSettings({ pricePrecision })}
                  value={settings.pricePrecision}
                />
              </SettingsSection>
            </>
          )}

          {activeTab === "status" && (
            <>
              <SettingsSection title="Status line">
                <SettingToggle
                  checked={settings.indicatorTitles}
                  label="Indicator titles"
                  onChange={(indicatorTitles) => updateSettings({ indicatorTitles })}
                />
                <SettingToggle
                  checked={settings.indicatorValues}
                  label="Indicator values"
                  onChange={(indicatorValues) => updateSettings({ indicatorValues })}
                />
                <SelectSetting
                  label="Symbol"
                  onChange={(symbolLine) =>
                    updateSettings({ symbolLine: symbolLine as ChartVisualSettings["symbolLine"] })
                  }
                  options={visibilityOptions}
                  value={settings.symbolLine}
                />
                <SelectSetting
                  label="Previous day close"
                  onChange={(previousDayClose) =>
                    updateSettings({
                      previousDayClose:
                        previousDayClose as ChartVisualSettings["previousDayClose"],
                    })
                  }
                  options={visibilityOptions}
                  value={settings.previousDayClose}
                />
                <SelectSetting
                  label="High and low"
                  onChange={(highLowLabels) =>
                    updateSettings({
                      highLowLabels: highLowLabels as ChartVisualSettings["highLowLabels"],
                    })
                  }
                  options={visibilityOptions}
                  value={settings.highLowLabels}
                />
              </SettingsSection>

            </>
          )}

          {activeTab === "scales" && (
            <>
              <SettingsSection title="Price scale">
                <SelectSetting
                  label="Scale placement"
                  onChange={(scalePlacement) =>
                    updateSettings({
                      scalePlacement: scalePlacement as ChartVisualSettings["scalePlacement"],
                    })
                  }
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "Right", value: "right" },
                    { label: "Left", value: "left" },
                  ]}
                  value={settings.scalePlacement}
                />
                <SettingToggle
                  checked={settings.priceScaleBorderVisible}
                  label="Price scale border"
                  onChange={(priceScaleBorderVisible) =>
                    updateSettings({ priceScaleBorderVisible })
                  }
                />
                <SettingToggle
                  checked={settings.noOverlappingLabels}
                  label="No overlapping labels"
                  onChange={(noOverlappingLabels) =>
                    updateSettings({ noOverlappingLabels })
                  }
                />
              </SettingsSection>

              <SettingsSection title="Grid and sessions">
                <SelectSetting
                  label="Grid lines"
                  onChange={(gridMode) =>
                    updateSettings({ gridMode: gridMode as ChartVisualSettings["gridMode"] })
                  }
                  options={[
                    { label: "Vertical and horizontal", value: "both" },
                    { label: "Horizontal", value: "horizontal" },
                    { label: "Vertical", value: "vertical" },
                    { label: "Hidden", value: "none" },
                  ]}
                  value={settings.gridMode}
                />
                <ColorSetting
                  label="Grid color"
                  onChange={(gridColor) => updateSettings({ gridColor })}
                  value={settings.gridColor}
                />
                <SettingToggle
                  checked={settings.sessionBreaks}
                  label="Session breaks"
                  onChange={(sessionBreaks) => updateSettings({ sessionBreaks })}
                />
                <ColorSetting
                  disabled={!settings.sessionBreaks}
                  label="Session break color"
                  onChange={(sessionBreakColor) => updateSettings({ sessionBreakColor })}
                  value={settings.sessionBreakColor}
                />
                <NumberSetting
                  label="Session break thickness"
                  max={8}
                  min={1}
                  onChange={(sessionBreakLineWidth) =>
                    updateSettings({ sessionBreakLineWidth })
                  }
                  value={settings.sessionBreakLineWidth}
                />
                <SelectSetting
                  label="Session break style"
                  onChange={(sessionBreakLineStyle) =>
                    updateSettings({
                      sessionBreakLineStyle: sessionBreakLineStyle as ChartLineStyle,
                    })
                  }
                  options={[
                    { label: "Solid", value: "solid" },
                    { label: "Dashed", value: "dashed" },
                    { label: "Dotted", value: "dotted" },
                  ]}
                  value={settings.sessionBreakLineStyle}
                />
              </SettingsSection>

              <SettingsSection title="Time scale">
                <SettingToggle
                  checked={settings.timeScaleBorderVisible}
                  label="Time scale border"
                  onChange={(timeScaleBorderVisible) =>
                    updateSettings({ timeScaleBorderVisible })
                  }
                />
                <SettingToggle
                  checked={settings.dayOfWeekLabels}
                  label="Day of week on labels"
                  onChange={(dayOfWeekLabels) => updateSettings({ dayOfWeekLabels })}
                />
                <TimeZoneSetting
                  onChange={(timeZone) => updateSettings({ timeZone })}
                  value={settings.timeZone}
                />
                <SelectSetting
                  label="Date format"
                  onChange={(dateFormat) =>
                    updateSettings({ dateFormat: dateFormat as ChartVisualSettings["dateFormat"] })
                  }
                  options={[
                    { label: "29 Sep '97", value: "dd MMM yy" },
                    { label: "Sep 29 1997", value: "MMM dd yyyy" },
                    { label: "1997-09-29", value: "yyyy-MM-dd" },
                  ]}
                  value={settings.dateFormat}
                />
                <SelectSetting
                  label="Time hours format"
                  onChange={(timeHoursFormat) =>
                    updateSettings({
                      timeHoursFormat:
                        timeHoursFormat as ChartVisualSettings["timeHoursFormat"],
                    })
                  }
                  options={[
                    { label: "24-hours", value: "24-hour" },
                    { label: "12-hours", value: "12-hour" },
                  ]}
                  value={settings.timeHoursFormat}
                />
              </SettingsSection>
            </>
          )}

          {activeTab === "canvas" && (
            <>
              <SettingsSection title="Canvas">
                <ColorSetting
                  label="Background"
                  onChange={(backgroundColor) => updateSettings({ backgroundColor })}
                  value={settings.backgroundColor}
                />
                <ColorSetting
                  label="Text"
                  onChange={(textColor) => updateSettings({ textColor })}
                  value={settings.textColor}
                />
                <NumberSetting
                  label="Text size"
                  max={18}
                  min={10}
                  onChange={(textSize) => updateSettings({ textSize })}
                  value={settings.textSize}
                />
                <SettingToggle
                  checked={settings.crosshairVisible}
                  label="Crosshair"
                  onChange={(crosshairVisible) => updateSettings({ crosshairVisible })}
                />
                <ColorSetting
                  label="Crosshair color"
                  onChange={(crosshairColor) => updateSettings({ crosshairColor })}
                  value={settings.crosshairColor}
                />
              </SettingsSection>

              <SettingsSection title="Watermark">
                <SelectSetting
                  label="Watermark"
                  onChange={(watermark) =>
                    updateSettings({ watermark: watermark as ChartVisualSettings["watermark"] })
                  }
                  options={[
                    { label: "Hidden", value: "hidden" },
                    { label: "Symbol", value: "symbol" },
                    { label: "Text", value: "text" },
                  ]}
                  value={settings.watermark}
                />
                <label className="chart-settings-field">
                  <span>Watermark text</span>
                  <input
                    className="input-control h-9"
                    onChange={(event) =>
                      updateSettings({ watermarkText: event.target.value })
                    }
                    value={settings.watermarkText}
                  />
                </label>
              </SettingsSection>
            </>
          )}
        </div>
      </div>

      <div className="chart-settings-footer">
        <div className="chart-settings-template-status">
          <span className="study-manager-label">Template</span>
          <strong>{presets.some((preset) => preset.name === presetName) ? presetName : "Unsaved"}</strong>
        </div>
        <input
          className="input-control h-8 min-w-40 flex-1 text-xs"
          onChange={(event) => onPresetNameChange(event.target.value)}
          placeholder="Save as template"
          value={presetName}
        />
        <button
          className="studio-tool-button studio-tool-button-active"
          onClick={() => {
            try {
              onSavePreset();
            } finally {
              onClose();
            }
          }}
          type="button"
        >
          <Save size={13} />
          Save Template
        </button>
        <button
          className="studio-tool-button"
          disabled={!presets.some((preset) => preset.name === presetName)}
          onClick={() => onDeletePreset(presetName)}
          type="button"
        >
          <Trash2 size={13} />
          Delete
        </button>
        <button className="studio-tool-button" onClick={onReset} type="button">
          Reset
        </button>
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
    <section className="chart-settings-section">
      <div className="chart-settings-section-title">{title}</div>
      <div className="chart-settings-section-grid">{children}</div>
    </section>
  );
}

function SettingToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="chart-settings-toggle">
      <input
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function CandleColorSetting({
  downColor,
  label,
  onDownColorChange,
  onVisibleChange,
  onUpColorChange,
  upColor,
  visible,
}: {
  downColor: string;
  label: string;
  onDownColorChange: (value: string) => void;
  onVisibleChange: (value: boolean) => void;
  onUpColorChange: (value: string) => void;
  upColor: string;
  visible: boolean;
}) {
  return (
    <div className="chart-settings-candle-row">
      <div className="flex min-h-9 items-center gap-2 rounded-md border border-white/[0.07] bg-white/[0.025] px-3 text-xs font-semibold text-slate-300">
        <button
          aria-label={`${visible ? "Hide" : "Show"} ${label}`}
          className={`grid h-6 w-6 place-items-center rounded border transition ${
            visible
              ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
              : "border-white/10 bg-black/20 text-slate-500 hover:text-slate-200"
          }`}
          onClick={() => onVisibleChange(!visible)}
          title={`${visible ? "Hide" : "Show"} ${label}`}
          type="button"
        >
          {visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <span>{label}</span>
      </div>
      <div className="chart-settings-color-pair">
        <ThemedColorPicker
          ariaLabel={`${label} up color`}
          compact
          onChange={onUpColorChange}
          value={upColor}
        />
        <ThemedColorPicker
          ariaLabel={`${label} down color`}
          compact
          onChange={onDownColorChange}
          value={downColor}
        />
      </div>
    </div>
  );
}

function ColorSetting({
  disabled = false,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label
      className={`chart-settings-field chart-settings-color-field ${
        disabled ? "chart-settings-field-disabled" : ""
      }`}
    >
      <span>{label}</span>
      <ThemedColorPicker
        ariaLabel={label}
        compact
        disabled={disabled}
        onChange={onChange}
        value={value}
      />
    </label>
  );
}

function NumberSetting({
  label,
  max,
  min,
  onChange,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="chart-settings-field">
      <span>{label}</span>
      <input
        className="input-control h-9"
        max={max}
        min={min}
        onChange={(event) => onChange(clampInteger(event.target.value, min, max))}
        type="number"
        value={value}
      />
    </label>
  );
}

function SelectSetting({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="chart-settings-field">
      <span>{label}</span>
      <ThemedSelect
        ariaLabel={label}
        className="h-9"
        onChange={onChange}
        options={options}
        value={value}
      />
    </label>
  );
}

function TimeZoneSetting({
  onChange,
  value,
}: {
  onChange: (value: ChartTimeZone) => void;
  value: ChartTimeZone;
}) {
  const listId = useId();
  const helpId = useId();
  const selectedTimeZone =
    CHART_TIMEZONES.find((timeZone) => timeZone.id === value) ?? CHART_TIMEZONES[0];
  const selectedLabel = timeZoneOptionLabel(selectedTimeZone);
  const [query, setQuery] = useState(selectedLabel);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setQuery(selectedLabel);
    setMessage("");
  }, [selectedLabel]);

  function commitQuery(raw: string) {
    const normalized = raw.trim().toLowerCase();
    const exact = CHART_TIMEZONES.find((timeZone) =>
      [timeZone.id, timeZone.label, timeZoneOptionLabel(timeZone)].some(
        (candidate) => candidate.toLowerCase() === normalized,
      ),
    );
    const matches = exact ? [exact] : searchChartTimeZones(raw);
    if (matches.length === 1) {
      onChange(matches[0].id);
      setQuery(timeZoneOptionLabel(matches[0]));
      setMessage(`Chart time zone set to ${matches[0].label}.`);
      return;
    }
    setQuery(selectedLabel);
    setMessage(
      raw.trim()
        ? `Choose one time zone from the suggestions. Kept ${selectedTimeZone.label}.`
        : `Chart time zone remains ${selectedTimeZone.label}.`,
    );
  }

  return (
    <label className="chart-settings-field">
      <span>Time zone</span>
      <span className="relative block">
        <Globe2
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cyan-200"
          size={14}
        />
        <input
          aria-describedby={helpId}
          autoComplete="off"
          className="input-control h-9 w-full pl-9 text-base normal-case tracking-normal sm:text-xs"
          list={listId}
          onBlur={(event) => commitQuery(event.currentTarget.value)}
          onChange={(event) => {
            setQuery(event.target.value);
            setMessage("");
          }}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitQuery(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setQuery(selectedLabel);
              setMessage(`Chart time zone remains ${selectedTimeZone.label}.`);
            }
          }}
          placeholder="Search city or IANA zone"
          spellCheck={false}
          type="text"
          value={query}
        />
        <datalist id={listId}>
          {CHART_TIMEZONES.map((timeZone) => (
            <option
              key={timeZone.id}
              label={`${timeZone.region} · ${timeZone.id}`}
              value={timeZoneOptionLabel(timeZone)}
            />
          ))}
        </datalist>
      </span>
      <span
        aria-live="polite"
        className="normal-case font-normal leading-4 tracking-normal text-slate-500"
        id={helpId}
      >
        {message || `${selectedTimeZone.id} · Applied to axis, values, drawings, and captures.`}
      </span>
    </label>
  );
}

function timeZoneOptionLabel(timeZone: (typeof CHART_TIMEZONES)[number]) {
  return `${timeZone.label} — ${timeZone.id}`;
}

const visibilityOptions = [
  { label: "Hidden", value: "hidden" },
  { label: "Value", value: "value" },
  { label: "Value, line", value: "valueLine" },
];

function CommandMenu({
  indicatorInstances,
  onChartStyleChange,
  onClose,
  onDrawingToolChange,
  onMagnetModeChange,
  onTimeframeChange,
  onAddIndicator,
  query,
  sourceTimeframe,
}: {
  indicatorInstances: ChartIndicatorInstance[];
  onChartStyleChange: (style: ChartStyle) => void;
  onClose: () => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onMagnetModeChange: (mode: MagnetMode) => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onAddIndicator: (kind: ChartIndicatorKind) => void;
  query: string;
  sourceTimeframe: ChartTimeframe | null;
}) {
  const normalized = query.trim().toLowerCase();
  const commands: Array<{
    description: string;
    disabled?: boolean;
    icon: ChartToolIcon | LucideIcon;
    id: string;
    label: string;
    run: () => void;
    searchText?: string;
    type: string;
  }> = [
    ...INDICATOR_CATALOG.map((indicator) => ({
      description:
        isSingleInstanceIndicator(indicator.kind) &&
        indicatorInstances.some((instance) => instance.kind === indicator.kind)
          ? "Already active in this chart"
          : indicatorInstances.some((instance) => instance.kind === indicator.kind)
          ? "Add another configurable instance"
          : indicator.description,
      disabled:
        isSingleInstanceIndicator(indicator.kind) &&
        indicatorInstances.some((instance) => instance.kind === indicator.kind),
      icon: Layers,
      id: `indicator-${indicator.id}`,
      label: indicator.label,
      run: () => onAddIndicator(indicator.kind),
      searchText: indicator.searchText,
      type: "Study",
    })),
    ...DRAWING_TOOLS.map((tool) => ({
      description: tool.shortcut ? `Shortcut ${tool.shortcut}` : "Drawing tool",
      icon: tool.icon,
      id: `drawing-${tool.tool}`,
      label: tool.label,
      run: () => onDrawingToolChange(tool.tool),
      type: "Drawing",
    })),
    ...TIMEFRAMES.map((interval) => {
      const unavailable = !isTimeframeAvailable(interval.id, sourceTimeframe);
      return {
        description: unavailable
          ? `Data not available from ${sourceTimeframe} source`
          : `${interval.seconds}s interval`,
        disabled: unavailable,
        icon: Command,
        id: `timeframe-${interval.id}`,
        label: interval.label,
        run: () => onTimeframeChange(interval.id),
        type: "Interval",
      };
    }),
    ...CHART_STYLES.map((style) => ({
      description: "Chart style",
      icon: style.icon,
      id: `style-${style.id}`,
      label: style.label,
      run: () => onChartStyleChange(style.id),
      type: "Style",
    })),
    ...MAGNET_MODES.map((mode) => ({
      description: mode.description,
      icon: Magnet,
      id: `magnet-${mode.id}`,
      label: `${mode.label} Magnet`,
      run: () => onMagnetModeChange(mode.id),
      type: "Drawing",
    })),
  ];
  const visibleCommands = commands
    .filter((command) =>
      normalized
        ? `${command.label} ${command.description} ${command.type} ${command.searchText ?? ""}`
            .toLowerCase()
            .includes(normalized)
        : true,
    )
    .slice(0, 12);

  return (
    <div className="chart-command-menu">
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Command Search
      </div>
      {visibleCommands.map((command) => {
        const Icon = command.icon;
        return (
          <button
            className={`chart-command-row ${command.disabled ? "chart-command-row-disabled" : ""}`}
            disabled={command.disabled}
            key={command.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (command.disabled) {
                return;
              }
              command.run();
              onClose();
            }}
            type="button"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/5 text-cyan-100">
              <Icon size={15} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold text-white">
                {command.label}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {command.type} · {command.description}
              </span>
            </span>
          </button>
        );
      })}
      {visibleCommands.length === 0 && (
        <div className="px-3 py-6 text-center text-sm text-slate-500">
          No matching command
        </div>
      )}
    </div>
  );
}

function isTimeframeAvailable(
  timeframe: ChartTimeframe,
  sourceTimeframe: ChartTimeframe | null,
) {
  return canAggregateTimeframe(timeframe, sourceTimeframe);
}

function IndicatorEditor({
  indicator,
  onRemove,
  onUpdate,
}: {
  indicator: ChartIndicatorInstance;
  onRemove: () => void;
  onUpdate: (settings: Partial<IndicatorSettings>) => void;
}) {
  const definition = INDICATORS.find((item) => item.kind === indicator.kind);
  const settings = indicator.settings ?? FALLBACK_SETTING;
  const isMacd = indicator.kind === "macd";
  const isGapStudy = indicator.kind === "fvg" || indicator.kind === "ifvg";
  const supportsPeriod = indicator.kind !== "vwap" && !isMacd;
  const supportsDeviation =
    indicator.kind === "bb" ||
    indicator.kind === "keltner" ||
    indicator.kind === "supertrend";

  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">
            {indicatorDisplayName(indicator)}
          </div>
          <div className="truncate text-xs text-slate-500">
            {definition?.description ?? "Custom indicator"}
          </div>
        </div>
        <button
          className="icon-button h-8 w-8"
          onClick={onRemove}
          title="Remove indicator"
          type="button"
        >
          <X size={14} />
        </button>
      </div>
      <div className={isMacd ? "grid grid-cols-3 gap-2" : "grid grid-cols-[1fr_92px] gap-2"}>
        {isMacd && (
          <>
            <label className="form-field">
              <span>Fast</span>
              <input
                className="input-control h-9"
                min={1}
                onChange={(event) =>
                  onUpdate({ fastPeriod: clampInteger(event.target.value, 1, 100) })
                }
                type="number"
                value={settings.fastPeriod ?? 12}
              />
            </label>
            <label className="form-field">
              <span>Slow</span>
              <input
                className="input-control h-9"
                min={2}
                onChange={(event) =>
                  onUpdate({ slowPeriod: clampInteger(event.target.value, 2, 200) })
                }
                type="number"
                value={settings.slowPeriod ?? 26}
              />
            </label>
            <label className="form-field">
              <span>Signal</span>
              <input
                className="input-control h-9"
                min={1}
                onChange={(event) =>
                  onUpdate({ signalPeriod: clampInteger(event.target.value, 1, 100) })
                }
                type="number"
                value={settings.signalPeriod ?? 9}
              />
            </label>
          </>
        )}
        {supportsPeriod && !isGapStudy && (
          <label className="form-field">
            <span>Period</span>
            <input
              className="input-control h-9"
              min={2}
              onChange={(event) =>
                onUpdate({ period: clampInteger(event.target.value, 2, 500) })
              }
              type="number"
              value={settings.period}
            />
          </label>
        )}
        {supportsDeviation && (
          <label className="form-field">
            <span>{indicator.kind === "bb" ? "Std Dev" : "Multiplier"}</span>
            <input
              className="input-control h-9"
              min={0.5}
              onChange={(event) => onUpdate({ stdDev: Number(event.target.value) })}
              step={0.1}
              type="number"
              value={settings.stdDev ?? 2}
            />
          </label>
        )}
        <label className="form-field">
          <span>{isGapStudy ? "Bullish" : "Color"}</span>
          <ThemedColorPicker
            ariaLabel="Indicator color"
            onChange={(color) => onUpdate({ color })}
            value={settings.color}
          />
        </label>
        {isGapStudy && (
          <label className="form-field">
            <span>Bearish</span>
            <ThemedColorPicker
              ariaLabel="Opposite indicator color"
              onChange={(secondaryColor) => onUpdate({ secondaryColor, signalColor: secondaryColor })}
              value={settings.secondaryColor ?? settings.signalColor ?? "#f43f5e"}
            />
          </label>
        )}
      </div>
    </div>
  );
}

function clampInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, parsed));
}

function chartStyleLabel(style: ChartStyle) {
  switch (style) {
    case "area":
      return "Area";
    case "heikinAshi":
      return "Heikin";
    case "line":
      return "Line";
    default:
      return "Candles";
  }
}
