import type { Candle } from "./api";
import type { PineExecutionResult, PinePlot, PineScalar } from "./pineProtocol";
import type { IChartApi, ISeriesApi, SeriesType, SeriesMarker, UTCTimestamp } from "lightweight-charts";

export type PineChartPoint = { time: UTCTimestamp; value?: number; color?: string; open?: number; high?: number; low?: number; close?: number; wickColor?: string; borderColor?: string };
export type PineChartPlot = {
  id: string; name: string; overlay: boolean; kind: "line" | "area" | "histogram" | "candles" | "markers";
  color: string; width: 1 | 2 | 3 | 4; step: boolean; pointsOnly: boolean; base: number;
  segments: PineChartPoint[][]; markers: SeriesMarker<UTCTimestamp>[];
};
export type PineChartResult = { plots: PineChartPlot[]; warnings: string[]; strategyMarkers: SeriesMarker<UTCTimestamp>[] };
const MAX_SEGMENTS = 16;
const FALLBACK_COLOR = "#22d3ee";
function color(value: PineScalar | undefined, fallback = FALLBACK_COLOR) {
  if (value === null) return "rgba(0,0,0,0)";
  return typeof value === "string" && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(value) ? value : fallback;
}
function number(value: PineScalar | undefined, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

function* shownPoints(plot: PinePlot, count: number) {
  for (let index = Math.max(0, plot.points.length - count); index < plot.points.length; index++) yield plot.points[index];
}

/** Header values need one sample; chart geometry already owns the full rendered data. */
export function latestPineChartPoint(plot: PineChartPlot): { time: UTCTimestamp; value: number } | null {
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
    const kind = kinds[style];
    if (!kind) { warn(`Native ${style} output is not rendered by this chart adapter.`); return []; }
    if (number(plot.options.offset, 0) !== 0 || plot.points.some((point) => number(point.options.offset, 0) !== 0)) { warn("Plot offsets are not rendered by this chart adapter."); return []; }
    const declaredWidth = number(plot.options.linewidth, 2);
    if (declaredWidth < 1 || declaredWidth > 4 || !Number.isInteger(declaredWidth)) warn("Plot line width is limited to integer values from 1 to 4 pixels.");
    if (plot.options.trackprice === true || plot.points.some((point) => point.options.trackprice === true)) warn("The trackprice guide is not exposed by this chart adapter.");
    const baseColor = color(plot.options.color);
    const segments: PineChartPoint[][] = [[]];
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    const breakGaps = ["linebr", "steplinebr", "areabr"].includes(style);
    const showLast = Math.max(0, Math.floor(number(plot.options.show_last, plot.points.length)));
    const points = shownPoints(plot, showLast);
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
        const shapes: Record<string, SeriesMarker<UTCTimestamp>["shape"]> = { circle: "circle", square: "square", arrowup: "arrowUp", arrowdown: "arrowDown" };
        const nativeShape = String(options.shape ?? "circle").replace(/^shape[._]/, "");
        const shape = shapes[nativeShape];
        const location = String(options.location ?? "abovebar").toLowerCase().replace(/^location[._]/, "");
        if (point.value === null || point.value === false || (location !== "absolute" && point.value === 0)) continue;
        const bar = barsByTime.get(point.time);
        if (!shape || !["abovebar", "belowbar", "absolute"].includes(location) || !bar) {
          if (!warnedShape) { warn("This shape or location is not rendered by this chart adapter."); warnedShape = true; }
          continue;
        }
        if (location === "absolute" && typeof point.value !== "number") continue;
        if (typeof options.text === "string" && options.text.length && options.textcolor != null) warn("Separate shape text color is not supported; marker text uses the marker color.");
        if (options.size != null && options.size !== "auto") warn("Native shape size is not supported; the chart uses its standard marker size.");
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
    if (nonempty.length > MAX_SEGMENTS) { warn(`More than ${MAX_SEGMENTS} disconnected segments; this plot was omitted.`); return []; }
    if (!nonempty.length) return [];
    if (style === "columns") warn("Columns use the chart’s native histogram bar width.");
    if (plot.points.some((point) => point.options.linewidth !== undefined && point.options.linewidth !== plot.options.linewidth)) warn("Per-point line width is not supported; the declared plot width is used.");
    return [{ id: plot.id, name: plot.name, overlay: plot.overlay, kind, color: baseColor, width: Math.max(1, Math.min(4, Math.round(declaredWidth))) as PineChartPlot["width"], step: style.startsWith("stepline"), pointsOnly: style === "circles", base: number(plot.options.histbase, 0), segments: nonempty, markers }];
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

export function installPineChartPlot(chart: IChartApi, plot: PineChartPlot, priceScaleId = "right"): ISeriesApi<SeriesType>[] {
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
