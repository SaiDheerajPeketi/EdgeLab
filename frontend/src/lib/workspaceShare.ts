import type {
  ChartDrawing,
  ChartIndicatorInstance,
  ChartStyle,
  ChartTimeframe,
  DrawingTool,
  MagnetMode,
} from "./charting";
import type { ChartPaneLayoutId } from "./chartLayouts";
import {
  DEFAULT_CHART_VISUAL_SETTINGS,
  sanitizeChartVisualSettings,
  type ChartVisualSettings,
} from "./chartSettings";

export type WorkspaceShareScope =
  | "chart-plus-panels"
  | "panels-only"
  | "complete-workspace";

export type WorkspaceShareCandle = {
  time: number;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type WorkspaceShareChartPane = {
  id: string;
  timeframe: string;
  chartStyle: ChartStyle;
  chartSettings: ChartVisualSettings;
  drawingTool: "cursor" | "crosshair";
  drawings: ChartDrawing[];
  indicatorInstances: ChartIndicatorInstance[];
  magnetMode: MagnetMode;
  smoothCandles: boolean;
};

export type WorkspaceShareChart = {
  symbol: string;
  timeframe: string;
  paneLayout: ChartPaneLayoutId;
  activePaneId: string | null;
  panes: WorkspaceShareChartPane[];
  candles: WorkspaceShareCandle[];
  currentTimestamp: string | null;
};

export type WorkspaceShareMetrics = {
  netPnl: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  breakevenTrades: number;
  profitFactor: number | null;
  maxDrawdown: number;
  averageR: number | null;
  expectancy: number | null;
};

export type WorkspaceSharePanels = {
  activePanel: "none" | "review" | "results";
  panelOrder: Array<"review" | "results">;
  metrics: WorkspaceShareMetrics;
};

export type WorkspaceShareWorkspace = {
  layoutName: string;
  activeView: "backtest";
  sidebarCollapsed: boolean;
  timezone: string | null;
  paneLayout: ChartPaneLayoutId;
};

export type WorkspaceSharePayload = {
  schemaVersion: 1;
  chart: WorkspaceShareChart | null;
  panels: WorkspaceSharePanels | null;
  workspace: WorkspaceShareWorkspace | null;
};

export const WORKSPACE_SHARE_COPY_STORAGE_PREFIX = "workspace-share-copy.v1.";

export type WorkspaceShareCopyArtifact = {
  artifactVersion: 1;
  kind: "workspace-share-copy";
  id: string;
  copiedAt: string;
  sourceTitle: string;
  title: string;
  scope: WorkspaceShareScope;
  payload: WorkspaceSharePayload;
};

export type WorkspaceShareSource = {
  activePanel: string;
  activePaneId: string | null;
  candles: Array<{
    time: number;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  currentTimestamp: string | null;
  layoutName: string;
  metrics: {
    net_pnl?: number;
    win_rate?: number;
    total_trades?: number;
    winning_trades?: number;
    breakeven_trades?: number;
    profit_factor?: number | null;
    max_drawdown?: number;
    average_r?: number | null;
    expectancy?: number | null;
  } | null;
  paneLayout: ChartPaneLayoutId;
  panes: Array<{
    id: string;
    timeframe: ChartTimeframe;
    chartStyle: ChartStyle;
    chartSettings: ChartVisualSettings;
    drawingTool: DrawingTool;
    drawings: ChartDrawing[];
    indicatorInstances: ChartIndicatorInstance[];
    magnetMode: MagnetMode;
    smoothCandles: boolean;
  }>;
  sidebarCollapsed: boolean;
  symbol: string;
  timeframe: string;
  timezone: string | null;
};

const PANE_LAYOUTS = new Set<ChartPaneLayoutId>([
  "single",
  "vertical-2",
  "horizontal-2",
  "grid-4",
  "grid-6",
  "grid-9",
  "grid-12",
  "grid-16",
]);
const CHART_STYLES = new Set<ChartStyle>(["area", "candles", "heikinAshi", "line"]);
const MAGNET_MODES = new Set<MagnetMode>(["off", "weak", "strong"]);
const DRAWING_TOOLS = new Set<ChartDrawing["tool"]>([
  "trendline",
  "horizontal",
  "vertical",
  "rectangle",
  "fib",
  "measure",
  "longPosition",
  "shortPosition",
  "text",
]);

export function buildWorkspaceSharePayload(
  scope: WorkspaceShareScope,
  source: WorkspaceShareSource,
): WorkspaceSharePayload {
  const chart = scope === "panels-only" ? null : sanitizeChart(source);
  const panels = sanitizePanels(source.activePanel, source.metrics);
  const workspace =
    scope === "complete-workspace"
      ? {
          layoutName: cleanText(source.layoutName, 48, "Shared workspace"),
          activeView: "backtest" as const,
          sidebarCollapsed: source.sidebarCollapsed,
          timezone: source.timezone ? cleanText(source.timezone, 80, "UTC") : null,
          paneLayout: sanitizePaneLayout(source.paneLayout),
        }
      : null;

  return { schemaVersion: 1, chart, panels, workspace };
}

export function createWorkspaceShareCopyArtifact(
  title: string,
  payload: WorkspaceSharePayload,
): WorkspaceShareCopyArtifact {
  const safePayload = sanitizeWorkspaceSharePayload(payload);
  const scope = safePayload ? inferWorkspaceShareScope(safePayload) : null;
  if (!safePayload || !scope) {
    throw new Error("The shared workspace could not be copied safely.");
  }
  const sourceTitle = cleanText(title, 160, "Shared workspace");
  return {
    artifactVersion: 1,
    kind: "workspace-share-copy",
    id: createWorkspaceShareCopyId(),
    copiedAt: new Date().toISOString(),
    sourceTitle,
    title: cleanText(`${sourceTitle} copy`, 176, "Shared workspace copy"),
    scope,
    payload: safePayload,
  };
}

export function sanitizeWorkspaceShareCopyArtifact(
  value: unknown,
): WorkspaceShareCopyArtifact | null {
  if (
    !isRecord(value) ||
    value.artifactVersion !== 1 ||
    value.kind !== "workspace-share-copy" ||
    !isWorkspaceShareCopyId(value.id)
  ) {
    return null;
  }
  const payload = sanitizeWorkspaceSharePayload(value.payload);
  const scope = payload ? inferWorkspaceShareScope(payload) : null;
  const copiedAt = safeDate(value.copiedAt);
  if (!payload || !scope || !copiedAt || value.scope !== scope) {
    return null;
  }
  return {
    artifactVersion: 1,
    kind: "workspace-share-copy",
    id: value.id,
    copiedAt,
    sourceTitle: cleanText(value.sourceTitle, 160, "Shared workspace"),
    title: cleanText(value.title, 176, "Shared workspace copy"),
    scope,
    payload,
  };
}

export function isWorkspaceShareCopyId(value: unknown): value is string {
  return typeof value === "string" && /^workspace-copy-[a-z0-9-]{8,128}$/i.test(value);
}

export function workspaceShareCopyStorageKey(copyId: string) {
  if (!isWorkspaceShareCopyId(copyId)) {
    throw new Error("Invalid workspace copy ID.");
  }
  return `${WORKSPACE_SHARE_COPY_STORAGE_PREFIX}${copyId}`;
}

export function sanitizeWorkspaceSharePayload(value: unknown): WorkspaceSharePayload | null {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    return null;
  }
  const chart = value.chart == null ? null : sanitizeIncomingChart(value.chart);
  const panels = value.panels == null ? null : sanitizeIncomingPanels(value.panels);
  const workspace = value.workspace == null ? null : sanitizeIncomingWorkspace(value.workspace);
  if ((value.chart != null && !chart) || (value.panels != null && !panels) || (value.workspace != null && !workspace)) {
    return null;
  }
  return { schemaVersion: 1, chart, panels, workspace };
}

export function workspaceShareHref(publicToken: string) {
  return `/shared#${encodeURIComponent(publicToken)}`;
}

export function workspaceShareUrl(publicToken: string) {
  if (typeof window === "undefined") {
    return workspaceShareHref(publicToken);
  }
  return new URL(workspaceShareHref(publicToken), window.location.origin).toString();
}

export function workspaceShareScopeLabel(scope: WorkspaceShareScope) {
  return {
    "chart-plus-panels": "Chart + panels",
    "panels-only": "Panels only",
    "complete-workspace": "Complete workspace",
  }[scope];
}

function inferWorkspaceShareScope(payload: WorkspaceSharePayload): WorkspaceShareScope | null {
  if (!payload.panels) {
    return null;
  }
  if (!payload.chart && !payload.workspace) {
    return "panels-only";
  }
  if (payload.chart && !payload.workspace) {
    return "chart-plus-panels";
  }
  if (payload.chart && payload.workspace) {
    return "complete-workspace";
  }
  return null;
}

function createWorkspaceShareCopyId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  return `workspace-copy-${suffix.toLowerCase()}`;
}

