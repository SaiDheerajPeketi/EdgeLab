import { usePineInputMetadata } from "../lib/usePineInputMetadata";
import {
  Activity,
  AreaChart,
  ArrowDown,
  ArrowUp,
  Bot,
  CandlestickChart,
  Camera,
  Check,
  ChevronDown,
  Code2,
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
  DEFAULT_CHART_SYNC_SETTINGS,
  searchChartSymbols,
  type ChartSymbolOption,
  type ChartSyncSettings,
  type DrawingMappingPolicy,
} from "../lib/chartWorkspace";
import {
  hydrateChartSettingsPresets,
  loadActiveChartSettingsPresetName,
  loadChartSettingsPresets,
  normalizeChartSettingsPresetName,
  sanitizeChartVisualSettings,
  subscribeChartSettingsPresets,
  type ChartLineStyle,
  type ChartSettingsPreset,
  type ChartVisualSettings,
} from "../lib/chartSettings";
import { confirmChartSettingsTemplate, type ChartTemplateAction } from "../lib/chartSettingsTemplates";
import { assertAppDataAccess, captureAppDataAccess } from "../lib/appDataBarrier";
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
  favoriteIndicatorScriptId,
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
import {
  CHART_SESSION_TEMPLATES,
  type ChartSessionTemplatePreference,
  type ChartTradingHoursMode,
} from "../lib/chartSessions";
import {
  ORDER_FLOW_COLOR_TEMPLATES,
  orderFlowColorTemplate,
  type OrderFlowAlignment,
  type OrderFlowDisplayMode,
  type OrderFlowStatsMetric,
  type OrderFlowTemplateId,
} from "../lib/orderFlowPresentation";
import { IndicatorCatalogPanel } from "./IndicatorCatalogPanel";
import { ThemedColorPicker } from "./ThemedColorPicker";
import { ThemedSelect } from "./ThemedSelect";
import { isPineScriptSource, sanitizePinePrepared, type CustomIndicatorScript } from "../lib/customIndicators";
import { pineSourceVersion } from "../lib/pineProtocol";
import { PineInputControl } from "./PineInputControl";
import { OverlaySurface } from "./overlays/OverlaySurface";

type ChartSyncToggleKey = Exclude<keyof ChartSyncSettings, "drawingMappingPolicy">;

const CHART_SYNC_TOGGLES: ReadonlyArray<{
  key: ChartSyncToggleKey;
  label: string;
}> = [
  { key: "symbol", label: "Symbol" },
  { key: "interval", label: "Interval" },
  { key: "crosshair", label: "Crosshair" },
  { key: "visibleRange", label: "Range" },
  { key: "style", label: "Style" },
  { key: "drawings", label: "Drawings" },
];

const DEFAULT_CHART_SYNC_TOGGLE_KEYS = CHART_SYNC_TOGGLES.map(({ key }) => key);

type Props = {
  activePaneLabel: string;
  captureMessage?: string;
  captureStatus?: ChartCaptureStatus;
  chartSettings: ChartVisualSettings;
  chartStyle: ChartStyle;
  clearableDrawingsCount: number;
  customIndicatorScripts?: readonly CustomIndicatorScript[];
  drawingTool: DrawingTool;
  drawingsCount: number;
  indicatorInstances: ChartIndicatorInstance[];
  keepDrawingAfterPlacement?: boolean;
  layoutName: string;
  layoutNames: string[];
  defaultLayoutName?: string | null;
  startupLayoutName?: string | null;
  workspaceRecoveryMessage?: string | null;
  magnetMode: MagnetMode;
  onAddIndicator: (kind: ChartIndicatorKind) => void;
  onAddCustomIndicator?: (script: CustomIndicatorScript) => void;
  onCaptureChart?: () => void;
  onCaptureRegionForQuant?: () => void;
  onChartSettingsChange: (settings: ChartVisualSettings) => void;
  onChartSettingsReset: () => void;
  onClearDrawings: () => void;
  onChartStyleChange: (style: ChartStyle) => void;
  onDeleteLayout: (name: string) => void;
  onDuplicateLayout?: (name: string) => void;
  onDrawingToolChange: (tool: DrawingTool) => void;
  onLayoutNameChange: (name: string) => void;
  onRenameLayout?: (from: string, to: string) => void;
  onSetDefaultLayout?: (name: string) => void;
  onSetStartupLayout?: (name: string) => void;
  onKeepDrawingAfterPlacementChange?: (value: boolean) => void;
  onLoadLayout: (name: string) => void;
  onMagnetModeChange: (mode: MagnetMode) => void;
  onPaneLayoutChange: (layout: ChartPaneLayoutId) => void;
  onReplayTimeframeChange: (timeframe: ChartTimeframe) => void;
  onSaveLayout: () => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onSymbolChange?: (symbol: string) => void;
  onSyncSettingsChange?: (settings: ChartSyncSettings) => void;
  onDrawingMarkerChange?: (marker: string) => void;
  onEditCustomIndicator?: (script: CustomIndicatorScript) => void;
  onOpenIndicatorEditor?: () => void;
  onOpenQuant?: () => void;
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
  symbol?: string;
  symbolOptions?: ChartSymbolOption[];
  syncSettingKeys?: readonly ChartSyncToggleKey[];
  syncSettings?: ChartSyncSettings;
  drawingMarker?: string;
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
  { icon: TvTrendLineIcon, label: "Ray", tool: "ray" },
  { icon: TvTrendLineIcon, label: "Extended", tool: "extendedLine" },
  { icon: TvTrendLineIcon, label: "Segment", tool: "segment" },
  { icon: TvTrendLineIcon, label: "Angle", tool: "angle" },
  { icon: TvHorizontalLineIcon, label: "H-Ray", tool: "horizontalRay" },
  { icon: TvTrendLineIcon, label: "Channel", tool: "parallelChannel" },
  { icon: TvHorizontalLineIcon, label: "H-Line", shortcut: "H", tool: "horizontal" },
  { icon: TvVerticalLineIcon, label: "V-Line", shortcut: "V", tool: "vertical" },
  { icon: TvRectangleIcon, label: "Zone", shortcut: "R", tool: "rectangle" },
  { icon: TvRectangleIcon, label: "Ellipse", tool: "ellipse" },
  { icon: TvRectangleIcon, label: "Triangle", tool: "triangle" },
  { icon: TvFibIcon, label: "Fib", shortcut: "F", tool: "fib" },
  { icon: TvFibIcon, label: "Fib Ext", tool: "fibExtension" },
  { icon: TvFibIcon, label: "Fib Channel", tool: "fibChannel" },
  { icon: TvFibIcon, label: "Fib Time", tool: "fibTime" },
  { icon: TvFibIcon, label: "Fib Fan", tool: "fibFan" },
  { icon: TvTrendLineIcon, label: "Pattern", tool: "chartPattern" },
  { icon: TvTrendLineIcon, label: "Elliott", tool: "elliottWave" },
  { icon: TvTrendLineIcon, label: "Harmonic", tool: "harmonicPattern" },
  { icon: TvTrendLineIcon, label: "Brush", tool: "brush" },
  { icon: TvTrendLineIcon, label: "Arrow", tool: "arrow" },
  { icon: TvMeasureIcon, label: "Measure", shortcut: "M", tool: "measure" },
  { icon: TvMeasureIcon, label: "Quick measure", tool: "quickMeasure" },
  { icon: TvCursorIcon, label: "Eraser", tool: "eraser" },
  { icon: TvLongPositionIcon, label: "Long", tool: "longPosition" },
  { icon: TvShortPositionIcon, label: "Short", tool: "shortPosition" },
  { icon: TvTextIcon, label: "Text", shortcut: "L", tool: "text" },
  { icon: TvTextIcon, label: "Callout", tool: "callout" },
  { icon: TvTextIcon, label: "Flag", tool: "flag" },
  { icon: TvTextIcon, label: "Icon", tool: "icon" },
];

