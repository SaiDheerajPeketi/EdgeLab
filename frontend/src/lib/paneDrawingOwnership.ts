import type { ChartDrawing } from "./charting";

type PaneDrawings = { drawings: ChartDrawing[]; drawingMarket?: string; drawingsByMarket: Record<string, ChartDrawing[]> };

/** A pane retains each market's drawings without showing another market's prices. */
export function ownPaneDrawings<T extends PaneDrawings>(pane: T, market: string): T {
  if (pane.drawingMarket === market) return pane;
  // Legacy layouts already associate their drawings with the saved pane symbol.
  if (!pane.drawingMarket) return { ...pane, drawingMarket: market };
  const drawingsByMarket = { ...pane.drawingsByMarket, [pane.drawingMarket]: pane.drawings };
  return { ...pane, drawingMarket: market, drawingsByMarket, drawings: drawingsByMarket[market] ?? [] };
}