function sanitizeChart(source: WorkspaceShareSource): WorkspaceShareChart {
  const panes = source.panes.slice(0, 16).map(sanitizePane);
  return {
    symbol: cleanText(source.symbol, 40, "MARKET"),
    timeframe: cleanText(source.timeframe, 20, "1m"),
    paneLayout: sanitizePaneLayout(source.paneLayout),
    activePaneId: source.activePaneId ? cleanText(source.activePaneId, 80, panes[0]?.id ?? "chart-pane-1") : null,
    panes: panes.length > 0 ? panes : [fallbackPane()],
    candles: source.candles.slice(-500).flatMap(sanitizeCandle),
    currentTimestamp: safeDate(source.currentTimestamp),
  };
}

function sanitizePane(source: WorkspaceShareSource["panes"][number]): WorkspaceShareChartPane {
  const drawingTool = source.drawingTool === "cursor" ? "cursor" : "crosshair";
  return {
    id: cleanText(source.id, 80, "chart-pane-1"),
    timeframe: cleanText(source.timeframe, 20, "1m"),
    chartStyle: CHART_STYLES.has(source.chartStyle) ? source.chartStyle : "candles",
    chartSettings: sanitizeChartVisualSettings(source.chartSettings),
    drawingTool,
    drawings: source.drawings.slice(0, 500).flatMap(sanitizeDrawing),
    indicatorInstances: source.indicatorInstances.slice(0, 64).map(sanitizeIndicator),
    magnetMode: MAGNET_MODES.has(source.magnetMode) ? source.magnetMode : "off",
    smoothCandles: source.smoothCandles === true,
  };
}

