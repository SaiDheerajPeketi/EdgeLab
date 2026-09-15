import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

export type ChartInteractionPreferences = {
  keepDrawingAfterPlacement: boolean;
  showDrawingRail: boolean;
};

export const CHART_INTERACTION_PREFERENCES_STORAGE_KEY =
  "chart-interaction-preferences.v1";

export const DEFAULT_CHART_INTERACTION_PREFERENCES: ChartInteractionPreferences = {
  keepDrawingAfterPlacement: false,
  showDrawingRail: true,
};

let hydrationPromise: Promise<ChartInteractionPreferences> | null = null;

export function sanitizeChartInteractionPreferences(
  value: unknown,
): ChartInteractionPreferences {
  if (typeof value !== "object" || value == null) {
    return { ...DEFAULT_CHART_INTERACTION_PREFERENCES };
  }
  const candidate = value as Partial<ChartInteractionPreferences>;
  return {
    keepDrawingAfterPlacement: candidate.keepDrawingAfterPlacement === true,
    showDrawingRail: candidate.showDrawingRail !== false,
  };
}

export function loadCachedChartInteractionPreferences() {
  return sanitizeChartInteractionPreferences(
    getCachedAppStorageItem(
      CHART_INTERACTION_PREFERENCES_STORAGE_KEY,
      DEFAULT_CHART_INTERACTION_PREFERENCES,
    ),
  );
}

export function hydrateChartInteractionPreferences() {
  if (!hydrationPromise) {
    const request = loadAppStorageItem(
      CHART_INTERACTION_PREFERENCES_STORAGE_KEY,
      DEFAULT_CHART_INTERACTION_PREFERENCES,
    ).then(sanitizeChartInteractionPreferences);
    hydrationPromise = request;
    void request.finally(() => {
      if (hydrationPromise === request) {
        hydrationPromise = null;
      }
    });
  }
  return hydrationPromise;
}

export function persistChartInteractionPreferences(
  value: ChartInteractionPreferences,
) {
  const preferences = sanitizeChartInteractionPreferences(value);
  return saveAppStorageItem(CHART_INTERACTION_PREFERENCES_STORAGE_KEY, preferences);
}

export function subscribeChartInteractionPreferences(
  listener: (preferences: ChartInteractionPreferences) => void,
) {
  return subscribeAppStorageItem<unknown>(
    CHART_INTERACTION_PREFERENCES_STORAGE_KEY,
    (value) => listener(sanitizeChartInteractionPreferences(value)),
  );
}
