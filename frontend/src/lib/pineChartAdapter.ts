import type { Candle } from "./api";
import type { PineExecutionResult, PinePlot, PineScalar } from "./pineProtocol";
import { getPackedPinePlot, pinePlotOptionSets, pointAtBar } from "./pinePacked";
import { PineVisualPrimitive, pineVisualSample, pineGradientColor } from "./pineVisualPrimitive";
import type { IChartApi, ISeriesApi, SeriesType, SeriesMarker, UTCTimestamp } from "lightweight-charts";

export type PineChartPoint = { time: UTCTimestamp; value?: number; color?: string; open?: number; high?: number; low?: number; close?: number; wickColor?: string; borderColor?: string };
export type PineChartPlot = {
  id: string; name: string; overlay: boolean; behindChart?: boolean; kind: "line" | "area" | "histogram" | "candles" | "markers" | "fill" | "background" | "barcolor";
  color: string; width: 1 | 2 | 3 | 4; step: boolean; pointsOnly: boolean; base: number;
  segments: PineChartPoint[][]; markers: SeriesMarker<UTCTimestamp>[];
  visual?: { pointStyle?: { size: number; join: boolean }; trackPrice?: { price: number; color: string }; histogramWidth?: number; plotOffset?: number; backgroundOffset?: number; level?: { price: number | null; color: string; width: 1 | 2 | 3 | 4; linestyle: "solid" | "dashed" | "dotted" }; source: PinePlot; bars: readonly Candle[]; style: string; showFrom: number; gradient?: boolean; refs?: { upper: PinePlot; lower: PinePlot } };
};
export type PineChartResult = { plots: PineChartPlot[]; warnings: string[]; adapterWarnings: string[]; strategyMarkers: SeriesMarker<UTCTimestamp>[] };
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
  if (plot.kind === "fill" || plot.kind === "background" || plot.kind === "barcolor") return null;
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
  const hasOffset = (source: PinePlot) => number(source.options.offset, 0) !== 0 || pinePlotOptionSets(source).some((options) => number(options.offset, 0) !== 0);
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
    const kinds: Record<string, PineChartPlot["kind"]> = { line: "line", linebr: "line", stepline: "line", steplinebr: "line", area: "area", areabr: "area", histogram: "histogram", columns: "histogram", circles: "line", cross: "line", bar: "candles", candle: "candles", candles: "candles", plotcandle: "candles", shape: "markers", plotshape: "markers" };
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
      if (hasOffset(plot) || hasOffset(upper) || hasOffset(lower)) { warn("Fill references with plot offsets are not rendered by this chart adapter."); return []; }
      if (upper.overlay !== lower.overlay) { warn("Fill references cross chart placements; this fill is not drawn."); return []; }
      const gradient = plot.options.gradient === true || ["top_value", "bottom_value", "top_color", "bottom_color"].some((key) => key in plot.options) || optionSets.some((options) => ["top_value", "bottom_value", "top_color", "bottom_color"].some((key) => key in options));
      if (gradient && optionSets.some((options) => {
        const top = options.top_value !== undefined ? options.top_value : plot.options.top_value;
        const bottom = options.bottom_value !== undefined ? options.bottom_value : plot.options.bottom_value;
        return typeof top === "number" && top === bottom;
      })) warn("Local gradient policy: equal anchors have zero span and are not painted; TradingView corner-case parity has not been verified.");
      if (gradient && optionSets.some((options) => ["top_color", "bottom_color"].some((key) => pineGradientColor(options[key] !== undefined ? options[key] : plot.options[key]) === undefined))) { warn("This gradient color format is not rendered by this chart adapter."); return []; }
      return [{ ...common, overlay: upper.overlay, behindChart: behindChart && !(upper.options.force_overlay === true && lower.options.force_overlay === true), kind: "fill", segments: [], markers: [], visual: { source: plot, bars, style, showFrom, gradient, refs: { upper, lower } } }];
    }
    const kind = kinds[style];
    if (!kind) { warn(`Native ${style} output is not rendered by this chart adapter.`); return []; }
    const numericStyle = ["line", "area", "histogram"].includes(kind);
    const plotOffset = numericStyle && plot.options.offset !== undefined ? plot.options.offset : 0;
    if (typeof plotOffset !== "number" || !Number.isSafeInteger(plotOffset)) { warn("Plot offsets require a constant safe integer."); return []; }
    if (numericStyle && optionSets.some((options) => options.offset !== undefined && options.offset !== plotOffset)) { warn("Changing per-bar plot offsets are not rendered."); return []; }
    if (!numericStyle && hasOffset(plot)) { warn("Offsets for this plot style are not rendered by this chart adapter."); return []; }
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
    const baseColor = color(plot.options.color);
    const visual = ["line", "markers", "area", "histogram", "candles"].includes(kind) ? { source: plot, bars, style, showFrom, ...(pointStyle ? { pointStyle: { size: relativeSize as number, join: constantJoin && joinFlag === true } } : {}), ...(trackPrice ? { trackPrice } : {}), ...(plotOffset ? { plotOffset } : {}), ...(style === "histogram" ? { histogramWidth: histogramWidth as number } : {}) } : undefined;
    if (style === "bar") {
      warnings.push("Native OHLC bar widths use local chart pixel cadence; TradingView pixel calibration has not been verified.");
      if (plot.options.color === undefined) warnings.push("Omitted native OHLC bar colors use local defaults; TradingView default color calibration has not been verified.");
    } else if (kind === "candles" && ["color", "wickcolor", "bordercolor"].some((key) => plot.options[key] === undefined)) warnings.push("Omitted native candle colors use local defaults and inheritance; TradingView default color calibration has not been verified.");
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
    if (!visual && optionSets.some((options) => options.linewidth !== undefined && options.linewidth !== plot.options.linewidth)) warn("Per-point line width is not supported; the declared plot width is used.");
    return [{ id: plot.id, name: plot.name, overlay: plot.overlay, behindChart, kind, color: baseColor, width: Math.max(1, Math.min(4, Math.round(declaredWidth))) as PineChartPlot["width"], step: style.startsWith("stepline"), pointsOnly: ["circles", "cross"].includes(style), base: number(plot.options.histbase, 0), segments: nonempty, markers, visual }];
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
  return { plots, warnings: [...new Set([...diagnosticWarnings, ...warnings])], adapterWarnings: [...new Set(warnings)], strategyMarkers: strategyMarkers.sort((left, right) => Number(left.time) - Number(right.time)) };
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
export function installPineChartPlots(chart: IChartApi, plots: readonly PineChartPlot[], priceScaleId = "right", options: { allowFillOnlyScale?: boolean; scaleAnchor?: Pick<Candle, "time" | "close"> } = {}): { series: ISeriesApi<SeriesType>[]; primitive?: PineVisualPrimitive; dispose: () => void } {
  const native = plots.filter((plot) => plot.kind !== "barcolor" && !plot.visual).flatMap((plot) => installNativePineChartPlot(chart, plot, priceScaleId));
  const visual = plots.filter((plot) => plot.kind !== "barcolor" && plot.visual);
  const primitive = visual.length ? new PineVisualPrimitive(visual, plots.filter((plot) => plot.kind !== "barcolor" && !plot.visual), options) : undefined;
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
