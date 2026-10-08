import type { AutoscaleInfo, IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneView, Logical, SeriesAttachedParameter, SeriesType, UTCTimestamp, ISeriesPrimitivePaneRenderer } from "lightweight-charts";
type CanvasRenderingTarget2D = Parameters<ISeriesPrimitivePaneRenderer["draw"]>[0];
import type { PineChartPlot } from "./pineChartAdapter";
import type { PinePlot, PineScalar } from "./pineProtocol";
import { getPackedPinePlot, pinePlotOptionSets, pointAtBar } from "./pinePacked";

const BLOCK = 128;
const MAX_CACHED_SAMPLES = 8192;
const SIZES: Record<string, number> = { auto: 10, tiny: 6, small: 8, normal: 10, large: 14, huge: 18 };
const sourceStarts = new WeakMap<PinePlot, WeakMap<object, number>>();
type Sample = { value: number | boolean | null | number[]; options: Record<string, PineScalar> };
type Bounds = { min: number; max: number };
type MarkerBounds = { bounds: Bounds | null; above: number; below: number };
type TextLayout = { lines: string[]; width: number; measured: boolean; maxAscent: number; maxDescent: number; glyphs: { ascent: number; descent: number }[] };
type MarkerGeometry = { shape: string; size: number; offset: number; direction: number; shade: string; textColor: string; layout: TextLayout; lineHeight: number; textY: number; labelTop: number; labelHeight: number; min: number; max: number };
let markerMetrics: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
export function pineVisualColor(value: PineScalar | undefined, fallback = "#22d3ee"): string {
  if (value === null) return "rgba(0,0,0,0)";
  return typeof value === "string" && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(value) ? value : fallback;
}
type RGBA = [number, number, number, number];
type Gradient = { top: number; bottom: number; topColor: RGBA; bottomColor: RGBA };
const COLOR_NAMES: Record<string, string> = { red: "#ff0000", blue: "#0000ff", green: "#008000", white: "#ffffff", black: "#000000", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", lime: "#00ff00", navy: "#000080", teal: "#008080", silver: "#c0c0c0", gray: "#808080", grey: "#808080", maroon: "#800000", aqua: "#00ffff", cyan: "#00ffff", magenta: "#ff00ff", fuchsia: "#ff00ff", transparent: "#00000000" };
let cssColors: OffscreenCanvasRenderingContext2D | null | undefined;
/** Keep explicit transparent endpoint RGB; an na color has no RGB and becomes transparent black. */
export function pineGradientColor(value: PineScalar | undefined): RGBA | undefined {
  if (value == null) return [0, 0, 0, 0];
  if (typeof value !== "string") return undefined;
  let text = value.trim().toLowerCase();
  text = COLOR_NAMES[text] ?? text;
  if (/^#[\da-f]{3,4}$/i.test(text)) text = "#" + [...text.slice(1)].map((digit) => digit + digit).join("");
  if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(text)) return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16), parseInt(text.slice(5, 7), 16), text.length === 9 ? parseInt(text.slice(7, 9), 16) / 255 : 1];
  const match = /^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)(?:\s*,\s*([\d.]+%?))?\s*\)$/.exec(text);
  if (match) {
    const channel = (part: string, max: number) => Math.max(0, Math.min(max, parseFloat(part) * (part.endsWith("%") ? max / 100 : 1)));
    const rgba: RGBA = [channel(match[1], 255), channel(match[2], 255), channel(match[3], 255), match[4] === undefined ? 1 : channel(match[4], 1)];
    return rgba.every(Number.isFinite) ? rgba : undefined;
  }
  if (/^[a-z]{1,24}$/.test(text) && typeof OffscreenCanvas !== "undefined") {
    cssColors ??= new OffscreenCanvas(1, 1).getContext("2d");
    if (cssColors) { cssColors.fillStyle = "#010203"; cssColors.fillStyle = text; const normalized = String(cssColors.fillStyle); if (normalized !== "#010203") return pineGradientColor(normalized); }
  }
  return undefined;
}
function gradientColorAt(gradient: Gradient, y: number, topY: number, bottomY: number): string {
  const scale = Math.max(Math.abs(y), Math.abs(topY), Math.abs(bottomY), 1);
  const ratio = Math.max(0, Math.min(1, (y / scale - topY / scale) / (bottomY / scale - topY / scale)));
  const rgba = gradient.topColor.map((channel, index) => channel * (1 - ratio) + gradient.bottomColor[index] * ratio);
  return `rgba(${rgba[0]},${rgba[1]},${rgba[2]},${rgba[3]})`;
}
function painted(value: string) { return value.toLowerCase() !== "transparent" && !/^#[\da-f]{3}0$/i.test(value) && !/^rgba\([^)]*,\s*0(?:\.0*)?\s*\)$/.test(value) && !/^#[\da-f]{6}00$/i.test(value); }
function option(source: PinePlot, sample: Sample | undefined, key: string) { return sample?.options[key] !== undefined ? sample.options[key] : source.options[key]; }
function norm(value: PineScalar | undefined, prefix: string, fallback: string) { return String(value ?? fallback).toLowerCase().replace(new RegExp(`^${prefix}[._]`), ""); }
function seconds(value: unknown): number | null { return typeof value === "number" ? value : null; }
function search(bars: readonly { time: number }[], time: number, upper = false) {
  let lo = 0, hi = bars.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].time < time || (upper && bars[mid].time === time)) lo = mid + 1; else hi = mid; }
  return lo;
}
function sourceStart(source: PinePlot, bars: readonly { time: number }[]) {
  let byBars = sourceStarts.get(source);
  if (!byBars) { byBars = new WeakMap(); sourceStarts.set(source, byBars); }
  let start = byBars.get(bars);
  if (start === undefined) {
    const count = Math.max(0, Math.floor(typeof source.options.show_last === "number" ? source.options.show_last : bars.length));
    start = Math.max(0, bars.length - count); byBars.set(bars, start);
  }
  return start;
}
/** Reads a single bar slot without projecting a packed channel into point objects. */
export function pineVisualSample(plot: PineChartPlot, index: number, source = plot.visual!.source): Sample | undefined {
  const bars = plot.visual!.bars;
  if (index < sourceStart(source, bars) || index < 0 || index >= bars.length) return undefined;
  if (getPackedPinePlot(source)) return pointAtBar(source, index);
  const time = bars[index].time, points = source.points;
  let lo = 0, hi = points.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (points[mid].time < time) lo = mid + 1; else hi = mid; }
  return points[lo]?.time === time ? points[lo] : undefined;
}
function numeric(plot: PineChartPlot, index: number, source = plot.visual!.source): number | undefined {
  if (index < sourceStart(source, plot.visual!.bars) || index < 0 || index >= plot.visual!.bars.length) return undefined;
  const packed = getPackedPinePlot(source);
  if (packed) return packed.kinds[index] === 4 ? packed.values[index * packed.arity] : undefined;
  const value = pineVisualSample(plot, index, source)?.value;
  return typeof value === "number" ? value : undefined;
}
function candleValues(plot: PineChartPlot, index: number): readonly number[] | Float64Array | undefined {
  if (index < plot.visual!.showFrom || index < 0 || index >= plot.visual!.bars.length) return undefined;
  const source = plot.visual!.source, packed = getPackedPinePlot(source);
  if (packed) return packed.kinds[index] === 5 ? packed.values.subarray(index * packed.arity, index * packed.arity + 4) : undefined;
  const value = pineVisualSample(plot, index)?.value;
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) ? value : undefined;
}

function markerLocation(plot: PineChartPlot, sample: Sample | undefined) {
  return norm(option(plot.visual!.source, sample, "location"), "location", "abovebar");
}
function markerActive(sample: Sample | undefined, location: string) {
  return !!sample && (typeof sample.value === "number" ? Number.isFinite(sample.value) && (location === "absolute" || sample.value !== 0) : sample.value === true);
}
function anchor(plot: PineChartPlot, index: number, sample: Sample | undefined): number | undefined {
  if (!sample || sample.value === null || sample.value === false) return undefined;
  if (plot.kind !== "markers") return typeof sample.value === "number" ? sample.value : undefined;
  const location = markerLocation(plot, sample);
  if (!markerActive(sample, location)) return undefined;
  if (location === "absolute") return typeof sample.value === "number" ? sample.value : undefined;
  if (sample.value === 0) return undefined;
  const bar = plot.visual!.bars[index];
  return location === "belowbar" ? bar.low : location === "abovebar" ? bar.high : undefined;
}
function extend(bounds: Bounds | null, value: number | undefined): Bounds | null {
  return value === undefined ? bounds : bounds ? { min: Math.min(bounds.min, value), max: Math.max(bounds.max, value) } : { min: value, max: value };
}

