export type ChartPaneLayoutId =
  | "single"
  | "vertical-2"
  | "horizontal-2"
  | "grid-4";

export type ChartPaneLayoutDefinition = {
  className: string;
  id: ChartPaneLayoutId;
  label: string;
  panes: number;
};

export const CHART_PANE_LAYOUTS: ChartPaneLayoutDefinition[] = [
  { className: "chart-pane-layout-single", id: "single", label: "1 chart", panes: 1 },
  { className: "chart-pane-layout-vertical-2", id: "vertical-2", label: "2 columns", panes: 2 },
  { className: "chart-pane-layout-horizontal-2", id: "horizontal-2", label: "2 rows", panes: 2 },
  { className: "chart-pane-layout-grid-4", id: "grid-4", label: "4 grid", panes: 4 },
];

export const DEFAULT_CHART_PANE_LAYOUT: ChartPaneLayoutId = "single";

export function chartPaneLayoutById(value: string | null | undefined) {
  return CHART_PANE_LAYOUTS.find((layout) => layout.id === value) ?? CHART_PANE_LAYOUTS[0];
}

export function sanitizeChartPaneLayout(value: unknown): ChartPaneLayoutId {
  return chartPaneLayoutById(typeof value === "string" ? value : null).id;
}
