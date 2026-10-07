import type { AutoscaleInfo, IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneView, Logical, SeriesAttachedParameter, SeriesType, UTCTimestamp, ISeriesPrimitivePaneRenderer } from "lightweight-charts";
type CanvasRenderingTarget2D = Parameters<ISeriesPrimitivePaneRenderer["draw"]>[0];
import type { PineChartPlot } from "./pineChartAdapter";
import type { PinePlot, PineScalar } from "./pineProtocol";
import { getPackedPinePlot, pointAtBar } from "./pinePacked";

const BLOCK = 128;
const MAX_CACHED_SAMPLES = 8192;
const SIZES: Record<string, number> = { auto: 10, tiny: 6, small: 8, normal: 10, large: 14, huge: 18 };
const sourceStarts = new WeakMap<PinePlot, WeakMap<object, number>>();
type Sample = { value: number | boolean | null | number[]; options: Record<string, PineScalar> };
type Bounds = { min: number; max: number };
export function pineVisualColor(value: PineScalar | undefined, fallback = "#22d3ee"): string {
  if (value === null) return "rgba(0,0,0,0)";
  return typeof value === "string" && /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{1,24})$/i.test(value) ? value : fallback;
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
function anchor(plot: PineChartPlot, index: number, sample: Sample | undefined): number | undefined {
  if (!sample || sample.value === null || sample.value === false) return undefined;
  if (plot.kind !== "markers") return typeof sample.value === "number" ? sample.value : undefined;
  const location = norm(option(plot.visual!.source, sample, "location"), "location", "abovebar");
  if (location === "absolute") return typeof sample.value === "number" ? sample.value : undefined;
  if (sample.value === 0) return undefined;
  const bar = plot.visual!.bars[index];
  return location === "belowbar" ? bar.low : location === "abovebar" ? bar.high : undefined;
}
function extend(bounds: Bounds | null, value: number | undefined): Bounds | null {
  return value === undefined ? bounds : bounds ? { min: Math.min(bounds.min, value), max: Math.max(bounds.max, value) } : { min: value, max: value };
}

type Vertex = { x: number; y: number };
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
  for (const [axis, bound, lower] of [["x", 0, true], ["x", width, false], ["y", 0, true], ["y", height, false]] as const) {
    if (!polygon.length) break;
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
    polygon = output;
  }
  return polygon;
}