type Vertex = { x: number; y: number };
type NumericBody = { index: number; left: number; right: number; logical: number; rounded: number; center: number; gap: number };
/** Crossing reference lines form two lobes, not a simple quadrilateral. */
function fillLobes(vertices: [Vertex, Vertex, Vertex, Vertex]): Vertex[][] {
  const [upperLeft, upperRight, lowerRight, lowerLeft] = vertices;
  const scale = Math.max(...vertices.map(({ y }) => Math.abs(y)), 1);
  const leftDelta = upperLeft.y / scale - lowerLeft.y / scale;
  const rightDelta = upperRight.y / scale - lowerRight.y / scale;
  if ((leftDelta > 0 && rightDelta < 0) || (leftDelta < 0 && rightDelta > 0)) {
    const ratio = leftDelta / (leftDelta - rightDelta);
    const crossing = { x: upperLeft.x * (1 - ratio) + upperRight.x * ratio, y: upperLeft.y * (1 - ratio) + upperRight.y * ratio };
    return [[upperLeft, crossing, lowerLeft], [crossing, upperRight, lowerRight]];
  }
  return [vertices];
}
/** Clip geometry before rasterization: Canvas clipping alone loses precision for extreme prices. */
function clipFillPolygon(vertices: Vertex[], width: number, height: number): Vertex[] {
  if (!vertices.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) return [];
  if (vertices.every(({ x, y }) => x >= 0 && x <= width && y >= 0 && y <= height)) return vertices;
  let polygon = vertices;
  for (const [axis, bound, lower] of [["x", 0, true], ["x", width, false], ["y", 0, true], ["y", height, false]] as const) polygon = clipPolygonEdge(polygon, axis, bound, lower);
  return polygon;
}

function clipStroke(first: Vertex, second: Vertex, width: number, height: number): [Vertex, Vertex] | null {
  if (![first.x, first.y, second.x, second.y].every(Number.isFinite)) return null;
  let left = first, right = second;
  for (const [axis, bound, lower] of [["x", 0, true], ["x", width, false], ["y", 0, true], ["y", height, false]] as const) {
    const a = lower ? left[axis] >= bound : left[axis] <= bound, b = lower ? right[axis] >= bound : right[axis] <= bound;
    if (!a && !b) return null;
    if (a === b) continue;
    const scale = Math.max(Math.abs(bound), Math.abs(left[axis]), Math.abs(right[axis]), 1);
    const t = (bound / scale - left[axis] / scale) / (right[axis] / scale - left[axis] / scale);
    const other = axis === "x" ? "y" : "x";
    const point = { [axis]: bound, [other]: left[other] * (1 - t) + right[other] * t } as Vertex;
    if (!a) left = point; else right = point;
  }
  return [left, right];
}

function clipPolygonEdge(polygon: Vertex[], axis: "x" | "y", bound: number, lower: boolean): Vertex[] {
  if (!polygon.length) return [];
  const output: Vertex[] = [];
  let previous = polygon[polygon.length - 1];
  let previousInside = lower ? previous[axis] >= bound : previous[axis] <= bound;
  for (const current of polygon) {
    const inside = lower ? current[axis] >= bound : current[axis] <= bound;
    if (inside !== previousInside) {
      const scale = Math.max(Math.abs(bound), Math.abs(previous[axis]), Math.abs(current[axis]), 1);
      const ratio = (bound / scale - previous[axis] / scale) / (current[axis] / scale - previous[axis] / scale);
      const other = axis === "x" ? "y" : "x";
      output.push({ [axis]: bound, [other]: previous[other] * (1 - ratio) + current[other] * ratio } as Vertex);
    }
    if (inside) output.push(current);
    previous = current; previousInside = inside;
  }
  return output;
}
function paintedGradientValues(values: [number, number, number, number], gradient: Gradient): number[] {
  const mask: [Vertex, Vertex, Vertex, Vertex] = [{ x: 0, y: values[0] }, { x: 1, y: values[1] }, { x: 1, y: values[2] }, { x: 0, y: values[3] }];
  const painted: number[] = [];
  for (let polygon of fillLobes(mask)) {
    if (gradient.topColor[3] === 0) polygon = clipPolygonEdge(polygon, "y", gradient.top, gradient.top < gradient.bottom);
    if (gradient.bottomColor[3] === 0) polygon = clipPolygonEdge(polygon, "y", gradient.bottom, gradient.bottom < gradient.top);
    const scale = Math.max(...polygon.map(({ y }) => Math.abs(y)), 1);
    const area = polygon.reduce((sum, point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return sum + point.x * (next.y / scale) - next.x * (point.y / scale);
    }, 0);
    // Touching a transparent cutoff without positive-area overlap paints nothing.
    if (area !== 0) for (const point of polygon) painted.push(point.y);
  }
  return painted;
}

