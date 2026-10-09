import type { IChartApi, ISeriesPrimitive, SeriesAttachedParameter } from "lightweight-charts";
import type { PineTableCell, PineTableDrawing } from "./pineProtocol";
import { acquireTooltipContainer, releaseTooltipContainer } from "./pineLinePrimitive";
import { pineGradientColor } from "./pineVisualPrimitive";

type CellLayout = { column: number; row: number; endColumn: number; endRow: number; cell: PineTableCell; x: number; y: number; width: number; height: number };
type MeasureText = (text: string, cell: PineTableCell) => { width: number; height: number };
export type PineTableLayout = { width: number; height: number; cells: CellLayout[] };
const fontSize = (cell: PineTableCell) => (cell.textSize || 14) * 96 / 72;
function font(cell: PineTableCell) {
  const italic = cell.textFormatting.includes("italic") ? "italic " : "";
  const bold = cell.textFormatting.includes("bold") ? "bold " : "";
  return `${italic}${bold}${fontSize(cell)}px ${cell.textFontFamily === "monospace" ? "monospace" : "Arial, sans-serif"}`;
}
function shade(value: string | null) {
  const color = pineGradientColor(value);
  return color ? `rgba(${color[0]},${color[1]},${color[2]},${color[3]})` : "transparent";
}

/** Rows/columns share their largest authored cell; sparse unpopulated axes collapse. */
export function layoutPineTable(table: PineTableDrawing, pane: { width: number; height: number }, measure: MeasureText): PineTableLayout {
  const widths = Array<number>(table.columns).fill(0), heights = Array<number>(table.rows).fill(0);
  const mergeAt = new Map<number, PineTableDrawing["merges"][number]>();
  for (const merge of table.merges) for (let row = merge.startRow; row <= merge.endRow; row++) for (let column = merge.startCol; column <= merge.endCol; column++) mergeAt.set(row * table.columns + column, merge);
  const cells: CellLayout[] = [];
  for (let row = 0; row < table.rows; row++) for (let column = 0; column < table.columns; column++) {
    const cell = table.cells[row][column], merge = mergeAt.get(row * table.columns + column);
    if (!cell?.populated || merge && (merge.startCol !== column || merge.startRow !== row)) continue;
    const endColumn = merge?.endCol ?? column, endRow = merge?.endRow ?? row;
    cells.push({ column, row, endColumn, endRow, cell, x: 0, y: 0, width: 0, height: 0 });
    if (!merge || endColumn === column && endRow === row) {
      const auto = cell.width === 0 || cell.height === 0 ? measure(cell.text, cell) : { width: 0, height: 0 };
      widths[column] = Math.max(widths[column], cell.width > 0 ? pane.width * cell.width / 100 : auto.width + 8);
      heights[row] = Math.max(heights[row], cell.height > 0 ? pane.height * cell.height / 100 : auto.height + 8);
    }
  }
  const neighborWidths = [...widths], neighborHeights = [...heights];
  // A merge's size is determined by its neighbors. With no populated neighbors,
  // distribute its auto text size across empty axes so a merge-only table is visible.
  for (const entry of cells) if (entry.endColumn !== entry.column || entry.endRow !== entry.row) {
    const auto = measure(entry.cell.text, entry.cell);
    if (!neighborWidths.slice(entry.column, entry.endColumn + 1).some(Boolean)) for (let column = entry.column; column <= entry.endColumn; column++) widths[column] = Math.max(widths[column], (auto.width + 8) / (entry.endColumn - entry.column + 1));
    if (!neighborHeights.slice(entry.row, entry.endRow + 1).some(Boolean)) for (let row = entry.row; row <= entry.endRow; row++) heights[row] = Math.max(heights[row], (auto.height + 8) / (entry.endRow - entry.row + 1));
  }
  const x = [0], y = [0];
  for (const width of widths) x.push(x.at(-1)! + width);
  for (const height of heights) y.push(y.at(-1)! + height);
  for (const entry of cells) Object.assign(entry, { x: x[entry.column], y: y[entry.row], width: x[entry.endColumn + 1] - x[entry.column], height: y[entry.endRow + 1] - y[entry.row] });
  return { width: x.at(-1)!, height: y.at(-1)!, cells };
}

