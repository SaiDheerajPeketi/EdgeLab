import { getAppStorageItem, putAppStorageItem } from "./api";

export const APP_STORAGE_NAMESPACE = "edgelab";

type Listener<T> = (value: T | null) => void;

const memoryCache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener<unknown>>>();

function storageKey(namespace: string, key: string) {
  return `${namespace}:${key}`;
}

export function getCachedAppStorageItem<T>(
  key: string,
  fallback: T,
  namespace = APP_STORAGE_NAMESPACE,
): T {
  const cached = memoryCache.get(storageKey(namespace, key));
  return cached === undefined ? fallback : (cached as T);
}

export async function loadAppStorageItem<T>(
  key: string,
  fallback: T,
  namespace = APP_STORAGE_NAMESPACE,
): Promise<T> {
  try {
    const item = await getAppStorageItem<T>(namespace, key);
    if (item.value == null) {
      const legacyValue = readLegacyStorageValue<T>(key);
      if (legacyValue !== null) {
        setCachedValue(namespace, key, legacyValue);
        await putAppStorageItem(namespace, key, legacyValue);
        removeLegacyStorageValue(key);
        return legacyValue;
      }
    }
    const value = item.value == null ? fallback : item.value;
    setCachedValue(namespace, key, value);
    return value;
  } catch {
    const cachedValue = getCachedAppStorageItem(key, fallback, namespace);
    if (cachedValue !== fallback) {
      return cachedValue;
    }
    return readLegacyStorageValue<T>(key) ?? fallback;
  }
}

export async function saveAppStorageItem<T>(
  key: string,
  value: T,
  namespace = APP_STORAGE_NAMESPACE,
): Promise<T> {
  setCachedValue(namespace, key, value);
  try {
    await putAppStorageItem(namespace, key, value);
  } catch {
    // Keep the UI responsive; a later successful save will replace the server value.
  }
  return value;
}

export function subscribeAppStorageItem<T>(
  key: string,
  listener: Listener<T>,
  namespace = APP_STORAGE_NAMESPACE,
) {
  const combinedKey = storageKey(namespace, key);
  const bucket = listeners.get(combinedKey) ?? new Set<Listener<unknown>>();
  bucket.add(listener as Listener<unknown>);
  listeners.set(combinedKey, bucket);
  return () => {
    bucket.delete(listener as Listener<unknown>);
    if (bucket.size === 0) {
      listeners.delete(combinedKey);
    }
  };
}

function setCachedValue<T>(namespace: string, key: string, value: T) {
  const combinedKey = storageKey(namespace, key);
  memoryCache.set(combinedKey, value);
  listeners.get(combinedKey)?.forEach((listener) => listener(value));
}

function readLegacyStorageValue<T>(key: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }
  const legacyKey = legacyStorageKeyFor(key);
  if (!legacyKey) {
    return null;
  }
  const raw = window.localStorage.getItem(legacyKey);
  if (raw == null) {
    return null;
  }
  if (legacyStoresPlainString(key)) {
    return raw as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function removeLegacyStorageValue(key: string) {
  if (typeof window === "undefined") {
    return;
  }
  const legacyKey = legacyStorageKeyFor(key);
  if (legacyKey) {
    window.localStorage.removeItem(legacyKey);
  }
}

function legacyStorageKeyFor(key: string) {
  const mappings: Record<string, string> = {
    "active-chart-layout.v1": "edgelab.active-chart-layout.v1",
    "active-chart-settings-preset.v1": "edgelab.active-chart-settings-preset.v1",
    "chart-layout-cleared-single-horizontal.v1": "edgelab.chart-layout-cleared-single-horizontal.v1",
    "chart-layout.v1": "edgelab.chart-layout.v1",
    "chart-layouts.v1": "edgelab.chart-layouts.v1",
    "chart-settings-presets.v1": "edgelab.chart-settings-presets.v1",
    "drawing-presets.v1": "edgelab.drawing-presets.v1",
    "fib-presets.v1": "edgelab.fib-presets.v1",
    "live-journal.v1": "edgelab.live-journal.v1",
    "order-risk-base.v1": "edgelab.order-risk-base.v1",
    "strategy-mistake-tags.v1": "edgelab.strategy-mistake-tags.v1",
  };
  return mappings[key] ?? null;
}

function legacyStoresPlainString(key: string) {
  return (
    key === "active-chart-layout.v1" ||
    key === "active-chart-settings-preset.v1" ||
    key === "chart-layout-cleared-single-horizontal.v1" ||
    key === "order-risk-base.v1"
  );
}
