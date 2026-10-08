/** Local uniform Catmull–Rom splines; TradingView does not publish its curve algorithm. */
export type PolylinePoint = { x: number; y: number };
export type PolylineSegment = { a: PolylinePoint; b: PolylinePoint; c1?: PolylinePoint; c2?: PolylinePoint };
export type PolylineRun = { points: PolylinePoint[]; segments: PolylineSegment[]; closed: boolean };
const mix = (a: number, b: number, t: number) => {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale ? (a / scale * (1 - t) + b / scale * t) * scale : 0;
};
// Compute p + (next - previous)/6 without overflowing next-previous prematurely.
function tangent(p: PolylinePoint, previous: PolylinePoint, next: PolylinePoint, sign: number): PolylinePoint {
  const coordinate = (key: "x" | "y") => {
    const scale = Math.max(Math.abs(p[key]), Math.abs(previous[key]), Math.abs(next[key]));
    return scale ? (p[key] / scale + sign * (next[key] / scale - previous[key] / scale) / 6) * scale : 0;
  };
  return { x: coordinate("x"), y: coordinate("y") };
}
export function polylineRuns(points: readonly (PolylinePoint | null)[], curved: boolean, closed: boolean): PolylineRun[] {
  const runs: PolylineRun[] = []; let run: PolylinePoint[] = [];
  const finish = () => { if (run.length > 1) runs.push({ points: run, segments: [], closed: false }); run = []; };
  for (const point of points) { if (point) run.push(point); else finish(); } finish();
  const complete = runs.length === 1 && runs[0].points.length === points.length;
  for (const run of runs) {
    run.closed = closed && complete;
    const n = run.points.length, count = n - 1 + Number(run.closed);
    for (let i = 0; i < count; i++) {
      const a = run.points[i % n], b = run.points[(i + 1) % n];
      const previous = run.points[run.closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const next = run.points[run.closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      const c1 = curved ? tangent(a, previous, b, 1) : undefined, c2 = curved ? tangent(b, a, next, -1) : undefined;
      if (![a, b, ...(c1 && c2 ? [c1, c2] : [])].every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) {
        // Unrepresentable controls never splice surviving edges into a different shape.
        run.segments = []; break;
      }
      run.segments.push({ a, b, ...(c1 && c2 ? { c1, c2 } : {}) });
    }
  }
  return runs;
}
export function polylineAt(segment: PolylineSegment, t: number): PolylinePoint {
  const at = (key: "x" | "y") => {
    if (!segment.c1 || !segment.c2) return mix(segment.a[key], segment.b[key], t);
    const a = mix(segment.a[key], segment.c1[key], t), b = mix(segment.c1[key], segment.c2[key], t), c = mix(segment.c2[key], segment.b[key], t);
    return mix(mix(a, b, t), mix(b, c, t), t);
  };
  return { x: at("x"), y: at("y") };
}
function extrema(segment: PolylineSegment, key: "x" | "y"): number[] {
  if (!segment.c1 || !segment.c2) return [];
  const values = [segment.a[key], segment.c1[key], segment.c2[key], segment.b[key]], scale = Math.max(...values.map(Math.abs));
  if (!scale) return [];
  const [p0, p1, p2, p3] = values.map(v => v / scale);
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  let roots: number[] = [];
  if (Math.abs(a) < 1e-14) { if (Math.abs(b) >= 1e-14) roots = [-c / b]; }
  else {
    const d = b * b - 4 * a * c;
    if (d >= 0) { const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(d)) / 2; roots = q ? [q / a, c / q] : [-b / (2 * a)]; }
  }
  return roots.filter(t => t > 0 && t < 1 && Number.isFinite(t));
}
function crossings(segment: PolylineSegment, x: number): number[] {
  if (!segment.c1 || !segment.c2) {
    const a = segment.a.x, b = segment.b.x;
    if (a === b || x < Math.min(a, b) || x > Math.max(a, b)) return [];
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(x));
    return [(x / scale - a / scale) / (b / scale - a / scale)];
  }
  const cuts = [0, ...extrema(segment, "x").sort((a, b) => a - b), 1], roots: number[] = [];
  for (let i = 1; i < cuts.length; i++) {
    let left = cuts[i - 1], right = cuts[i], a = polylineAt(segment, left).x, b = polylineAt(segment, right).x;
    if (x < Math.min(a, b) || x > Math.max(a, b)) continue;
    if (a === x) roots.push(left); if (b === x) roots.push(right);
    if (a === b || a === x || b === x) continue;
    for (let step = 0; step < 48; step++) {
      const mid = (left + right) / 2, value = polylineAt(segment, mid).x;
      if ((value < x) === (a < b)) left = mid; else right = mid;
    }
    roots.push((left + right) / 2);
  }
  return roots;
}
/** Exact cubic extrema restricted to the visible horizontal domain, including loops. */
export function visiblePolylineY(segments: readonly PolylineSegment[], from: number, to: number): number[] {
  const values: number[] = [];
  for (const segment of segments) {
    const hull = [segment.a.x, segment.b.x, ...(segment.c1 && segment.c2 ? [segment.c1.x, segment.c2.x] : [])];
    if (Math.max(...hull) < from || Math.min(...hull) > to) continue;
    const cuts = [...new Set([0, ...crossings(segment, from), ...crossings(segment, to), 1])].sort((a, b) => a - b), critical = extrema(segment, "y");
    for (let i = 1; i < cuts.length; i++) {
      const left = cuts[i - 1], right = cuts[i], x = polylineAt(segment, (left + right) / 2).x;
      if (x < from || x > to) continue;
      for (const t of [left, right, ...critical.filter(t => t > left && t < right)]) { const y = polylineAt(segment, t).y; if (Number.isFinite(y)) values.push(y); }
    }
  }
  return values;
}
export function polylineHasArea(points: readonly PolylinePoint[]): boolean {
  const a = points[0]; if (!a) return false;
  const b = points.find(p => p.x !== a.x || p.y !== a.y); if (!b) return false;
  const scale = Math.max(...[a, b].flatMap(p => [Math.abs(p.x), Math.abs(p.y)]), 1);
  return points.some(p => {
    const magnitude = Math.max(scale, Math.abs(p.x), Math.abs(p.y)), ax = a.x / magnitude, ay = a.y / magnitude;
    return (b.x / magnitude - ax) * (p.y / magnitude - ay) !== (b.y / magnitude - ay) * (p.x / magnitude - ax);
  });
}
export function tracePolyline(ctx: CanvasRenderingContext2D, run: PolylineRun): void {
  if (!run.segments.length) return;
  ctx.moveTo(run.segments[0].a.x, run.segments[0].a.y);
  for (const segment of run.segments) {
    if (segment.c1 && segment.c2) ctx.bezierCurveTo(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.b.x, segment.b.y);
    else ctx.lineTo(segment.b.x, segment.b.y);
  }
  if (run.closed) ctx.closePath();
}
