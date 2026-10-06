import { useEffect, type SetStateAction } from "react";
import { DEFAULT_JOURNAL_FILTERS, type JournalBreakdownDimension, type JournalFilters } from "../../lib/journalAnalytics";
import { isJournalDate } from "../../lib/journalDailyNotes";
import { journalDeepLink, parseJournalDeepLink } from "../../lib/journalWorkspaceState";
import { useRestorableSurfaceState } from "../../lib/useRestorableSurfaceState";

export const JOURNAL_DIMENSIONS: Array<{ id: JournalBreakdownDimension; label: string }> = [
  { id: "market", label: "Market" }, { id: "symbol", label: "Symbol" },
  { id: "direction", label: "Direction" }, { id: "duration", label: "Duration" },
  { id: "size", label: "Size" }, { id: "strategy", label: "Strategy" },
  { id: "tag", label: "Tag" }, { id: "rating", label: "Rating" },
  { id: "grade", label: "Grade" }, { id: "weekday", label: "Weekday" },
  { id: "hour", label: "Time of day" }, { id: "account", label: "Account" },
];

type AnalyticsContext = { filters: JournalFilters; dimension: JournalBreakdownDimension; selectedKey: string | null; drilling: boolean };
export function isJournalAnalyticsContext(value: unknown): value is AnalyticsContext {
  if (!value || typeof value !== "object") return false;
  const context = value as AnalyticsContext;
  const filters = context.filters;
  const ids = (candidate: unknown) => Array.isArray(candidate) && candidate.every((id) => Number.isSafeInteger(id) && id > 0);
  const text = (candidate: unknown) => typeof candidate === "string" && candidate.length <= 1000;
  return Boolean(filters && typeof filters === "object" && ids(filters.accountIds) && ids(filters.tagIds)
    && (filters.dateFrom === "" || isJournalDate(filters.dateFrom)) && (filters.dateTo === "" || isJournalDate(filters.dateTo))
    && ["ALL", "LONG", "SHORT"].includes(filters.direction) && ["ALL", "UNRATED", "1", "2", "3", "4", "5"].includes(filters.rating)
    && text(filters.market) && text(filters.symbol) && text(filters.strategy)
    && JOURNAL_DIMENSIONS.some((item) => item.id === context.dimension)
    && (context.selectedKey === null || text(context.selectedKey)) && typeof context.drilling === "boolean");
}
const SCHEMA = { version: 1, validate: isJournalAnalyticsContext } as const;

/** Both interfaces restore the same task; exact trade IDs are derived from current records. */
export function useJournalAnalyticsContext(initialDimension: JournalBreakdownDimension = "market") {
  const [context, setContext] = useRestorableSurfaceState<AnalyticsContext>("journal:analytics", "filters", {
    filters: DEFAULT_JOURNAL_FILTERS, dimension: initialDimension, selectedKey: null, drilling: false,
  }, SCHEMA);
  useEffect(() => {
    const applyLink = () => {
      const dimension = parseJournalDeepLink(window.location.hash)?.segment;
      if (JOURNAL_DIMENSIONS.some((item) => item.id === dimension)) {
        setContext((current) => current.dimension === dimension ? current : { ...current, dimension: dimension as JournalBreakdownDimension, selectedKey: null, drilling: false });
      }
    };
    applyLink();
    window.addEventListener("hashchange", applyLink);
    window.addEventListener("popstate", applyLink);
    return () => { window.removeEventListener("hashchange", applyLink); window.removeEventListener("popstate", applyLink); };
  }, [initialDimension]);
  return { ...context,
    setFilters: (next: SetStateAction<JournalFilters>) => setContext((current) => ({ ...current, filters: typeof next === "function" ? next(current.filters) : next, selectedKey: null, drilling: false })),
    setDimension: (dimension: JournalBreakdownDimension) => {
      const link = parseJournalDeepLink(window.location.hash);
      if (link?.surface === "analytics" && link.segment != null) window.history.replaceState(null, "", journalDeepLink({ ...link, segment: dimension }));
      setContext((current) => ({ ...current, dimension, selectedKey: null, drilling: false }));
    },
    setSelectedKey: (selectedKey: string | null) => setContext((current) => ({ ...current, selectedKey })),
    setDrilling: (drilling: boolean) => setContext((current) => ({ ...current, drilling })),
  };
}
