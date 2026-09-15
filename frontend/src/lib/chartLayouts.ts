export type ChartPaneLayoutId =
  | "single"
  | "vertical-2"
  | "horizontal-2"
  | "grid-4"
  | "grid-6"
  | "grid-9"
  | "grid-12"
  | "grid-16";

export type ChartPaneLayoutDefinition = {
  className: string;
  columns: number;
  id: ChartPaneLayoutId;
  label: string;
  panes: number;
  rows: number;
};

export const CHART_PANE_LAYOUTS: ChartPaneLayoutDefinition[] = [
  {
    className: "chart-pane-layout-single",
    columns: 1,
    id: "single",
    label: "1 chart",
    panes: 1,
    rows: 1,
  },
  {
    className: "chart-pane-layout-vertical-2",
    columns: 2,
    id: "vertical-2",
    label: "2 columns",
    panes: 2,
    rows: 1,
  },
  {
    className: "chart-pane-layout-horizontal-2",
    columns: 1,
    id: "horizontal-2",
    label: "2 rows",
    panes: 2,
    rows: 2,
  },
  {
    className: "chart-pane-layout-grid-4",
    columns: 2,
    id: "grid-4",
    label: "2 × 2 grid · 4 charts",
    panes: 4,
    rows: 2,
  },
  {
    className: "chart-pane-layout-grid-6",
    columns: 3,
    id: "grid-6",
    label: "3 × 2 grid · 6 charts",
    panes: 6,
    rows: 2,
  },
  {
    className: "chart-pane-layout-grid-9",
    columns: 3,
    id: "grid-9",
    label: "3 × 3 grid · 9 charts",
    panes: 9,
    rows: 3,
  },
  {
    className: "chart-pane-layout-grid-12",
    columns: 4,
    id: "grid-12",
    label: "4 × 3 grid · 12 charts",
    panes: 12,
    rows: 3,
  },
  {
    className: "chart-pane-layout-grid-16",
    columns: 4,
    id: "grid-16",
    label: "4 × 4 grid · 16 charts",
    panes: 16,
    rows: 4,
  },
];

export const DEFAULT_CHART_PANE_LAYOUT: ChartPaneLayoutId = "single";

export function chartPaneLayoutById(value: string | null | undefined) {
  return CHART_PANE_LAYOUTS.find((layout) => layout.id === value) ?? CHART_PANE_LAYOUTS[0];
}

export function shouldMountPaneDrawingControls(
  paneCount: number,
  paneActive: boolean,
) {
  return paneCount < 9 || paneActive;
}

export function sanitizeChartPaneLayout(value: unknown): ChartPaneLayoutId {
  return chartPaneLayoutById(typeof value === "string" ? value : null).id;
}