/** One chart-owned canvas primitive for a placement. Only the current viewport is decoded. */
export class PineVisualPrimitive implements ISeriesPrimitive {
  private plots: readonly PineChartPlot[];
  private scalePeers: readonly PineChartPlot[];
  private allowFillOnlyScale: boolean;
  private cacheSize = 0;
  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType>;
  private requestUpdate?: () => void;
  private samples = new Map<PinePlot, Map<number, Sample | undefined>>();
  private margins = new Map<PineChartPlot, number>();
  private textLayouts = new Map<number, Map<string, { lines: string[]; width: number }>>();
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
    this.views = [
      { zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target, "fill") }) },
      { zOrder: () => "normal", renderer: () => ({ draw: (target) => this.draw(target, "line") }) },
      { zOrder: () => "top", renderer: () => ({ draw: (target) => this.draw(target, "shape") }) },
    ];
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
    this.samples.clear(); this.cacheSize = 0; this.blocks.clear(); this.numericIndices.clear(); this.margins.clear(); this.textLayouts.clear(); this.rangeKey = ""; this.rangeCache = null;
    this.plots = []; this.scalePeers = []; this.from = 0; this.to = -1;
  }
  updateAllViews() { /* Coordinates are read at draw time so price zoom/resize cannot reuse stale geometry. */ }
  paneViews() { return this.views; }
  autoscaleInfo(_from: Logical, _to: Logical) { return this.rangeForVisible(); }
  private visible(plot: PineChartPlot, neighbors = false): [number, number] {
    if (!this.chart || !plot.visual?.bars.length) return [0, -1];
    const scale = this.chart.timeScale(), bars = plot.visual.bars;
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
    return low + (high - low) * (x - xLeft) / (xRight - xLeft);
  }
  private bounds(plot: PineChartPlot, from: number, to: number): Bounds | null {
    let result: Bounds | null = null;
    let cache = this.blocks.get(plot);
    if (!cache) { cache = new Map(); this.blocks.set(plot, cache); }
    const scan = (lo: number, hi: number) => {
      let bounds: Bounds | null = null;
      for (let index = lo; index <= hi; index++) {
        this.scans++;
        bounds = extend(bounds, plot.kind === "markers" ? anchor(plot, index, pineVisualSample(plot, index)) : numeric(plot, index));
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
  rangeForVisible(): AutoscaleInfo | null {
    const ranges = this.plots.map((plot) => this.visible(plot));
    const paneHeight = this.chart?.paneSize?.().height ?? Infinity;
    const key = `${paneHeight}|${ranges.map(([from, to]) => `${from}:${to}`).join("|")}`;
    if (key === this.rangeKey) return this.rangeCache;
    this.rangeKey = key;
    let bounds: Bounds | null = null;
    let margin = 0;
    this.plots.forEach((plot, p) => {
      const [from, to] = ranges[p];
      if (to < from || plot.kind === "fill") return;
      const found = this.bounds(plot, from, to);
      if (found) { bounds = extend(bounds, found.min); bounds = extend(bounds, found.max); }
      if (plot.kind === "line" && !plot.pointsOnly && !["linebr", "steplinebr", "areabr"].includes(plot.visual!.style)) {
        bounds = extend(bounds, this.interpolated(plot, from, plot.visual!.source, plot.step));
        bounds = extend(bounds, this.interpolated(plot, to, plot.visual!.source, plot.step));
      }
      if (plot.kind === "markers") {
        let maxMargin = this.margins.get(plot);
        if (maxMargin === undefined) {
        maxMargin = 0;
        const source = plot.visual!.source;
        const options = getPackedPinePlot(source)?.optionTable ?? source.points.map((point) => point.options);
        for (const fields of options) {
          const size = SIZES[norm(fields.size ?? source.options.size, "size", "auto")] ?? 10;
          const lines = String(fields.text ?? source.options.text ?? "").split("\n").length;
          maxMargin = Math.max(maxMargin, size * 2 + 16 + lines * (size + 5));
        }
        this.margins.set(plot, maxMargin);
        }
        margin = Math.max(margin, maxMargin);
      }
    });
    // A fill-only pane needs price coordinates; only painted geometry is a deliberate fallback.
    if (!bounds && this.allowFillOnlyScale && !this.hasVisibleScalePeer()) this.plots.forEach((plot, p) => {
      if (plot.kind !== "fill") return;
      const [from, to] = this.visible(plot, true);
      for (let index = from + 1; index <= to; index++) {
        const polygon = this.fillPolygon(plot, index);
        if (polygon) for (const value of polygon.values) bounds = extend(bounds, value);
      }
    });
    this.rangeCache = bounds ? { priceRange: { minValue: (bounds as Bounds).min, maxValue: (bounds as Bounds).max }, margins: { above: Math.min(margin, paneHeight * .4), below: Math.min(margin, paneHeight * .4) } } : null;
    return this.rangeCache;
  }
  private fillPolygon(plot: PineChartPlot, index: number): { shade: string; values: [number, number, number, number] } | null {
    const sample = this.sample(plot, index);
    const shade = pineVisualColor(option(plot.visual!.source, sample, "color"), plot.color);
    if (!sample || !painted(shade)) return null;
    const refs = plot.visual!.refs!;
    const values = [this.fillValue(plot, index - 1, refs.upper), this.fillValue(plot, index, refs.upper), this.fillValue(plot, index, refs.lower), this.fillValue(plot, index - 1, refs.lower)];
    return values.every((value) => value !== undefined) ? { shade, values: values as [number, number, number, number] } : null;
  }
  private fillValue(plot: PineChartPlot, index: number, source: PinePlot): number | undefined {
    const direct = numeric(plot, index, source);
    if (direct !== undefined || plot.visual!.source.options.fillgaps === false) return direct;
    return this.interpolated(plot, index, source);
  }

  private draw(target: CanvasRenderingTarget2D, layer: "fill" | "line" | "shape") {
    if (!this.chart || !this.series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
      for (const plot of this.plots) {
        if (plot.kind === "area" ? layer === "shape" : (plot.kind === "fill" ? "fill" : plot.kind === "markers" ? "shape" : "line") !== layer) continue;
        let [from, to] = this.visible(plot, true);
        this.from = from; this.to = to;
        if (to < from) continue;
        const x = (index: number) => this.chart!.timeScale().timeToCoordinate(plot.visual!.bars[index].time as UTCTimestamp);
        if (layer === "fill" && plot.kind === "fill") {
          for (let index = from + 1; index <= to; index++) {
            const polygon = this.fillPolygon(plot, index);
            if (!polygon) continue;
            const { shade, values } = polygon;
            const left = x(index - 1), right = x(index);
            const ys = values.map((value) => this.series!.priceToCoordinate(value!));
            if (left === null || right === null || ys.some((value) => value === null)) continue;
            for (const lobe of fillLobes([{ x: left, y: ys[0]! }, { x: right, y: ys[1]! }, { x: right, y: ys[2]! }, { x: left, y: ys[3]! }])) {
              const clipped = clipFillPolygon(lobe, mediaSize.width, mediaSize.height);
              if (clipped.length < 3) continue;
              ctx.fillStyle = shade; ctx.beginPath(); ctx.moveTo(clipped[0].x, clipped[0].y);
              for (let vertex = 1; vertex < clipped.length; vertex++) ctx.lineTo(clipped[vertex].x, clipped[vertex].y);
              ctx.closePath(); ctx.fill();
            }
          }
          continue;
        }
        let previous: { x: number; y: number; index: number } | null = null;
        let positions: Iterable<number>;
        if (plot.kind === "line" || plot.kind === "area") {
          const indices = this.indices(plot), lo = this.indexPosition(indices, from), hi = this.indexPosition(indices, to + 1);
          const bridges = !plot.pointsOnly && !["linebr", "steplinebr", "areabr"].includes(plot.visual!.style);
          positions = indices.subarray(bridges ? Math.max(0, lo - 1) : lo, bridges ? Math.min(indices.length, hi + 1) : hi);
        } else positions = (function* () { for (let index = from; index <= to; index++) yield index; })();
        for (const index of positions) {
          const sample = this.sample(plot, index), value = anchor(plot, index, sample);
          if (value === undefined) { if (["linebr", "steplinebr", "areabr"].includes(plot.visual!.style)) previous = null; continue; }
          const px = x(index), py = this.series!.priceToCoordinate(value);
          if (px === null || py === null) { previous = null; continue; }
          const options = plot.visual!.source;
          const shade = pineVisualColor(option(options, sample, "color"), plot.color);
          if (plot.kind === "markers") { this.shape(ctx, plot, sample!, px, py, mediaSize.height); continue; }
          const width = Math.max(1, Math.min(4, Number(option(options, sample, "linewidth") ?? plot.width)));
          if (layer === "fill" && plot.kind === "area") {
            if (previous && index === previous.index + 1) {
              const base = this.series!.priceToCoordinate(plot.base);
              if (base !== null) {
                const gradient = ctx.createLinearGradient(0, Math.min(previous.y, py), 0, base === Math.min(previous.y, py) ? base + 1 : base);
                gradient.addColorStop(0, shade); gradient.addColorStop(1, "transparent"); ctx.fillStyle = gradient;
                ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(px, py); ctx.lineTo(px, base); ctx.lineTo(previous.x, base); ctx.closePath(); ctx.fill();
              }
            }
            previous = { x: px, y: py, index }; continue;
          }
          ctx.strokeStyle = shade; ctx.fillStyle = shade; ctx.lineWidth = width;
          if (plot.pointsOnly) { ctx.beginPath(); ctx.arc(px, py, width + 1, 0, Math.PI * 2); ctx.fill(); }
          else if (previous && (!["linebr", "steplinebr", "areabr"].includes(plot.visual!.style) || index === previous.index + 1)) { ctx.beginPath(); ctx.moveTo(previous.x, previous.y); if (plot.step) ctx.lineTo(px, previous.y); ctx.lineTo(px, py); ctx.stroke(); }
          previous = { x: px, y: py, index };
        }
      }
      ctx.restore();
    });
  }
  private shape(ctx: CanvasRenderingContext2D, plot: PineChartPlot, sample: Sample, x: number, anchorY: number, paneHeight: number) {
    const source = plot.visual!.source;
    const shape = norm(option(source, sample, "shape"), "shape", "circle").replace(/_/g, "");
    const size = SIZES[norm(option(source, sample, "size"), "size", "auto")] ?? 10;
    const location = norm(option(source, sample, "location"), "location", "abovebar");
    const y = anchorY + (location === "abovebar" ? -size - 4 : location === "belowbar" ? size + 4 : 0);
    const shade = pineVisualColor(option(source, sample, "color"), plot.color);
    const text = option(source, sample, "text");
    ctx.font = `${size + 3}px sans-serif`;
    let layouts = this.textLayouts.get(size);
    if (!layouts) { layouts = new Map(); this.textLayouts.set(size, layouts); }
    const rawText = typeof text === "string" ? text : "";
    let layout = layouts.get(rawText);
    if (!layout) {
      const lines = typeof text === "string" ? text.split("\n") : [];
      let width = size; for (const line of lines) width = Math.max(width, ctx.measureText(line).width + 8);
      layout = { lines, width }; layouts.set(rawText, layout);
    }
    const lines = layout.lines;
    const lineHeight = size + 5;
    const paintLines = (firstY: number) => {
      const from = Math.max(0, Math.ceil((-lineHeight / 2 - firstY) / lineHeight));
      const to = Math.min(lines.length - 1, Math.floor((paneHeight + lineHeight / 2 - firstY) / lineHeight));
      for (let index = from; index <= to; index++) ctx.fillText(lines[index], x, firstY + index * lineHeight);
    };
    const textColor = pineVisualColor(option(source, sample, "textcolor"), shade);
    ctx.fillStyle = shade; ctx.strokeStyle = shade; ctx.lineWidth = 1;
    const down = ["triangledown", "arrowdown", "labeldown"].includes(shape);
    const direction = down ? -1 : 1;
    if (shape === "circle") { ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fill(); }
    else if (shape === "square") ctx.fillRect(x - size / 2, y - size / 2, size, size);
    else if (shape.startsWith("label")) {
      ctx.font = `${size + 3}px sans-serif`;
      const width = layout.width, height = Math.max(size + 8, lines.length * lineHeight + 6);
      const top = direction > 0 ? y + 4 : y - height - 4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + direction * 4); ctx.lineTo(x + 4, y + direction * 4); ctx.closePath(); ctx.fill();
      ctx.fillRect(x - width / 2, top, width, height);
      if (lines.length) { ctx.fillStyle = textColor; ctx.textAlign = "center"; ctx.textBaseline = "middle"; paintLines(top + 3 + lineHeight / 2); }
      return;
    } else {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - size / 2, y + direction * size); ctx.lineTo(x + size / 2, y + direction * size); ctx.closePath(); ctx.fill();
      if (shape.startsWith("arrow")) ctx.fillRect(x - size / 6, down ? y - size * 1.6 : y + size, size / 3, size * .6);
    }
    if (lines.length) {
      ctx.font = `${size + 3}px sans-serif`; ctx.fillStyle = textColor; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const top = location === "belowbar" ? y + size + 6 : y - size - 6 - (lines.length - 1) * lineHeight;
      paintLines(top);
    }
  }
}
