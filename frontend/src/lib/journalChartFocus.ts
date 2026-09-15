import type { JournalChartFocusRequest } from "../components/journal/JournalReviewDrawer";
import type { ChartDrawing } from "./charting";
import type { SyncedChartVisibleRange } from "./chartWorkspace";

const FOCUS_PREFIX = "journal-focus-";

export function journalFocusDrawings(request: JournalChartFocusRequest): ChartDrawing[] {
  return request.markers.flatMap((marker, index) => {
    const time = Math.floor(Date.parse(marker.time) / 1000);
    if (!Number.isFinite(time) || !Number.isFinite(marker.price) || marker.price <= 0) return [];
    return [{
      id: `${FOCUS_PREFIX}${request.tradeId}-${index}`,
      tool: "flag" as const,
      color: markerColor(marker.kind),
      points: [{ time, price: marker.price }],
      label: marker.label,
      marker: markerAbbreviation(marker.kind),
      createdAt: new Date().toISOString(),
      locked: true,
      syncKey: `${FOCUS_PREFIX}${request.tradeId}-${marker.kind}-${index}`,
      visible: true,
    }];
  });
}

export function applyJournalFocusDrawings(existing: ChartDrawing[], request: JournalChartFocusRequest) {
  return [...existing.filter((drawing) => !drawing.id.startsWith(FOCUS_PREFIX)), ...journalFocusDrawings(request)];
}

export function journalFocusVisibleRange(request: JournalChartFocusRequest, revision: number): SyncedChartVisibleRange | null {
  const from = Math.floor(Date.parse(request.startAt) / 1000);
  const to = Math.floor(Date.parse(request.endAt) / 1000);
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to, revision, sourcePaneId: `journal-focus-${request.tradeId}` } : null;
}

export function journalFocusMatchesSymbol(left: string, right: string) {
  return normalize(left) === normalize(right);
}

function normalize(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function markerAbbreviation(kind: JournalChartFocusRequest["markers"][number]["kind"]) { return kind === "entry" ? "E" : kind === "exit" ? "X" : kind === "stop" ? "S" : kind === "target" ? "T" : "F"; }
function markerColor(kind: JournalChartFocusRequest["markers"][number]["kind"]) { return kind === "entry" ? "#67e8f9" : kind === "exit" ? "#60a5fa" : kind === "stop" ? "#fb7185" : kind === "target" ? "#34d399" : "#fbbf24"; }