/** Viewport-only drawings own no time/price coordinates or autoscale data. */
export class PineTablePrimitive implements ISeriesPrimitive {
  private chart?: IChartApi;
  private layer?: HTMLDivElement;
  private observer?: ResizeObserver;
  private context?: CanvasRenderingContext2D | null;
  private geometry = "";
  private tooltip?: HTMLDivElement;
  private hits: { x: number; y: number; width: number; height: number; text: string }[] = [];
  private readonly hideTooltip = () => { if (this.tooltip) this.tooltip.hidden = true; };
  private readonly onPointer = (event: PointerEvent) => {
    if (!this.chart || event.pointerType === "touch") { this.hideTooltip(); return; }
    const rect = this.chart.chartElement().getBoundingClientRect(), pane = this.chart.paneSize();
    const leftAxis = this.chart.priceScale("left").width(), x = event.clientX - rect.left - leftAxis, y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x >= pane.width || y >= pane.height) { this.hideTooltip(); return; }
    let hit: (typeof this.hits)[number] | undefined;
    for (let index = this.hits.length - 1; index >= 0; index--) {
      const candidate = this.hits[index];
      if (x >= candidate.x && y >= candidate.y && x < candidate.x + candidate.width && y < candidate.y + candidate.height) { hit = candidate; break; }
    }
    if (!hit?.text) { this.hideTooltip(); return; }
    if (!this.tooltip) {
      const tooltip = document.createElement("div"); tooltip.setAttribute("role", "tooltip"); tooltip.dataset.pineTableTooltip = "";
      Object.assign(tooltip.style, { position: "absolute", pointerEvents: "none", zIndex: "50", maxWidth: "min(320px, 80%)", maxHeight: "80%",
        overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: "8px 10px", borderRadius: "6px",
        border: "1px solid var(--ui-border-strong, #3f4652)", background: "var(--ui-floating, #171c24)", color: "var(--text-primary, #f0f2f5)",
        font: "12px/1.4 system-ui, sans-serif", boxShadow: "0 4px 20px #0004" });
      this.chart.chartElement().append(tooltip); this.tooltip = tooltip;
    }
    this.tooltip.textContent = hit.text; this.tooltip.hidden = false;
    this.tooltip.style.left = `${leftAxis + Math.max(0, Math.min(x + 12, pane.width - this.tooltip.offsetWidth))}px`;
    this.tooltip.style.top = `${Math.max(0, Math.min(y + 12, pane.height - this.tooltip.offsetHeight))}px`;
  };
  constructor(private readonly tables: readonly PineTableDrawing[]) {}
  attached({ chart, requestUpdate }: SeriesAttachedParameter) {
    this.chart = chart;
    const root = chart.chartElement();
    acquireTooltipContainer(root);
    const layer = document.createElement("div");
    layer.className = "pine-tables-layer";
    Object.assign(layer.style, { position: "absolute", top: "0", overflow: "hidden", pointerEvents: "none", zIndex: "30", userSelect: "none" });
    root.append(layer); this.layer = layer;
    root.addEventListener("pointermove", this.onPointer, { passive: true, capture: true });
    root.addEventListener("pointerleave", this.hideTooltip);
    root.addEventListener("pointerdown", this.hideTooltip, { passive: true, capture: true });
    this.context = document.createElement("canvas").getContext("2d");
    this.observer = new ResizeObserver(() => this.updateAllViews()); this.observer.observe(root);
    document.fonts?.ready.then(() => { if (this.chart === chart) { this.geometry = ""; this.updateAllViews(); requestUpdate(); } });
    this.updateAllViews(); requestUpdate();
  }
  detached() {
    this.observer?.disconnect(); this.observer = undefined;
    this.layer?.remove(); this.layer = undefined;
    if (this.chart) {
      const root = this.chart.chartElement();
      root.removeEventListener("pointermove", this.onPointer, true); root.removeEventListener("pointerleave", this.hideTooltip);
      root.removeEventListener("pointerdown", this.hideTooltip, true); releaseTooltipContainer(root);
    }
    this.tooltip?.remove(); this.tooltip = undefined; this.hits = [];
    this.chart = undefined; this.context = undefined; this.geometry = "";
  }
  updateAllViews() {
    if (!this.chart || !this.layer) return;
    const pane = this.chart.paneSize(), leftAxis = this.chart.priceScale("left").width();
    const geometry = `${pane.width}:${pane.height}:${leftAxis}`;
    if (geometry === this.geometry) return;
    this.geometry = geometry;
    this.hideTooltip(); this.hits = [];
    Object.assign(this.layer.style, { left: `${leftAxis}px`, width: `${pane.width}px`, height: `${pane.height}px` });
    this.layer.replaceChildren();
    for (const table of this.tables) this.render(table, pane);
  }
  private measure: MeasureText = (text, cell) => {
    if (this.context) this.context.font = font(cell);
    const lines = text.split(/\r\n|\r|\n/);
    return { width: Math.max(...lines.map(line => this.context?.measureText(line).width ?? line.length * fontSize(cell) * 0.6)), height: lines.length * fontSize(cell) * 1.2 };
  };
  private render(table: PineTableDrawing, pane: { width: number; height: number }) {
    const layout = layoutPineTable(table, pane, this.measure);
    if (!layout.cells.length || layout.width <= 0 || layout.height <= 0) return;
    const element = document.createElement("div");
    element.setAttribute("role", "table"); element.setAttribute("aria-label", `Pine table ${table.position}`);
    element.setAttribute("aria-colcount", String(table.columns)); element.setAttribute("aria-rowcount", String(table.rows));
    element.dataset.pineTableId = table.id; element.dataset.pineTablePosition = table.position; element.dataset.pineTableOverlay = String(table.overlay);
    const [vertical, horizontal] = table.position.split("_");
    const x = horizontal === "left" ? 0 : horizontal === "right" ? pane.width : pane.width / 2;
    const y = vertical === "top" ? 0 : vertical === "bottom" ? pane.height : pane.height / 2;
    const frame = table.frameWidth;
    const originX = x - (horizontal === "left" ? 0 : (layout.width + frame * 2) * (horizontal === "right" ? 1 : 0.5)) + frame;
    const originY = y - (vertical === "top" ? 0 : (layout.height + frame * 2) * (vertical === "bottom" ? 1 : 0.5)) + frame;
    Object.assign(element.style, { position: "absolute", left: `${x}px`, top: `${y}px`, width: `${layout.width + frame * 2}px`, height: `${layout.height + frame * 2}px`,
      transform: `translate(${horizontal === "left" ? "0" : horizontal === "right" ? "-100%" : "-50%"},${vertical === "top" ? "0" : vertical === "bottom" ? "-100%" : "-50%"})`,
      boxSizing: "border-box", background: shade(table.bgcolor), border: `${frame}px solid ${shade(table.frameColor)}` });
    const rows = new Map<number, HTMLDivElement>();
    for (const entry of layout.cells) {
      let row = rows.get(entry.row);
      if (!row) { row = document.createElement("div"); row.setAttribute("role", "row"); row.setAttribute("aria-rowindex", String(entry.row + 1)); rows.set(entry.row, row); element.append(row); }
      const cell = entry.cell, view = document.createElement("div");
      view.setAttribute("role", "cell"); view.setAttribute("aria-colindex", String(entry.column + 1));
      view.setAttribute("aria-colspan", String(entry.endColumn - entry.column + 1)); view.setAttribute("aria-rowspan", String(entry.endRow - entry.row + 1));
      view.dataset.pineTableCell = `${entry.column},${entry.row}`;
      view.textContent = cell.text;
      if (cell.tooltip) view.title = cell.tooltip;
      this.hits.push({ x: originX + entry.x, y: originY + entry.y, width: entry.width, height: entry.height, text: cell.tooltip });
      Object.assign(view.style, { position: "absolute", left: `${entry.x}px`, top: `${entry.y}px`, width: `${entry.width}px`, height: `${entry.height}px`,
        boxSizing: "border-box", overflow: "hidden", whiteSpace: "pre", padding: "4px", display: "flex", flexDirection: "column",
        justifyContent: cell.textValign === "top" ? "flex-start" : cell.textValign === "bottom" ? "flex-end" : "center",
        textAlign: cell.textHalign, font: font(cell), lineHeight: "1.2", color: shade(cell.textColor), background: shade(cell.bgcolor),
        pointerEvents: "none",
        borderRight: entry.x + entry.width < layout.width ? `${table.borderWidth}px solid ${shade(table.borderColor)}` : "none",
        borderBottom: entry.y + entry.height < layout.height ? `${table.borderWidth}px solid ${shade(table.borderColor)}` : "none" });
      row.append(view);
    }
    this.layer!.append(element);
  }
}
