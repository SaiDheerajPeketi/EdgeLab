import type { HeatmapColumn } from "./heatmap-context";
import { formatLocaleDateTime, formatLocaleNumber } from "../../../lib/locale";

export function getHeatmapColumnStartDate(column: HeatmapColumn): Date | null {
  return column.bins[0]?.date ?? null;
}

export function getHeatmapColumnEndDate(column: HeatmapColumn): Date | null {
  const lastBin = column.bins.at(-1);
  return lastBin?.date ?? null;
}

export function getHeatmapTimeExtent(
  columns: HeatmapColumn[]
): [Date, Date] | null {
  if (columns.length === 0) {
    return null;
  }

  const firstColumn = columns[0];
  if (!firstColumn) {
    return null;
  }
  const start = getHeatmapColumnStartDate(firstColumn);
  const lastColumn = columns.at(-1);
  if (!lastColumn) {
    return null;
  }
  const end = getHeatmapColumnEndDate(lastColumn);
  if (!(start && end)) {
    return null;
  }

  return [start, end];
}

export function filterHeatmapColumns(
  columns: HeatmapColumn[],
  xDomain?: [Date, Date]
): HeatmapColumn[] {
  if (!xDomain) {
    return columns;
  }

  const start = Math.min(xDomain[0].getTime(), xDomain[1].getTime());
  const end = Math.max(xDomain[0].getTime(), xDomain[1].getTime());

  return columns.filter((column) => {
    const weekStart = getHeatmapColumnStartDate(column)?.getTime();
    const weekEnd = getHeatmapColumnEndDate(column)?.getTime();
    if (weekStart == null || weekEnd == null) {
      return false;
    }
    return weekEnd >= start && weekStart <= end;
  });
}

export function formatHeatmapContributionLabel(
  count: number,
  date: Date
): string {
  const word = count === 1 ? "contribution" : "contributions";
  return `${formatLocaleNumber(count)} ${word} on ${formatLocaleDateTime(date, { month: "long", day: "numeric" })}`;
}

/** Maps a contribution count to the GitHub-style legend level (0–4). */
export function getHeatmapContributionLevel(count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (count === 1) {
    return 1;
  }
  if (count === 2) {
    return 2;
  }
  if (count === 3) {
    return 3;
  }
  return 4;
}
