import type { DrawingTool } from "./charting";
import {
  getCachedAppStorageItem,
  loadAppStorageItem,
  saveAppStorageItem,
  subscribeAppStorageItem,
} from "./serverStorage";

export type FavoriteDrawingTool = Exclude<DrawingTool, "cursor" | "crosshair">;

export const DRAWING_TOOL_FAVORITES_STORAGE_KEY = "drawing-tool-favorites.v1";
export const MAX_DRAWING_TOOL_FAVORITES = 8;

export const FAVORITABLE_DRAWING_TOOLS: FavoriteDrawingTool[] = [
  "trendline",
  "ray",
  "extendedLine",
  "segment",
  "angle",
  "horizontalRay",
  "parallelChannel",
  "horizontal",
  "vertical",
  "rectangle",
  "ellipse",
  "triangle",
  "fib",
  "fibExtension",
  "fibChannel",
  "fibTime",
  "fibFan",
  "chartPattern",
  "elliottWave",
  "harmonicPattern",
  "brush",
  "arrow",
  "measure",
  "quickMeasure",
  "eraser",
  "longPosition",
  "shortPosition",
  "text",
  "callout",
  "flag",
  "icon",
];

export const DEFAULT_DRAWING_TOOL_FAVORITES: FavoriteDrawingTool[] = [
  "trendline",
  "horizontal",
  "rectangle",
  "fib",
  "measure",
  "text",
];

const FAVORITABLE_DRAWING_TOOL_SET = new Set<DrawingTool>(FAVORITABLE_DRAWING_TOOLS);
let hydrationPromise: Promise<FavoriteDrawingTool[]> | null = null;

export function isFavoriteDrawingTool(tool: DrawingTool): tool is FavoriteDrawingTool {
  return FAVORITABLE_DRAWING_TOOL_SET.has(tool);
}

export function sanitizeDrawingToolFavorites(value: unknown): FavoriteDrawingTool[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_DRAWING_TOOL_FAVORITES];
  }

  const favorites: FavoriteDrawingTool[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "string" ||
      !FAVORITABLE_DRAWING_TOOL_SET.has(candidate as DrawingTool) ||
      favorites.includes(candidate as FavoriteDrawingTool)
    ) {
      continue;
    }
    favorites.push(candidate as FavoriteDrawingTool);
    if (favorites.length === MAX_DRAWING_TOOL_FAVORITES) {
      break;
    }
  }

  return favorites.length > 0 ? favorites : [...DEFAULT_DRAWING_TOOL_FAVORITES];
}

export function toggleDrawingToolFavorite(
  current: FavoriteDrawingTool[],
  tool: FavoriteDrawingTool,
): FavoriteDrawingTool[] {
  const favorites = sanitizeDrawingToolFavorites(current);
  if (favorites.includes(tool)) {
    return favorites.length === 1 ? favorites : favorites.filter((favorite) => favorite !== tool);
  }
  if (favorites.length >= MAX_DRAWING_TOOL_FAVORITES) {
    return favorites;
  }
  return [...favorites, tool];
}

export function moveDrawingToolFavorite(
  current: FavoriteDrawingTool[],
  tool: FavoriteDrawingTool,
  direction: -1 | 1,
): FavoriteDrawingTool[] {
  const favorites = sanitizeDrawingToolFavorites(current);
  const currentIndex = favorites.indexOf(tool);
  const nextIndex = currentIndex + direction;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= favorites.length) {
    return favorites;
  }
  const next = [...favorites];
  [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
  return next;
}

export function loadCachedDrawingToolFavorites() {
  return sanitizeDrawingToolFavorites(
    getCachedAppStorageItem(
      DRAWING_TOOL_FAVORITES_STORAGE_KEY,
      DEFAULT_DRAWING_TOOL_FAVORITES,
    ),
  );
}

export function hydrateDrawingToolFavorites() {
  if (!hydrationPromise) {
    const request = loadAppStorageItem(
      DRAWING_TOOL_FAVORITES_STORAGE_KEY,
      DEFAULT_DRAWING_TOOL_FAVORITES,
    ).then(sanitizeDrawingToolFavorites);
    hydrationPromise = request;
    void request.finally(() => {
      if (hydrationPromise === request) {
        hydrationPromise = null;
      }
    });
  }
  return hydrationPromise;
}

export function persistDrawingToolFavorites(value: FavoriteDrawingTool[]) {
  const favorites = sanitizeDrawingToolFavorites(value);
  return saveAppStorageItem(DRAWING_TOOL_FAVORITES_STORAGE_KEY, favorites);
}

export function subscribeDrawingToolFavorites(
  listener: (favorites: FavoriteDrawingTool[]) => void,
) {
  return subscribeAppStorageItem<unknown>(
    DRAWING_TOOL_FAVORITES_STORAGE_KEY,
    (value) => listener(sanitizeDrawingToolFavorites(value)),
  );
}
