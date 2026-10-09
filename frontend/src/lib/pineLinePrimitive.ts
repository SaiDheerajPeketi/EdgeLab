import type { AutoscaleInfo, IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, Logical, MouseEventParams, SeriesAttachedParameter, SeriesType, UTCTimestamp } from "lightweight-charts";
import type { PineChartPlot } from "./pineChartAdapter";
import type { PineLineDrawing, PineLineFillDrawing, PineBoxDrawing, PineLabelDrawing, PinePolylineDrawing } from "./pineProtocol";
import { pineLabelLayout, paintPineLabel, hitPineLabel } from "./pineLabelLayout";
import type { PineLabelLayout } from "./pineLabelLayout";
import { clipFillPolygon, fillLobes, pineGradientColor } from "./pineVisualPrimitive";
import { polylineRuns, visiblePolylineY, polylineHasArea, tracePolyline } from "./pinePolylineGeometry";
type Target = Parameters<ISeriesPrimitivePaneRenderer["draw"]>[0];
type Point = { x: number; y: number };
const drawingBehind = (plot: PineChartPlot, drawing: { forceOverlay?: boolean }) => plot.behindChart !== false && drawing.forceOverlay !== true;
const tooltipContainers = new WeakMap<HTMLDivElement, { count: number; previous: string }>();
export function acquireTooltipContainer(element: HTMLDivElement) {
  const owned = tooltipContainers.get(element);
  if (owned) { owned.count++; return; }
  if (typeof window !== "undefined" && window.getComputedStyle(element).position === "static") {
    tooltipContainers.set(element, { count: 1, previous: element.style.position }); element.style.position = "relative";
  }
}
export function releaseTooltipContainer(element: HTMLDivElement) {
  const owned = tooltipContainers.get(element);
  if (!owned || --owned.count) return;
  if (element.style.position === "relative") element.style.position = owned.previous;
  tooltipContainers.delete(element);
}

function interval(line: PineLineDrawing, dx: number): [number, number] {
  // Left/right mean earlier/later chart positions even when endpoints are reversed.
  const left = line.extend === "left" || line.extend === "both";
  const right = line.extend === "right" || line.extend === "both";
  return dx < 0 ? [right ? -Infinity : 0, left ? Infinity : 1] : [left ? -Infinity : 0, right ? Infinity : 1];
}
function restrict(from: number, to: number, origin: number, delta: number, low: number, high: number): [number, number] | null {
  if (delta === 0) return origin < low || origin > high ? null : [from, to];
  const a = (low - origin) / delta, b = (high - origin) / delta;
  from = Math.max(from, Math.min(a, b)); to = Math.min(to, Math.max(a, b));
  return from <= to ? [from, to] : null;
}
function visible(line: PineLineDrawing): boolean {
  return line.x1 !== null && line.x2 !== null && line.y1 !== null && line.y2 !== null
    && (line.x1 !== line.x2 || line.y1 !== line.y2) && (pineGradientColor(line.color)?.[3] ?? 0) > 0;
}

