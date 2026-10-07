import type { Candle } from "./api";
import type { PineExecutionResult, PinePlot, PineScalar } from "./pineProtocol";
import { getPackedPinePlot } from "./pinePacked";
import { PineVisualPrimitive, pineVisualSample } from "./pineVisualPrimitive";
import type { IChartApi, ISeriesApi, SeriesType, SeriesMarker, UTCTimestamp } from "lightweight-charts";

export type PineChartPoint = { time: UTCTimestamp; value?: number; color?: string; open?: number; high?: number; low?: number; close?: number; wickColor?: string; borderColor?: string };
export type PineChartPlot = {
  id: string; name: string; overlay: boolean; kind: "line" | "area" | "histogram" | "candles" | "markers" | "fill";
  color: string; width: 1 | 2 | 3 | 4; step: boolean; pointsOnly: boolean; base: number;
  segments: PineChartPoint[][]; markers: SeriesMarker<UTCTimestamp>[];
  visual?: { source: PinePlot; bars: readonly Candle[]; style: string; showFrom: number; refs?: { upper: PinePlot; lower: PinePlot } };
};
export type PineChartResult = { plots: PineChartPlot[]; warnings: string[]; strategyMarkers: SeriesMarker<UTCTimestamp>[] };
const FALLBACK_COLOR = "#22d3ee";
function color(value: PineScalar | undefined, fallback = FALLBACK_COLOR) {
  if (value === null) return "rgba(0,0,0,0)";
  return typeof value === "string" && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(value) ? value : fallback;
}
function number(value: PineScalar | undefined, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

function* shownPoints(plot: PinePlot, time: number) {
  for (const point of plot.points) if (point.time >= time) yield point;
}

/** Header values need one sample; chart geometry already owns the full rendered data. */
export function latestPineChartPoint(plot: PineChartPlot): { time: UTCTimestamp; value: number } | null {
  if (plot.kind === "fill") return null;
  if (plot.visual) {
    for (let index = plot.visual.bars.length - 1; index >= plot.visual.showFrom; index--) {
      const value = pineVisualSample(plot, index)?.value;
      if (typeof value === "number") return { time: plot.visual.bars[index].time as UTCTimestamp, value };
    }
    return null;
  }
  for (let segment = plot.segments.length - 1; segment >= 0; segment--) {
    for (let index = plot.segments[segment].length - 1; index >= 0; index--) {
      const point = plot.segments[segment][index];
      if (point.value !== undefined) return { time: point.time, value: point.value };
    }
  }
  return null;
}

/** Preserve native output semantics. Unsupported output is omitted with a visible reason. */
export function adaptPineChartResult(result: PineExecutionResult, bars: Candle[]): PineChartResult {
  const warnings = result.diagnostics.map((item) => `${item.code}: ${item.message}`);
  const barsByTime = new Map(bars.map((bar) => [bar.time, bar]));
  const sources = new Map(result.plots.map((plot) => [plot.id, plot]));
  const hasOffset = (source: PinePlot) => number(source.options.offset, 0) !== 0 || (getPackedPinePlot(source)?.optionTable ?? source.points.map((point) => point.options)).some((options) => number(options.offset, 0) !== 0);
  const smallProjection = result.plots.length * bars.length <= 4096;
  const plots = result.plots.flatMap((plot): PineChartPlot[] => {
    const plotWarnings = new Set<string>();
    const warn = (message: string) => { if (!plotWarnings.has(message)) { plotWarnings.add(message); warnings.push(`${plot.name}: ${message}`); } };
    if (["none", "display_none"].includes(String(plot.options.display))) return [];
    if (plot.options.display != null && !["all", "pane", "display_all", "display_pane"].includes(String(plot.options.display))) {
      warn(`The ${String(plot.options.display)} display destination is not exposed by this chart adapter; this plot is not drawn.`);
      return [];
    }
    const style = plot.style.replace(/^(?:plot\.)?style_/, "");
    const kinds: Record<string, PineChartPlot["kind"]> = { line: "line", linebr: "line", stepline: "line", steplinebr: "line", area: "area", areabr: "area", histogram: "histogram", columns: "histogram", circles: "line", candle: "candles", candles: "candles", plotcandle: "candles", shape: "markers", plotshape: "markers" };
    const packed = getPackedPinePlot(plot);
    const optionSets = packed?.optionTable ?? plot.points.map((point) => point.options);
    const showLast = Math.max(0, Math.floor(number(plot.options.show_last, bars.length)));
    const showFrom = Math.max(0, bars.length - showLast);
    const common = { id: plot.id, name: plot.name, overlay: plot.overlay, color: color(plot.options.color), width: Math.max(1, Math.min(4, Math.round(number(plot.options.linewidth, 2)))) as PineChartPlot["width"], step: style.startsWith("stepline"), pointsOnly: style === "circles", base: number(plot.options.histbase, 0) };
    if (style === "fill") {
      const upper = sources.get(String(plot.options.plot1)), lower = sources.get(String(plot.options.plot2));
      if (!upper || !lower) { warn("Fill references are unavailable; this fill is not drawn."); return []; }
      if (hasOffset(plot) || hasOffset(upper) || hasOffset(lower)) { warn("Fill references with plot offsets are not rendered by this chart adapter."); return []; }
      if (upper.overlay !== lower.overlay) { warn("Fill references cross chart placements; this fill is not drawn."); return []; }
      if (plot.options.top_color !== undefined || plot.options.bottom_color !== undefined) { warn("Gradient fills are not rendered; this fill is not drawn."); return []; }
      return [{ ...common, overlay: upper.overlay, kind: "fill", segments: [], markers: [], visual: { source: plot, bars, style, showFrom, refs: { upper, lower } } }];
    }
    const kind = kinds[style];
    if (!kind) { warn(`Native ${style} output is not rendered by this chart adapter.`); return []; }
    if (hasOffset(plot)) { warn("Plot offsets are not rendered by this chart adapter."); return []; }
    const declaredWidth = number(plot.options.linewidth, 2);
    if (declaredWidth < 1 || declaredWidth > 4 || !Number.isInteger(declaredWidth) || optionSets.some((options) => options.linewidth !== undefined && (number(options.linewidth, 2) < 1 || number(options.linewidth, 2) > 4 || !Number.isInteger(number(options.linewidth, 2))))) warn("Plot line width is limited to integer values from 1 to 4 pixels.");
    if (plot.options.trackprice === true || optionSets.some((options) => options.trackprice === true)) warn("The trackprice guide is not exposed by this chart adapter.");
    const baseColor = color(plot.options.color);
    const visual = (["line", "markers"].includes(kind) || style === "areabr") ? { source: plot, bars, style, showFrom } : undefined;
    if (kind === "markers") {
      const allowedShapes = ["circle", "square", "arrowup", "arrowdown", "triangleup", "triangledown", "labelup", "labeldown"];
      const supported = optionSets.every((options) => {
        const shape = String(options.shape ?? plot.options.shape ?? "circle").toLowerCase().replace(/^shape[._]/, "").replace(/_/g, "");
        const location = String(options.location ?? plot.options.location ?? "abovebar").toLowerCase().replace(/^location[._]/, "");
        return allowedShapes.includes(shape) && ["absolute", "abovebar", "belowbar"].includes(location);
      });
      if (!supported) { warn("This shape or location is not rendered by this chart adapter."); return []; }
      if (plot.options.size != null || optionSets.some((options) => options.size != null)) warnings.push("Shape sizes and text use local pixel metrics; TradingView font and size calibration has not been verified.");
    }
    if (kind !== "markers" && kind !== "candles" && (packed ? packed.kinds.some((kind) => kind > 1 && kind !== 4) : plot.points.some((point) => point.value !== null && typeof point.value !== "number"))) warn("Non-numeric values are not rendered as a numeric series.");
    if (visual && !smallProjection) return [{ ...common, kind, segments: [], markers: [], visual }];
    const segments: PineChartPoint[][] = [[]];
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    const breakGaps = ["linebr", "steplinebr", "areabr"].includes(style);
    const points = shownPoints(plot, bars[showFrom]?.time ?? Infinity);
    let warnedValue = false, warnedShape = false;
    for (const point of points) {
      const options = { ...plot.options, ...point.options };
      const time = point.time as UTCTimestamp;
      const pointColor = color(options.color, baseColor);
      if (kind === "candles") {
        if (Array.isArray(point.value) && point.value.length === 4) {
          const [open, high, low, close] = point.value;
          segments[0].push({ time, open, high, low, close, color: pointColor, wickColor: color(options.wickcolor, pointColor), borderColor: color(options.bordercolor, pointColor) });
        } else if (point.value === null) segments[0].push({ time });
        else if (!warnedValue) { warn("Invalid candle output was omitted."); warnedValue = true; }
        continue;
      }
      if (kind === "markers") {
        const shapes: Record<string, SeriesMarker<UTCTimestamp>["shape"]> = { circle: "circle", square: "square", arrowup: "arrowUp", arrowdown: "arrowDown", triangleup: "arrowUp", triangledown: "arrowDown", labelup: "arrowUp", labeldown: "arrowDown" };
        const nativeShape = String(options.shape ?? "circle").replace(/^shape[._]/, "").replace(/_/g, "");
        const shape = shapes[nativeShape];
        const location = String(options.location ?? "abovebar").toLowerCase().replace(/^location[._]/, "");
        if (point.value === null || point.value === false || (location !== "absolute" && point.value === 0)) continue;
        const bar = barsByTime.get(point.time);
        if (!shape || !["abovebar", "belowbar", "absolute"].includes(location) || !bar) {
          if (!warnedShape) { warn("This shape or location is not rendered by this chart adapter."); warnedShape = true; }
          continue;
        }
        if (location === "absolute" && typeof point.value !== "number") continue;
        segments[0].push({ time, value: location === "absolute" ? point.value as number : location === "belowbar" ? bar.low : bar.high });
        markers.push({ time, color: pointColor, shape, position: location === "absolute" ? "inBar" : location === "belowbar" ? "belowBar" : "aboveBar", text: typeof options.text === "string" ? options.text : undefined });
        continue;
      }
      if (point.value === null) {
        if (breakGaps && segments.at(-1)!.length) segments.push([]);
        else if (!breakGaps) segments.at(-1)!.push({ time });
      } else if (typeof point.value === "number") segments.at(-1)!.push({ time, value: point.value, color: pointColor });
      else if (!warnedValue) { warn("Non-numeric values are not rendered as a numeric series."); warnedValue = true; }
    }
    const nonempty = segments.filter((segment) => segment.length);
    if (!nonempty.length && !visual) return [];
    if (style === "columns") warn("Columns use the chart’s native histogram bar width.");
    if (!visual && optionSets.some((options) => options.linewidth !== undefined && options.linewidth !== plot.options.linewidth)) warn("Per-point line width is not supported; the declared plot width is used.");
    return [{ id: plot.id, name: plot.name, overlay: plot.overlay, kind, color: baseColor, width: Math.max(1, Math.min(4, Math.round(declaredWidth))) as PineChartPlot["width"], step: style.startsWith("stepline"), pointsOnly: style === "circles", base: number(plot.options.histbase, 0), segments: nonempty, markers, visual }];
  });
  const strategyMarkers: SeriesMarker<UTCTimestamp>[] = [];
  for (const trade of [...result.strategy?.closedTrades ?? [], ...result.strategy?.openTrades ?? []]) {
    for (const leg of ["entry", "exit"] as const) {
      const rawTime = trade[`${leg}_time`];
      if (typeof rawTime !== "number") continue;
      const time = rawTime > 253_402_300_799 ? rawTime / 1000 : rawTime;
      if (!barsByTime.has(time)) continue;
      const long = number(trade.size, 0) > 0;
      const buy = leg === "entry" ? long : !long;
      strategyMarkers.push({ time: time as UTCTimestamp, position: buy ? "belowBar" : "aboveBar", color: buy ? "#22c55e" : "#fb7185", shape: buy ? "arrowUp" : "arrowDown", text: `Pine ${leg} ${String(trade.entry_id ?? trade.id)}` });
    }
  }
  return { plots, warnings: [...new Set(warnings)], strategyMarkers: strategyMarkers.sort((left, right) => Number(left.time) - Number(right.time)) };
}

function installNativePineChartPlot(chart: IChartApi, plot: PineChartPlot, priceScaleId = "right"): ISeriesApi<SeriesType>[] {
  return plot.segments.map((segment) => {
    const common = { title: plot.name, priceScaleId, priceLineVisible: false, lastValueVisible: false };
    if (plot.kind === "histogram") {
      const series = chart.addHistogramSeries({ ...common, color: plot.color, base: plot.base });
      series.setData(segment.map((point) => point.value === undefined ? { time: point.time } : { time: point.time, value: point.value, color: point.color }));
      return series;
    }
    if (plot.kind === "candles") {
      const series = chart.addCandlestickSeries({ ...common, upColor: plot.color, downColor: plot.color, wickUpColor: plot.color, wickDownColor: plot.color });
      series.setData(segment.map((point) => point.open === undefined ? { time: point.time } : { time: point.time, open: point.open, high: point.high!, low: point.low!, close: point.close!, color: point.color, wickColor: point.wickColor, borderColor: point.borderColor }));
      return series;
    }
    if (plot.kind === "area") {
      const series = chart.addBaselineSeries({ ...common, baseValue: { type: "price", price: plot.base }, topLineColor: plot.color, bottomLineColor: plot.color, topFillColor1: plot.color, topFillColor2: "transparent", bottomFillColor1: "transparent", bottomFillColor2: plot.color, lineWidth: plot.width });
      series.setData(segment.map((point) => point.value === undefined ? { time: point.time } : { time: point.time, value: point.value, topLineColor: point.color, bottomLineColor: point.color, topFillColor1: point.color, topFillColor2: "transparent", bottomFillColor1: "transparent", bottomFillColor2: point.color }));
      return series;
    }
    const series = chart.addLineSeries({ ...common, color: plot.color, lineWidth: plot.width, lineType: plot.step ? 1 : 0, lineVisible: plot.kind !== "markers" && !plot.pointsOnly, pointMarkersVisible: plot.pointsOnly });
    series.setData(segment.map((point) => point.value === undefined ? { time: point.time } : { time: point.time, value: point.value, color: point.color }));
    if (plot.markers.length) series.setMarkers(plot.markers);
    return series;
  });
}


/** A single owned host/primitive per placement keeps gaps and plot count independent of series count. */
export function installPineChartPlots(chart: IChartApi, plots: readonly PineChartPlot[], priceScaleId = "right", options: { allowFillOnlyScale?: boolean } = {}): { series: ISeriesApi<SeriesType>[]; primitive?: PineVisualPrimitive; dispose: () => void } {
  const native = plots.filter((plot) => !plot.visual).flatMap((plot) => installNativePineChartPlot(chart, plot, priceScaleId));
  const visual = plots.filter((plot) => plot.visual);
  const primitive = visual.length ? new PineVisualPrimitive(visual, plots.filter((plot) => !plot.visual), options) : undefined;
  let host: ISeriesApi<"Line"> | undefined;
  if (primitive) {
    const timeline = new Map<number, Candle>();
    for (const plot of visual) for (const bar of plot.visual!.bars) timeline.set(bar.time, bar);
    const bars = [...timeline.values()].sort((a, b) => a.time - b.time);
    host = chart.addLineSeries({ priceScaleId, color: "transparent", lineVisible: false, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => primitive.rangeForVisible() });
    // LWC skips primitive autoscale on empty data and needs a first numeric value for conversion.
    // Endpoint seeds keep NearestRight first-value lookup valid after panning.
    // The provider above entirely replaces their range; they never contribute to autoscale.
    host.setData(bars.map((bar, index) => (index === 0 || index === bars.length - 1) ? { time: bar.time as UTCTimestamp, value: bar.close, color: "transparent" } : { time: bar.time as UTCTimestamp }));
    host.attachPrimitive(primitive);
    native.push(host);
  }
  let disposed = false;
  return { series: native, primitive, dispose() {
    if (disposed) return;
    disposed = true;
    if (host && primitive) host.detachPrimitive(primitive);
    for (const series of native) chart.removeSeries(series);
  } };
}

/** Compatibility entry point. Group placements with installPineChartPlots in chart owners. */
export function installPineChartPlot(chart: IChartApi, plot: PineChartPlot, priceScaleId = "right"): ISeriesApi<SeriesType>[] {
  return installPineChartPlots(chart, [plot], priceScaleId).series;
}
