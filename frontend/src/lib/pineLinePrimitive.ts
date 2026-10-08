import type { AutoscaleInfo, IChartApi, ISeriesApi, ISeriesPrimitive, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, Logical, SeriesAttachedParameter, SeriesType, UTCTimestamp } from "lightweight-charts";
import type { PineChartPlot } from "./pineChartAdapter";
import type { PineLineDrawing } from "./pineProtocol";
import { pineGradientColor } from "./pineVisualPrimitive";
type Target = Parameters<ISeriesPrimitivePaneRenderer["draw"]>[0];
type Point = { x: number; y: number };

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

/** Final active line objects: no synthetic candles, historical copies or per-line chart series. */
export class PineLinePrimitive implements ISeriesPrimitive {
  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType>;
  private requestUpdate?: () => void;
  private readonly onRange = () => this.requestUpdate?.();
  private readonly views: readonly ISeriesPrimitivePaneView[];
  constructor(private plots: readonly PineChartPlot[]) {
    this.views = [{ zOrder: () => "normal", renderer: () => ({ drawBackground: target => this.draw(target, true), draw: target => this.draw(target, false) }) }];
  }
  attached({ chart, series, requestUpdate }: SeriesAttachedParameter) {
    this.chart = chart; this.series = series; this.requestUpdate = requestUpdate;
    chart.timeScale().subscribeVisibleTimeRangeChange(this.onRange); requestUpdate();
  }
  detached() {
    this.chart?.timeScale().unsubscribeVisibleTimeRangeChange(this.onRange);
    this.chart = undefined; this.series = undefined; this.requestUpdate = undefined; this.plots = [];
  }
  updateAllViews() { /* Read current chart transforms on every render, including price zoom. */ }
  paneViews() { return this.views; }
  autoscaleInfo(_from: Logical, _to: Logical) { return this.rangeForVisible(); }
  private logical(plot: PineChartPlot, line: PineLineDrawing, value: number): number | null {
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
  rangeForVisible(): AutoscaleInfo | null {
    if (!this.chart || !this.series) return null;
    const range = this.chart.timeScale().getVisibleLogicalRange();
    if (!range) return null;
    let min = Infinity, max = -Infinity;
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
        const roundtrip = (coordinate: number | null, value: number) => {
          if (coordinate === null || !Number.isFinite(coordinate)) return false;
          const price = this.series!.coordinateToPrice(coordinate as Parameters<ISeriesApi<SeriesType>["coordinateToPrice"]>[0]);
          return price !== null && Number.isFinite(price) && Math.abs(price - value) <= Math.abs(value) * 1e-8;
        };
        // LWC's empty transform can return zero rather than null. Only a valid
        // round trip may drive log/inverted interpolation; numeric slope seeds it.
        const transformed = roundtrip(a, line.y1!) && roundtrip(b, line.y2!);
        values = clipped.map(t => {
          const price = !transformed ? null : this.series!.coordinateToPrice((a! + (b! - a!) * t) as Parameters<ISeriesApi<SeriesType>["coordinateToPrice"]>[0]);
          return price ?? line.y1! + (line.y2! - line.y1!) * t;
        });
      }
      for (const value of values) if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
    }
    return min === Infinity ? null : { priceRange: { minValue: min, maxValue: max } };
  }
  private draw(target: Target, behind: boolean) {
    if (!this.chart || !this.series) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = mediaSize.width, height = mediaSize.height;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
      for (const plot of this.plots) {
        if ((plot.behindChart !== false) !== behind) continue;
        for (const line of plot.drawing!.lines) {
          if (!visible(line)) continue;
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
      ctx.restore();
    });
  }
}
