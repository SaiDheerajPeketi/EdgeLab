import { INDICATORS, type ChartIndicatorKind } from "./charting";
import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

export type FavoriteIndicator = ChartIndicatorKind | `script:${string}`;

export function scriptIndicatorFavorite(scriptId: string): FavoriteIndicator {
  return `script:${scriptId}`;
}

export function favoriteIndicatorScriptId(favorite: FavoriteIndicator): string | null {
  return favorite.startsWith("script:") ? favorite.slice(7) : null;
}

export const INDICATOR_FAVORITES_STORAGE_KEY = "indicator-favorites.v1";
export const MAX_INDICATOR_FAVORITES = 6;
export const DEFAULT_INDICATOR_FAVORITES: FavoriteIndicator[] = [
  "ema",
  "rsi",
  "vwap",
];

const INDICATOR_KIND_SET = new Set<ChartIndicatorKind>(
  INDICATORS.map((indicator) => indicator.kind),
);
let hydrationPromise: Promise<FavoriteIndicator[]> | null = null;

export function sanitizeIndicatorFavorites(value: unknown): FavoriteIndicator[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_INDICATOR_FAVORITES];
  }

  const favorites: FavoriteIndicator[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      (!INDICATOR_KIND_SET.has(candidate as ChartIndicatorKind) &&
        !/^script:[A-Za-z0-9:_-]{1,96}$/.test(candidate)) ||
      favorites.includes(candidate as FavoriteIndicator)
    ) {
      continue;
    }
    favorites.push(candidate as FavoriteIndicator);
    if (favorites.length === MAX_INDICATOR_FAVORITES) {
      break;
    }
  }
  return favorites;
}

export function toggleIndicatorFavorite(
  current: readonly FavoriteIndicator[],
  indicator: FavoriteIndicator,
) {
  const favorites = sanitizeIndicatorFavorites(current);
  if (favorites.includes(indicator)) {
    return favorites.filter((favorite) => favorite !== indicator);
  }
  if (favorites.length >= MAX_INDICATOR_FAVORITES) {
    return favorites;
  }
  return [...favorites, indicator];
}

export function loadCachedIndicatorFavorites() {
  return sanitizeIndicatorFavorites(
    getCachedAppStorageItem(
      INDICATOR_FAVORITES_STORAGE_KEY,
      DEFAULT_INDICATOR_FAVORITES,
    ),
  );
}

export function hydrateIndicatorFavorites() {
  if (!hydrationPromise) {
    const request = loadAppStorageItem(
      INDICATOR_FAVORITES_STORAGE_KEY,
      DEFAULT_INDICATOR_FAVORITES,
    ).then(sanitizeIndicatorFavorites);
    hydrationPromise = request;
    void request.finally(() => {
      if (hydrationPromise === request) {
        hydrationPromise = null;
      }
    });
  }
  return hydrationPromise;
}

export function persistIndicatorFavorites(value: readonly FavoriteIndicator[]) {
  const favorites = sanitizeIndicatorFavorites(value);
  return saveAppStorageItem(INDICATOR_FAVORITES_STORAGE_KEY, favorites);
}

export function subscribeIndicatorFavorites(
  listener: (favorites: FavoriteIndicator[]) => void,
) {
  return subscribeAppStorageItem<unknown>(
    INDICATOR_FAVORITES_STORAGE_KEY,
    (value) => listener(sanitizeIndicatorFavorites(value)),
  );
}