/** Final active drawing objects: no synthetic candles, historical copies or per-line chart series. */
export class PineLinePrimitive implements ISeriesPrimitive {
  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType>;
  private requestUpdate?: () => void;
  private tooltip?: HTMLDivElement;
  private labelsAttached = false;
  private tooltipGeometry?: { plot: PineChartPlot; label: PineLabelDrawing; x: number; y: number; width: number; height: number; leftAxis: number; transform: string };
  private readonly labelLayouts = new WeakMap<PineLabelDrawing, PineLabelLayout | null>();
  private readonly hideTooltip = () => { if (this.tooltip) this.tooltip.hidden = true; this.tooltipGeometry = undefined; };
  private readonly onRange = () => { this.hideTooltip(); this.requestUpdate?.(); };
  private readonly onCrosshair = (event: MouseEventParams) => {
    if (!this.chart || !event.point || !event.sourceEvent) { this.hideTooltip(); return; }
    // Magnet crosshairs can snap to a candle far from the actual mouse/touch hit.
    const { localX: x, localY: y } = event.sourceEvent, { width, height } = this.chart.paneSize();
    if (x < 0 || x >= width || y < 0 || y >= height) { this.hideTooltip(); return; }
    const ordered = [...this.plots].reverse();
    // Frontmost labels win. Non-tooltip labels also occlude lower labels.
    for (const behind of [false, true]) for (const plot of ordered) for (const label of [...(plot.drawing!.labels ?? [])].reverse()) {
      if (drawingBehind(plot, label) !== behind) continue;
      const layout = this.labelLayout(label), position = this.labelAnchor(plot, label);
      if (!layout || !position || !hitPineLabel(layout, x - position.x, y - position.y)) continue;
      if (!label.tooltip) { this.hideTooltip(); return; }
      if (!this.tooltip) {
        const tooltip = document.createElement("div"); tooltip.setAttribute("role", "tooltip"); tooltip.dataset.pineLabelTooltip = "";
        Object.assign(tooltip.style, { position: "absolute", pointerEvents: "none", zIndex: "50", maxWidth: "min(320px, 80%)",
          maxHeight: "80%", overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: "8px 10px",
          borderRadius: "6px", border: "1px solid var(--ui-border-strong, #3f4652)", background: "var(--ui-floating, #171c24)",
          color: "var(--text-primary, #f0f2f5)", font: "12px/1.4 system-ui, sans-serif", boxShadow: "0 4px 20px #0004" });
        this.chart.chartElement().append(tooltip); this.tooltip = tooltip;
      }
      this.tooltip.textContent = label.tooltip; this.tooltip.hidden = false;
      const leftAxis = this.chart.priceScale("left").width();
      this.tooltip.style.left = `${leftAxis + Math.max(0, Math.min(x + 12, width - this.tooltip.offsetWidth))}px`;
      this.tooltipGeometry = { plot, label, x: position.x, y: position.y, width, height, leftAxis, transform: this.priceTransform() };
      this.tooltip.style.top = `${Math.max(0, Math.min(y + 12, height - this.tooltip.offsetHeight))}px`;
      return;
    }
    this.hideTooltip();
  };
  private readonly views: readonly ISeriesPrimitivePaneView[];
  private textMeasurementContext?: CanvasRenderingContext2D | null;
  private readonly boxTextBounds = new WeakMap<PineBoxDrawing, { font: string; left: number; right: number }>();
  private readonly boxTextLayouts = new WeakMap<PineBoxDrawing, { width: number; font: string; lines: string[] }>();
  private readonly polylineRanges = new WeakMap<PinePolylineDrawing, { from: number; to: number; transform: string; points: (Point | null)[]; values: number[] }>();
  private readonly lineReferences = new WeakMap<PineChartPlot, Map<string, PineLineDrawing>>();
  constructor(private plots: readonly PineChartPlot[], private options: { allowFillOnlyScale?: boolean; hasScalePeer?: () => boolean } = {}) {
    for (const plot of plots) this.lineReferences.set(plot, new Map(plot.drawing!.lines.map(line => [line.id, line])));
    this.views = [{ zOrder: () => "normal", renderer: () => ({ drawBackground: target => this.draw(target, true), draw: target => this.draw(target, false) }) }];
  }
  attached({ chart, series, requestUpdate }: SeriesAttachedParameter) {
    this.chart = chart; this.series = series; this.requestUpdate = requestUpdate;
    chart.timeScale().subscribeVisibleTimeRangeChange(this.onRange);
    if (this.plots.some(plot => plot.drawing!.labels?.length)) { this.labelsAttached = true; acquireTooltipContainer(chart.chartElement()); chart.subscribeCrosshairMove(this.onCrosshair); chart.chartElement().addEventListener('pointerleave', this.hideTooltip); }
    requestUpdate();
  }
  detached() {
    this.chart?.timeScale().unsubscribeVisibleTimeRangeChange(this.onRange);
    if (this.labelsAttached) { this.chart?.unsubscribeCrosshairMove(this.onCrosshair); this.chart?.chartElement().removeEventListener('pointerleave', this.hideTooltip); if (this.chart) releaseTooltipContainer(this.chart.chartElement()); }
    this.labelsAttached = false;
    this.tooltip?.remove(); this.tooltip = undefined; this.tooltipGeometry = undefined;
    this.chart = undefined; this.series = undefined; this.requestUpdate = undefined; this.plots = []; this.textMeasurementContext = undefined;
  }
  updateAllViews() {
    // Crosshair redraws retain the tooltip; actual transform/size changes retire its old hit.
    const owned = this.tooltipGeometry;
    if (!owned || !this.chart) return;
    const position = this.labelAnchor(owned.plot, owned.label), size = this.chart.paneSize();
    if (!position || position.x !== owned.x || position.y !== owned.y || size.width !== owned.width || size.height !== owned.height || this.chart.priceScale('left').width() !== owned.leftAxis || this.priceTransform() !== owned.transform) this.hideTooltip();
  }
  private priceTransform() {
    if (!this.chart || !this.series) return "";
    const scale = this.series.priceScale().options(), height = this.chart.paneSize().height;
    type Coordinate = Parameters<ISeriesApi<SeriesType>["coordinateToPrice"]>[0];
    return JSON.stringify([scale.mode, scale.invertScale, scale.scaleMargins.top, scale.scaleMargins.bottom,
      this.series.coordinateToPrice(0 as Coordinate), this.series.coordinateToPrice(height as Coordinate)]);
  }
  paneViews() { return this.views; }
  autoscaleInfo(_from: Logical, _to: Logical) { return this.rangeForVisible(); }
  private logical(plot: PineChartPlot, line: Pick<PineLineDrawing, "xloc">, value: number): number | null {
    const scale = this.chart!.timeScale(), bars = plot.drawing!.bars;
    const locate = (index: number): number | null => {
      const coordinate = scale.timeToCoordinate(bars[index].time as UTCTimestamp);
      const position = coordinate === null ? null : scale.coordinateToLogical(coordinate);
      return position === null || !Number.isFinite(position) ? null : Number(position);
    };
    if (!bars.length) return null;
    if (line.xloc === "bar_index") {
      const index = Math.max(0, Math.min(bars.length - 1, value));
      const position = locate(index);
      return position === null ? null : position + value - index;
    }
    const exact = scale.timeToCoordinate(value as UTCTimestamp);
    if (exact !== null) {
      const position = scale.coordinateToLogical(exact);
      if (position !== null && Number.isFinite(position)) return Number(position);
    }
    if (bars.length < 2) return null;
    let lo = 0, hi = bars.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].time < value) lo = mid + 1; else hi = mid; }
    const left = Math.max(0, Math.min(bars.length - 2, lo - 1)), right = left + 1;
    const a = locate(left), b = locate(right);
    if (a === null || b === null) return null;
    // Unknown times interpolate loaded chart slots; outside history uses the nearest
    // known interval. This never adds a fabricated trading-session candle.
    const position = a + (b - a) * ((value - bars[left].time) / (bars[right].time - bars[left].time));
    return Number.isFinite(position) ? position : null;
  }
  private coordinate(logical: number): number | null {
    // LWC 4.2 accepts integer logical indexes only. Timestamp endpoints may sit
    // between bars, so interpolate the actual neighboring pixel centers.
    const scale = this.chart!.timeScale(), first = Math.floor(logical), last = Math.ceil(logical);
    const a = scale.logicalToCoordinate(first as Logical);
    if (a === null || !Number.isFinite(a)) return null;
    if (first === last) return a;
    const b = scale.logicalToCoordinate(last as Logical);
    return b === null || !Number.isFinite(b) ? null : a * (last - logical) + b * (logical - first);
  }
  private validPriceTransform(coordinate: number | null, value: number): boolean {
    if (coordinate === null || !Number.isFinite(coordinate)) return false;
    const price = this.series!.coordinateToPrice(coordinate as Parameters<ISeriesApi<SeriesType>["coordinateToPrice"]>[0]);
    return price !== null && Number.isFinite(price) && Math.abs(price - value) <= Math.abs(value) * 1e-8;
  }
  /** Only common horizontal space is filled; line stroke color never controls its region. */
  private fillVertices(plot: PineChartPlot, fill: PineLineFillDrawing, from: number, to: number, pixels: boolean): [Point, Point, Point, Point] | null {
    if ((pineGradientColor(fill.color)?.[3] ?? 0) === 0) return null;
    const coordinates = [fill.line1, fill.line2].map(id => {
      const line = this.lineReferences.get(plot)?.get(id);
      if (!line || line.x1 === null || line.x2 === null || line.y1 === null || line.y2 === null) return null;
      const first = this.logical(plot, line, line.x1), last = this.logical(plot, line, line.x2);
      if (first === null || last === null || first === last) return null;
      const x1 = pixels ? this.coordinate(first) : first, x2 = pixels ? this.coordinate(last) : last;
      const y1 = pixels ? this.series!.priceToCoordinate(line.y1) : line.y1;
      const y2 = pixels ? this.series!.priceToCoordinate(line.y2) : line.y2;
      if (x1 === null || x2 === null || y1 === null || y2 === null || ![x1, x2, y1, y2].every(Number.isFinite)) return null;
      const py1 = this.series!.priceToCoordinate(line.y1), py2 = this.series!.priceToCoordinate(line.y2);
      const transformed = !pixels && this.validPriceTransform(py1, line.y1) && this.validPriceTransform(py2, line.y2);
      return { x1, x2, y1, y2, py1, py2, transformed, left: line.extend === "left" || line.extend === "both" ? -Infinity : Math.min(x1, x2), right: line.extend === "right" || line.extend === "both" ? Infinity : Math.max(x1, x2) };
    });
    const [a, b] = coordinates;
    if (!a || !b) return null;
    const left = Math.max(from, a.left, b.left), right = Math.min(to, a.right, b.right);
    if (right <= left) return null;
    const at = (line: NonNullable<typeof a>, x: number) => {
      const t = (x - line.x1) / (line.x2 - line.x1);
      const interpolate = (a: number, b: number) => {
        if (a === b) return a;
        const scale = Math.max(Math.abs(a), Math.abs(b));
        return (a / scale * (1 - t) + b / scale * t) * scale;
      };
      if (line.transformed) {
        const price = this.series!.coordinateToPrice(interpolate(line.py1!, line.py2!) as Parameters<ISeriesApi<SeriesType>["coordinateToPrice"]>[0]);
        if (price !== null) return price;
      }
      return interpolate(line.y1, line.y2);
    };
    const vertices: [Point, Point, Point, Point] = [{ x: left, y: at(a, left) }, { x: right, y: at(a, right) }, { x: right, y: at(b, right) }, { x: left, y: at(b, left) }];
    if (!vertices.every(point => Number.isFinite(point.y)) || vertices[0].y === vertices[3].y && vertices[1].y === vertices[2].y) return null;
    return vertices;
  }
  private polylinePoints(plot: PineChartPlot, polyline: PinePolylineDrawing, pixels: boolean, transformed = true) {
    return polyline.points.map(point => {
      if (point.x === null || point.y === null) return null;
      const logical = this.logical(plot, polyline, point.x);
      if (logical === null) return null;
      const x = pixels ? this.coordinate(logical) : logical, y = transformed ? this.series!.priceToCoordinate(point.y) : point.y;
      return x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) ? null : { x, y };
    });
  }
  private polylineRange(plot: PineChartPlot, polyline: PinePolylineDrawing, from: number, to: number): number[] {
    const stroke = (pineGradientColor(polyline.lineColor)?.[3] ?? 0) > 0;
    const transformed = polyline.points.every(point => point.y === null || this.validPriceTransform(this.series!.priceToCoordinate(point.y), point.y));
    const points = this.polylinePoints(plot, polyline, false, transformed), transform = this.priceTransform();
    const cached = this.polylineRanges.get(polyline);
    if (cached && cached.from === from && cached.to === to && cached.transform === transform && cached.points.length === points.length
      && points.every((point, index) => point === null ? cached.points[index] === null : point.x === cached.points[index]?.x && point.y === cached.points[index]?.y)) return cached.values;
    const runs = polylineRuns(points, polyline.curved, polyline.closed);
    const fill = points.every(Boolean) && points.length >= 3 && (pineGradientColor(polyline.fillColor)?.[3] ?? 0) > 0 && polylineHasArea(points as Point[]);
    if (!stroke && !fill) return [];
    const segments = runs.flatMap(run => {
      if (!run.segments.length) return [];
      const segments = [...run.segments];
      // An open path's fill closes implicitly while its stroke keeps authored endpoints.
      if (fill && !run.closed) segments.push({ a: run.points.at(-1)!, b: run.points[0] });
      return segments;
    }).filter(segment => segment.a.x !== segment.b.x || segment.a.y !== segment.b.y || segment.c1 && segment.c2 && (segment.c1.x !== segment.a.x || segment.c1.y !== segment.a.y || segment.c2.x !== segment.b.x || segment.c2.y !== segment.b.y));
    const values = visiblePolylineY(segments, from, to).flatMap(y => {
      const price = transformed ? this.series!.coordinateToPrice(y as Parameters<ISeriesApi<SeriesType>["coordinateToPrice"]>[0]) : y;
      return price !== null && Number.isFinite(price) ? [price] : [];
    });
    this.polylineRanges.set(polyline, { from, to, transform, points, values });
    return values;
  }
  private drawPolyline(plot: PineChartPlot, polyline: PinePolylineDrawing, ctx: CanvasRenderingContext2D, width: number, height: number) {
    const points = this.polylinePoints(plot, polyline, true), runs = polylineRuns(points, polyline.curved, polyline.closed);
    const stroke = (pineGradientColor(polyline.lineColor)?.[3] ?? 0) > 0;
    const fill = points.every(Boolean) && points.length >= 3 && (pineGradientColor(polyline.fillColor)?.[3] ?? 0) > 0 && polylineHasArea(points as Point[]);
    if (!stroke && !fill) return;
    ctx.save(); ctx.lineWidth = polyline.lineWidth; ctx.lineJoin = "round";
    ctx.lineCap = polyline.lineStyle === "dotted" ? "round" : "butt";
    ctx.setLineDash(polyline.lineStyle === "dashed" ? [6 * polyline.lineWidth, 4 * polyline.lineWidth] : polyline.lineStyle === "dotted" ? [0, 2 * polyline.lineWidth] : []);
    for (const run of runs) {
      if (!run.segments.length) continue;
      ctx.beginPath(); tracePolyline(ctx, run);
      if (fill) { ctx.fillStyle = polyline.fillColor!; ctx.fill("nonzero"); }
      if (stroke) { ctx.strokeStyle = polyline.lineColor!; ctx.stroke(); }
    }
    ctx.setLineDash([]);
    // Arrow tips only belong to the complete authored path's actual endpoints.
    // Clipping never manufactures an arrow on a pane edge or an NA gap.
    if (stroke && points.every(Boolean) && runs.length === 1 && !polyline.closed) {
      const segments = runs[0].segments;
      const arrow = (tip: Point, adjacent: Point) => {
        if (tip.x < 0 || tip.x > width || tip.y < 0 || tip.y > height) return;
        const magnitude = Math.max(Math.abs(tip.x), Math.abs(tip.y), Math.abs(adjacent.x), Math.abs(adjacent.y), 1);
        const dx = tip.x / magnitude - adjacent.x / magnitude, dy = tip.y / magnitude - adjacent.y / magnitude, length = Math.hypot(dx, dy);
        if (!length) return;
        const ux = dx / length, uy = dy / length, size = Math.max(6, polyline.lineWidth * 3);
        ctx.beginPath(); ctx.moveTo(tip.x - ux * size - uy * size / 2, tip.y - uy * size + ux * size / 2);
        ctx.lineTo(tip.x, tip.y); ctx.lineTo(tip.x - ux * size + uy * size / 2, tip.y - uy * size - ux * size / 2); ctx.stroke();
      };
      const first = segments[0], last = segments.at(-1);
      const direction = (tip: Point, reverse: boolean) => {
        for (const segment of reverse ? [...segments].reverse() : segments) {
          const candidates = reverse ? [segment.c2, segment.c1, segment.a] : [segment.c1, segment.c2, segment.b];
          const adjacent = candidates.find(point => point && (point.x !== tip.x || point.y !== tip.y));
          if (adjacent) return adjacent;
        }
        return tip;
      };
      if (first && ["arrow_left", "arrow_both"].includes(polyline.lineStyle)) arrow(first.a, direction(first.a, false));
      if (last && ["arrow_right", "arrow_both"].includes(polyline.lineStyle)) arrow(last.b, direction(last.b, true));
    }
    ctx.restore();
  }
  private labelLayout(label: PineLabelDrawing): PineLabelLayout | null {
    if (this.labelLayouts.has(label)) return this.labelLayouts.get(label)!;
    if (this.textMeasurementContext === undefined) this.textMeasurementContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    const ctx = this.textMeasurementContext;
    if (!ctx) return null;
    ctx.save(); const layout = pineLabelLayout(label, ctx); ctx.restore();
    this.labelLayouts.set(label, layout); return layout;
  }
  private labelPosition(plot: PineChartPlot, label: PineLabelDrawing) {
    if (label.x === null) return null;
    const logical = this.logical(plot, label, label.x);
    if (logical === null) return null;
    if (label.yloc === "price") return label.y === null ? null : { logical, prices: [label.y] };
    const bars = plot.drawing!.bars;
    let bar: typeof bars[number] | undefined;
    if (label.xloc === "bar_index") bar = bars[label.x];
    else {
      let lo = 0, hi = bars.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].time < label.x) lo = mid + 1; else hi = mid; }
      if (bars[lo]?.time === label.x) bar = bars[lo];
    }
    // Relative y locations ignore y, but require the actual referenced candle.
    return bar ? { logical, prices: [bar.high, bar.low] } : null;
  }
  private labelAnchor(plot: PineChartPlot, label: PineLabelDrawing) {
    const position = this.labelPosition(plot, label);
    if (!position) return null;
    const x = this.coordinate(position.logical), values = position.prices.map(price => this.series!.priceToCoordinate(price));
    if (x === null || !Number.isFinite(x) || values.some(value => value === null || !Number.isFinite(value))) return null;
    const y = label.yloc === "abovebar" ? Math.min(...values as number[]) - 12
      : label.yloc === "belowbar" ? Math.max(...values as number[]) + 12 : values[0]!;
    return { x, y };
  }
  private boxPosition(plot: PineChartPlot, box: PineBoxDrawing) {
    if (box.left === null || box.right === null || box.top === null || box.bottom === null
      || box.left === box.right && box.top === box.bottom) return null;
    const a = this.logical(plot, box, box.left), b = this.logical(plot, box, box.right);
    return a === null || b === null ? null : { left: Math.min(a, b), right: Math.max(a, b) };
  }
  private boxHasBorder(box: PineBoxDrawing) { return box.borderWidth > 0 && (pineGradientColor(box.borderColor)?.[3] ?? 0) > 0; }
  private boxHasText(box: PineBoxDrawing) { return box.text.trim().length > 0 && (pineGradientColor(box.textColor)?.[3] ?? 0) > 0; }
  private boxFont(box: PineBoxDrawing) {
    // Auto uses a stable local 14px default, including an initially empty price scale.
    const size = box.textSize || 14;
    const font = `${box.textFormatting.includes("italic") ? "italic " : ""}${box.textFormatting.includes("bold") ? "bold " : ""}${size}px ${box.textFontFamily === "monospace" ? "monospace" : "system-ui, sans-serif"}`;
    return { size, font };
  }
  private overflowingBoxTextVisible(box: PineBoxDrawing, position: { left: number; right: number }): boolean {
    if (box.textWrap !== "none" || !this.boxHasText(box)) return false;
    const left = this.coordinate(position.left), right = this.coordinate(position.right);
    if (left === null || right === null) return false;
    if (this.textMeasurementContext === undefined) this.textMeasurementContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    const ctx = this.textMeasurementContext;
    if (!ctx) return false;
    const { font } = this.boxFont(box);
    let bounds = this.boxTextBounds.get(box);
    if (!bounds || bounds.font !== font) {
      ctx.font = font; ctx.textAlign = box.textHalign;
      let left = Infinity, right = -Infinity;
      for (const paragraph of box.text.split("\n")) {
        const metrics = ctx.measureText(paragraph);
        if (metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight <= 0) continue;
        left = Math.min(left, -metrics.actualBoundingBoxLeft); right = Math.max(right, metrics.actualBoundingBoxRight);
      }
      bounds = { font, left, right }; this.boxTextBounds.set(box, bounds);
    }
    const x = box.textHalign === "left" ? left + 2 : box.textHalign === "right" ? right - 2 : left / 2 + right / 2;
    return Number.isFinite(bounds.left) && Number.isFinite(bounds.right) && x + bounds.left < this.chart!.timeScale().width() && x + bounds.right > 0;
  }
  private drawBox(plot: PineChartPlot, box: PineBoxDrawing, ctx: CanvasRenderingContext2D, width: number, height: number) {
    const position = this.boxPosition(plot, box);
    if (!position) return;
    const left = this.coordinate(position.left), right = this.coordinate(position.right);
    const a = this.series!.priceToCoordinate(box.top!), b = this.series!.priceToCoordinate(box.bottom!);
    if (left === null || right === null || a === null || b === null || ![left, right, a, b].every(Number.isFinite)) return;
    const top = Math.min(a, b), bottom = Math.max(a, b), area = left < right && top < bottom;
    const clipLeft = Math.max(0, left), clipRight = Math.min(width, right), clipTop = Math.max(0, top), clipBottom = Math.min(height, bottom);
    if (area && clipRight > clipLeft && clipBottom > clipTop && (pineGradientColor(box.bgcolor)?.[3] ?? 0) > 0) {
      ctx.fillStyle = box.bgcolor!; ctx.fillRect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop);
    }
    if (this.boxHasBorder(box)) {
      ctx.save(); ctx.strokeStyle = box.borderColor!; ctx.lineWidth = box.borderWidth;
      ctx.lineCap = box.borderStyle === "dotted" ? "round" : "butt";
      ctx.setLineDash(box.borderStyle === "dashed" ? [6 * box.borderWidth, 4 * box.borderWidth] : box.borderStyle === "dotted" ? [0, 2 * box.borderWidth] : []);
      const pad = box.borderWidth / 2 + 1;
      const stroke = (x1: number, y1: number, x2: number, y2: number) => {
        const dx = x2 - x1, dy = y2 - y1;
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx === 0 && dy === 0) return;
        const horizontal = restrict(0, 1, x1, dx, -pad, width + pad);
        const clipped = horizontal && restrict(horizontal[0], horizontal[1], y1, dy, -pad, height + pad);
        if (!clipped || !clipped.every(Number.isFinite)) return;
        const points = clipped.map(t => ({ x: x1 + dx * t, y: y1 + dy * t }));
        if (!points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) return;
        const phase = Math.hypot(dx, dy) * clipped[0], period = (box.borderStyle === "dashed" ? 10 : 2) * box.borderWidth;
        ctx.lineDashOffset = Number.isFinite(phase) ? -(phase % period) : 0;
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); ctx.lineTo(points[1].x, points[1].y); ctx.stroke();
      };
      // Only horizontal borders extend. No invented side is drawn at a clipped edge.
      const start = box.extend === "left" || box.extend === "both" ? -pad : left;
      const end = box.extend === "right" || box.extend === "both" ? width + pad : right;
      stroke(start, top, end, top);
      if (bottom !== top) stroke(start, bottom, end, bottom);
      stroke(left, top, left, bottom);
      if (right !== left) stroke(right, top, right, bottom);
      ctx.restore();
    }
    if (!area || !this.boxHasText(box)) return;
    const { size, font } = this.boxFont(box);
    ctx.save(); ctx.font = font; ctx.fillStyle = box.textColor!; ctx.textBaseline = "top"; ctx.textAlign = box.textHalign;
    const pad = 2, wrapWidth = Math.max(0, right - left - pad * 2);
    let layout = this.boxTextLayouts.get(box);
    if (!layout || layout.width !== wrapWidth || layout.font !== font) {
      const lines: string[] = [];
      for (const paragraph of box.text.split("\n")) {
        if (box.textWrap === "none" || wrapWidth === 0) { lines.push(paragraph); continue; }
        let line = "";
        for (const word of paragraph.split(/(\s+)/)) {
          if (!word) continue;
          if (ctx.measureText(line + word).width <= wrapWidth) { line += word; continue; }
          if (line) { lines.push(line.trimEnd()); line = ""; }
          if (/^\s+$/.test(word)) continue;
          if (ctx.measureText(word).width <= wrapWidth) { line = word; continue; }
          let advance = 0;
          for (const character of word) {
            const next = ctx.measureText(character).width;
            if (line && advance + next > wrapWidth) { lines.push(line); line = ""; advance = 0; }
            line += character; advance += next;
          }
        }
        lines.push(line.trimEnd());
      }
      layout = { width: wrapWidth, font, lines }; this.boxTextLayouts.set(box, layout);
    }
    if (box.textWrap === "auto") {
      if (clipRight <= clipLeft || clipBottom <= clipTop) { ctx.restore(); return; }
      ctx.beginPath(); ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop); ctx.clip();
    }
    const lineHeight = size * 1.2, blockHeight = layout.lines.length * lineHeight;
    const y = box.textValign === "top" ? top + pad : box.textValign === "bottom" ? bottom - pad - blockHeight : top / 2 + bottom / 2 - blockHeight / 2;
    const x = box.textHalign === "left" ? left + pad : box.textHalign === "right" ? right - pad : left / 2 + right / 2;
    for (let index = 0; index < layout.lines.length; index++) {
      const baseline = y + index * lineHeight;
      if (Number.isFinite(x) && Number.isFinite(baseline) && baseline + lineHeight >= 0 && baseline < height) ctx.fillText(layout.lines[index], x, baseline);
    }
    ctx.restore();
  }
  rangeForVisible(): AutoscaleInfo | null {
    if (!this.chart || !this.series) return null;
    const range = this.chart.timeScale().getVisibleLogicalRange();
    if (!range) return null;
    let min = Infinity, max = -Infinity, above = 0, below = 0;
    for (const plot of this.plots) for (const line of plot.drawing!.lines) {
      if (!visible(line)) continue;
      const x1 = this.logical(plot, line, line.x1!), x2 = this.logical(plot, line, line.x2!);
      if (x1 === null || x2 === null) continue;
      const dx = x2 - x1, [start, end] = interval(line, dx);
      const clipped = restrict(start, end, x1, dx, Number(range.from), Number(range.to));
      if (!clipped) continue;
      let values: number[];
      if (dx === 0) values = [line.y1!, line.y2!];
      else {
        const a = this.series.priceToCoordinate(line.y1!), b = this.series.priceToCoordinate(line.y2!);
        // LWC's empty transform can return zero rather than null. Only a valid
        // round trip may drive log/inverted interpolation; numeric slope seeds it.
        const transformed = this.validPriceTransform(a, line.y1!) && this.validPriceTransform(b, line.y2!);
        values = clipped.map(t => {
          const price = !transformed ? null : this.series!.coordinateToPrice((a! + (b! - a!) * t) as Parameters<ISeriesApi<SeriesType>["coordinateToPrice"]>[0]);
          return price ?? line.y1! + (line.y2! - line.y1!) * t;
        });
      }
      for (const value of values) if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
    }
    for (const plot of this.plots) for (const box of plot.drawing!.boxes ?? []) {
      const position = this.boxPosition(plot, box);
      if (!position) continue;
      const area = position.left !== position.right && box.top !== box.bottom;
      const border = this.boxHasBorder(box), fill = area && (pineGradientColor(box.bgcolor)?.[3] ?? 0) > 0;
      const text = area && this.boxHasText(box);
      if (!border && !fill && !text) continue;
      const left = border && (box.extend === "left" || box.extend === "both") ? -Infinity : position.left;
      const right = border && (box.extend === "right" || box.extend === "both") ? Infinity : position.right;
      if ((left > range.to || right < range.from) && !(text && this.overflowingBoxTextVisible(box, position))) continue;
      min = Math.min(min, box.top!, box.bottom!); max = Math.max(max, box.top!, box.bottom!);
    }
    for (const plot of this.plots) for (const polyline of plot.drawing!.polylines ?? []) {
      for (const value of this.polylineRange(plot, polyline, Number(range.from), Number(range.to))) { min = Math.min(min, value); max = Math.max(max, value); }
    }
    for (const plot of this.plots) for (const label of plot.drawing!.labels ?? []) {
      const layout = this.labelLayout(label), position = this.labelPosition(plot, label);
      if (!layout || !position) continue;
      const x = this.coordinate(position.logical);
      if (x === null || x + layout.bounds.right <= 0 || x + layout.bounds.left >= this.chart.timeScale().width()) continue;
      for (const price of position.prices) { min = Math.min(min, price); max = Math.max(max, price); }
      const shift = label.yloc === "abovebar" ? -12 : label.yloc === "belowbar" ? 12 : 0;
      above = Math.max(above, -layout.bounds.top - shift); below = Math.max(below, layout.bounds.bottom + shift);
    }
    // Shading does not expand an established scale. A fill-only study can seed
    // a scale from its visible positive-area boundaries; main-chart owners disable this.
    if (min === Infinity && this.options.allowFillOnlyScale !== false && !this.options.hasScalePeer?.()) for (const plot of this.plots) for (const fill of plot.drawing!.lineFills ?? []) {
      const vertices = this.fillVertices(plot, fill, Number(range.from), Number(range.to), false);
      if (vertices) for (const point of vertices) { min = Math.min(min, point.y); max = Math.max(max, point.y); }
    }
    if (above || below) {
      const height = this.chart.paneSize().height, scale = this.series.priceScale().options();
      const available = height * (1 - scale.scaleMargins.top - scale.scaleMargins.bottom);
      // Oversized text is pane-clipped, never allowed to invert the chart's drawable height.
      const budget = Math.max(0, Math.min(height * 0.2, (available - 16) / 2)), total = above + below;
      if (total > budget) { above *= budget / total; below *= budget / total; }
      if (scale.invertScale) [above, below] = [below, above];
    }
    return min === Infinity ? null : { priceRange: { minValue: min, maxValue: max }, ...(above || below ? { margins: { above, below } } : {}) };
  }
  private draw(target: Target, behind: boolean) {
    if (!this.chart || !this.series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = mediaSize.width, height = mediaSize.height;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
      for (const plot of this.plots) {
        for (const fill of plot.drawing!.lineFills ?? []) {
          const refs = this.lineReferences.get(plot);
          const forced = refs?.get(fill.line1)?.forceOverlay === true || refs?.get(fill.line2)?.forceOverlay === true;
          if (drawingBehind(plot, { forceOverlay: forced }) !== behind) continue;
          const vertices = this.fillVertices(plot, fill, 0, width, true);
          if (!vertices) continue;
          // Split crossing lobes before clipping so translucent regions never double-paint.
          for (const lobe of fillLobes(vertices)) {
            const polygon = clipFillPolygon(lobe, width, height);
            if (polygon.length < 3) continue;
            let area = 0;
            for (let i = 0; i < polygon.length; i++) { const a = polygon[i], b = polygon[(i + 1) % polygon.length]; area += a.x * b.y - b.x * a.y; }
            if (area === 0) continue;
            ctx.fillStyle = fill.color!; ctx.beginPath(); ctx.moveTo(polygon[0].x, polygon[0].y);
            for (const point of polygon.slice(1)) ctx.lineTo(point.x, point.y);
            ctx.closePath(); ctx.fill();
          }
        }
      }
      for (const plot of this.plots) {
        for (const line of plot.drawing!.lines) {
          if (drawingBehind(plot, line) !== behind || !visible(line)) continue;
          const l1 = this.logical(plot, line, line.x1!), l2 = this.logical(plot, line, line.x2!);
          if (l1 === null || l2 === null) continue;
          const x1 = this.coordinate(l1), x2 = this.coordinate(l2);
          const y1 = this.series!.priceToCoordinate(line.y1!), y2 = this.series!.priceToCoordinate(line.y2!);
          if (x1 === null || x2 === null || y1 === null || y2 === null || ![x1, x2, y1, y2].every(Number.isFinite)) continue;
          const dx = x2 - x1, dy = y2 - y1;
          if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx === 0 && dy === 0) continue;
          const [start, end] = interval(line, dx), pad = line.width / 2 + 1;
          const horizontal = restrict(start, end, x1, dx, -pad, width + pad);
          const clipped = horizontal && restrict(horizontal[0], horizontal[1], y1, dy, -pad, height + pad);
          if (!clipped || !clipped.every(Number.isFinite)) continue;
          const at = (t: number): Point => ({ x: x1 + dx * t, y: y1 + dy * t });
          const a = at(clipped[0]), b = at(clipped[1]);
          if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
          ctx.save(); ctx.strokeStyle = line.color!; ctx.lineWidth = line.width;
          ctx.lineCap = line.style === "dotted" ? "round" : "butt";
          ctx.setLineDash(line.style === "dashed" ? [6 * line.width, 4 * line.width] : line.style === "dotted" ? [0, 2 * line.width] : []);
          const period = (line.style === "dashed" ? 10 : 2) * line.width;
          const phase = Math.hypot(dx, dy) * clipped[0];
          ctx.lineDashOffset = Number.isFinite(phase) ? -(phase % period) : 0;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.setLineDash([]);
          const arrow = (tip: Point, direction: number) => {
            const length = Math.hypot(dx, dy), size = Math.max(6, line.width * 3);
            const ux = dx / length * direction, uy = dy / length * direction;
            ctx.beginPath(); ctx.moveTo(tip.x - ux * size - uy * size / 2, tip.y - uy * size + ux * size / 2);
            ctx.lineTo(tip.x, tip.y); ctx.lineTo(tip.x - ux * size + uy * size / 2, tip.y - uy * size - ux * size / 2); ctx.stroke();
          };
          if (line.style === "arrow_left" || line.style === "arrow_both") {
            if (line.extend !== "none" || clipped[0] === 0) arrow(a, -1);
          }
          if (line.style === "arrow_right" || line.style === "arrow_both") {
            if (line.extend !== "none" || clipped[1] === 1) arrow(b, 1);
          }
          ctx.restore();
        }
      }
      for (const plot of this.plots) {
        for (const box of plot.drawing!.boxes ?? []) if (drawingBehind(plot, box) === behind) this.drawBox(plot, box, ctx, width, height);
      }
      // Polyline layer placement is local; the public TradingView z-index list omits it.
      for (const plot of this.plots) for (const polyline of plot.drawing!.polylines ?? []) {
        if (drawingBehind(plot, polyline) === behind) this.drawPolyline(plot, polyline, ctx, width, height);
      }
      for (const plot of this.plots) {
        for (const label of plot.drawing!.labels ?? []) {
          if (drawingBehind(plot, label) !== behind) continue;
          const layout = this.labelLayout(label), position = this.labelAnchor(plot, label);
          if (!layout || !position || position.x + layout.bounds.right <= 0 || position.x + layout.bounds.left >= width
            || position.y + layout.bounds.bottom <= 0 || position.y + layout.bounds.top >= height) continue;
          paintPineLabel(label, layout, ctx, position.x, position.y, width, height);
        }
      }
      ctx.restore();
    });
  }
}
