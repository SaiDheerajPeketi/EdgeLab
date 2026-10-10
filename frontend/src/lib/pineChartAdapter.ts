import type { Candle } from "./api";
import type { PineExecutionResult, PineLabelDrawing, PineBoxDrawing, PineLineFillDrawing, PinePolylineDrawing, PineLineDrawing, PinePlot, PineScalar, PineTableDrawing } from "./pineProtocol";
import { getPackedPinePlot, pinePlotOptionSets, pointAtBar } from "./pinePacked";
import { parsePineDisplay, canonicalPineDisplay, parsePineFormat, type PineDisplayDestination, type PineValueFormat } from "./pineDisplay";
import { PineLinePrimitive } from "./pineLinePrimitive";
import { PineTablePrimitive } from "./pineTablePrimitive";
import { PineVisualPrimitive, pineVisualSample, pineGradientColor } from "./pineVisualPrimitive";
import type { IChartApi, ISeriesApi, SeriesType, SeriesMarker, UTCTimestamp } from "lightweight-charts";

export type PineChartPoint = { time: UTCTimestamp; value?: number; color?: string; open?: number; high?: number; low?: number; close?: number; wickColor?: string; borderColor?: string };
export type PineChartPlot = {
  id: string; name: string; overlay: boolean; behindChart?: boolean; kind: "line" | "area" | "histogram" | "candles" | "markers" | "fill" | "background" | "barcolor" | "drawing_line" | "table";
  color: string; width: 1 | 2 | 3 | 4; step: boolean; pointsOnly: boolean; base: number;
  segments: PineChartPoint[][]; markers: SeriesMarker<UTCTimestamp>[];
  drawing?: { lines: readonly PineLineDrawing[]; lineFills?: readonly PineLineFillDrawing[]; boxes?: readonly PineBoxDrawing[]; labels?: readonly PineLabelDrawing[]; polylines?: readonly PinePolylineDrawing[]; bars: readonly Candle[] };
  table?: { tables: readonly PineTableDrawing[] };
  visual?: { linestyle?: "solid" | "dashed" | "dotted"; diamond?: { size: number }; arrow?: { minHeight: number; maxHeight: number; maxMagnitude: number }; pointStyle?: { size: number; join: boolean }; trackPrice?: { price: number; color: string }; histogramWidth?: number; plotOffset?: number; backgroundOffset?: number; level?: { price: number | null; color: string; width: 1 | 2 | 3 | 4; linestyle: "solid" | "dashed" | "dotted" }; source: PinePlot; bars: readonly Candle[]; style: string; showFrom: number; gradient?: boolean; refs?: { upper: PinePlot; lower: PinePlot; upperOffset: number; lowerOffset: number } };
};
export type PineChartReadout = Readonly<{
  id: string; name: string; source: PinePlot; bars: readonly Candle[]; overlay: boolean;
  destinations: readonly PineDisplayDestination[]; color: string; format: PineValueFormat; precision?: number; showFrom: number;
}>;
export type PineChartResult = { plots: PineChartPlot[]; readouts: readonly PineChartReadout[]; warnings: string[]; adapterWarnings: string[]; strategyMarkers: SeriesMarker<UTCTimestamp>[] };
const FALLBACK_COLOR = "#22d3ee";
function color(value: PineScalar | undefined, fallback = FALLBACK_COLOR) {
  if (value === null) return "rgba(0,0,0,0)";
  return typeof value === "string" && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(value) ? value : fallback;
}
function number(value: PineScalar | undefined, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

/** Readouts retain original bar alignment: visual offsets do not move values.
 * Missing/NA samples remain NA instead of reviving a preceding value. */
export function samplePineChartReadout(readout: PineChartReadout, time: number): { time: number; values: (number | null)[]; color: string } | undefined {
  let lo = 0, hi = readout.bars.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (readout.bars[mid].time < time) lo = mid + 1; else hi = mid; }
  if (readout.bars[lo]?.time !== time) return undefined;
  const ohlc = ["bar", "candle", "candles", "plotcandle"].includes(readout.source.style);
  if (lo < readout.showFrom) return { time, values: Array(ohlc ? 4 : 1).fill(null), color: readout.color };
  let point = pointAtBar(readout.source, lo);
  if (!getPackedPinePlot(readout.source)) {
    const points = readout.source.points;
    let left = 0, right = points.length;
    while (left < right) { const mid = (left + right) >>> 1; if (points[mid].time < time) left = mid + 1; else right = mid; }
    point = points[left]?.time === time ? points[left] : undefined;
  }
  const raw = point?.value;
  const numeric = (value: unknown): number | null => typeof value === "boolean" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null;
  const values = ohlc ? Array.from({ length: 4 }, (_, index) => numeric(Array.isArray(raw) ? raw[index] : null)) : [numeric(raw)];
  return { time, values, color: color(point?.options.color === undefined ? readout.source.options.color : point.options.color, readout.color) };
}
export function formatPineChartValue(readout: Pick<PineChartReadout, "format" | "precision">, value: number | null, fallbackPrecision = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (readout.format === "volume") {
    const unit = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const;
    const chosen = unit.find(([size]) => Math.abs(value) >= size);
    return chosen ? (value / chosen[0]).toFixed(2).replace(/\.?0+$/, "") + chosen[1] : value.toFixed(0);
  }
  const precision = readout.precision ?? (readout.format === "inherit" && Number.isInteger(fallbackPrecision) && fallbackPrecision >= 0 && fallbackPrecision <= 16 ? fallbackPrecision : 2);
  const [integer, fraction] = value.toFixed(precision).split(".");
  const grouped = readout.format === "price" || readout.format === "percent" || readout.precision !== undefined
    ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : integer;
  return grouped + (fraction === undefined ? "" : "." + fraction) + (readout.format === "percent" ? "%" : "");
}

function* shownPoints(plot: PinePlot, time: number) {
  for (const point of plot.points) if (point.time >= time) yield point;
}