/** One chart-owned canvas primitive for a placement. Only the current viewport is decoded. */
export class PineVisualPrimitive implements ISeriesPrimitive {
  private plots: readonly PineChartPlot[];
  private scalePeers: readonly PineChartPlot[];
  private allowFillOnlyScale: boolean;
  private cacheSize = 0;
  private pixelRatio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType>;
  private requestUpdate?: () => void;
  private samples = new Map<PinePlot, Map<number, Sample | undefined>>();
  private markerBlocks = new Map<PineChartPlot, Map<number, MarkerBounds>>();
  private markerReaches = new Map<PineChartPlot, number>();
  private textLayouts = new Map<number, Map<string, TextLayout>>();
  private numericIndices = new Map<PinePlot, Uint16Array>();
  private blocks = new Map<PineChartPlot, Map<number, Bounds | null>>();
  private rangeKey = "";
  private rangeCache: AutoscaleInfo | null = null;
  private decoded = 0;
  private scans = 0;
  private from = 0;
  private to = -1;
  private readonly onRange = () => { this.rangeKey = ""; this.samples.clear(); this.cacheSize = 0; this.textLayouts.clear(); this.requestUpdate?.(); };
  private readonly views: readonly ISeriesPrimitivePaneView[];
  constructor(plots: readonly PineChartPlot[], scalePeers: readonly PineChartPlot[] = [], options: { allowFillOnlyScale?: boolean } = {}) {
    this.plots = plots; this.scalePeers = scalePeers; this.allowFillOnlyScale = options.allowFillOnlyScale !== false;
    // LWC draws every normal background before primary series, then normal foregrounds.
    // The owner adds this host after the primary series, keeping front output below crosshair.
    const pass = (target: CanvasRenderingTarget2D, behind: boolean) => {
      for (const layer of ["background", "fill", "line", "shape"] as const) this.draw(target, layer, behind);
    };
    this.views = [{ zOrder: () => "normal", renderer: () => ({ drawBackground: (target) => pass(target, true), draw: (target) => pass(target, false) }) }];
  }
  get debugStats() { return { decodedSamples: this.decoded, visibleFrom: this.from, visibleTo: this.to, cacheEntries: this.cacheSize, rangeScans: this.scans }; }
  attached({ chart, series, requestUpdate }: SeriesAttachedParameter) {
    this.chart = chart; this.series = series; this.requestUpdate = requestUpdate;
    chart.timeScale().subscribeVisibleTimeRangeChange(this.onRange);
    requestUpdate();
  }
  detached() {
    this.chart?.timeScale().unsubscribeVisibleTimeRangeChange(this.onRange);
    this.chart = undefined; this.series = undefined; this.requestUpdate = undefined;
    this.samples.clear(); this.cacheSize = 0; this.blocks.clear(); this.numericIndices.clear(); this.markerBlocks.clear(); this.markerReaches.clear(); this.textLayouts.clear(); this.rangeKey = ""; this.rangeCache = null;
    this.plots = []; this.scalePeers = []; this.from = 0; this.to = -1;
  }
  updateAllViews() { /* Coordinates are read at draw time so price zoom/resize cannot reuse stale geometry. */ }
  paneViews() { return this.views; }
  autoscaleInfo(_from: Logical, _to: Logical) { return this.rangeForVisible(); }
  private visible(plot: PineChartPlot, neighbors = false): [number, number] {
    if (!this.chart || !plot.visual?.bars.length) return [0, -1];
    const scale = this.chart.timeScale(), bars = plot.visual.bars;
    if (plot.kind === "background" || plot.kind === "area" || plot.kind === "histogram" || plot.kind === "candles" || plot.visual.plotOffset || plot.visual.pointStyle) {
      const range = scale.getVisibleLogicalRange();
      if (!range) return [0, -1];
      const offset = plot.visual.plotOffset ?? plot.visual.backgroundOffset ?? 0;
      let valid = true;
      // Source bars can be a subset of the shared chart timeline. Search actual chart positions,
      // rather than subtracting an assumed contiguous snapshot index from the visible range.
      const locate = (target: number, upper = false) => {
        let lo = 0, hi = bars.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1, x = scale.timeToCoordinate(bars[mid].time as UTCTimestamp);
          const logical = x === null ? null : scale.coordinateToLogical(x);
          if (logical === null) { valid = false; return 0; }
          if (Number(logical) < target || (upper && Number(logical) === target)) lo = mid + 1; else hi = mid;
        }
        return lo;
      };
      let margin = plot.kind === "background" || plot.kind === "histogram" || plot.kind === "candles" ? 1 : 0;
      if (plot.kind === "histogram" && plot.visual.histogramWidth) {
        const center = scale.logicalToCoordinate(0 as Logical), next = scale.logicalToCoordinate(1 as Logical);
        if (center !== null && next !== null && next !== center) margin = Math.ceil(plot.visual.histogramWidth / Math.abs(next - center) / 2) + 1;
      }
      if (plot.visual.pointStyle) {
        const center = scale.logicalToCoordinate(0 as Logical), next = scale.logicalToCoordinate(1 as Logical);
        if (center !== null && next !== null && next !== center) margin = Math.ceil((plot.visual.pointStyle.size + 1) / Math.abs(next - center)) + 1;
      }
      const from = locate(Number(range.from) - offset - margin), to = locate(Number(range.to) - offset + margin, true) - 1;
      return valid ? [Math.max(plot.visual.showFrom, from - (neighbors && plot.kind !== "background" ? 1 : 0)), Math.min(bars.length - 1, to + (neighbors && plot.kind !== "background" ? 1 : 0))] : [0, -1];
    }
    const range = scale.getVisibleRange();
    let from = seconds(range?.from), to = seconds(range?.to);
    if (from === null || to === null) {
      const logical = scale.getVisibleLogicalRange(), x = scale.timeToCoordinate(bars[0].time as UTCTimestamp);
      const offset = x === null ? null : scale.coordinateToLogical(x);
      if (!logical || offset === null) return [0, -1];
      const lo = Math.ceil(Number(logical.from) - Number(offset)), hi = Math.floor(Number(logical.to) - Number(offset));
      if (hi < 0 || lo >= bars.length) return [0, -1];
      return [Math.max(plot.visual.showFrom, lo - (neighbors ? 1 : 0), 0), Math.min(bars.length - 1, hi + (neighbors ? 1 : 0))];
    }
    if (to < bars[0].time || from > bars[bars.length - 1].time) return [0, -1];
    const lo = search(bars, from), hi = search(bars, to, true) - 1;
    return [Math.max(plot.visual.showFrom, lo - (neighbors ? 1 : 0), 0), Math.min(bars.length - 1, hi + (neighbors ? 1 : 0))];
  }
  /** Retain bodies and text that reach the pane even when their source centers are outside it. */
  private markerDrawRange(plot: PineChartPlot, ctx: CanvasRenderingContext2D): [number, number] {
    const scale = this.chart!.timeScale(), range = scale.getVisibleLogicalRange();
    if (!range) return this.visible(plot, true);
    const left = scale.logicalToCoordinate(range.from), right = scale.logicalToCoordinate(range.to);
    if (left === null || right === null || !Number.isFinite(left) || !Number.isFinite(right)) return this.visible(plot, true);
    let reach = this.markerReaches.get(plot);
    if (reach === undefined) {
      reach = 0;
      const source = plot.visual!.source;
      let previousText: string | undefined, previousSize = 0;
      // Stream packed option variants without decoding or caching historical samples.
      // Keep only one conservative pixel reach per plot, independently of pan/zoom.
      for (const options of pinePlotOptionSets(source)) {
        const sample: Sample = { value: true, options };
        const size = SIZES[norm(option(source, sample, "size"), "size", "auto")] ?? 10;
        reach = Math.max(reach, size);
        const text = option(source, sample, "text");
        if (typeof text !== "string" || (text === previousText && size === previousSize)) continue;
        previousText = text; previousSize = size;
        ctx.font = `${size + 3}px sans-serif`; ctx.textAlign = "center";
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          const metrics = ctx.measureText(line);
          reach = Math.max(reach, metrics.width / 2 + 4, Math.abs(metrics.actualBoundingBoxLeft ?? 0), Math.abs(metrics.actualBoundingBoxRight ?? 0));
        }
      }
      this.markerReaches.set(plot, reach);
    }
    const bars = plot.visual!.bars, offset = plot.visual!.plotOffset ?? 0;
    let valid = true;
    const locate = (pixel: number, upper = false) => {
      let lo = 0, hi = bars.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1, center = scale.timeToCoordinate(bars[mid].time as UTCTimestamp);
        const logical = center === null ? null : scale.coordinateToLogical(center);
        const x = logical === null ? null : scale.logicalToCoordinate((Number(logical) + offset) as Logical);
        if (x === null || !Number.isFinite(x)) { valid = false; return 0; }
        if (x < pixel || (upper && x === pixel)) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    const from = locate(Math.min(left, right) - reach), to = locate(Math.max(left, right) + reach, true) - 1;
    return valid ? [Math.max(plot.visual!.showFrom, from), Math.min(bars.length - 1, to)] : this.visible(plot, true);
  }
  private sample(plot: PineChartPlot, index: number, source = plot.visual!.source) {
    let cache = this.samples.get(source);
    if (!cache) { cache = new Map(); this.samples.set(source, cache); }
    if (cache.has(index)) return cache.get(index);
    this.decoded++;
    const sample = pineVisualSample(plot, index, source);
    if (this.cacheSize < MAX_CACHED_SAMPLES) { this.cacheSize++; cache.set(index, sample); }
    return sample;
  }
  private indices(plot: PineChartPlot, source = plot.visual!.source) {
    let indices = this.numericIndices.get(source);
    if (!indices) {
      const values: number[] = [];
      for (let index = 0; index < plot.visual!.bars.length; index++) if (numeric(plot, index, source) !== undefined) values.push(index);
      indices = Uint16Array.from(values); this.numericIndices.set(source, indices);
    }
    return indices;
  }
  private indexPosition(indices: Uint16Array, index: number) {
    let lo = 0, hi = indices.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (indices[mid] < index) lo = mid + 1; else hi = mid; }
    return lo;
  }
  private interpolated(plot: PineChartPlot, index: number, source = plot.visual!.source, step = false) {
    const direct = numeric(plot, index, source);
    if (direct !== undefined) return direct;
    const indices = this.indices(plot, source), pos = this.indexPosition(indices, index);
    const left = indices[pos - 1], right = indices[pos];
    if (left === undefined || right === undefined) return undefined;
    const low = numeric(plot, left, source)!, high = numeric(plot, right, source)!;
    if (step) return low;
    const bars = plot.visual!.bars, scale = this.chart?.timeScale();
    const x = scale?.timeToCoordinate(bars[index].time as UTCTimestamp), xLeft = scale?.timeToCoordinate(bars[left].time as UTCTimestamp), xRight = scale?.timeToCoordinate(bars[right].time as UTCTimestamp);
    // Sessions and weekends do not create proportional time gaps on LWC's logical timeline.
    if (x == null || xLeft == null || xRight == null || xRight === xLeft) return undefined;
    const ratio = Math.max(0, Math.min(1, (x - xLeft) / (xRight - xLeft)));
    return low * (1 - ratio) + high * ratio;
  }
  private bounds(plot: PineChartPlot, from: number, to: number): Bounds | null {
    let result: Bounds | null = null;
    let cache = this.blocks.get(plot);
    if (!cache) { cache = new Map(); this.blocks.set(plot, cache); }
    const scan = (lo: number, hi: number) => {
      let bounds: Bounds | null = null;
      for (let index = lo; index <= hi; index++) {
        this.scans++;
        if (plot.kind === "candles") {
          const values = candleValues(plot, index);
          if (values) { bounds = extend(bounds, Math.min(...values)); bounds = extend(bounds, Math.max(...values)); }
        } else bounds = extend(bounds, numeric(plot, index));
      }
      return bounds;
    };
    for (let index = from; index <= to;) {
      const block = Math.floor(index / BLOCK), end = Math.min(to, (block + 1) * BLOCK - 1);
      let bounds: Bounds | null;
      if (index % BLOCK === 0 && end === (block + 1) * BLOCK - 1) {
        if (!cache.has(block)) cache.set(block, scan(index, end));
        bounds = cache.get(block)!;
      } else bounds = scan(index, end);
      if (bounds) { result = extend(result, bounds.min); result = extend(result, bounds.max); }
      index = end + 1;
    }
    return result;
  }
  private markerBounds(plot: PineChartPlot, from: number, to: number): MarkerBounds {
    let cache = this.markerBlocks.get(plot);
    if (!cache) { cache = new Map(); this.markerBlocks.set(plot, cache); }
    const result: MarkerBounds = { bounds: null, above: 0, below: 0 };
    const scan = (lo: number, hi: number): MarkerBounds => {
      const result: MarkerBounds = { bounds: null, above: 0, below: 0 };
      for (let index = lo; index <= hi; index++) {
        this.scans++;
        const sample = this.sample(plot, index), value = anchor(plot, index, sample);
        if (value === undefined) continue;
        const geometry = this.markerGeometry(plot, sample!);
        if (!geometry) continue;
        result.bounds = extend(result.bounds, value);
        result.above = Math.max(result.above, -geometry.min);
        result.below = Math.max(result.below, geometry.max);
      }
      return result;
    };
    for (let index = from; index <= to;) {
      const block = Math.floor(index / BLOCK), end = Math.min(to, (block + 1) * BLOCK - 1);
      let found: MarkerBounds;
      if (index % BLOCK === 0 && end === (block + 1) * BLOCK - 1) {
        if (!cache.has(block)) cache.set(block, scan(index, end));
        found = cache.get(block)!;
      } else found = scan(index, end);
      if (found.bounds) { result.bounds = extend(result.bounds, found.bounds.min); result.bounds = extend(result.bounds, found.bounds.max); }
      result.above = Math.max(result.above, found.above); result.below = Math.max(result.below, found.below);
      index = end + 1;
    }
    return result;
  }
  private pointGeometry(plot: PineChartPlot, from: number, to: number) {
    const indices = this.indices(plot), lo = this.indexPosition(indices, from), hi = this.indexPosition(indices, to + 1);
    const joined = plot.visual!.pointStyle!.join;
    const positions = indices.subarray(joined ? Math.max(0, lo - 1) : lo, joined ? Math.min(indices.length, hi + 1) : hi);
    const scale = this.chart!.timeScale();
    return Array.from(positions, (index) => {
      const sample = this.sample(plot, index), value = numeric(plot, index);
      const logical = this.logicalPosition(plot, index), x = logical === undefined ? null : scale.logicalToCoordinate(logical as Logical);
      if (value === undefined || !Number.isFinite(value) || x === null || !Number.isFinite(x)) return undefined;
      const shade = pineVisualColor(option(plot.visual!.source, sample, "color"), plot.color);
      return { x, value, shade, painted: pineGradientColor(shade)?.[3] !== 0 && painted(shade) };
    }).filter((point) => point !== undefined);
  }
  private pointBounds(plot: PineChartPlot, from: number, to: number, width: number) {
    const geometry = this.pointGeometry(plot, from, to), radius = plot.visual!.pointStyle!.size + 1;
    let bounds: Bounds | null = null, margin = 0;
    let previous: typeof geometry[number] | undefined;
    for (const point of geometry) {
      if (point.painted && point.x + radius > 0 && point.x - radius < width) { bounds = extend(bounds, point.value); margin = radius; }
      if (plot.visual!.pointStyle!.join && previous && point.painted && point.x >= 0 && previous.x <= width) {
        const left = Math.max(0, previous.x), right = Math.min(width, point.x);
        if (left <= right) {
          const span = point.x - previous.x;
          for (const x of [left, right]) {
            const t = span === 0 ? 1 : Math.max(0, Math.min(1, (x - previous.x) / span));
            bounds = extend(bounds, previous.value * (1 - t) + point.value * t);
          }
        }
      }
      previous = point;
    }
    return { bounds, margin };
  }
  private drawPointPlot(ctx: CanvasRenderingContext2D, plot: PineChartPlot, from: number, to: number, width: number, height: number) {
    const points = this.pointGeometry(plot, from, to).map((point) => ({ ...point, y: this.series!.priceToCoordinate(point.value) })).filter((point) => point.y !== null && Number.isFinite(point.y));
    const radius = plot.visual!.pointStyle!.size + 1;
    ctx.save(); ctx.lineWidth = 1; ctx.lineCap = "butt"; ctx.setLineDash([]);
    // Join numeric neighbors (including across na) using the destination sample's color.
    // This gap/color rule is an explicit local policy, independent of symbol size.
    if (plot.visual!.pointStyle!.join) for (let index = 1; index < points.length; index++) {
      const point = points[index], previous = points[index - 1];
      if (!point.painted) continue;
      const segment = clipStroke({ x: previous.x, y: previous.y! }, { x: point.x, y: point.y! }, width, height);
      if (segment) { ctx.strokeStyle = point.shade; ctx.beginPath(); ctx.moveTo(segment[0].x, segment[0].y); ctx.lineTo(segment[1].x, segment[1].y); ctx.stroke(); }
    }
    for (const point of points) {
      const y = point.y!;
      if (!point.painted || point.x + radius <= 0 || point.x - radius >= width || y + radius <= 0 || y - radius >= height) continue;
      ctx.fillStyle = point.shade; ctx.beginPath();
      if (plot.visual!.style === "cross") {
        // Fill both arms once, avoiding doubled alpha at their intersection.
        for (const [left, top, right, bottom] of [[point.x - radius, y - .5, point.x + radius, y + .5], [point.x - .5, y - radius, point.x + .5, y + radius]]) {
          const x = Math.max(0, left), yy = Math.max(0, top), end = Math.min(width, right), floor = Math.min(height, bottom);
          if (end > x && floor > yy) ctx.rect(x, yy, end - x, floor - yy);
        }
      } else ctx.arc(point.x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  private hasVisibleScalePeer() {
    const range = this.chart?.timeScale().getVisibleRange();
    const from = seconds(range?.from), to = seconds(range?.to);
    if (from === null || to === null) return false;
    return this.scalePeers.some((plot) => plot.segments.some((segment) => {
      let lo = 0, hi = segment.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (Number(segment[mid].time) < from) lo = mid + 1; else hi = mid; }
      for (let index = lo; index < segment.length && Number(segment[index].time) <= to; index++) if (segment[index].value !== undefined || segment[index].open !== undefined) return true;
      return false;
    }));
  }
  /** Only prices on the clipped, shifted segment affect a viewport between source centers. */
  private shiftedEdgeValue(plot: PineChartPlot, target: number): number | undefined {
    const scale = this.chart?.timeScale();
    if (!scale) return undefined;
    const indices = this.indices(plot), bars = plot.visual!.bars;
    const position = (index: number) => {
      const x = scale.timeToCoordinate(bars[index].time as UTCTimestamp);
      const logical = x === null ? null : scale.coordinateToLogical(x);
      return logical === null ? undefined : Number(logical) + (plot.visual!.plotOffset ?? 0);
    };
    let lo = 0, hi = indices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1, logical = position(indices[mid]);
      if (logical === undefined) return undefined;
      if (logical < target) lo = mid + 1; else hi = mid;
    }
    const right = indices[lo], left = indices[lo - 1];
    const rightX = right === undefined ? undefined : position(right);
    if (rightX === target) return numeric(plot, right);
    if (left === undefined || right === undefined || rightX === undefined) return undefined;
    if (["linebr", "steplinebr", "areabr"].includes(plot.visual!.style) && right !== left + 1) return undefined;
    const leftX = position(left);
    if (leftX === undefined || rightX === leftX) return undefined;
    const low = numeric(plot, left)!, high = numeric(plot, right)!;
    const ratio = Math.max(0, Math.min(1, (target - leftX) / (rightX - leftX)));
    return plot.step ? low : low * (1 - ratio) + high * ratio;
  }
  rangeForVisible(): AutoscaleInfo | null {
    const ranges = this.plots.map((plot) => this.visible(plot));
    const paneHeight = this.chart?.paneSize?.().height ?? Infinity;
    const paneWidth = this.chart?.paneSize?.().width ?? Infinity;
    const inverted = this.series?.priceScale?.().options().invertScale === true;
    const logical = this.chart?.timeScale().getVisibleLogicalRange();
    const key = `${inverted}|${paneHeight}|${paneWidth}|${this.pixelRatio}|${logical?.from}:${logical?.to}|${ranges.map(([from, to]) => `${from}:${to}`).join("|")}`;
    if (key === this.rangeKey) return this.rangeCache;
    this.rangeKey = key;
    let bounds: Bounds | null = null;
    let above = 0, below = 0;
    this.plots.forEach((plot, p) => {
      const level = plot.visual?.level;
      if (level) {
        if (level.price !== null && painted(level.color)) bounds = extend(bounds, level.price);
        return;
      }
      const guide = plot.visual?.trackPrice;
      if (guide && painted(guide.color)) bounds = extend(bounds, guide.price);
      const [from, to] = ranges[p];
      if (plot.visual?.pointStyle) {
        const found = this.pointBounds(plot, from, to, paneWidth);
        if (found.bounds) { bounds = extend(bounds, found.bounds.min); bounds = extend(bounds, found.bounds.max); }
        above = Math.max(above, found.margin); below = Math.max(below, found.margin);
        return;
      }
      if (plot.kind === "candles") {
        // Neighbor samples are retained only when their actual candle body reaches the pane.
        if (to >= from) for (let index = from; index <= to; index++) {
          const body = this.candleBody(plot, index, this.pixelRatio);
          if (!body || body.right <= 0 || body.left >= paneWidth) continue;
          const values = candleValues(plot, index);
          if (values) { bounds = extend(bounds, Math.min(...values)); bounds = extend(bounds, Math.max(...values)); }
        }
        return;
      }
      if (plot.kind === "histogram") {
        // Documented numeric columns/histogram policy: histbase always belongs to the scale.
        bounds = extend(bounds, plot.base);
        if (to >= from) for (const body of this.numericBodies(plot, from, to, this.pixelRatio)) {
          if (body.right / this.pixelRatio > 0 && body.left / this.pixelRatio < paneWidth) bounds = extend(bounds, numeric(plot, body.index));
        }
        return;
      }
      if (plot.kind === "area") {
        let found = to >= from ? this.bounds(plot, from, to) : null;
        if (logical) {
          found = extend(found, this.shiftedEdgeValue(plot, Number(logical.from)));
          found = extend(found, this.shiftedEdgeValue(plot, Number(logical.to)));
        }
        if (found) {
          bounds = extend(bounds, found.min); bounds = extend(bounds, found.max);
          if (plot.visual!.style === "area") bounds = extend(bounds, plot.base);
        }
        return;
      }
      if (plot.kind === "markers") {
        const marker = to >= from ? this.markerBounds(plot, from, to) : undefined;
        if (marker?.bounds) {
          bounds = extend(bounds, marker.bounds.min); bounds = extend(bounds, marker.bounds.max);
          above = Math.max(above, marker.above); below = Math.max(below, marker.below);
        }
        return;
      }
      if (plot.visual?.plotOffset) {
        const found = to >= from ? this.bounds(plot, from, to) : null;
        if (found) { bounds = extend(bounds, found.min); bounds = extend(bounds, found.max); }
        if (!plot.pointsOnly && logical) {
          bounds = extend(bounds, this.shiftedEdgeValue(plot, Number(logical.from)));
          bounds = extend(bounds, this.shiftedEdgeValue(plot, Number(logical.to)));
        }
        return;
      }
      if (to < from || plot.kind === "fill" || plot.kind === "background") return;
      const found = this.bounds(plot, from, to);
      if (found) { bounds = extend(bounds, found.min); bounds = extend(bounds, found.max); }
      if (plot.kind === "line" && !plot.pointsOnly && !["linebr", "steplinebr", "areabr"].includes(plot.visual!.style)) {
        bounds = extend(bounds, this.interpolated(plot, from, plot.visual!.source, plot.step));
        bounds = extend(bounds, this.interpolated(plot, to, plot.visual!.source, plot.step));
      }
    });
    // A fill-only pane needs price coordinates; only painted geometry is a deliberate fallback.
    if (!bounds && this.allowFillOnlyScale && !this.hasVisibleScalePeer()) this.plots.forEach((plot, p) => {
      if (plot.kind !== "fill") return;
      const [from, to] = this.visible(plot, true);
      for (let index = from + 1; index <= to; index++) {
        const polygon = this.fillPolygon(plot, index);
        if (polygon) for (const value of polygon.gradient ? paintedGradientValues(polygon.values, polygon.gradient) : polygon.values) bounds = extend(bounds, value);
      }
    });
    const screenAbove = Math.min(above, paneHeight * .4), screenBelow = Math.min(below, paneHeight * .4);
    // LWC's inverted-coordinate transform compensates its internal margin swap: these remain screen extents.
    this.rangeCache = bounds ? { priceRange: { minValue: (bounds as Bounds).min, maxValue: (bounds as Bounds).max }, margins: { above: screenAbove, below: screenBelow } } : null;
    return this.rangeCache;
  }
  private fillPolygon(plot: PineChartPlot, index: number): { shade: string; gradient?: Gradient; values: [number, number, number, number] } | null {
    const sample = this.sample(plot, index);
    const shade = pineVisualColor(option(plot.visual!.source, sample, "color"), plot.color);
    if (!sample) return null;
    let gradient: Gradient | undefined;
    if (plot.visual!.gradient) {
      const source = plot.visual!.source;
      const top = option(source, sample, "top_value"), bottom = option(source, sample, "bottom_value");
      const topColor = pineGradientColor(option(source, sample, "top_color")), bottomColor = pineGradientColor(option(source, sample, "bottom_color"));
      if (typeof top !== "number" || typeof bottom !== "number" || !Number.isFinite(top) || !Number.isFinite(bottom) || top === bottom || !topColor || !bottomColor || (!topColor[3] && !bottomColor[3])) return null;
      gradient = { top, bottom, topColor, bottomColor };
    } else if (!painted(shade)) return null;
    const refs = plot.visual!.refs!;
    const values = [this.fillValue(plot, index - 1, refs.upper), this.fillValue(plot, index, refs.upper), this.fillValue(plot, index, refs.lower), this.fillValue(plot, index - 1, refs.lower)];
    if (!values.every((value) => value !== undefined)) return null;
    const mask = values as [number, number, number, number];
    if (gradient && !paintedGradientValues(mask, gradient).length) return null;
    return { shade, gradient, values: mask };
  }
  private fillValue(plot: PineChartPlot, index: number, source: PinePlot): number | undefined {
    const direct = numeric(plot, index, source);
    if (direct !== undefined || plot.visual!.source.options.fillgaps === false) return direct;
    return this.interpolated(plot, index, source);
  }

  private draw(target: CanvasRenderingTarget2D, layer: "background" | "fill" | "line" | "shape", behind: boolean) {
    if (!this.chart || !this.series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
      for (const plot of this.plots) {
        if ((plot.behindChart !== false) !== behind) continue;
        if (plot.kind === "area" ? layer !== "fill" && layer !== "line" : (plot.kind === "background" ? "background" : plot.kind === "fill" ? "fill" : plot.kind === "markers" ? "shape" : "line") !== layer) continue;
        const level = plot.visual?.level;
        if (level) {
          if (level.price === null || !painted(level.color)) continue;
          const y = this.series!.priceToCoordinate(level.price);
          if (y === null || !Number.isFinite(y)) continue;
          ctx.save(); ctx.strokeStyle = level.color; ctx.lineWidth = level.width;
          ctx.lineCap = level.linestyle === "dotted" ? "round" : "butt";
          ctx.setLineDash(level.linestyle === "dashed" ? [6 * level.width, 4 * level.width] : level.linestyle === "dotted" ? [0, 2 * level.width] : []);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mediaSize.width, y); ctx.stroke(); ctx.restore();
          continue;
        }
        const guide = plot.visual?.trackPrice;
        if (layer === "line" && guide && painted(guide.color)) {
          const y = this.series!.priceToCoordinate(guide.price);
          if (y !== null && Number.isFinite(y)) {
            ctx.save(); ctx.strokeStyle = guide.color; ctx.lineWidth = 1;
            ctx.lineCap = "butt"; ctx.setLineDash([1, 3]);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mediaSize.width, y); ctx.stroke(); ctx.restore();
          }
        }
        let [from, to] = plot.kind === "markers" ? this.markerDrawRange(plot, ctx) : this.visible(plot, true);
        this.from = from; this.to = to;
        if (plot.visual?.pointStyle) { this.drawPointPlot(ctx, plot, from, to, mediaSize.width, mediaSize.height); continue; }
        if (to < from) continue;
        const x = (index: number) => {
          const scale = this.chart!.timeScale(), center = scale.timeToCoordinate(plot.visual!.bars[index].time as UTCTimestamp);
          if (!plot.visual!.plotOffset || center === null) return center;
          const logical = scale.coordinateToLogical(center);
          return logical === null ? null : scale.logicalToCoordinate((Number(logical) + plot.visual!.plotOffset) as Logical);
        };
        if (plot.kind === "background") {
          const scale = this.chart!.timeScale();
          let band: { start: number; end: number; shade: string } | undefined;
          const flush = () => {
            if (band) { ctx.fillStyle = band.shade; ctx.fillRect(band.start, 0, band.end - band.start, mediaSize.height); band = undefined; }
          };
          for (let index = from; index <= to; index++) {
            const sample = this.sample(plot, index);
            if (!sample || sample.value === null || sample.value === false) continue;
            const value = option(plot.visual!.source, sample, "color");
            if (typeof value !== "string") continue;
            const rgba = pineGradientColor(value);
            if (!rgba || rgba[3] === 0) continue;
            const shade = `rgba(${rgba.join(",")})`;
            const center = x(index), logical = center === null ? null : scale.coordinateToLogical(center);
            if (logical === null) continue;
            const shifted = Number(logical) + (plot.visual!.backgroundOffset ?? 0);
            // LWC 4.2 rejects fractional logical indexes. Derive half-slot edges from integer centers.
            const middle = scale.logicalToCoordinate(shifted as Logical), before = scale.logicalToCoordinate((shifted - 1) as Logical), after = scale.logicalToCoordinate((shifted + 1) as Logical);
            if (middle === null || before === null || after === null || !Number.isFinite(middle) || !Number.isFinite(before) || !Number.isFinite(after)) continue;
            const left = (before + middle) / 2, right = (middle + after) / 2;
            const start = Math.max(0, Math.min(left, right)), end = Math.min(mediaSize.width, Math.max(left, right));
            if (end <= start) continue;
            // One rectangle for a contiguous same-color run avoids alpha seams at fractional pixel edges.
            if (band && band.shade === shade && band.end === start) band.end = end;
            else { flush(); band = { start, end, shade }; }
          }
          flush();
          continue;
        }
        if (layer === "fill" && plot.kind === "fill") {
          for (let index = from + 1; index <= to; index++) {
            const polygon = this.fillPolygon(plot, index);
            if (!polygon) continue;
            const { shade, values, gradient } = polygon;
            const left = x(index - 1), right = x(index);
            const ys = values.map((value) => this.series!.priceToCoordinate(value!));
            if (left === null || right === null || ys.some((value) => value === null)) continue;
            let fillStyle: string | CanvasGradient = shade;
            if (gradient) {
              const topY = this.series!.priceToCoordinate(gradient.top), bottomY = this.series!.priceToCoordinate(gradient.bottom);
              if (topY === null || bottomY === null || !Number.isFinite(topY) || !Number.isFinite(bottomY) || topY === bottomY) continue;
              const start = Math.max(0, Math.min(topY, bottomY)), end = Math.min(mediaSize.height, Math.max(topY, bottomY));
              if (start < end) {
                const ramp = ctx.createLinearGradient(0, start, 0, end);
                ramp.addColorStop(0, gradientColorAt(gradient, start, topY, bottomY));
                ramp.addColorStop(1, gradientColorAt(gradient, end, topY, bottomY));
                fillStyle = ramp;
              } else fillStyle = gradientColorAt(gradient, mediaSize.height / 2, topY, bottomY);
            }
            for (const lobe of fillLobes([{ x: left, y: ys[0]! }, { x: right, y: ys[1]! }, { x: right, y: ys[2]! }, { x: left, y: ys[3]! }])) {
              const clipped = clipFillPolygon(lobe, mediaSize.width, mediaSize.height);
              if (clipped.length < 3) continue;
              ctx.fillStyle = fillStyle; ctx.beginPath(); ctx.moveTo(clipped[0].x, clipped[0].y);
              for (let vertex = 1; vertex < clipped.length; vertex++) ctx.lineTo(clipped[vertex].x, clipped[vertex].y);
              ctx.closePath(); ctx.fill();
            }
          }
          continue;
        }
        if (plot.kind === "candles") { this.drawCandles(ctx, plot, from, to, mediaSize.width, mediaSize.height); continue; }
        if (plot.kind === "area" || plot.kind === "histogram") {
          this.drawNumericPlot(ctx, plot, from, to, x, layer, mediaSize.width, mediaSize.height);
          continue;
        }
        let previous: { x: number; y: number; index: number } | null = null;
        let positions: Iterable<number>;
        if (plot.kind === "line") {
          const indices = this.indices(plot), lo = this.indexPosition(indices, from), hi = this.indexPosition(indices, to + 1);
          const bridges = !plot.pointsOnly && !["linebr", "steplinebr", "areabr"].includes(plot.visual!.style);
          positions = indices.subarray(bridges ? Math.max(0, lo - 1) : lo, bridges ? Math.min(indices.length, hi + 1) : hi);
        } else positions = (function* () { for (let index = from; index <= to; index++) yield index; })();
        for (const index of positions) {
          const sample = this.sample(plot, index), value = anchor(plot, index, sample);
          if (plot.kind === "markers") {
            const location = markerLocation(plot, sample);
            if (!markerActive(sample, location)) continue;
            const px = x(index);
            if (px === null || !Number.isFinite(px)) continue;
            if (location === "top" || location === "bottom") {
              const geometry = this.markerGeometry(plot, sample!, ctx);
              if (!geometry) continue;
              const py = location === "top" ? 4 - geometry.min : mediaSize.height - 4 - geometry.max;
              this.shape(ctx, plot, sample!, px, py, mediaSize.height);
            } else if (value !== undefined) {
              const py = this.series!.priceToCoordinate(value);
              if (py !== null && Number.isFinite(py)) this.shape(ctx, plot, sample!, px, py, mediaSize.height);
            }
            continue;
          }
          if (value === undefined) { if (["linebr", "steplinebr", "areabr"].includes(plot.visual!.style)) previous = null; continue; }
          const px = x(index), py = this.series!.priceToCoordinate(value);
          if (px === null || py === null) { previous = null; continue; }
          const options = plot.visual!.source;
          const shade = pineVisualColor(option(options, sample, "color"), plot.color);
          const width = Math.max(1, Math.min(4, Number(option(options, sample, "linewidth") ?? plot.width)));
          ctx.strokeStyle = shade; ctx.fillStyle = shade; ctx.lineWidth = width;
          if (plot.pointsOnly) { ctx.beginPath(); ctx.arc(px, py, width + 1, 0, Math.PI * 2); ctx.fill(); }
          else if (previous && (!["linebr", "steplinebr", "areabr"].includes(plot.visual!.style) || index === previous.index + 1)) { ctx.beginPath(); ctx.moveTo(previous.x, previous.y); if (plot.step) ctx.lineTo(px, previous.y); ctx.lineTo(px, py); ctx.stroke(); }
          previous = { x: px, y: py, index };
        }
      }
      ctx.restore();
    });
  }
  /** Pinned LWC candlestick cadence, using actual adjacent shared chart slots and physical pixels. */
  private candleBody(plot: PineChartPlot, index: number, ratio: number) {
    const scale = this.chart!.timeScale(), logical = this.logicalPosition(plot, index);
    if (logical === undefined) return null;
    const x = scale.logicalToCoordinate(logical as Logical), next = scale.logicalToCoordinate((logical + 1) as Logical);
    if (x === null || next === null || !Number.isFinite(x) || !Number.isFinite(next)) return null;
    const spacing = Math.abs(next - x), coefficient = 1 - .2 * Math.atan(Math.max(4, spacing) - 4) / (Math.PI * .5);
    let pixels = spacing >= 2.5 && spacing <= 4 ? Math.floor(3 * ratio) : Math.max(Math.floor(ratio), Math.min(Math.floor(spacing * coefficient * ratio), Math.floor(spacing * ratio)));
    const wick = Math.max(1, Math.floor(ratio));
    if (pixels >= 2 && wick % 2 !== pixels % 2) pixels--;
    const center = Math.round(x * ratio), left = center - Math.floor(pixels / 2);
    return { left: left / ratio, right: (left + pixels) / ratio, center: center / ratio, pixels, wick };
  }
  private drawCandles(ctx: CanvasRenderingContext2D, plot: PineChartPlot, from: number, to: number, width: number, height: number) {
    const transform = ctx.getTransform?.();
    const ratio = Math.abs(transform?.a ?? 1) || 1, verticalRatio = Math.abs(transform?.d ?? ratio) || 1;
    if (ratio !== this.pixelRatio) { this.pixelRatio = ratio; this.rangeKey = ""; this.requestUpdate?.(); }
    const rect = (shade: string, left: number, top: number, right: number, bottom: number) => {
      if (![left, top, right, bottom].every(Number.isFinite) || !painted(shade)) return;
      left = Math.max(0, left); right = Math.min(width, right); top = Math.max(0, top); bottom = Math.min(height, bottom);
      if (right > left && bottom > top) { ctx.fillStyle = shade; ctx.fillRect(left, top, right - left, bottom - top); }
    };
    for (let index = from; index <= to; index++) {
      const values = candleValues(plot, index), body = this.candleBody(plot, index, ratio);
      if (!values || !body || body.right <= 0 || body.left >= width) continue;
      const sample = this.sample(plot, index), source = plot.visual!.source;
      const ys = [values[0], Math.max(...values), Math.min(...values), values[3]].map((value) => this.series!.priceToCoordinate(value));
      if (ys.some((value) => value === null || !Number.isFinite(value))) continue;
      const [open, high, low, close] = ys as number[];
      const rounded = (value: number) => Math.round(value * verticalRatio) / verticalRatio;
      const top = rounded(Math.min(open, close)), bottom = rounded(Math.max(open, close));
      const bodyShade = pineVisualColor(option(source, sample, "color"), plot.color);
      const wickShade = pineVisualColor(option(source, sample, "wickcolor"), bodyShade);
      const borderShade = pineVisualColor(option(source, sample, "bordercolor"), bodyShade);
      const wickLeft = body.center - Math.floor(body.wick / 2) / ratio, wickRight = wickLeft + body.wick / ratio;
      const highY = rounded(Math.min(high, low)), lowY = rounded(Math.max(high, low));
      if (plot.visual!.style === "bar") {
        // Conventional OHLC bars: open ticks left, close ticks right. Disjoint
        // rectangles keep translucent intersections from receiving color twice.
        const tickHeight = Math.max(1, Math.floor(verticalRatio)) / verticalRatio;
        rect(bodyShade, wickLeft, highY, wickRight, lowY + 1 / verticalRatio);
        rect(bodyShade, body.left, rounded(open), wickLeft, rounded(open) + tickHeight);
        rect(bodyShade, wickRight, rounded(close), body.right, rounded(close) + tickHeight);
        continue;
      }
      rect(wickShade, wickLeft, highY, wickRight, top);
      rect(wickShade, wickLeft, bottom + 1 / verticalRatio, wickRight, lowY + 1 / verticalRatio);
      const border = Math.max(Math.floor(ratio), body.pixels <= 2 * Math.floor(ratio) ? Math.floor((body.pixels - 1) / 2) : Math.floor(ratio)) / ratio;
      const verticalBorder = border * ratio / verticalRatio;
      // Disjoint border strips preserve alpha without painting the body twice.
      rect(borderShade, body.left, top, body.right, Math.min(bottom + 1 / verticalRatio, top + verticalBorder));
      if (bottom + 1 / verticalRatio > top + verticalBorder) rect(borderShade, body.left, Math.max(top + verticalBorder, bottom + 1 / verticalRatio - verticalBorder), body.right, bottom + 1 / verticalRatio);
      rect(borderShade, body.left, top + verticalBorder, Math.min(body.right, body.left + border), bottom + 1 / verticalRatio - verticalBorder);
      rect(borderShade, Math.max(body.left + border, body.right - border), top + verticalBorder, body.right, bottom + 1 / verticalRatio - verticalBorder);
      if (body.pixels > border * ratio * 2) rect(bodyShade, body.left + border, top + verticalBorder, body.right - border, bottom + 1 / verticalRatio - verticalBorder);
    }
  }

  private logicalPosition(plot: PineChartPlot, index: number): number | undefined {
    const scale = this.chart?.timeScale(), bar = plot.visual!.bars[index];
    if (!scale || !bar) return undefined;
    const x = scale.timeToCoordinate(bar.time as UTCTimestamp), logical = x === null ? null : scale.coordinateToLogical(x);
    return logical === null ? undefined : Number(logical) + (plot.visual!.plotOffset ?? 0);
  }
  /** Shared physical body bounds keep drawn pixels and autoscale eligibility identical. */
  private numericBodies(plot: PineChartPlot, from: number, to: number, ratio: number): NumericBody[] {
    const scale = this.chart!.timeScale(), rows: NumericBody[] = [];
    for (let index = from; index <= to; index++) {
      if (numeric(plot, index) === undefined) continue;
      const logical = this.logicalPosition(plot, index);
      if (logical === undefined) continue;
      const center = scale.logicalToCoordinate(logical as Logical), adjacent = scale.logicalToCoordinate((logical + 1) as Logical);
      if (center === null || adjacent === null || !Number.isFinite(center) || !Number.isFinite(adjacent)) continue;
      const spacing = Math.abs(adjacent - center) * ratio;
      const histogramWidth = plot.visual!.histogramWidth;
      const gap = histogramWidth ? 0 : Math.ceil(spacing) <= 4 ? 0 : Math.max(1, Math.floor(ratio));
      const pixels = histogramWidth ? Math.max(1, Math.round(histogramWidth * ratio)) : Math.max(1, Math.round(spacing) - gap);
      const rounded = Math.round(center * ratio), left = rounded - Math.floor(pixels / 2);
      rows.push({ index, left, right: left + pixels, logical, rounded, center: center * ratio, gap });
    }
    // Pinned local-column rounding corrects only consecutive actual chart slots.
    if (!plot.visual!.histogramWidth) for (let index = 1; index < rows.length; index++) {
      const current = rows[index], previous = rows[index - 1];
      if (current.logical !== previous.logical + 1 || current.left - previous.right === current.gap) continue;
      if (previous.rounded > previous.center) previous.right = current.left - current.gap;
      else current.left = previous.right + current.gap;
    }
    return rows;
  }
  private drawNumericPlot(ctx: CanvasRenderingContext2D, plot: PineChartPlot, from: number, to: number, x: (index: number) => number | null, layer: string, width: number, height: number) {
    const base = this.series!.priceToCoordinate(plot.base);
    const ratio = Math.abs(ctx.getTransform?.().a ?? 1) || 1;
    if (ratio !== this.pixelRatio) { this.pixelRatio = ratio; this.rangeKey = ""; this.requestUpdate?.(); }
    if (plot.kind === "histogram") {
      if (base === null || !Number.isFinite(base)) return;
      const rows = this.numericBodies(plot, from, to, ratio);
      let shade: string | undefined, active = false;
      const flush = () => { if (active) { ctx.fillStyle = shade!; ctx.fill(); active = false; } };
      for (const row of rows) {
        const sample = this.sample(plot, row.index), value = anchor(plot, row.index, sample);
        const y = value === undefined ? null : this.series!.priceToCoordinate(value);
        if (y === null || !Number.isFinite(y)) continue;
        const top = Math.max(0, Math.min(y, base)), bottom = Math.min(height, Math.max(y, base));
        const color = pineVisualColor(option(plot.visual!.source, sample, "color"), plot.color);
        const left = Math.max(0, row.left / ratio), right = Math.min(width, row.right / ratio);
        if (!painted(color) || right <= left || bottom <= top) continue;
        if (shade !== color) { flush(); shade = color; ctx.beginPath(); }
        // A single nonzero-fill path unions overlapping same-color rectangles: no double alpha.
        ctx.rect(left, top, right - left, bottom - top); active = true;
      }
      flush(); return;
    }
    const indices = this.indices(plot), lo = this.indexPosition(indices, from), hi = this.indexPosition(indices, to + 1);
    const bridges = plot.visual!.style === "area";
    const positions = indices.subarray(bridges ? Math.max(0, lo - 1) : lo, bridges ? Math.min(indices.length, hi + 1) : hi);
    let previous: { point: Vertex; index: number } | undefined;
    let run: { shade: string; points: Vertex[] } | undefined;
    const flush = () => {
      if (run && run.points.length > 1) {
        ctx.fillStyle = run.shade; ctx.strokeStyle = run.shade; ctx.lineWidth = plot.width;
        if (layer === "fill" && base !== null && Number.isFinite(base)) {
          const vertices = [...run.points, { x: run.points.at(-1)!.x, y: base }, { x: run.points[0].x, y: base }];
          const polygon = clipFillPolygon(vertices, width, height);
          if (polygon.length >= 3) { ctx.beginPath(); ctx.moveTo(polygon[0].x, polygon[0].y); for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i].x, polygon[i].y); ctx.closePath(); ctx.fill(); }
        } else if (layer === "line") {
          // Clip each line segment, retaining a single stroke where adjacent endpoints meet.
          ctx.beginPath(); let last: Vertex | undefined;
          for (let index = 1; index < run.points.length; index++) {
            const segment = clipStroke(run.points[index - 1], run.points[index], width, height);
            if (!segment) { last = undefined; continue; }
            if (!last || last.x !== segment[0].x || last.y !== segment[0].y) ctx.moveTo(segment[0].x, segment[0].y);
            ctx.lineTo(segment[1].x, segment[1].y); last = segment[1];
          }
          ctx.stroke();
        }
      }
      run = undefined;
    };
    const add = (left: Vertex, right: Vertex, shade: string) => {
      if (run?.shade !== shade || run.points.at(-1)!.x !== left.x || run.points.at(-1)!.y !== left.y) { flush(); run = { shade, points: [left] }; }
      run!.points.push(right);
    };
    for (const index of positions) {
      const sample = this.sample(plot, index), value = anchor(plot, index, sample);
      const px = x(index), py = value === undefined ? null : this.series!.priceToCoordinate(value);
      if (px === null || py === null || !Number.isFinite(px) || !Number.isFinite(py)) { flush(); previous = undefined; continue; }
      const point = { x: px, y: py }, shade = pineVisualColor(option(plot.visual!.source, sample, "color"), plot.color);
      if (previous && (bridges || index === previous.index + 1) && painted(shade)) {
        if (layer === "fill" && base !== null && ((previous.point.y < base && py > base) || (previous.point.y > base && py < base))) {
          const scale = Math.max(Math.abs(base), Math.abs(py), Math.abs(previous.point.y), 1);
          const t = (base / scale - previous.point.y / scale) / (py / scale - previous.point.y / scale);
          const crossing = { x: previous.point.x * (1 - t) + px * t, y: base };
          add(previous.point, crossing, shade); flush(); add(crossing, point, shade);
        } else add(previous.point, point, shade);
      } else flush();
      previous = { point, index };
    }
    flush();
  }
  /** Shared vertical geometry keeps drawing and directional autoscale margins in agreement. */
  private markerGeometry(plot: PineChartPlot, sample: Sample, ctx?: CanvasRenderingContext2D): MarkerGeometry | null {
    const source = plot.visual!.source;
    const shape = norm(option(source, sample, "shape"), "shape", "circle").replace(/_/g, "");
    const size = SIZES[norm(option(source, sample, "size"), "size", "auto")] ?? 10;
    const location = norm(option(source, sample, "location"), "location", "abovebar");
    const offset = location === "abovebar" ? -size - 4 : location === "belowbar" ? size + 4 : 0;
    const shade = pineVisualColor(option(source, sample, "color"), plot.color);
    const textColor = pineVisualColor(option(source, sample, "textcolor"), shade);
    const rawText = option(source, sample, "text");
    const text = typeof rawText === "string" ? rawText : "";
    let layouts = this.textLayouts.get(size);
    if (!layouts) { layouts = new Map(); this.textLayouts.set(size, layouts); }
    let layout = layouts.get(text);
    if (layout && !layout.measured && ctx) {
      // A headless/no-canvas first range query must not retain estimated glyph bounds after drawing.
      layout = undefined; this.markerBlocks.clear(); this.rangeKey = "";
    }
    if (!layout) {
      if (markerMetrics === undefined) markerMetrics = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1).getContext("2d") : typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
      const metrics = markerMetrics ?? ctx;
      if (metrics) { metrics.font = `${size + 3}px sans-serif`; metrics.textBaseline = "middle"; }
      const lines = text ? text.split("\n") : [];
      let width = size;
      const glyphs = lines.map((line) => {
        const measured = metrics?.measureText(line);
        width = Math.max(width, (measured?.width ?? line.length * (size + 3) * .6) + 8);
        return { ascent: measured?.actualBoundingBoxAscent ?? (size + 3) / 2, descent: measured?.actualBoundingBoxDescent ?? (size + 3) / 2 };
      });
      layout = { lines, width, glyphs, maxAscent: Math.max(0, ...glyphs.map((glyph) => glyph.ascent)), maxDescent: Math.max(0, ...glyphs.map((glyph) => glyph.descent)), measured: !!metrics || !lines.some((line) => line.trim()) }; layouts.set(text, layout);
    }
    const direction = ["triangledown", "arrowdown", "labeldown"].includes(shape) ? -1 : 1;
    const lineHeight = size + 5;
    const labelHeight = Math.max(size + 8, layout.lines.length * lineHeight + 6);
    const labelTop = direction > 0 ? offset + 4 : offset - labelHeight - 4;
    const textY = shape.startsWith("label") ? labelTop + 3 + lineHeight / 2 : ["belowbar", "bottom"].includes(location) ? offset + size + 6 : offset - size - 6 - (layout.lines.length - 1) * lineHeight;
    let min = Infinity, max = -Infinity;
    if (painted(shade)) {
      if (["circle", "square", "cross", "xcross", "diamond"].includes(shape)) { min = offset - size / 2; max = offset + size / 2; }
      else if (shape === "flag") { min = offset - size; max = offset; }
      else if (shape.startsWith("label")) { min = Math.min(offset, labelTop); max = Math.max(offset, labelTop + labelHeight); }
      else { const end = offset + direction * size * (shape.startsWith("arrow") ? 1.6 : 1); min = Math.min(offset, end); max = Math.max(offset, end); }
    }
    if (painted(textColor)) layout.lines.forEach((line, index) => {
      if (!line.trim()) return;
      const y = textY + index * lineHeight, glyph = layout!.glyphs[index];
      min = Math.min(min, y - glyph.ascent); max = Math.max(max, y + glyph.descent);
    });
    return min === Infinity ? null : { shape, size, offset, direction, shade, textColor, layout, lineHeight, textY, labelTop, labelHeight, min, max };
  }
  private shape(ctx: CanvasRenderingContext2D, plot: PineChartPlot, sample: Sample, x: number, anchorY: number, paneHeight: number) {
    const geometry = this.markerGeometry(plot, sample, ctx);
    if (!geometry) return;
    const { shape, size, offset, direction, shade, textColor, layout, lineHeight, textY, labelTop, labelHeight } = geometry;
    const y = anchorY + offset;
    ctx.font = `${size + 3}px sans-serif`;
    ctx.fillStyle = shade; ctx.strokeStyle = shade; ctx.lineWidth = 1;
    if (painted(shade)) {
      if (shape === "circle") { ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill(); }
      else if (shape === "square") ctx.fillRect(x - size / 2, y - size / 2, size, size);
      else if (shape === "cross") {
        const radius = size / 2, halfArm = Math.max(1, size / 5) / 2;
        // One nonzero-fill path paints the intersection once, including alpha.
        ctx.beginPath(); ctx.rect(x - radius, y - halfArm, size, halfArm * 2); ctx.rect(x - halfArm, y - radius, halfArm * 2, size); ctx.fill();
      } else if (shape === "xcross" || shape === "diamond" || shape === "flag") {
        const r = size / 2, t = Math.max(1, size / 5);
        const polygons = shape === "diamond" ? [[[0, -r], [r, 0], [0, r], [-r, 0]]]
          : shape === "flag" ? [[[0, 0], [0, -size], [size * .75, -size], [size * .75, -size / 2], [t, -size / 2], [t, 0]]]
          : [[[-r, -r + t], [-r + t, -r], [r, r - t], [r - t, r]], [[-r, r - t], [r - t, -r], [r, -r + t], [-r + t, r]]];
        ctx.beginPath();
        for (const polygon of polygons) {
          ctx.moveTo(x + polygon[0][0], y + polygon[0][1]);
          for (let index = 1; index < polygon.length; index++) ctx.lineTo(x + polygon[index][0], y + polygon[index][1]);
          ctx.closePath();
        }
        ctx.fill();
      }
      else if (shape.startsWith("label")) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + direction * 4); ctx.lineTo(x + 4, y + direction * 4); ctx.closePath(); ctx.fill();
        ctx.fillRect(x - layout.width / 2, anchorY + labelTop, layout.width, labelHeight);
      } else {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - size / 2, y + direction * size); ctx.lineTo(x + size / 2, y + direction * size); ctx.closePath(); ctx.fill();
        if (shape.startsWith("arrow")) ctx.fillRect(x - size / 6, direction < 0 ? y - size * 1.6 : y + size, size / 3, size * .6);
      }
    }
    if (painted(textColor)) {
      ctx.fillStyle = textColor; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const firstY = anchorY + textY;
      const from = Math.max(0, Math.ceil((-layout.maxDescent - firstY) / lineHeight));
      const to = Math.min(layout.lines.length - 1, Math.floor((paneHeight + layout.maxAscent - firstY) / lineHeight));
      for (let index = from; index <= to; index++) {
        const y = firstY + index * lineHeight, glyph = layout.glyphs[index];
        if (layout.lines[index].trim() && y + glyph.descent >= 0 && y - glyph.ascent <= paneHeight) ctx.fillText(layout.lines[index], x, y);
      }
    }
  }
}