function fallbackPane(): WorkspaceShareChartPane {
  return {
    id: "chart-pane-1",
    timeframe: "1m",
    chartStyle: "candles",
    chartSettings: DEFAULT_CHART_VISUAL_SETTINGS,
    drawingTool: "crosshair",
    drawings: [],
    indicatorInstances: [],
    magnetMode: "off",
    smoothCandles: false,
  };
}

function sanitizeIndicator(indicator: ChartIndicatorInstance): ChartIndicatorInstance {
  const settings = indicator.settings;
  return {
    id: cleanText(indicator.id, 96, `indicator-${indicator.kind}`),
    kind: indicator.kind,
    settings: {
      color: safeColor(settings.color, "#32D3EE"),
      period: clampInteger(settings.period, 1, 10_000, 20),
      ...(finiteOptional(settings.fillOpacity) != null ? { fillOpacity: clamp(settings.fillOpacity!, 0, 1) } : {}),
      ...(finiteOptional(settings.stdDev) != null ? { stdDev: clamp(settings.stdDev!, 0, 100) } : {}),
      ...(finiteOptional(settings.fastPeriod) != null ? { fastPeriod: clampInteger(settings.fastPeriod!, 1, 10_000, 12) } : {}),
      ...(finiteOptional(settings.slowPeriod) != null ? { slowPeriod: clampInteger(settings.slowPeriod!, 1, 10_000, 26) } : {}),
      ...(finiteOptional(settings.signalPeriod) != null ? { signalPeriod: clampInteger(settings.signalPeriod!, 1, 10_000, 9) } : {}),
      ...(settings.secondaryColor ? { secondaryColor: safeColor(settings.secondaryColor, "#60A5FA") } : {}),
      ...(settings.signalColor ? { signalColor: safeColor(settings.signalColor, "#F59E0B") } : {}),
      ...(settings.histogramColor ? { histogramColor: safeColor(settings.histogramColor, "#6B7280") } : {}),
      ...(settings.showLabels != null ? { showLabels: settings.showLabels === true } : {}),
      ...(settings.unmitigatedOnly != null ? { unmitigatedOnly: settings.unmitigatedOnly === true } : {}),
      ...(settings.lineStyle ? { lineStyle: settings.lineStyle } : {}),
      ...(finiteOptional(settings.lineWidth) != null ? { lineWidth: clamp(settings.lineWidth!, 1, 8) } : {}),
    },
    visible: indicator.visible !== false,
    ...(indicator.createdAt ? { createdAt: cleanText(indicator.createdAt, 64, new Date(0).toISOString()) } : {}),
  };
}

