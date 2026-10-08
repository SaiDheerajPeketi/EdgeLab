import type { PineLabelDrawing } from "./pineProtocol";
import { pineGradientColor } from "./pineVisualPrimitive";
type Point = { x: number; y: number };
type Bounds = { left: number; right: number; top: number; bottom: number };
export type PineLabelLayout = {
  bounds: Bounds; body?: Bounds; polygon?: Point[]; ellipse?: boolean;
  font: string; size: number; lines: string[]; textX: number; textY: number; textBounds?: Bounds;
  fillText: boolean; outlineText: boolean; rows: (Bounds | null)[]; rowTop: number; rowBottom: number;
};
const ink = (color: string | null) => (pineGradientColor(color)?.[3] ?? 0) > 0;
/** Local canvas geometry; coordinates and lifecycle follow the native label object. */
export function pineLabelLayout(label: PineLabelDrawing, ctx: CanvasRenderingContext2D): PineLabelLayout | null {
  const size = label.textSize || 12, lineHeight = size * 1.2;
  const font = `${label.textFormatting.includes("italic") ? "italic " : ""}${label.textFormatting.includes("bold") ? "bold " : ""}${size}px ${label.textFontFamily === "monospace" ? "monospace" : "system-ui, sans-serif"}`;
  ctx.font = font; ctx.textAlign = label.textAlign; ctx.textBaseline = "top";
  const lines = label.text.split("\n"), fillText = label.text.trim().length > 0 && ink(label.textColor);
  const outlineText = label.style === "text_outline" && label.text.trim().length > 0 && ink(label.color);
  const shape = label.style !== "none" && label.style !== "text_outline" && ink(label.color);
  if (!shape && !fillText && !outlineText) return null;
  const metrics = lines.map(line => ctx.measureText(line));
  const advance = Math.max(0, ...metrics.map(value => value.width)), pad = Math.max(3, size * 0.3), tail = Math.max(5, size * 0.5);
  let w = Math.max(size, advance + pad * 2), h = Math.max(size, lines.length * lineHeight + pad * 2);
  let left = -w / 2, top = -h / 2, body: Bounds | undefined, polygon: Point[] | undefined, ellipse = false;
  const style = label.style;
  if (style.startsWith("label_")) {
    if (style === "label_down") top = -tail - h;
    else if (style === "label_up") top = tail;
    else if (style === "label_left") left = tail;
    else if (style === "label_right") left = -tail - w;
    else if (style === "label_lower_left") { left = tail; top = -tail - h; }
    else if (style === "label_lower_right") { left = -tail - w; top = -tail - h; }
    else if (style === "label_upper_left") { left = tail; top = tail; }
    else if (style === "label_upper_right") { left = -tail - w; top = tail; }
    body = { left, top, right: left + w, bottom: top + h };
    const { right, bottom } = body;
    if (style === "label_down") polygon = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: tail, y: bottom }, { x: 0, y: 0 }, { x: -tail, y: bottom }, { x: left, y: bottom }];
    else if (style === "label_up") polygon = [{ x: left, y: top }, { x: -tail, y: top }, { x: 0, y: 0 }, { x: tail, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
    else if (style === "label_left") polygon = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: tail }, { x: 0, y: 0 }, { x: left, y: -tail }];
    else if (style === "label_right") polygon = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: -tail }, { x: 0, y: 0 }, { x: right, y: tail }, { x: right, y: bottom }, { x: left, y: bottom }];
    else if (style === "label_lower_left") polygon = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left + tail, y: bottom }, { x: 0, y: 0 }, { x: left, y: bottom - tail }];
    else if (style === "label_lower_right") polygon = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom - tail }, { x: 0, y: 0 }, { x: right - tail, y: bottom }, { x: left, y: bottom }];
    else if (style === "label_upper_left") polygon = [{ x: 0, y: 0 }, { x: left + tail, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }, { x: left, y: top + tail }];
    else if (style === "label_upper_right") polygon = [{ x: left, y: top }, { x: right - tail, y: top }, { x: 0, y: 0 }, { x: right, y: top + tail }, { x: right, y: bottom }, { x: left, y: bottom }];
    else polygon = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  } else if (style === "circle" || style === "square" || style === "diamond") {
    const width = style === "square" ? Math.max(w, h) : w, height = style === "square" ? width : h;
    w = width; h = height; left = -width / 2; top = -height / 2;
    body = { left, top, right: -left, bottom: -top }; ellipse = style === "circle";
    polygon = style === "diamond" ? [{ x: 0, y: top }, { x: -left, y: 0 }, { x: 0, y: -top }, { x: left, y: 0 }]
      : [{ x: left, y: top }, { x: -left, y: top }, { x: -left, y: -top }, { x: left, y: -top }];
  } else if (style === "flag") {
    left = 0; top = -h;
    body = { left, top, right: w, bottom: 0 };
    polygon = [{ x: 0, y: 0 }, { x: 0, y: top }, { x: w, y: top }, { x: w - tail, y: top + h / 2 }, { x: tail / 3, y: top + h / 2 }, { x: tail / 3, y: 0 }];
  } else if (style !== "none" && style !== "text_outline") {
    const r = Math.max(5, size * 0.65), t = r / 3;
    if (style === "cross" || style === "xcross") {
      polygon = [{ x: -t, y: -r }, { x: t, y: -r }, { x: t, y: -t }, { x: r, y: -t }, { x: r, y: t }, { x: t, y: t }, { x: t, y: r }, { x: -t, y: r }, { x: -t, y: t }, { x: -r, y: t }, { x: -r, y: -t }, { x: -t, y: -t }];
      if (style === "xcross") polygon = polygon.map(p => ({ x: (p.x - p.y) / Math.SQRT2, y: (p.x + p.y) / Math.SQRT2 }));
    } else {
      const up = style === "triangleup" || style === "arrowup";
      const direction = up ? -1 : 1;
      polygon = style.startsWith("triangle") ? [{ x: 0, y: r * direction }, { x: r, y: -r * direction }, { x: -r, y: -r * direction }]
        : [{ x: 0, y: -r * 1.5 }, { x: r, y: 0 }, { x: t, y: 0 }, { x: t, y: r * 1.5 }, { x: -t, y: r * 1.5 }, { x: -t, y: 0 }, { x: -r, y: 0 }].map(p => ({ x: p.x, y: up ? p.y : -p.y }));
    }
    body = { left: Math.min(...polygon.map(p => p.x)), right: Math.max(...polygon.map(p => p.x)), top: Math.min(...polygon.map(p => p.y)), bottom: Math.max(...polygon.map(p => p.y)) };
    left = -w / 2; top = body.bottom + pad;
  }
  const textX = label.textAlign === "left" ? left + pad : label.textAlign === "right" ? left + w - pad : left + w / 2;
  const textY = top + pad;
  let textBounds: Bounds | undefined;
  const stroke = outlineText ? 1 : 0;
  const rows = metrics.map((m, i) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight > 0 ? { left: textX - m.actualBoundingBoxLeft - stroke, right: textX + m.actualBoundingBoxRight + stroke,
    top: textY + i * lineHeight - m.actualBoundingBoxAscent - stroke, bottom: textY + i * lineHeight + m.actualBoundingBoxDescent + stroke } : null);
  const rowTop = Math.min(0, ...metrics.map(m => -m.actualBoundingBoxAscent - stroke)), rowBottom = Math.max(0, ...metrics.map(m => m.actualBoundingBoxDescent + stroke));
  if (fillText || outlineText) {
    const painted = rows.filter((b): b is Bounds => b !== null && b.left < b.right && b.top < b.bottom);
    if (painted.length) {
      textBounds = { left: Math.min(...painted.map(b => b.left)), right: Math.max(...painted.map(b => b.right)),
        top: Math.min(...painted.map(b => b.top)), bottom: Math.max(...painted.map(b => b.bottom)) };
    }
  }
  const bounds = [...(shape && body ? [body] : []), ...(textBounds ? [textBounds] : []),
    ...(shape && polygon ? [{ left: Math.min(...polygon.map(p => p.x)), right: Math.max(...polygon.map(p => p.x)), top: Math.min(...polygon.map(p => p.y)), bottom: Math.max(...polygon.map(p => p.y)) }] : [])];
  if (!bounds.length) return null;
  return { bounds: { left: Math.min(...bounds.map(b => b.left)), right: Math.max(...bounds.map(b => b.right)), top: Math.min(...bounds.map(b => b.top)), bottom: Math.max(...bounds.map(b => b.bottom)) },
    ...(shape ? { body, polygon, ellipse } : {}), font, size, lines, textX, textY, textBounds, fillText, outlineText, rows, rowTop, rowBottom };
}
export function paintPineLabel(label: PineLabelDrawing, layout: PineLabelLayout, ctx: CanvasRenderingContext2D, x: number, y: number, width = Infinity, height = Infinity) {
  ctx.save(); ctx.translate(x, y); ctx.setLineDash([]); ctx.lineWidth = 2;
  if (layout.body && layout.polygon) {
    ctx.fillStyle = label.color!; ctx.beginPath();
    if (layout.ellipse) {
      const b = layout.body; ctx.ellipse((b.left + b.right) / 2, (b.top + b.bottom) / 2, (b.right - b.left) / 2, (b.bottom - b.top) / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.moveTo(layout.polygon[0].x, layout.polygon[0].y);
      for (const point of layout.polygon.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.font = layout.font; ctx.textAlign = label.textAlign; ctx.textBaseline = "top"; ctx.lineJoin = "round";
  const lineHeight = layout.size * 1.2;
  const from = Math.max(0, Math.ceil((-y - layout.textY - layout.rowBottom) / lineHeight));
  const to = Math.min(layout.lines.length - 1, Math.floor((height - y - layout.textY - layout.rowTop) / lineHeight));
  for (let i = from; i <= to; i++) {
    const row = layout.rows[i];
    if (!row || row.right + x <= 0 || row.left + x >= width || row.bottom + y <= 0 || row.top + y >= height) continue;
    const baseline = layout.textY + i * layout.size * 1.2;
    if (layout.outlineText) { ctx.strokeStyle = label.color!; ctx.strokeText(layout.lines[i], layout.textX, baseline); }
    if (layout.fillText) { ctx.fillStyle = label.textColor!; ctx.fillText(layout.lines[i], layout.textX, baseline); }
  }
  ctx.restore();
}
export function hitPineLabel(layout: PineLabelLayout, x: number, y: number): boolean {
  const inBounds = (b: Bounds) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  if (layout.textBounds && inBounds(layout.textBounds)) {
    const lineHeight = layout.size * 1.2;
    const from = Math.max(0, Math.ceil((y - layout.textY - layout.rowBottom) / lineHeight));
    const to = Math.min(layout.rows.length - 1, Math.floor((y - layout.textY - layout.rowTop) / lineHeight));
    for (let i = from; i <= to; i++) if (layout.rows[i] && inBounds(layout.rows[i]!)) return true;
  }
  if (!layout.body || !layout.polygon || !inBounds(layout.bounds)) return false;
  if (layout.ellipse) {
    const b = layout.body, rx = (b.right - b.left) / 2, ry = (b.bottom - b.top) / 2;
    return ((x - (b.left + b.right) / 2) / rx) ** 2 + ((y - (b.top + b.bottom) / 2) / ry) ** 2 <= 1;
  }
  let inside = false;
  for (let i = 0, j = layout.polygon.length - 1; i < layout.polygon.length; j = i++) {
    const a = layout.polygon[i], b = layout.polygon[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