const DRAWING_MARKERS = [
  { label: "Star", value: "★" },
  { label: "Flag", value: "⚑" },
  { label: "Up", value: "↑" },
  { label: "Down", value: "↓" },
  { label: "Check", value: "✓" },
  { label: "Warning", value: "!" },
  { label: "Circle", value: "●" },
  { label: "Diamond", value: "◆" },
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
  { icon: Layers, id: "footprint", label: "Footprint" },
  { icon: AreaChart, id: "tpo", label: "TPO Profile" },
];

const TRADING_HOURS_MODES: Array<{
  description: string;
  id: ChartTradingHoursMode;
  label: string;
}> = [
  {
    description: "Regular Trading Hours only; indicators use the filtered bars",
    id: "regular",
    label: "RTH",
  },
  {
    description: "Extended Trading Hours; retain every published source bar",
    id: "extended",
    label: "ETH",
  },
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
  customIndicatorScripts = [],
  drawingTool,
  drawingsCount,
  indicatorInstances,
  keepDrawingAfterPlacement = false,
  layoutName,
  layoutNames,
  defaultLayoutName = null,
  startupLayoutName = null,
  workspaceRecoveryMessage = null,
  magnetMode,
  onAddIndicator,
  onAddCustomIndicator,
  onCaptureChart,
  onCaptureRegionForQuant,
  onChartSettingsChange,
  onChartSettingsReset,
  onChartStyleChange,
  onClearDrawings,
  onDeleteLayout,
  onDuplicateLayout,
  onDrawingToolChange,
  onLayoutNameChange,
  onRenameLayout,
  onSetDefaultLayout,
  onSetStartupLayout,
  onKeepDrawingAfterPlacementChange,
  onLoadLayout,
  onMagnetModeChange,
  onPaneLayoutChange,
  onReplayTimeframeChange,
  onSaveLayout,
  onTimeframeChange,
  onSymbolChange,
  onSyncSettingsChange,
  onDrawingMarkerChange,
  onEditCustomIndicator,
  onOpenIndicatorEditor,
  onOpenQuant,
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
  symbol = "MARKET",
  symbolOptions = [],
  syncSettingKeys = DEFAULT_CHART_SYNC_TOGGLE_KEYS,
  syncSettings = DEFAULT_CHART_SYNC_SETTINGS,
  drawingMarker = "★",
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
  const [markerQuery, setMarkerQuery] = useState("");
  const [selectedLayoutName, setSelectedLayoutName] = useState(() =>
    layoutNames.includes(layoutName) ? layoutName : "",
  );
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState(symbol);
  const [symbolActiveIndex, setSymbolActiveIndex] = useState(0);
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
  const [settingsActivePresetName, setSettingsActivePresetName] = useState<string | null>(() => loadActiveChartSettingsPresetName());
  const settingsNameEdited = useRef(false);
  const [templatePending, setTemplatePending] = useState<ChartTemplateAction | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const templateOperationRef = useRef<object | null>(null);
  const templateMountedRef = useRef(true);
  const templateDraftSignature = JSON.stringify([chartSettings, settingsPresetName, activePaneLabel, symbol, timeframe, paneLayout, syncSettings.style, settingsOpen]);
  const templateDraftRef = useRef({ signature: templateDraftSignature, revision: 0 });
  if (templateDraftRef.current.signature !== templateDraftSignature) {
    templateDraftRef.current = { signature: templateDraftSignature, revision: templateDraftRef.current.revision + 1 };
  }
  useEffect(() => {
    templateMountedRef.current = true;
    return () => { templateMountedRef.current = false; };
  }, []);

  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const suppressCommandFocusOpenRef = useRef(false);
  const symbolInputRef = useRef<HTMLInputElement | null>(null);
  const indicatorCatalogId = useId();
  const commandMenuId = useId();
  const settingsOverlayId = useId();
  const commandRef = useRef<HTMLDivElement | null>(null);
  const commandSurfaceRef = useRef<HTMLDivElement | null>(null);
  const drawingFavoritesRef = useRef<HTMLDivElement | null>(null);
  const drawingFavoritesSurfaceRef = useRef<HTMLDivElement | null>(null);
  const drawingFavoritesTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const indicatorMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsAnchorRef = useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
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
  const favoriteIndicatorOptions = indicatorFavorites.flatMap((favorite) => {
    const scriptId = favoriteIndicatorScriptId(favorite);
    if (scriptId != null) {
      const script = customIndicatorScripts.find((item) => item.id === scriptId);
      return script ? [{
        color: script.color,
        count: indicatorInstances.filter((instance) => instance.kind === "custom" && instance.customScriptId === scriptId).length,
        description: script.description,
        disabled: !onAddCustomIndicator,
        id: favorite,
        label: script.name,
        add: () => onAddCustomIndicator?.(script),
      }] : [];
    }
    const indicator = getIndicatorCatalogItem(favorite as ChartIndicatorKind);
    if (!indicator) return [];
    const count = indicatorInstances.filter((instance) => instance.kind === indicator.kind).length;
    return [{
      color: indicator.color,
      count,
      description: indicator.description,
      disabled: isSingleInstanceIndicator(indicator.kind) && count > 0,
      id: favorite,
      label: indicator.label,
      add: () => onAddIndicator(indicator.kind),
    }];
  });
  const visibleSymbolOptions = searchChartSymbols(symbolOptions, symbolQuery, 10);
  const visibleMarkers = DRAWING_MARKERS.filter((marker) =>
    `${marker.label} ${marker.value}`.toLowerCase().includes(markerQuery.trim().toLowerCase()),
  );

  const closeIndicatorMenu = useCallback((restoreFocus = false) => {
    setIndicatorMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => indicatorMenuTriggerRef.current?.focus());
    }
  }, []);

  const closeSymbolMenu = useCallback((restoreValue = true) => {
    setSymbolMenuOpen(false);
    setSymbolActiveIndex(0);
    if (restoreValue) setSymbolQuery(symbol);
  }, [symbol]);

  function selectSymbol(option: ChartSymbolOption) {
    onSymbolChange?.(option.symbol);
    setSymbolQuery(option.symbol);
    setSymbolMenuOpen(false);
    setSymbolActiveIndex(0);
    window.requestAnimationFrame(() => symbolInputRef.current?.focus());
  }

  function handleSymbolKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSymbolMenu();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!symbolMenuOpen) setSymbolMenuOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setSymbolActiveIndex((index) =>
        visibleSymbolOptions.length === 0
          ? 0
          : (index + direction + visibleSymbolOptions.length) % visibleSymbolOptions.length,
      );
      return;
    }
    if (event.key === "Enter") {
      const selected = visibleSymbolOptions[symbolActiveIndex] ?? visibleSymbolOptions[0];
      if (selected) {
        event.preventDefault();
        selectSymbol(selected);
      }
    }
  }

  useEffect(() => {
    if (!symbolMenuOpen) setSymbolQuery(symbol);
  }, [symbol, symbolMenuOpen]);

  useEffect(() => {
    if (layoutNames.includes(layoutName)) setSelectedLayoutName(layoutName);
    else if (selectedLayoutName && !layoutNames.includes(selectedLayoutName)) setSelectedLayoutName("");
  }, [layoutName, layoutNames, selectedLayoutName]);

  useEffect(() => {
    function handleOpenSymbolSearch(event: Event) {
      if (!onSymbolChange) return;
      const detail = (event as CustomEvent<{ query?: string }>).detail;
      setSymbolQuery(detail?.query ?? "");
      setSymbolActiveIndex(0);
      setSymbolMenuOpen(true);
      window.requestAnimationFrame(() => symbolInputRef.current?.focus());
    }
    window.addEventListener("edgelab:open-symbol-search", handleOpenSymbolSearch);
    return () => window.removeEventListener("edgelab:open-symbol-search", handleOpenSymbolSearch);
  }, [onSymbolChange]);

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
    if (preferredName || !settingsNameEdited.current) setSettingsPresetName(nextName);
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
      if (!templateOperationRef.current) setSettingsActivePresetName(nextName);
      if (!templateOperationRef.current && !settingsNameEdited.current) setSettingsPresetName(nextName);
    });
    const unsubscribe = subscribeChartSettingsPresets((nextPresets) => {
      const nextName = loadActiveChartSettingsPresetName(nextPresets) ?? "Default";
      setSettingsPresets(nextPresets);
      if (!templateOperationRef.current) setSettingsActivePresetName((current) => nextPresets.some((preset) => preset.name === current) ? current : null);
      if (!templateOperationRef.current && !settingsNameEdited.current) setSettingsPresetName((current) =>
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

  function closeCommandSearch() {
    suppressCommandFocusOpenRef.current = true;
    setCommandOpen(false);
    setCommandQuery("");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        suppressCommandFocusOpenRef.current = false;
      });
    });
  }

  function focusCommandResult(position: "first" | "last") {
    window.requestAnimationFrame(() => {
      const commands = commandSurfaceRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-chart-command-result]:not([disabled])",
      );
      commands?.[position === "first" ? 0 : commands.length - 1]?.focus();
    });
  }

  function handleCommandInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    if (!commandOpen) {
      setCommandOpen(true);
    }
    focusCommandResult(event.key === "ArrowDown" ? "first" : "last");
  }

  function handleCommandSurfaceKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const commands = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[data-chart-command-result]:not([disabled])",
    )];
    const active = event.target instanceof HTMLElement
      ? event.target.closest<HTMLButtonElement>("[data-chart-command-result]")
      : null;
    const activeIndex = active ? commands.indexOf(active) : -1;
    if (commands.length === 0 || activeIndex < 0) {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? commands.length - 1
        : event.key === "ArrowDown"
          ? (activeIndex + 1) % commands.length
          : (activeIndex - 1 + commands.length) % commands.length;
    commands[nextIndex]?.focus();
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

  function handleTradingHoursKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % TRADING_HOURS_MODES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + TRADING_HOURS_MODES.length) %
        TRADING_HOURS_MODES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TRADING_HOURS_MODES.length - 1;
    }
    if (nextIndex == null) {
      return;
    }
    event.preventDefault();
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    onChartSettingsChange({
      ...chartSettings,
      tradingHoursMode: TRADING_HOURS_MODES[nextIndex].id,
    });
    window.requestAnimationFrame(() => buttons?.[nextIndex]?.focus());
  }

  async function changeTemplate(action: ChartTemplateAction, name: string) {
    if (templateOperationRef.current) return;
    const operation = {};
    const access = captureAppDataAccess();
    const revision = templateDraftRef.current.revision;
    const presetName = normalizeChartSettingsPresetName(name);
    const submitted = sanitizeChartVisualSettings(chartSettings);
    templateOperationRef.current = operation;
    setTemplatePending(action);
    setTemplateError(null);
    setTemplateNotice(null);
    const current = () => {
      if (!templateMountedRef.current || templateOperationRef.current !== operation) return false;
      try { assertAppDataAccess(access); return true; } catch { return false; }
    };
    try {
      const { presets, activeName } = await confirmChartSettingsTemplate(action, presetName, action === "save" ? submitted : undefined);
      if (!current()) return;
      const latestPresets = loadChartSettingsPresets();
      const targetSettings = (values: ChartSettingsPreset[]) => values.find((entry) => entry.name === presetName)?.settings;
      const unchanged = templateDraftRef.current.revision === revision &&
        (action === "delete" || (loadActiveChartSettingsPresetName(latestPresets) === activeName && JSON.stringify(targetSettings(latestPresets)) === JSON.stringify(targetSettings(presets))));
      // A later queued edit may already have rebased this acknowledged bundle.
      setSettingsPresets(latestPresets);
      if (action === "delete") {
        setSettingsActivePresetName((active) => active === presetName ? null : active);
        if (unchanged && !settingsNameEdited.current) setSettingsPresetName(loadActiveChartSettingsPresetName(latestPresets) ?? "Default");
        setTemplateNotice(`Deleted ${presetName}.`);
      } else if (unchanged) {
        settingsNameEdited.current = false;
        setSettingsPresetName(presetName);
        setSettingsActivePresetName(presetName);
        if (action === "activate") {
          const preset = presets.find((entry) => entry.name === presetName)!;
          onChartSettingsChange(preset.settings);
          setTemplateNotice(`Using ${presetName}.`);
        } else {
          setSettingsOpen(false);
        }
      } else {
        setTemplateNotice(action === "save" ? `Saved ${presetName}. Your newer changes are still unsaved.` : `Selected ${presetName}. Your newer chart changes were kept. Select it again to apply.`);
      }
    } catch (error) {
      if (!current()) return;
      setTemplateError(error instanceof Error && "requiresReload" in error ? error.message : action === "save" ? "Couldn't save the template. Your changes are still here. Try Save Template again." : action === "delete" ? "Couldn't delete the template. It has been kept. Try Delete again." : "Couldn't switch templates. Your current chart settings were kept. Try again.");
    } finally {
      if (templateOperationRef.current === operation) {
        templateOperationRef.current = null;
        if (templateMountedRef.current) setTemplatePending(null);
      }
    }
  }

  const settingsPanel = settingsOpen ? (
    <OverlaySurface anchorRef={toolsOpen ? settingsTriggerRef : settingsAnchorRef} surfaceRef={settingsRef} triggerRef={settingsTriggerRef} open onDismiss={(reason) => { setSettingsOpen(false); if (reason === "escape") settingsTriggerRef.current?.focus({ preventScroll: true }); }} align="right" mobileSheet preferredWidth={860} minWidth={320} estimatedHeight={680} id={settingsOverlayId} role="dialog" ariaLabel="Chart settings" className="chart-settings-overlay z-[var(--layer-popover)]">
    <ChartSettingsPanel
      activePresetName={settingsActivePresetName}
      indicatorInstances={indicatorInstances}
      onClose={() => setSettingsOpen(false)}
      onDeletePreset={(name) => { void changeTemplate("delete", name); }}
      onLoadPreset={(name) => { void changeTemplate("activate", name); }}
      onPresetNameChange={(name) => { templateDraftRef.current.revision += 1; settingsNameEdited.current = true; setSettingsPresetName(name); setTemplateNotice(null); }}
      onRemoveIndicator={onRemoveIndicator}
      onReset={() => { templateDraftRef.current.revision += 1; setTemplateNotice(null); onChartSettingsReset(); }}
      onSavePreset={() => { void changeTemplate("save", settingsPresetName); }}
      onSettingsChange={(settings) => { templateDraftRef.current.revision += 1; setTemplateNotice(null); onChartSettingsChange(settings); }}
      templateError={templateError}
      templateNotice={templateNotice}
      templatePending={templatePending}
      onUpdateIndicatorSettings={onUpdateIndicatorSettings}
      presetName={settingsPresetName}
      presets={settingsPresets}
      settings={chartSettings}
    />
    </OverlaySurface>
  ) : null;

  function removeStudy(indicatorId: string, button: HTMLButtonElement) {
    const toolbar = button.closest(".chart-studio-toolbar");
    const active = document.activeElement;
    if (toolbar?.contains(active) && active instanceof Element && active.closest("[data-study-instance]")?.getAttribute("data-study-instance") === indicatorId) {
      const scope = button.closest(".study-manager-strip") ?? toolbar;
      const actions = Array.from(scope.querySelectorAll<HTMLButtonElement>("[data-study-action]"));
      const index = actions.indexOf(button);
      const survives = (candidate: HTMLButtonElement) => candidate.isConnected && candidate.getAttribute("data-study-instance") !== indicatorId;
      const fallback = actions.slice(index + 1).find(survives) ?? actions.slice(0, index).reverse().find(survives) ?? indicatorMenuTriggerRef.current;
      fallback?.focus({ preventScroll: true });
    }
    onRemoveIndicator(indicatorId);
  }

  if (!toolsOpen) {
    return (
      <div ref={settingsAnchorRef} className="chart-settings-host">
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
                {formatChartTimeframeLabel(timeframe)} / {chartStyleLabel(chartStyle)} / {chartSettings.tradingHoursMode === "regular" ? "RTH" : "ETH"} / {getChartTimeZoneLabel(chartSettings.timeZone)} / {indicatorInstances.length} studies / {drawingsCount} drawings
              </div>
            </div>
          </div>
        </div>

        {onSymbolChange ? (
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <label className="sr-only" htmlFor="chart-symbol-search">Chart symbol</label>
            <div className="chart-command-box">
              <Search aria-hidden="true" size={15} className="text-cyan-200" />
              <input
                aria-activedescendant={
                  symbolMenuOpen && visibleSymbolOptions[symbolActiveIndex]
                    ? `chart-symbol-option-${visibleSymbolOptions[symbolActiveIndex].id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-controls="chart-symbol-results"
                aria-expanded={symbolMenuOpen}
                autoComplete="off"
                id="chart-symbol-search"
                onBlur={() => window.setTimeout(() => closeSymbolMenu(false), 120)}
                onChange={(event) => {
                  setSymbolQuery(event.target.value);
                  setSymbolActiveIndex(0);
                  setSymbolMenuOpen(true);
                }}
                onFocus={() => setSymbolMenuOpen(true)}
                onKeyDown={handleSymbolKeyDown}
                placeholder="Symbol or market"
                ref={symbolInputRef}
                role="combobox"
                value={symbolQuery}
              />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {activePaneLabel}
              </span>
            </div>
            {symbolMenuOpen ? (
              <div className="chart-command-menu" id="chart-symbol-results" role="listbox">
                <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  Symbols · ↑↓ choose · Enter apply · Esc close
                </div>
                {visibleSymbolOptions.length > 0 ? visibleSymbolOptions.map((option, index) => (
                  <button
                    aria-selected={index === symbolActiveIndex}
                    className={index === symbolActiveIndex ? "chart-command-item chart-command-item-active" : "chart-command-item"}
                    id={`chart-symbol-option-${option.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`}
                    key={option.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setSymbolActiveIndex(index)}
                    onClick={() => selectSymbol(option)}
                    role="option"
                    type="button"
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="block truncate text-sm text-slate-100">{option.label}</strong>
                      <span className="block truncate text-xs text-slate-500">{option.name} · {option.assetClass}</span>
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-cyan-200/70">{option.source}</span>
                  </button>
                )) : (
                  <div className="px-4 py-5 text-center text-sm text-slate-500" role="status">
                    No symbols match “{symbolQuery}”.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          ref={commandRef}
          className="chart-command-box"
          onClickCapture={openCommandSearch}
          onPointerDownCapture={openCommandSearch}
        >
          <Command size={15} className="text-cyan-200" />
          <input
            aria-autocomplete="list"
            aria-controls={commandMenuId}
            aria-expanded={commandOpen}
            aria-haspopup="dialog"
            aria-label="Search chart commands"
            role="combobox"
            ref={commandInputRef}
            onChange={(event) => {
              setCommandQuery(event.target.value);
              setCommandOpen(true);
            }}
            onClick={() => setCommandOpen(true)}
            onFocus={() => {
              if (!suppressCommandFocusOpenRef.current) {
                setCommandOpen(true);
              }
            }}
            onKeyDown={handleCommandInputKeyDown}
            onPointerDown={() => setCommandOpen(true)}
            placeholder="Search tools, indicators, styles, intervals"
            value={commandQuery}
          />
          <Search size={14} className="text-slate-500" />
          {commandOpen && (
            <OverlaySurface anchorRef={commandRef} surfaceRef={commandSurfaceRef} triggerRef={commandInputRef} open onDismiss={closeCommandSearch} preferredWidth={520} estimatedHeight={440} id={commandMenuId} onKeyDown={handleCommandSurfaceKeyDown} role="dialog" ariaLabel="Chart command search results" className="chart-command-menu z-[var(--layer-popover)]">
            <CommandMenu
              indicatorInstances={indicatorInstances}
              onChartStyleChange={selectChartStyle}
              onClose={closeCommandSearch}
              onDrawingToolChange={onDrawingToolChange}
              onMagnetModeChange={onMagnetModeChange}
              onTimeframeChange={onTimeframeChange}
              onAddIndicator={onAddIndicator}
              query={commandQuery}
              sourceTimeframe={sourceTimeframe}
            />
            </OverlaySurface>
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
          <div
            aria-label="Trading hours for active chart pane"
            className="flex min-h-9 items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1"
            role="radiogroup"
          >
            <span className="px-1 text-xs font-semibold text-slate-400">Hours</span>
            {TRADING_HOURS_MODES.map((mode, index) => (
              <button
                aria-checked={chartSettings.tradingHoursMode === mode.id}
                aria-label={mode.description}
                className={`chart-mode-button h-7 px-2 ${
                  chartSettings.tradingHoursMode === mode.id ? "chart-mode-active" : ""
                }`}
                key={mode.id}
                onClick={() =>
                  onChartSettingsChange({ ...chartSettings, tradingHoursMode: mode.id })
                }
                onKeyDown={(event) => handleTradingHoursKeyDown(event, index)}
                role="radio"
                tabIndex={chartSettings.tradingHoursMode === mode.id ? 0 : -1}
                title={mode.description}
                type="button"
              >
                {mode.label}
              </button>
            ))}
          </div>
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
          {onCaptureRegionForQuant ? (
            <button
              className="chart-mode-button"
              disabled={captureStatus === "capturing"}
              onClick={onCaptureRegionForQuant}
              title="Drag-select a chart region, then add a typed or dictated prompt in Quant"
              type="button"
            >
              <Star size={15} />
              Ask Quant
            </button>
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

      {onSyncSettingsChange && syncSettingKeys.length > 0 ? (
        <div className="layout-manager-strip" aria-label="Chart synchronization controls">
          <span className="study-manager-label">Sync panes</span>
          {CHART_SYNC_TOGGLES.filter(({ key }) => syncSettingKeys.includes(key)).map(({ key, label }) => (
            <button
              aria-pressed={syncSettings[key]}
              className={`studio-tool-button ${syncSettings[key] ? "studio-tool-button-active" : ""}`}
              key={key}
              onClick={() => onSyncSettingsChange({ ...syncSettings, [key]: !syncSettings[key] })}
              type="button"
            >
              {label}
            </button>
          ))}
          {syncSettingKeys.includes("drawings") ? (
            <ThemedSelect
              ariaLabel="Drawing synchronization mapping policy"
              className="h-8 min-w-52"
              disabled={!syncSettings.drawings}
              onChange={(value) => onSyncSettingsChange({
                ...syncSettings,
                drawingMappingPolicy: value as DrawingMappingPolicy,
              })}
              options={[
                { label: "Same symbol + interval", value: "same-symbol-timeframe" },
                { label: "Map timestamp + price", value: "time-price" },
              ]}
              value={syncSettings.drawingMappingPolicy}
            />
          ) : null}
        </div>
      ) : null}

      <div className="layout-manager-strip">
        <span className="study-manager-label">Layouts</span>
        <ThemedSelect
          ariaLabel="Saved layouts"
          className="h-8 w-44"
          onChange={(name) => {
            setSelectedLayoutName(name);
            onLoadLayout(name);
          }}
          options={
            layoutNames.length > 0
              ? [
                  { disabled: true, label: "Saved layouts", value: "" },
                  ...layoutNames.map((name) => ({ label: name, value: name })),
                ]
              : [{ disabled: true, label: "No saved layouts", value: "" }]
          }
          value={selectedLayoutName}
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
          disabled={!selectedLayoutName}
          onClick={() => onDeleteLayout(selectedLayoutName)}
          type="button"
        >
          <Trash2 size={13} />
          Delete
        </button>
        {onDuplicateLayout ? (
          <button
            className="studio-tool-button"
            disabled={!selectedLayoutName}
            onClick={() => onDuplicateLayout(selectedLayoutName)}
            type="button"
          >
            Duplicate
          </button>
        ) : null}
        {onRenameLayout ? (
          <button
            className="studio-tool-button"
            disabled={!selectedLayoutName || selectedLayoutName === layoutName.trim()}
            onClick={() => onRenameLayout(selectedLayoutName, layoutName)}
            title="Type a new name, then choose Rename"
            type="button"
          >
            Rename
          </button>
        ) : null}
        {onSetDefaultLayout ? (
          <button
            aria-pressed={defaultLayoutName === selectedLayoutName}
            className={`studio-tool-button ${defaultLayoutName === selectedLayoutName ? "studio-tool-button-active" : ""}`}
            disabled={!selectedLayoutName}
            onClick={() => onSetDefaultLayout(selectedLayoutName)}
            type="button"
          >
            Default
          </button>
        ) : null}
        {onSetStartupLayout ? (
          <button
            aria-pressed={startupLayoutName === selectedLayoutName}
            className={`studio-tool-button ${startupLayoutName === selectedLayoutName ? "studio-tool-button-active" : ""}`}
            disabled={!selectedLayoutName}
            onClick={() => onSetStartupLayout(selectedLayoutName)}
            type="button"
          >
            Startup
          </button>
        ) : null}
        {workspaceRecoveryMessage ? (
          <span className="text-xs text-amber-200" role="status">{workspaceRecoveryMessage}</span>
        ) : null}
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
              <OverlaySurface
                align="right"
                anchorRef={drawingFavoritesRef}
                ariaLabel="Circular toolbox favorites"
                className="drawing-favorites-panel"
                estimatedHeight={520}
                id="chart-drawing-favorites"
                onDismiss={() => setDrawingFavoritesOpen(false)}
                open
                preferredWidth={340}
                role="dialog"
                surfaceRef={drawingFavoritesSurfaceRef}
                triggerRef={drawingFavoritesTriggerRef}
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
              </OverlaySurface>
            )}
          </div>
        </div>

        {(drawingTool === "icon" || drawingTool === "flag") && onDrawingMarkerChange ? (
          <div className="flex min-w-48 flex-wrap items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1" role="group" aria-label="Drawing marker library">
            <input
              aria-label="Search drawing markers"
              className="input-control h-8 w-28 text-xs"
              onChange={(event) => setMarkerQuery(event.target.value)}
              placeholder="Search markers"
              value={markerQuery}
            />
            {visibleMarkers.map((marker) => (
              <button
                aria-label={`Use ${marker.label} marker`}
                aria-pressed={drawingMarker === marker.value}
                className={`studio-tool-button h-8 min-w-8 ${drawingMarker === marker.value ? "studio-tool-button-active" : ""}`}
                key={marker.label}
                onClick={() => onDrawingMarkerChange(marker.value)}
                title={marker.label}
                type="button"
              >
                {marker.value}
              </button>
            ))}
            {visibleMarkers.length === 0 ? (
              <span className="px-2 text-xs text-slate-500">No markers</span>
            ) : null}
          </div>
        ) : null}

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
              <IndicatorCatalogPanel
                anchorRef={indicatorMenuTriggerRef}
                customScripts={customIndicatorScripts}
                favorites={indicatorFavorites}
                indicatorInstances={indicatorInstances}
                onAddCustomIndicator={onAddCustomIndicator}
                onAddIndicator={onAddIndicator}
                onClose={closeIndicatorMenu}
                onEditCustomIndicator={onEditCustomIndicator}
                onToggleFavorite={toggleFavoriteIndicator}
                id={indicatorCatalogId}
              />
          )}
        </div>

        {onOpenIndicatorEditor ? (
          <button className="chart-dropdown-trigger" onClick={onOpenIndicatorEditor} type="button">
            <Code2 size={15} />
            Editor
          </button>
        ) : null}

        {onOpenQuant ? (
          <button className="chart-dropdown-trigger" onClick={onOpenQuant} type="button">
            <Bot size={15} />
            Quant
          </button>
        ) : null}

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
              const { count, disabled } = indicator;
              return (
                <button
                  aria-label={
                    disabled
                      ? count > 0 ? `${indicator.label} is already active` : `${indicator.label} cannot be added in this chart`
                      : count > 0
                        ? `Add another ${indicator.label} indicator; ${count} active`
                        : `Add ${indicator.label} indicator`
                  }
                  className={`studio-tool-button ${count > 0 ? "text-cyan-100" : ""}`}
                  disabled={disabled}
                  key={indicator.id}
                  onClick={indicator.add}
                  title={disabled && count > 0 ? `${indicator.label} supports one instance` : indicator.description}
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

        <div ref={settingsAnchorRef} className="relative">
          <button
            aria-controls={settingsOverlayId}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            className="chart-dropdown-trigger"
            onClick={() => {
              setSettingsOpen((value) => !value);
              setIndicatorMenuOpen(false);
            }}
            ref={settingsTriggerRef}
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
                aria-label={`Remove ${indicatorDisplayName(indicator)}`}
                className="indicator-chip indicator-chip-active"
                data-study-action="true"
                data-study-instance={indicator.id}
                key={indicator.id}
                onClick={(event) => removeStudy(indicator.id, event.currentTarget)}
                type="button"
              >
                {indicator.kind === "custom" && isPineScriptSource(indicator.customScriptSource ?? "") ? <Code2 aria-hidden="true" className="shrink-0" size={14} /> : <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: settings.color }}
                />}
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
            if (indicator.kind === "custom" && isPineScriptSource(indicator.customScriptSource ?? "")) {
              const saved = customIndicatorScripts?.find((script) => script.id === indicator.customScriptId && script.source === indicator.customScriptSource);
              return <NativeStudyInputs indicator={indicator} key={indicator.id}
                onEdit={saved && onEditCustomIndicator ? () => onEditCustomIndicator(saved) : undefined}
                onRemove={(button) => removeStudy(indicator.id, button)}
                onUpdate={(patch) => onUpdateIndicatorSettings(indicator.id, patch)} />;
            }
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
                  aria-label={`Remove ${indicatorDisplayName(indicator)}`}
                  className="study-action-button"
                  data-study-action="true"
                  data-study-instance={indicator.id}
                  onClick={(event) => removeStudy(indicator.id, event.currentTarget)}
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

function NativeStudyInputs({ indicator, onEdit, onRemove, onUpdate }: {
  indicator: ChartIndicatorInstance;
  onEdit?: () => void;
  onRemove: (button: HTMLButtonElement) => void;
  onUpdate: (settings: Partial<IndicatorSettings>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const disclosureId = useId();
  const name = indicatorDisplayName(indicator);
  const source = indicator.customScriptSource!;
  const prepared = usePineInputMetadata(source, sanitizePinePrepared(indicator.customPinePrepared, source));
  let version: number | undefined = prepared?.pineVersion;
  if (version === undefined) { try { version = pineSourceVersion(source); } catch { /* Unsupported source stays native. */ } }
  const close = () => { setExpanded(false); trigger.current?.focus({ preventScroll: true }); };
  return <div className="study-chip native-study-chip" data-study-instance={indicator.id}>
    <div className="flex min-w-0 items-center gap-2">
      <Code2 aria-hidden="true" className="shrink-0 text-slate-300" size={16} />
      <span className="native-study-name min-w-0 flex-1 font-semibold text-slate-100">{name}</span>
      <button aria-controls={disclosureId} aria-expanded={expanded} aria-label={`Inputs for ${name}`} className="study-action-button px-2 text-cyan-100" data-study-action="true" data-study-instance={indicator.id} onClick={() => setExpanded(!expanded)} ref={trigger} type="button">Inputs</button>
      <button aria-label={`Remove ${name}`} className="study-action-button" data-study-action="true" data-study-instance={indicator.id} onClick={(event) => onRemove(event.currentTarget)} title={`Remove ${name}`} type="button"><X aria-hidden="true" size={14} /></button>
    </div>
    <p className="native-study-caption mt-1 text-xs leading-5 text-slate-300">Native Pine{version ? ` v${version}` : ""} · revision {indicator.customScriptVersion ?? 1}</p>
    {indicator.runtimeError ? <p className="native-study-caption mt-1 text-xs leading-5 text-amber-200">Runtime error · {indicator.runtimeError}</p> : null}
    <div aria-label={`Pine inputs for ${name}`} className="native-study-inputs" hidden={!expanded} id={disclosureId} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }} role="group">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-200">Pine inputs</span>
        <button aria-label={`Close inputs for ${name}`} className="study-action-button" onClick={close} type="button"><X aria-hidden="true" size={14} /></button>
      </div>
      <div className="native-study-input-list">
        {prepared?.inputDefinitions.map((definition) => <PineInputControl key={definition.id} definitions={prepared.inputDefinitions} inputs={indicator.settings.customInputs} definition={definition} value={indicator.settings.customInputs?.[definition.id]} onChange={(value) => onUpdate({ customInputs: { ...indicator.settings.customInputs, [definition.id]: value } })} />)}
        {!prepared ? <div className="grid min-w-0 gap-2">
          <p className="text-xs leading-5 text-slate-300">Check and save this Pine script in the editor to configure its inputs.</p>
          {onEdit ? <button className="study-action-button justify-start px-2 text-cyan-100" onClick={onEdit} type="button">Open saved script in editor</button> : null}
        </div> : !prepared.inputDefinitions.length ? <p className="text-xs leading-5 text-slate-300">No configurable Pine inputs.</p> : null}
      </div>
    </div>
  </div>;
}

// Keep incomplete numeric edits local instead of forcing the minimum after
// every keystroke. Valid values preview immediately; blur commits the bounds.
function useIntegerDraft(value: number, min: number, max: number, onChange: (value: number) => void) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  function commit() {
    const parsed = Number(draft);
    const next = draft.trim() && Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  }
  return {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setDraft(raw);
      const next = Number(raw);
      if (raw.trim() && Number.isInteger(next) && next >= min && next <= max) onChange(next);
    },
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); }
    },
  };
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
  const input = useIntegerDraft(value, 1, 500, onChange);
  return (
    <label className="study-number-pill">
      <span>{label}</span>
      <input
        min={1}
        {...input}
        max={500}
        type="number"
      />
    </label>
  );
}

type ChartSettingsTab = "canvas" | "orderFlow" | "scales" | "status" | "symbol";

const CHART_SETTINGS_TABS: Array<{ id: ChartSettingsTab; label: string }> = [
  { id: "symbol", label: "Symbol" },
  { id: "status", label: "Status line" },
  { id: "scales", label: "Scales and lines" },
  { id: "orderFlow", label: "Order flow" },
  { id: "canvas", label: "Canvas" },
];

function ChartSettingsPanel({
  activePresetName,
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
  templateError,
  templateNotice,
  templatePending,
}: {
  activePresetName: string | null;
  templateError: string | null;
  templateNotice: string | null;
  templatePending: ChartTemplateAction | null;
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
  const activePreset = presets.find((preset) => preset.name === activePresetName);
  const modified = Boolean(activePreset && JSON.stringify(sanitizeChartVisualSettings(activePreset.settings)) !== JSON.stringify(sanitizeChartVisualSettings(settings)));

  function updateSettings(patch: Partial<ChartVisualSettings>) {
    onSettingsChange({ ...settings, ...patch });
  }

  return (
    <div className="chart-settings-popover">
      <div className="chart-settings-header">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Settings</div>
          <div className="text-xs text-[var(--text-secondary)]">
            Chart display, scales, labels, and canvas styling
          </div>
        </div>
        <button aria-label="Close chart settings" className="icon-button h-8 w-8" onClick={onClose} type="button">
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
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                {presets.length > 0
                  ? "Switch chart settings without changing drawings or indicators."
                  : "Save the current settings to create your first template."}
              </div>
            </div>
            {presets.length > 0 ? (
              <div className="chart-settings-template-list">
                {presets.map((preset) => {
                  const active = preset.name === activePresetName;
                  return (
                    <button
                      className={`chart-settings-template-chip ${active ? "chart-settings-template-chip-active" : ""}`}
                      key={preset.name}
                      disabled={templatePending != null}
                      onClick={() => onLoadPreset(preset.name)}
                      type="button"
                    >
                      <span className="truncate">{preset.name}</span>
                      <span>{active ? modified ? "Modified" : "Active" : "Use"}</span>
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
                <SelectSetting
                  label="Trading hours"
                  onChange={(tradingHoursMode) =>
                    updateSettings({
                      tradingHoursMode: tradingHoursMode as ChartTradingHoursMode,
                    })
                  }
                  options={TRADING_HOURS_MODES.map((mode) => ({
                    label: `${mode.label} · ${mode.id === "regular" ? "Regular only" : "All source bars"}`,
                    value: mode.id,
                  }))}
                  value={settings.tradingHoursMode}
                />
                <SelectSetting
                  label="Session template"
                  onChange={(sessionTemplate) =>
                    updateSettings({
                      sessionTemplate:
                        sessionTemplate as ChartSessionTemplatePreference,
                    })
                  }
                  options={[
                    { label: "Automatic from symbol", value: "auto" },
                    ...CHART_SESSION_TEMPLATES.map((template) => ({
                      label: `${template.label} · ${template.timeZone}`,
                      value: template.id,
                    })),
                  ]}
                  value={settings.sessionTemplate}
                />
                <SettingToggle
                  checked={settings.preMarketShading}
                  label="Pre-market shading"
                  onChange={(preMarketShading) => updateSettings({ preMarketShading })}
                />
                <SettingToggle
                  checked={settings.postMarketShading}
                  label="Post-market shading"
                  onChange={(postMarketShading) => updateSettings({ postMarketShading })}
                />
                <SettingToggle
                  checked={settings.closedSessionShading}
                  label="Closed-session shading"
                  onChange={(closedSessionShading) =>
                    updateSettings({ closedSessionShading })
                  }
                />
                <p className="col-span-full text-xs leading-5 text-[var(--text-secondary)]">
                  Automatic templates follow recognized exchange and instrument symbols.
                  Unknown symbols keep every bar so incomplete metadata never hides data.
                </p>
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

          {activeTab === "orderFlow" && (
            <>
              <SettingsSection title="Footprint">
                <SelectSetting
                  label="Color template"
                  onChange={(orderFlowTemplate) => {
                    const template = orderFlowColorTemplate(
                      orderFlowTemplate as OrderFlowTemplateId,
                    );
                    updateSettings({
                      footprintAskColor: template.askColor,
                      footprintBidColor: template.bidColor,
                      footprintDisplayMode: template.mode,
                      footprintNeutralColor: template.neutralColor,
                      orderFlowTemplate: template.id,
                    });
                  }}
                  options={ORDER_FLOW_COLOR_TEMPLATES.map((template) => ({
                    label: template.label,
                    value: template.id,
                  }))}
                  value={settings.orderFlowTemplate}
                />
                <SelectSetting
                  label="Cell display"
                  onChange={(footprintDisplayMode) =>
                    updateSettings({
                      footprintDisplayMode: footprintDisplayMode as OrderFlowDisplayMode,
                    })
                  }
                  options={[
                    { label: "Bid × Ask", value: "bid-ask" },
                    { label: "Volume profile", value: "volume-profile" },
                    { label: "Delta profile", value: "delta-profile" },
                    { label: "Absolute delta", value: "absolute-delta" },
                  ]}
                  value={settings.footprintDisplayMode}
                />
                <SelectSetting
                  label="Cell alignment"
                  onChange={(footprintAlignment) =>
                    updateSettings({
                      footprintAlignment: footprintAlignment as OrderFlowAlignment,
                    })
                  }
                  options={[
                    { label: "Left", value: "left" },
                    { label: "Center", value: "center" },
                    { label: "Right", value: "right" },
                  ]}
                  value={settings.footprintAlignment}
                />
                <SettingToggle
                  checked={settings.footprintShowAverageTradeSize}
                  label="Average trade size"
                  onChange={(footprintShowAverageTradeSize) =>
                    updateSettings({ footprintShowAverageTradeSize })
                  }
                />
                <SettingToggle
                  checked={settings.footprintShowImbalances}
                  label="Bid/ask imbalances"
                  onChange={(footprintShowImbalances) =>
                    updateSettings({ footprintShowImbalances })
                  }
                />
                <NumberSetting
                  label="Imbalance ratio"
                  max={10}
                  min={2}
                  onChange={(footprintImbalanceRatio) =>
                    updateSettings({ footprintImbalanceRatio })
                  }
                  value={settings.footprintImbalanceRatio}
                />
                <NumberSetting
                  label="Stacked levels"
                  max={6}
                  min={2}
                  onChange={(footprintStackedImbalanceCount) =>
                    updateSettings({ footprintStackedImbalanceCount })
                  }
                  value={settings.footprintStackedImbalanceCount}
                />
                <SettingToggle
                  checked={settings.footprintShowUnfinishedAuctions}
                  label="Unfinished auctions"
                  onChange={(footprintShowUnfinishedAuctions) =>
                    updateSettings({ footprintShowUnfinishedAuctions })
                  }
                />
                <ColorSetting
                  label="Ask / buy color"
                  onChange={(footprintAskColor) => updateSettings({ footprintAskColor })}
                  value={settings.footprintAskColor}
                />
                <ColorSetting
                  label="Bid / sell color"
                  onChange={(footprintBidColor) => updateSettings({ footprintBidColor })}
                  value={settings.footprintBidColor}
                />
                <ColorSetting
                  label="Neutral / unknown"
                  onChange={(footprintNeutralColor) =>
                    updateSettings({ footprintNeutralColor })
                  }
                  value={settings.footprintNeutralColor}
                />
              </SettingsSection>

              <SettingsSection title="Statistics">
                <SettingToggle
                  checked={settings.footprintShowStats}
                  label="Bar statistics table"
                  onChange={(footprintShowStats) => updateSettings({ footprintShowStats })}
                />
                <SelectSetting
                  label="Primary statistic"
                  onChange={(footprintStatsMetric) =>
                    updateSettings({
                      footprintStatsMetric: footprintStatsMetric as OrderFlowStatsMetric,
                    })
                  }
                  options={[
                    { label: "Total volume", value: "volume" },
                    { label: "Delta", value: "delta" },
                    { label: "Trade count", value: "trades" },
                    { label: "Average trade size", value: "average-size" },
                  ]}
                  value={settings.footprintStatsMetric}
                />
              </SettingsSection>

              <SettingsSection title="TPO / Market Profile">
                <SelectSetting
                  label="TPO bracket"
                  onChange={(tpoBracketMinutes) =>
                    updateSettings({ tpoBracketMinutes: Number(tpoBracketMinutes) })
                  }
                  options={[15, 30, 60, 120].map((minutes) => ({
                    label: `${minutes} minutes`,
                    value: String(minutes),
                  }))}
                  value={String(settings.tpoBracketMinutes)}
                />
                <NumberSetting
                  label="Value area percent"
                  max={95}
                  min={50}
                  onChange={(tpoValueAreaPercent) => updateSettings({ tpoValueAreaPercent })}
                  value={settings.tpoValueAreaPercent}
                />
                <SettingToggle
                  checked={settings.tpoShowValueArea}
                  label="Value area"
                  onChange={(tpoShowValueArea) => updateSettings({ tpoShowValueArea })}
                />
                <SettingToggle
                  checked={settings.tpoShowPointOfControl}
                  label="Point of control"
                  onChange={(tpoShowPointOfControl) =>
                    updateSettings({ tpoShowPointOfControl })
                  }
                />
              </SettingsSection>

              <p className="rounded-md border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs leading-5 text-amber-100/80">
                Footprint, delta, imbalance, auction, and TPO views require real
                trade-level aggregates with aggressor side. OHLCV candles are never used
                to fabricate bid or ask volume.
              </p>
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

      {templateError ? <div className="px-4 py-2 text-sm text-[var(--loss-text)]" role="alert">{templateError}</div> : null}
      {templateNotice || templatePending ? <div className="px-4 py-2 text-sm text-[var(--text-secondary)]" role="status">{templatePending === "save" ? "Saving template…" : templatePending === "delete" ? "Deleting template…" : templatePending === "activate" ? "Switching template…" : templateNotice}</div> : null}
      <div className="chart-settings-footer">
        <div className="chart-settings-template-status">
          <span className="study-manager-label">Template</span>
          <strong>{activePreset ? `${activePreset.name}${modified ? " · Modified" : ""}` : "Unsaved"}</strong>
        </div>
        <input
          aria-label="Template name"
          className="input-control h-8 min-w-40 flex-1 text-xs"
          onChange={(event) => onPresetNameChange(event.target.value)}
          placeholder="Save as template"
          value={presetName}
        />
        <button
          className="studio-tool-button studio-tool-button-active"
          disabled={templatePending != null}
          onClick={onSavePreset}
          type="button"
        >
          <Save size={13} />
          Save Template
        </button>
        <button
          className="studio-tool-button"
          disabled={!activePreset || templatePending != null}
          onClick={() => { if (activePreset) onDeletePreset(activePreset.name); }}
          title={activePreset ? `Delete ${activePreset.name}` : "No active template"}
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
      <div className="flex min-h-9 items-center gap-2 rounded-md border border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] px-3 text-xs font-semibold text-[var(--text-primary)]">
        <button
          aria-label={`${visible ? "Hide" : "Show"} ${label}`}
          className={`grid h-6 w-6 place-items-center rounded border transition ${
            visible
              ? "border-[var(--ui-focus)] bg-[var(--ui-selection)] text-[var(--text-primary)]"
              : "border-[var(--ui-border-strong)] bg-[var(--ui-inset)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
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
  const input = useIntegerDraft(value, min, max, onChange);
  return (
    <label className="chart-settings-field">
      <span>{label}</span>
      <input
        className="input-control h-9"
        max={max}
        min={min}
        {...input}
        type="number"
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
        portal
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
        className="normal-case font-normal leading-4 tracking-normal text-[var(--text-secondary)]"
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
    <div className="grid">
      <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
        Command Search
      </div>
      {visibleCommands.map((command) => {
        const Icon = command.icon;
        return (
          <button
            className={`chart-command-row ${command.disabled ? "chart-command-row-disabled" : ""}`}
            data-chart-command-result="true"
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
          aria-label="Remove indicator"
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
    case "footprint":
      return "Footprint";
    case "line":
      return "Line";
    case "tpo":
      return "TPO";
    default:
      return "Candles";
  }
}