function sanitizeDrawing(drawing: ChartDrawing): ChartDrawing[] {
  if (!DRAWING_TOOLS.has(drawing.tool)) {
    return [];
  }
  const points = drawing.points.slice(0, 64).flatMap((point) =>
    Number.isFinite(point.time) && Number.isFinite(point.price)
      ? [{ time: point.time, price: point.price, ...(Number.isFinite(point.logical) ? { logical: point.logical } : {}) }]
      : [],
  );
  if (points.length === 0) {
    return [];
  }
  return [{
    id: cleanText(drawing.id, 96, "drawing"),
    tool: drawing.tool,
    color: safeColor(drawing.color, "#32D3EE"),
    points,
    createdAt: cleanText(drawing.createdAt, 64, new Date(0).toISOString()),
    ...(drawing.fibExtendLeft != null ? { fibExtendLeft: drawing.fibExtendLeft === true } : {}),
    ...(drawing.fibExtendRight != null ? { fibExtendRight: drawing.fibExtendRight === true } : {}),
    ...(drawing.fibLevels ? {
      fibLevels: drawing.fibLevels.slice(0, 32).map((level) => ({
        id: cleanText(level.id, 64, "level"),
        value: finite(level.value, 0),
        color: safeColor(level.color, "#32D3EE"),
        ...(finiteOptional(level.backgroundOpacity) != null ? { backgroundOpacity: clamp(level.backgroundOpacity!, 0, 1) } : {}),
        ...(level.label ? { label: cleanText(level.label, 80, "Level") } : {}),
        ...(level.lineStyle ? { lineStyle: level.lineStyle } : {}),
        visible: level.visible !== false,
      })),
    } : {}),
    ...(finiteOptional(drawing.fillOpacity) != null ? { fillOpacity: clamp(drawing.fillOpacity!, 0, 1) } : {}),
    ...(drawing.lineStyle ? { lineStyle: drawing.lineStyle } : {}),
    ...(finiteOptional(drawing.lineWidth) != null ? { lineWidth: clamp(drawing.lineWidth!, 1, 8) } : {}),
    locked: drawing.locked === true,
    ...(drawing.rewardColor ? { rewardColor: safeColor(drawing.rewardColor, "#22C55E") } : {}),
    ...(drawing.riskColor ? { riskColor: safeColor(drawing.riskColor, "#EF4444") } : {}),
    ...(drawing.label ? { label: cleanText(drawing.label, 160, "Label") } : {}),
    ...(finiteOptional(drawing.labelBackgroundOpacity) != null ? { labelBackgroundOpacity: clamp(drawing.labelBackgroundOpacity!, 0, 1) } : {}),
    visible: drawing.visible !== false,
  }];
}

function sanitizePanels(activePanel: string, metrics: WorkspaceShareSource["metrics"]): WorkspaceSharePanels {
  return {
    activePanel: activePanel === "review" || activePanel === "results" ? activePanel : "none",
    panelOrder: ["review", "results"],
    metrics: {
      netPnl: finite(metrics?.net_pnl, 0),
      winRate: clamp(finite(metrics?.win_rate, 0), 0, 100),
      totalTrades: Math.max(0, clampInteger(metrics?.total_trades, 0, Number.MAX_SAFE_INTEGER, 0)),
      winningTrades: Math.max(0, clampInteger(metrics?.winning_trades, 0, Number.MAX_SAFE_INTEGER, 0)),
      breakevenTrades: Math.max(0, clampInteger(metrics?.breakeven_trades, 0, Number.MAX_SAFE_INTEGER, 0)),
      profitFactor: nullableFinite(metrics?.profit_factor),
      maxDrawdown: Math.max(0, finite(metrics?.max_drawdown, 0)),
      averageR: nullableFinite(metrics?.average_r),
      expectancy: nullableFinite(metrics?.expectancy),
    },
  };
}