/** Header values need one sample; chart geometry already owns the full rendered data. */
export function latestPineChartPoint(plot: PineChartPlot): { time: UTCTimestamp; value: number } | null {
  if (plot.kind === "table" || plot.kind === "drawing_line" || plot.kind === "fill" || plot.kind === "background" || plot.kind === "barcolor") return null;
  if (plot.visual?.level) {
    const price = plot.visual.level.price, time = plot.visual.bars.at(-1)?.time;
    return price === null || time === undefined ? null : { time: time as UTCTimestamp, value: price };
  }
  if (plot.visual) {
    for (let index = plot.visual.bars.length - 1; index >= plot.visual.showFrom; index--) {
      const value = pineVisualSample(plot, index)?.value;
      if (typeof value === "number" || (plot.kind === "candles" && Array.isArray(value))) return { time: plot.visual.bars[index].time as UTCTimestamp, value: typeof value === "number" ? value : value[3] };
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
  const diagnosticWarnings = result.diagnostics.map((item) => `${item.code}: ${item.message}`);
  const warnings: string[] = [];
  const barsByTime = new Map(bars.map((bar) => [bar.time, bar]));
  const sources = new Map(result.plots.map((plot) => [plot.id, plot]));
  const readouts: PineChartReadout[] = [];
  const hasOffset = (source: PinePlot) => number(source.options.offset, 0) !== 0 || pinePlotOptionSets(source).some((options) => number(options.offset, 0) !== 0);
  const smallProjection = result.plots.length * bars.length <= 4096;
  const plots = result.plots.flatMap((plot): PineChartPlot[] => {
    const plotWarnings = new Set<string>();
    const warn = (message: string) => { if (!plotWarnings.has(message)) { plotWarnings.add(message); warnings.push(`${plot.name}: ${message}`); } };
    const destinations = parsePineDisplay(plot.options.display);
    if (!destinations) { warn("Invalid plot display destinations were omitted."); return []; }
    const constantDisplay = pinePlotOptionSets(plot).every(options => options.display === undefined || canonicalPineDisplay(options.display) === canonicalPineDisplay(plot.options.display));
    if (!constantDisplay) { warn("Changing plot display destinations were omitted."); return []; }
    const numericChannel = !["hline", "fill", "background", "barcolor"].includes(plot.style);
    if (!numericChannel && !["all", "none"].includes(canonicalPineDisplay(plot.options.display)!)) { warn("This visual supports only display.all or display.none."); return []; }
    if (numericChannel && destinations.some(destination => destination !== "pane")) {
      const format = parsePineFormat(plot.options.format ?? "inherit");
      const precision = plot.options.precision;
      if (!format || precision !== undefined && (typeof precision !== "number" || !Number.isSafeInteger(precision) || precision < 0 || precision > 16)
        || !pinePlotOptionSets(plot).every(options => (options.format === undefined || parsePineFormat(options.format) === format) && (options.precision === undefined || options.precision === precision))) {
        warn("Invalid or changing plot number formatting was omitted."); return [];
      }
      const effectiveFormat = format === "inherit" ? precision === undefined ? result.format ?? "inherit" : "price" : format;
      readouts.push(Object.freeze({ id: plot.id, name: plot.name, source: plot, bars, overlay: plot.overlay, destinations, color: color(plot.options.color),
        format: effectiveFormat, ...(precision === undefined && result.precision === undefined ? {} : { precision: (precision ?? result.precision) as number }),
        showFrom: Math.max(0, bars.length - Math.max(0, Math.floor(number(plot.options.show_last, bars.length)))) }));
    }
    if (!destinations.includes("pane")) return [];
    const style = plot.style.replace(/^(?:plot\.)?style_/, "");
    const kinds: Record<string, PineChartPlot["kind"]> = { line: "line", linebr: "line", stepline: "line", stepline_diamond: "line", steplinebr: "line", area: "area", areabr: "area", histogram: "histogram", columns: "histogram", circles: "line", cross: "line", bar: "candles", candle: "candles", candles: "candles", plotcandle: "candles", shape: "markers", plotshape: "markers", char: "markers", plotchar: "markers", arrow: "markers", plotarrow: "markers" };
    const characterPlot = style === "char" || style === "plotchar";
    const arrowPlot = style === "arrow" || style === "plotarrow";
    const packed = getPackedPinePlot(plot);
    const optionSets = pinePlotOptionSets(plot);
    const showLast = Math.max(0, Math.floor(number(plot.options.show_last, bars.length)));
    const showFrom = Math.max(0, bars.length - showLast);
    const behindChart = result.overlay && result.behindChart !== false && plot.options.force_overlay !== true;
    const common = { id: plot.id, name: plot.name, overlay: plot.overlay, behindChart, color: color(plot.options.color), width: Math.max(1, Math.min(4, Math.round(number(plot.options.linewidth, ["area", "areabr"].includes(style) ? 1 : 2)))) as PineChartPlot["width"], step: style.startsWith("stepline"), pointsOnly: ["circles", "cross"].includes(style), base: number(plot.options.histbase, 0) };
    if (style === "barcolor") {
      const offset = plot.options.offset === undefined ? 0 : plot.options.offset;
      if (typeof offset !== "number" || !Number.isSafeInteger(offset) || optionSets.some((options) => options.offset !== undefined && options.offset !== offset)) { warn("Bar colors require a constant safe integer offset; invalid or changing offsets are not applied."); return []; }
      if (plot.options.show_last !== undefined && (typeof plot.options.show_last !== "number" || !Number.isSafeInteger(plot.options.show_last) || plot.options.show_last < 0) || optionSets.some((options) => options.show_last !== undefined && options.show_last !== plot.options.show_last)) { warn("Bar colors require a constant nonnegative show_last count; invalid or changing counts are not applied."); return []; }
      if (optionSets.some((options) => {
        const shade = options.color !== undefined ? options.color : plot.options.color;
        return shade != null && pineGradientColor(shade) === undefined;
      })) warn("Unsupported bar-color formats leave the corresponding primary candle bodies unchanged.");
      return [{ ...common, overlay: true, kind: "barcolor", segments: [], markers: [], visual: { source: plot, bars, style, showFrom, ...(offset ? { plotOffset: offset } : {}) } }];
    }
    if (style === "background") {
      const offset = plot.options.offset == null ? 0 : plot.options.offset;
      if (typeof offset !== "number" || !Number.isSafeInteger(offset)) { warn("Background offsets require a constant safe integer."); return []; }
      if (optionSets.some((options) => options.offset != null && options.offset !== offset)) { warn("Changing per-bar background offsets are not rendered."); return []; }
      if (optionSets.some((options) => {
        const shade = options.color !== undefined ? options.color : plot.options.color;
        return shade != null && pineGradientColor(shade) === undefined;
      })) warn("Unsupported background color formats are not painted.");
      return [{ ...common, kind: "background", segments: [], markers: [], visual: { source: plot, bars, style, showFrom, backgroundOffset: offset } }];
    }
    if (style === "hline") {
      if (hasOffset(plot)) { warn("Horizontal level offsets are not supported."); return []; }
      const defaults = { color: FALLBACK_COLOR, linestyle: "solid", linewidth: 1, display: "all", editable: true };
      const fixed = (key: keyof typeof defaults, fields: Record<string, PineScalar>) => fields[key] !== undefined ? fields[key] : plot.options[key] !== undefined ? plot.options[key] : defaults[key];
      if (!optionSets.every((fields) => (Object.keys(defaults) as (keyof typeof defaults)[]).every((key) => fixed(key, fields) === fixed(key, plot.options)))) {
        warn("Horizontal levels require input-only price, color and style settings; changing per-bar settings are not rendered."); return [];
      }
      let price: number | null | undefined;
      const check = (value: unknown) => {
        if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return false;
        if (price === undefined) price = value as number | null;
        return price === value;
      };
      const constant = packed ? packed.kinds.every((kind, index) => !kind || check(kind === 1 ? null : kind === 4 ? packed.values[index * packed.arity] : undefined)) : plot.points.every((point) => check(point.value));
      if (!constant) { warn("Horizontal levels require input-only prices; changing per-bar prices are not rendered."); return []; }
      const linestyle = String(fixed("linestyle", plot.options)).replace(/^hline[._]style_/, "");
      if (!["solid", "dashed", "dotted"].includes(linestyle)) { warn("This horizontal level line style is not rendered."); return []; }
      const declared = number(plot.options.linewidth, 1), width = Math.max(1, Math.min(4, Math.round(declared))) as PineChartPlot["width"];
      if (declared < 1 || declared > 4 || !Number.isInteger(declared)) warn("Horizontal level line width is limited to integer values from 1 to 4 pixels.");
      if (plot.options.color === undefined || plot.options.linestyle === undefined) warnings.push("Omitted horizontal level colors and styles use local defaults; TradingView default and pixel calibration has not been verified.");
      if (linestyle !== "solid") warnings.push("Horizontal level dash and dot spacing uses local pixel metrics; TradingView pixel calibration has not been verified.");
      const shade = color(plot.options.color);
      return [{ ...common, kind: "line", width, color: shade, segments: [], markers: [], visual: { source: plot, bars, style, showFrom: 0, level: { price: price ?? null, color: shade, width, linestyle: linestyle as "solid" | "dashed" | "dotted" } } }];
    }
    if (style === "fill") {
      const upper = sources.get(String(plot.options.plot1)), lower = sources.get(String(plot.options.plot2));
      if (!upper || !lower) { warn("Fill references are unavailable; this fill is not drawn."); return []; }
      // Hidden references bypass the normal plot adapter, so validate their offsets here too.
      const referenceOffset = (source: PinePlot) => {
        const offset = source.options.offset === undefined ? 0 : source.options.offset;
        return typeof offset === "number" && Number.isSafeInteger(offset) && pinePlotOptionSets(source).every((options) => options.offset === undefined || options.offset === offset) ? offset : undefined;
      };
      const upperOffset = referenceOffset(upper), lowerOffset = referenceOffset(lower);
      if (upperOffset === undefined || lowerOffset === undefined) { warn("Fill references require constant safe integer plot offsets; invalid or changing offsets are not rendered."); return []; }
      if (hasOffset(plot)) { warn("Fill has no offset argument; an injected fill offset is not rendered."); return []; }
      if (upper.overlay !== lower.overlay) { warn("Fill references cross chart placements; this fill is not drawn."); return []; }
      const gradient = plot.options.gradient === true || ["top_value", "bottom_value", "top_color", "bottom_color"].some((key) => key in plot.options) || optionSets.some((options) => ["top_value", "bottom_value", "top_color", "bottom_color"].some((key) => key in options));
      if (gradient && optionSets.some((options) => {
        const top = options.top_value !== undefined ? options.top_value : plot.options.top_value;
        const bottom = options.bottom_value !== undefined ? options.bottom_value : plot.options.bottom_value;
        return typeof top === "number" && top === bottom;
      })) warn("Local gradient policy: equal anchors have zero span and are not painted; TradingView corner-case parity has not been verified.");
      if (gradient && optionSets.some((options) => ["top_color", "bottom_color"].some((key) => pineGradientColor(options[key] !== undefined ? options[key] : plot.options[key]) === undefined))) { warn("This gradient color format is not rendered by this chart adapter."); return []; }
      return [{ ...common, overlay: upper.overlay, behindChart: behindChart && !(upper.options.force_overlay === true && lower.options.force_overlay === true), kind: "fill", segments: [], markers: [], visual: { source: plot, bars, style, showFrom, gradient, refs: { upper, lower, upperOffset, lowerOffset } } }];
    }
    const kind = kinds[style];
    if (!kind) { warn(`Native ${style} output is not rendered by this chart adapter.`); return []; }
    const declaredLineStyle = plot.options.linestyle === undefined ? "linestyle_solid" : plot.options.linestyle;
    if (typeof declaredLineStyle !== "string" || !["linestyle_solid", "linestyle_dashed", "linestyle_dotted"].includes(declaredLineStyle) || optionSets.some((options) => options.linestyle !== undefined && options.linestyle !== declaredLineStyle)) { warn("Plot line styles require a constant solid, dashed or dotted setting; invalid or changing styles are not rendered."); return []; }
    const linestyle = ["line", "linebr", "stepline", "stepline_diamond", "area"].includes(style) ? String(declaredLineStyle).replace("linestyle_", "") as "solid" | "dashed" | "dotted" : "solid";
    if (linestyle !== "solid") warn("Plot dash and dot spacing uses local canvas metrics; exact TradingView pixels have not been verified.");
    if (style === "stepline_diamond") warn("Step-line diamond sizes and gap transitions use local canvas metrics; exact TradingView pixels have not been verified.");
    const numericStyle = ["line", "area", "histogram"].includes(kind);
    const supportsOffset = numericStyle || kind === "markers";
    const plotOffset = supportsOffset && plot.options.offset !== undefined ? plot.options.offset : 0;
    if (typeof plotOffset !== "number" || !Number.isSafeInteger(plotOffset)) { warn("Plot offsets require a constant safe integer."); return []; }
    if (supportsOffset && optionSets.some((options) => {
      // PineTS emits null per-sample defaults for omitted signal arguments.
      // Only that absent global declaration means zero; authored nulls and
      // changing resolved offsets retain the strict constant-offset guard.
      const omittedMarkerOffset = kind === "markers" && plot.options.offset === undefined && options.offset === null;
      return !omittedMarkerOffset && options.offset !== undefined && options.offset !== plotOffset;
    })) { warn("Changing per-bar plot offsets are not rendered."); return []; }
    if (!supportsOffset && hasOffset(plot)) { warn("Offsets for this plot style are not rendered by this chart adapter."); return []; }
    const numericBody = kind === "area" || kind === "histogram";
    const base = plot.options.histbase === undefined ? 0 : plot.options.histbase;
    if (numericBody && (typeof base !== "number" || !Number.isFinite(base) || optionSets.some((options) => options.histbase !== undefined && options.histbase !== base))) { warn("Numeric filled plots require a constant finite histbase; changing or invalid baselines are not rendered."); return []; }
    const histogramWidth = plot.options.linewidth === undefined ? 1 : plot.options.linewidth;
    if (style === "histogram" && (typeof histogramWidth !== "number" || !Number.isSafeInteger(histogramWidth) || histogramWidth < 1 || optionSets.some((options) => options.linewidth !== undefined && options.linewidth !== histogramWidth))) { warn("Histogram width requires a constant positive integer in pixels; changing or invalid widths are not rendered."); return []; }
    if (style === "columns") warnings.push("Column widths use the local chart pixel-gap cadence; TradingView pixel gap calibration has not been verified.");
    const pointStyle = ["circles", "cross"].includes(style);
    const relativeSize = plot.options.linewidth === undefined ? 1 : plot.options.linewidth;
    if (pointStyle && (typeof relativeSize !== "number" || !Number.isSafeInteger(relativeSize) || relativeSize < 1 || optionSets.some((options) => options.linewidth !== undefined && options.linewidth !== relativeSize))) { warn("Point plots require a constant positive integer relative size; invalid or changing sizes are not rendered."); return []; }
    const joinFlag = plot.options.join === undefined ? false : plot.options.join;
    const constantJoin = typeof joinFlag === "boolean" && optionSets.every((options) => options.join === undefined || options.join === joinFlag);
    if (pointStyle && !constantJoin) warn("Point joins require a constant boolean join flag; invalid or changing flags leave the symbols separate.");
    const declaredWidth = number(plot.options.linewidth, kind === "area" ? 1 : 2);
    if (!pointStyle && kind !== "histogram" && (declaredWidth < 1 || declaredWidth > 4 || !Number.isInteger(declaredWidth) || optionSets.some((options) => options.linewidth !== undefined && (number(options.linewidth, 2) < 1 || number(options.linewidth, 2) > 4 || !Number.isInteger(number(options.linewidth, 2)))))) warn("Plot line width is limited to integer values from 1 to 4 pixels.");
    const trackPriceFlag = plot.options.trackprice === undefined ? false : plot.options.trackprice;
    const constantTrackPrice = typeof trackPriceFlag === "boolean" && optionSets.every((options) => options.trackprice === undefined || options.trackprice === trackPriceFlag);
    if (!constantTrackPrice) warn("Price guides require a constant boolean trackprice flag; invalid or changing flags leave the plot body unchanged.");
    let trackPrice: { price: number; color: string } | undefined;
    if (numericStyle && constantTrackPrice && trackPriceFlag) {
      // Source-first selection, independent of visual offsets. Decode one packed sample,
      // never project the history or rescan it on each chart redraw.
      let sample;
      if (packed) {
        for (let index = Math.min(bars.length, packed.slots) - 1; index >= showFrom; index--) {
          if (packed.kinds[index] === 4 && Number.isFinite(packed.values[index * packed.arity])) { sample = pointAtBar(plot, index); break; }
        }
      } else {
        const firstTime = bars[showFrom]?.time ?? Infinity;
        for (let index = plot.points.length - 1; index >= 0; index--) {
          const point = plot.points[index];
          if (point.time < firstTime) break;
          if (barsByTime.has(point.time) && typeof point.value === "number" && Number.isFinite(point.value)) { sample = point; break; }
        }
      }
      // A transparent latest numeric sample hides its guide, without reviving an
      // earlier painted sample. Header values remain independent of paint.
      if (sample && typeof sample.value === "number") {
        const shade = color(sample.options.color !== undefined ? sample.options.color : plot.options.color);
        trackPrice = { price: sample.value, color: pineGradientColor(shade)?.[3] === 0 ? "rgba(0,0,0,0)" : shade };
      }
    }
    if (pointStyle) warn("Point sizes and join gap/color behavior use local canvas metrics; TradingView pixel and corner-case calibration has not been verified.");
    let arrow: { minHeight: number; maxHeight: number; maxMagnitude: number } | undefined;
    if (arrowPlot) {
      const minHeight = plot.options.minheight === undefined ? 5 : plot.options.minheight;
      const maxHeight = plot.options.maxheight === undefined ? 100 : plot.options.maxheight;
      if (typeof minHeight !== "number" || typeof maxHeight !== "number" || !Number.isSafeInteger(minHeight) || !Number.isSafeInteger(maxHeight) || minHeight < 0 || maxHeight < minHeight || optionSets.some((options) =>
        options.minheight !== undefined && options.minheight !== minHeight || options.maxheight !== undefined && options.maxheight !== maxHeight || options.height !== undefined && !(options.height === null && plot.options.maxheight === undefined) && options.height !== maxHeight)) {
        warn("Arrow heights require constant nonnegative integer bounds, with maxheight at least minheight."); return [];
      }
      if (plot.options.show_last !== undefined && (typeof plot.options.show_last !== "number" || !Number.isSafeInteger(plot.options.show_last) || plot.options.show_last < 0) || optionSets.some((options) => options.show_last !== undefined && options.show_last !== plot.options.show_last)) { warn("Arrow show_last requires a constant nonnegative integer count."); return []; }
      // One source-snapshot scan: magnitude stays independent of viewport,
      // offsets, visibility and color. Packed channels never project samples.
      let maxMagnitude = 0;
      if (packed) {
        for (let index = 0; index < Math.min(packed.slots, bars.length); index++) if (packed.kinds[index] === 4) {
          const value = packed.values[index * packed.arity];
          if (Number.isFinite(value)) maxMagnitude = Math.max(maxMagnitude, Math.abs(value));
        }
      } else for (const point of plot.points) if (barsByTime.has(point.time) && typeof point.value === "number" && Number.isFinite(point.value)) maxMagnitude = Math.max(maxMagnitude, Math.abs(point.value));
      arrow = { minHeight, maxHeight, maxMagnitude };
      warn("Arrow length uses the absolute signal relative to its full retained snapshot, capped at maxheight with a minheight floor. TradingView normalization and pixel calibration have not been verified.");
      if (plot.options.colorup === undefined || plot.options.colordown === undefined) warn("Omitted arrow colors use local green and rose defaults.");
    }
    const baseColor = color(plot.options.color);
    const visual = ["line", "markers", "area", "histogram", "candles"].includes(kind) ? { source: plot, bars, style, showFrom, ...(kind === "line" || kind === "area" ? { linestyle } : {}), ...(style === "stepline_diamond" ? { diamond: { size: common.width + 2 } } : {}), ...(arrow ? { arrow } : {}), ...(pointStyle ? { pointStyle: { size: relativeSize as number, join: constantJoin && joinFlag === true } } : {}), ...(trackPrice ? { trackPrice } : {}), ...(plotOffset ? { plotOffset } : {}), ...(style === "histogram" ? { histogramWidth: histogramWidth as number } : {}) } : undefined;
    if (style === "bar") {
      warnings.push("Native OHLC bar widths use local chart pixel cadence; TradingView pixel calibration has not been verified.");
      if (plot.options.color === undefined) warnings.push("Omitted native OHLC bar colors use local defaults; TradingView default color calibration has not been verified.");
    } else if (kind === "candles" && ["color", "wickcolor", "bordercolor"].some((key) => plot.options[key] === undefined)) warnings.push("Omitted native candle colors use local defaults and inheritance; TradingView default color calibration has not been verified.");
    if (kind === "markers" && !arrowPlot) {
      const allowedShapes = ["circle", "square", "arrowup", "arrowdown", "triangleup", "triangledown", "labelup", "labeldown", "cross", "xcross", "diamond", "flag"];
      const supported = optionSets.every((options) => {
        const shape = String(options.shape ?? plot.options.shape ?? "circle").toLowerCase().replace(/^shape[._]/, "").replace(/_/g, "");
        const location = String(options.location ?? plot.options.location ?? "abovebar").toLowerCase().replace(/^location[._]/, "");
        return (characterPlot || allowedShapes.includes(shape)) && ["absolute", "abovebar", "belowbar", "top", "bottom"].includes(location);
      });
      if (!supported) { warn("This shape or location is not rendered by this chart adapter."); return []; }
      if (characterPlot) {
        warn("Characters display the first Unicode codepoint using local fonts and sizes; TradingView glyph and pixel calibration has not been verified.");
        if (["char", "color", "textcolor"].some((key) => plot.options[key] === undefined)) warn("Omitted character options use local defaults, including the star glyph and inherited text color.");
      } else if (plot.options.size != null || optionSets.some((options) => options.size != null)) warnings.push("Shape sizes and text use local pixel metrics; TradingView font and size calibration has not been verified.");
    }
    if (kind !== "markers" && kind !== "candles" && (packed ? packed.kinds.some((kind) => kind > 1 && kind !== 4) : plot.points.some((point) => point.value !== null && typeof point.value !== "number"))) warn("Non-numeric values are not rendered as a numeric series.");
    if (visual && (!smallProjection || characterPlot || arrowPlot)) return [{ ...common, kind, segments: [], markers: [], visual }];
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
        const nativeShape = String(options.shape ?? "circle").toLowerCase().replace(/^shape[._]/, "").replace(/_/g, "");
        const shape = shapes[nativeShape];
        const location = String(options.location ?? "abovebar").toLowerCase().replace(/^location[._]/, "");
        if (point.value === null || point.value === false || (location !== "absolute" && point.value === 0)) continue;
        const bar = barsByTime.get(point.time);
        if (![...Object.keys(shapes), "cross", "xcross", "diamond", "flag"].includes(nativeShape) || !["abovebar", "belowbar", "absolute", "top", "bottom"].includes(location) || !bar) {
          if (!warnedShape) { warn("This shape or location is not rendered by this chart adapter."); warnedShape = true; }
          continue;
        }
        if (location === "absolute" && typeof point.value !== "number") continue;
        // Edge locations have no price coordinate. Lightweight marker metadata
        // cannot express them; the source-backed primitive renders them directly.
        if (location === "top" || location === "bottom") continue;
        segments[0].push({ time, value: location === "absolute" ? point.value as number : location === "belowbar" ? bar.low : bar.high });
        if (shape) markers.push({ time, color: pointColor, shape, position: location === "absolute" ? "inBar" : location === "belowbar" ? "belowBar" : "aboveBar", text: typeof options.text === "string" ? options.text : undefined });
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
    if (!visual && optionSets.some((options) => options.linewidth !== undefined && options.linewidth !== plot.options.linewidth)) warn("Per-point line width is not supported; the declared plot width is used.");
    return [{ id: plot.id, name: plot.name, overlay: plot.overlay, behindChart, kind, color: baseColor, width: Math.max(1, Math.min(4, Math.round(declaredWidth))) as PineChartPlot["width"], step: style.startsWith("stepline"), pointsOnly: ["circles", "cross"].includes(style), base: number(plot.options.histbase, 0), segments: nonempty, markers, visual }];
  });
  if (result.lines?.length || result.lineFills?.length || result.boxes?.length || result.labels?.length || result.polylines?.length) {
    if (result.audit.bars !== bars.length) warnings.push("Pine drawings require their execution's owned chart snapshot; mismatched drawings were omitted.");
    else for (const overlay of [false, true]) {
      const lines = (result.lines ?? []).filter(line => line.overlay === overlay);
      const boxes = (result.boxes ?? []).filter(box => box.overlay === overlay);
      const labels = (result.labels ?? []).filter(label => label.overlay === overlay);
      const polylines = (result.polylines ?? []).filter(polyline => polyline.overlay === overlay);
      if (polylines.length) warnings.push("Polylines use local uniform Catmull–Rom curves with possible overshoot, nonzero-winding fills and a layer above boxes/below labels. NA points break strokes and suppress fill/closed seams; unrepresentable curve controls omit the affected run. Exact TradingView spline, fill and layer calibration has not been verified.");
      if (polylines.some(polyline => [polyline.lineColor, polyline.fillColor].some(shade => pineGradientColor(shade) === undefined))) warnings.push("Unsupported polyline colors are not painted.");
      if (polylines.some(polyline => polyline.xloc === "bar_time" && polyline.points.some(point => point.x !== null && !barsByTime.has(point.x)))) warnings.push("Polyline times between candles interpolate chart positions; times outside history use the nearest known interval. Exchange-session placement has not been verified.");
      const lineIds = new Set(lines.map(line => line.id));
      const lineFills = (result.lineFills ?? []).filter(fill => fill.overlay === overlay && lineIds.has(fill.line1) && lineIds.has(fill.line2));
      if ((result.lineFills ?? []).some(fill => fill.overlay === overlay && (!lineIds.has(fill.line1) || !lineIds.has(fill.line2)))) warnings.push("Line fills across separate chart panes are not drawn; both boundaries must share a placement.");
      if (lineFills.length) warnings.push("Line fills use the common horizontal domain of their boundaries. Unequal/reversed endpoints and vertical-line corner cases use local geometry; complete TradingView geometry parity has not been verified.");
      if (lineFills.some(fill => pineGradientColor(fill.color) === undefined)) warnings.push("Unsupported line-fill color formats are not painted.");
      if (boxes.length) warnings.push("Boxes extend horizontal borders while backgrounds and text keep their authored rectangle. Reversed corners, fonts, wrapping and dash metrics use local canvas policies; size.auto uses a 14-pixel default and explicit newlines remain separate; exact TradingView pixels have not been verified.");
      if (boxes.some(box => [box.borderColor, box.bgcolor, box.textColor].some(shade => pineGradientColor(shade) === undefined))) warnings.push("Unsupported box colors are not painted.");
      if (boxes.some(box => box.xloc === "bar_time" && [box.left, box.right].some(time => time !== null && !barsByTime.has(time)))) warnings.push("Box times between loaded candles interpolate chart positions; times outside history use the nearest known interval. Exchange-session time placement has not been verified.");
      if (labels.length) warnings.push("Label shapes, fonts and padding use local canvas metrics; size.auto uses 12 pixels and omitted colors use blue/white. Oversized glyphs clip to the pane; total label scale padding is capped at 20% of pane height. Exact TradingView pixels have not been verified.");
      if (labels.some(label => [label.color, label.textColor].some(shade => pineGradientColor(shade) === undefined))) warnings.push("Unsupported label colors are not painted.");
      if (labels.some(label => label.xloc === "bar_time" && label.x !== null && !barsByTime.has(label.x))) warnings.push("Label times between candles interpolate positions. Above/below-bar labels require an actual referenced candle; missing-session anchors are not fabricated.");
      if (labels.some(label => label.yloc !== "price" && label.xloc === "bar_index" && label.x !== null && (label.x < 0 || label.x >= bars.length))) warnings.push("Above/below-bar labels outside loaded history have no candle anchor and are not painted.");
      const behindChart = result.overlay && result.behindChart !== false;
      if (lineFills.some(fill => lines.find(line => line.id === fill.line1)?.forceOverlay || lines.find(line => line.id === fill.line2)?.forceOverlay)) warnings.push("Line-fill layers follow the pinned engine: forcing either boundary onto the main chart places its fill in front. Mixed boundary layering has not been calibrated against TradingView.");
      if (!lines.length && !boxes.length && !labels.length && !polylines.length) continue;
      const unsupportedColors = lines.some(line => pineGradientColor(line.color) === undefined);
      if (unsupportedColors) warnings.push("Unsupported line-drawing colors are not painted.");
      if (lines.some(line => line.xloc === "bar_time" && [line.x1, line.x2].some(time => time !== null && !barsByTime.has(time)))) warnings.push("Line times between loaded candles interpolate chart positions; times outside history use the nearest known interval. Exchange-session time placement has not been verified.");
      if (lines.some(line => line.style !== "solid")) warnings.push("Line dashes, dots and arrowheads use local canvas metrics; TradingView pixel calibration has not been verified.");
      plots.push({ id: `pine-lines-${overlay ? "overlay" : "pane"}`, name: boxes.length || labels.length || polylines.length ? "Drawings" : "Lines", overlay,
        behindChart,
        kind: "drawing_line", color: lines.find(line => line.color !== null)?.color ?? "#2962FF", width: 1,
        step: false, pointsOnly: false, base: 0, segments: [], markers: [], drawing: { lines, lineFills, boxes, labels, polylines, bars } });
    }
  }
  if (result.tables?.length) {
    for (const overlay of [true, false]) {
      const tables = result.tables.filter(table => table.overlay === overlay);
      if (!tables.length) continue;
      plots.push({ id: `pine-tables-${overlay ? "overlay" : "pane"}`, name: "Tables", overlay, kind: "table", color: FALLBACK_COLOR,
        width: 1, step: false, pointsOnly: false, base: 0, segments: [], markers: [], table: { tables } });
    }
    if (result.tables.length) warnings.push("Tables use local browser fonts and padding; size.auto uses 14 typographic points. Merge-only empty axes use distributed auto text sizing. Tables appear above chart drawings; exact TradingView pixel and behind_chart calibration, and its bottom-panel view, are not provided.");
    if (result.tables.some(table => [table.bgcolor, table.frameColor, table.borderColor, ...table.cells.flatMap(row => row.flatMap(cell => cell ? [cell.textColor, cell.bgcolor] : []))].some(shade => shade !== null && pineGradientColor(shade) === undefined))) warnings.push("Unsupported table colors are not painted.");
  }
  const strategyMarkers: SeriesMarker<UTCTimestamp>[] = [];
  for (const trade of [...result.strategy?.closedTrades ?? [], ...result.strategy?.openTrades ?? []]) {
    for (const leg of ["entry", "exit"] as const) {
      const rawTime = trade[`${leg}_time`];
      if (typeof rawTime !== "number" || !Number.isFinite(rawTime)) continue;
      let time: number;
      const indexKey = `${leg}_bar_index`;
      if (Object.prototype.hasOwnProperty.call(trade, indexKey)) {
        // Native indexes belong to the request's chart bars, while magnified
        // ledger timestamps retain the real child candle opening time.
        if (result.audit.bars !== bars.length) {
          warnings.push("Strategy markers require the execution's owned chart snapshot; indexed markers were omitted.");
          continue;
        }
        const index = trade[indexKey];
        if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= bars.length) {
          warnings.push("Strategy markers require a valid parent bar index; invalid indexed markers were omitted.");
          continue;
        }
        time = bars[index].time;
      } else {
        // Older ledgers have no parent index. Only an exact real chart time
        // can locate them; do not infer a timeframe interval or invent a bar.
        time = rawTime > 253_402_300_799 ? rawTime / 1000 : rawTime;
        if (!barsByTime.has(time)) continue;
      }
      const long = number(trade.size, 0) > 0;
      const buy = leg === "entry" ? long : !long;
      strategyMarkers.push({ time: time as UTCTimestamp, position: buy ? "belowBar" : "aboveBar", color: buy ? "#22c55e" : "#fb7185", shape: buy ? "arrowUp" : "arrowDown", text: `Pine ${leg} ${String(trade.entry_id ?? trade.id)}` });
    }
  }
  if (readouts.some(readout => !readout.overlay && readout.destinations.includes("price_scale")
    && !["shape", "plotshape", "char", "plotchar", "arrow", "plotarrow"].includes(readout.source.style))) {
    const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
    const hasBasis = plots.some(plot => !plot.overlay && (finite(latestPineChartPoint(plot)?.value)
      || plot.segments.some(segment => segment.some(point => finite(point.value) || finite(point.low) || finite(point.high)))
      || plot.drawing?.lines.some(line => finite(line.y1) || finite(line.y2))
      || plot.drawing?.boxes?.some(box => finite(box.top) || finite(box.bottom))
      || plot.drawing?.labels?.some(label => label.yloc === "price" && finite(label.y))
      || plot.drawing?.polylines?.some(polyline => polyline.points.some(point => finite(point.y)))));
    if (!hasBasis) warnings.push("Price-scale values need a pane with plotted prices. This study has no finite pane geometry; its selected Data Window and status values remain available.");
  }
  return { plots, readouts: Object.freeze(readouts), warnings: [...new Set([...diagnosticWarnings, ...warnings])], adapterWarnings: [...new Set(warnings)], strategyMarkers: strategyMarkers.sort((left, right) => Number(left.time) - Number(right.time)) };
}

/** Body-only overrides over real primary chart slots; no point-object projection or synthetic bars. */
export function projectPineBarColors(plots: readonly PineChartPlot[], chartBars: readonly Pick<Candle, "time">[]): { colorAt: (index: number) => string | undefined; warnings: string[] } {
  const channels = plots.filter((plot) => plot.kind === "barcolor" && plot.visual);
  const warnings = channels.length > 1 ? ["Local bar-color precedence follows study order and later non-na calls; TradingView cross-study precedence has not been verified."] : [];
  const compiled = channels.map((plot) => ({ plot, source: plot.visual!.source, bars: plot.visual!.bars, packed: getPackedPinePlot(plot.visual!.source), offset: plot.visual!.plotOffset ?? 0 }));
  return { warnings, colorAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= chartBars.length) return undefined;
    for (let channel = compiled.length - 1; channel >= 0; channel--) {
      const { plot, source, bars, packed, offset } = compiled[channel];
      const target = index - offset;
      if (target < 0 || target >= chartBars.length) continue;
      const time = chartBars[target].time;
      let lo = plot.visual!.showFrom, hi = bars.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].time < time) lo = mid + 1; else hi = mid; }
      if (bars[lo]?.time !== time) continue;
      let shade: PineScalar | undefined;
      if (packed) {
        if (packed.kinds[lo] !== 3) continue;
        const fields = packed.optionTable[packed.optionIndices[lo]], colorLane = packed.numericOptions.indexOf("color");
        if (colorLane >= 0 && packed.numericKinds[colorLane * packed.slots + lo] === 1) continue;
        shade = fields.color !== undefined ? fields.color : source.options.color;
      } else {
        let left = 0, right = source.points.length;
        while (left < right) { const mid = (left + right) >>> 1; if (source.points[mid].time < time) left = mid + 1; else right = mid; }
        const sample = source.points[left];
        if (sample?.time !== time || sample.value !== true) continue;
        shade = sample.options.color !== undefined ? sample.options.color : source.options.color;
      }
      // na is a no-op; an explicit fully transparent color remains a real body override.
      if (typeof shade === "string") {
        const rgba = pineGradientColor(shade);
        // The primary series contrast parser accepts integer RGB, not CSS percentages or fractions.
        if (rgba) {
          const [mantissa, exponent] = String(rgba[3]).split("e-");
          const alpha = exponent === undefined ? mantissa : "0." + "0".repeat(Number(exponent) - 1) + mantissa.replace(".", "");
          return `rgba(${Math.round(rgba[0])},${Math.round(rgba[1])},${Math.round(rgba[2])},${alpha})`;
        }
      }
    }
    return undefined;
  } };
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
export function installPineChartPlots(chart: IChartApi, plots: readonly PineChartPlot[], priceScaleId = "right", options: { allowFillOnlyScale?: boolean; scaleAnchor?: Pick<Candle, "time" | "close">; readouts?: readonly PineChartReadout[]; fallbackPrecision?: number } = {}): { series: ISeriesApi<SeriesType>[]; primitive?: PineVisualPrimitive; drawingPrimitive?: PineLinePrimitive; tablePrimitive?: PineTablePrimitive; dispose: () => void } {
  const native = plots.filter((plot) => plot.kind !== "barcolor" && plot.kind !== "table" && !plot.visual && !plot.drawing).flatMap((plot) => installNativePineChartPlot(chart, plot, priceScaleId));
  const visual = plots.filter((plot) => plot.kind !== "barcolor" && plot.visual);
  const primitive = visual.length ? new PineVisualPrimitive(visual, plots.filter((plot) => plot.kind !== "barcolor" && plot.kind !== "table" && !plot.visual && !plot.drawing), options) : undefined;
  let host: ISeriesApi<"Line"> | undefined;
  if (primitive) {
    const timeline = new Map<number, Candle>();
    for (const plot of visual) for (const bar of plot.visual!.bars) timeline.set(bar.time, bar);
    const bars = [...timeline.values()].sort((a, b) => a.time - b.time);
    host = chart.addLineSeries({ priceScaleId, color: "transparent", lineVisible: false, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => primitive.rangeForVisible() });
    // LWC skips primitive autoscale on empty data and needs a first numeric value for conversion.
    // Endpoint seeds keep NearestRight first-value lookup valid after panning.
    // The provider above entirely replaces their range; they never contribute to autoscale.
    const data = bars.map((bar, index) => (index === 0 || index === bars.length - 1) ? { time: bar.time as UTCTimestamp, value: bar.close, color: "transparent" } : { time: bar.time as UTCTimestamp });
    // A newer real price-chart endpoint keeps conversion and primitive autoscale available
    // when the chart's shared timeline extends beyond this Pine snapshot. It adds no invented time.
    const anchor = options.scaleAnchor;
    if (anchor && Number.isFinite(anchor.time) && Number.isFinite(anchor.close) && anchor.time > (bars.at(-1)?.time ?? -Infinity)) data.push({ time: anchor.time as UTCTimestamp, value: anchor.close, color: "transparent" });
    host.setData(data);
    host.attachPrimitive(primitive);
    native.push(host);
  }
  const drawings = plots.filter(plot => plot.drawing);
  const drawingPrimitive = drawings.length ? new PineLinePrimitive(drawings, { allowFillOnlyScale: options.allowFillOnlyScale !== false, hasScalePeer: () => {
    if (primitive?.rangeForVisible()) return true;
    const scale = chart.timeScale(), range = scale.getVisibleLogicalRange();
    if (!range) return false;
    return plots.filter(plot => !plot.drawing && !plot.visual && plot.kind !== "barcolor" && plot.kind !== "table").some(plot => plot.segments.some(segment => {
      const locate = (point: PineChartPoint) => {
        const coordinate = scale.timeToCoordinate(point.time);
        return coordinate === null ? null : scale.coordinateToLogical(coordinate);
      };
      let lo = 0, hi = segment.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1, logical = locate(segment[mid]);
        if (logical === null) { lo = 0; break; }
        if (logical < range.from) lo = mid + 1; else hi = mid;
      }
      let start = Math.max(0, lo - 1);
      while (start > 0 && segment[start].value === undefined && segment[start].open === undefined) start--;
      let previous: number | null = null;
      for (let index = start; index < segment.length; index++) {
        const point = segment[index];
        if (point.value === undefined && point.open === undefined) continue;
        const logical = locate(point);
        if (logical === null) continue;
        if (logical >= range.from && logical <= range.to) return true;
        if (previous !== null && ["line", "area"].includes(plot.kind) && previous < range.from && logical > range.to) return true;
        previous = logical;
        if (logical > range.to) break;
      }
      return false;
    }));
  } }) : undefined;
  let drawingHost: ISeriesApi<"Line"> | undefined;
  if (drawingPrimitive) {
    const timeline = new Map<number, Candle>();
    for (const plot of drawings) for (const bar of plot.drawing!.bars) timeline.set(bar.time, bar);
    const bars = [...timeline.values()].sort((a, b) => a.time - b.time);
    drawingHost = chart.addLineSeries({ priceScaleId, color: "transparent", lineVisible: false, crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => drawingPrimitive.rangeForVisible() });
    const data = bars.map((bar, index) => index === 0 || index === bars.length - 1 ? { time: bar.time as UTCTimestamp, value: bar.close, color: "transparent" } : { time: bar.time as UTCTimestamp });
    const anchor = options.scaleAnchor;
    if (anchor && Number.isFinite(anchor.time) && Number.isFinite(anchor.close) && anchor.time > (bars.at(-1)?.time ?? -Infinity)) data.push({ time: anchor.time as UTCTimestamp, value: anchor.close, color: "transparent" });
    drawingHost.setData(data); drawingHost.attachPrimitive(drawingPrimitive); native.push(drawingHost);
  }
  const tables = plots.flatMap(plot => plot.table?.tables ?? []);
  const tablePrimitive = tables.length ? new PineTablePrimitive(tables) : undefined;
  let tableHost: ISeriesApi<"Line"> | undefined;
  if (tablePrimitive) {
    tableHost = chart.addLineSeries({ priceScaleId, color: "transparent", lineVisible: false, crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => null });
    tableHost.setData([]); tableHost.attachPrimitive(tablePrimitive); native.push(tableHost);
  }
  let disposed = false;
  // These hosts publish only labels. Their timestamps already belong to the
  // owned chart, and a null range prevents readouts from changing autoscale.
  const labelHosts = (options.readouts ?? []).filter(readout => readout.destinations.includes("price_scale")
    && !["shape", "plotshape", "char", "plotchar", "arrow", "plotarrow"].includes(readout.source.style)).map(readout => {
    const series = chart.addLineSeries({ priceScaleId, color: readout.color, lineVisible: false, pointMarkersVisible: false,
      crosshairMarkerVisible: false, lastValueVisible: true, priceLineVisible: false, autoscaleInfoProvider: () => null,
      priceFormat: { type: "custom", minMove: 10 ** -(readout.precision ?? (readout.format === "inherit" ? options.fallbackPrecision ?? 2 : 2)), formatter: (value: number) => formatPineChartValue(readout, value, options.fallbackPrecision) } });
    native.push(series);
    return { readout, series, endpoint: -1 };
  });
  const refreshLabels = () => {
    if (disposed) return;
    const visible = chart.timeScale().getVisibleRange();
    const endTime = visible && typeof visible.to === "number" ? visible.to : Infinity;
    for (const host of labelHosts) {
      const { readout, series } = host;
      let lo = 0, hi = readout.bars.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (readout.bars[mid].time <= endTime) lo = mid + 1; else hi = mid; }
      const endpoint = lo - 1;
      if (endpoint === host.endpoint) continue;
      host.endpoint = endpoint;
      let sample: ReturnType<typeof samplePineChartReadout>;
      for (let index = endpoint; index >= readout.showFrom; index--) {
        const candidate = samplePineChartReadout(readout, readout.bars[index].time);
        if (candidate?.values.at(-1) !== null && candidate?.values.at(-1) !== undefined) { sample = candidate; break; }
      }
      const value = sample?.values.at(-1);
      series.applyOptions({ color: sample?.color ?? readout.color });
      series.setData(typeof value === "number" && endpoint >= 0 ? [{ time: readout.bars[endpoint].time as UTCTimestamp, value }] : []);
    }
  };
  if (labelHosts.length) { chart.timeScale().subscribeVisibleLogicalRangeChange(refreshLabels); refreshLabels(); }
  return { series: native, primitive, drawingPrimitive, tablePrimitive, dispose() {
    if (disposed) return;
    disposed = true;
    if (labelHosts.length) chart.timeScale().unsubscribeVisibleLogicalRangeChange(refreshLabels);
    if (host && primitive) host.detachPrimitive(primitive);
    if (drawingHost && drawingPrimitive) drawingHost.detachPrimitive(drawingPrimitive);
    if (tableHost && tablePrimitive) tableHost.detachPrimitive(tablePrimitive);
    for (const series of native) chart.removeSeries(series);
  } };
}

/** Compatibility entry point. Group placements with installPineChartPlots in chart owners. */
export function installPineChartPlot(chart: IChartApi, plot: PineChartPlot, priceScaleId = "right"): ISeriesApi<SeriesType>[] {
  return installPineChartPlots(chart, [plot], priceScaleId).series;
}