function sanitizeIncomingChart(value: unknown): WorkspaceShareChart | null {
  if (!isRecord(value) || !Array.isArray(value.panes) || value.panes.length === 0) {
    return null;
  }
  const source: WorkspaceShareSource = {
    activePanel: "none",
    activePaneId: typeof value.activePaneId === "string" ? value.activePaneId : null,
    candles: Array.isArray(value.candles) ? value.candles.filter(isRecord).map((item) => ({
      time: finite(item.time, 0), timestamp: safeDate(item.timestamp) ?? new Date(0).toISOString(),
      open: finite(item.open, 0), high: finite(item.high, 0), low: finite(item.low, 0), close: finite(item.close, 0), volume: finite(item.volume, 0),
    })) : [],
    currentTimestamp: safeDate(value.currentTimestamp),
    layoutName: "Shared workspace",
    metrics: null,
    paneLayout: sanitizePaneLayout(value.paneLayout),
    panes: value.panes.filter(isRecord).map((pane, index) => ({
      id: cleanText(pane.id, 80, `chart-pane-${index + 1}`),
      timeframe: cleanText(pane.timeframe, 20, "1m"),
      chartStyle: CHART_STYLES.has(pane.chartStyle as ChartStyle) ? pane.chartStyle as ChartStyle : "candles",
      chartSettings: sanitizeChartVisualSettings(isRecord(pane.chartSettings) ? pane.chartSettings : undefined),
      drawingTool: pane.drawingTool === "cursor" ? "cursor" : "crosshair",
      drawings: Array.isArray(pane.drawings) ? pane.drawings as ChartDrawing[] : [],
      indicatorInstances: Array.isArray(pane.indicatorInstances) ? pane.indicatorInstances as ChartIndicatorInstance[] : [],
      magnetMode: MAGNET_MODES.has(pane.magnetMode as MagnetMode) ? pane.magnetMode as MagnetMode : "off",
      smoothCandles: pane.smoothCandles === true,
    })),
    sidebarCollapsed: false,
    symbol: cleanText(value.symbol, 40, "MARKET"),
    timeframe: cleanText(value.timeframe, 20, "1m"),
    timezone: null,
  };
  return sanitizeChart(source);
}

function sanitizeIncomingPanels(value: unknown): WorkspaceSharePanels | null {
  if (!isRecord(value) || !isRecord(value.metrics)) {
    return null;
  }
  return {
    activePanel: value.activePanel === "review" || value.activePanel === "results" ? value.activePanel : "none",
    panelOrder: ["review", "results"],
    metrics: {
      netPnl: finite(value.metrics.netPnl, 0), winRate: clamp(finite(value.metrics.winRate, 0), 0, 100),
      totalTrades: clampInteger(value.metrics.totalTrades, 0, Number.MAX_SAFE_INTEGER, 0),
      winningTrades: clampInteger(value.metrics.winningTrades, 0, Number.MAX_SAFE_INTEGER, 0),
      breakevenTrades: clampInteger(value.metrics.breakevenTrades, 0, Number.MAX_SAFE_INTEGER, 0),
      profitFactor: nullableFinite(value.metrics.profitFactor), maxDrawdown: Math.max(0, finite(value.metrics.maxDrawdown, 0)),
      averageR: nullableFinite(value.metrics.averageR), expectancy: nullableFinite(value.metrics.expectancy),
    },
  };
}

function sanitizeIncomingWorkspace(value: unknown): WorkspaceShareWorkspace | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    layoutName: cleanText(value.layoutName, 48, "Shared workspace"), activeView: "backtest",
    sidebarCollapsed: value.sidebarCollapsed === true,
    timezone: typeof value.timezone === "string" ? cleanText(value.timezone, 80, "UTC") : null,
    paneLayout: sanitizePaneLayout(value.paneLayout),
  };
}

function sanitizeCandle(value: WorkspaceShareSource["candles"][number]): WorkspaceShareCandle[] {
  const numbers = [value.time, value.open, value.high, value.low, value.close, value.volume];
  const timestamp = safeDate(value.timestamp);
  return numbers.every(Number.isFinite) && timestamp
    ? [{
        time: value.time,
        timestamp,
        open: value.open,
        high: value.high,
        low: value.low,
        close: value.close,
        volume: value.volume,
      }]
    : [];
}

function sanitizePaneLayout(value: unknown): ChartPaneLayoutId {
  return PANE_LAYOUTS.has(value as ChartPaneLayoutId) ? value as ChartPaneLayoutId : "single";
}

function safeColor(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split("").map((char) => char + char).join("").toUpperCase()}`;
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : fallback;
}

function safeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cleanText(value: unknown, maxLength: number, fallback: string) {
  const clean = typeof value === "string" ? value.trim() : "";
  return (clean || fallback).slice(0, maxLength);
}

function finite(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function finiteOptional(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableFinite(value: unknown) {
  return value == null ? null : finiteOptional(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  return clamp(Math.round(finite(value, fallback)), min, max);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}
