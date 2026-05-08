import { getAppStorageItem, putAppStorageItem } from "./api";

export const APP_STORAGE_NAMESPACE = "edgelab";

type Listener<T> = (value: T | null) => void;

const memoryCache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener<unknown>>>();
const mutationVersions = new Map<string, number>();
const writeQueues = new Map<string, Promise<void>>();

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
  const combinedKey = storageKey(namespace, key);
  const versionAtStart = mutationVersions.get(combinedKey) ?? 0;
  const localValue = readLocalStorageValue<T>(key);
  try {
    const item = await getAppStorageItem<T>(namespace, key);
    if ((mutationVersions.get(combinedKey) ?? 0) !== versionAtStart) {
      return getCachedAppStorageItem(key, fallback, namespace);
    }
    if (item.value != null) {
      const serverUpdatedAt = parseTimestamp(item.updated_at);
      if (localValue != null && localValue.updatedAt > serverUpdatedAt) {
        setCachedValue(namespace, key, localValue.value);
        void saveAppStorageItem(key, localValue.value, namespace);
        return localValue.value;
      }
      setCachedValue(namespace, key, item.value);
      writeLocalStorageValue(key, item.value, serverUpdatedAt);
      return item.value;
    }
    if (item.value == null) {
      if (localValue != null) {
        setCachedValue(namespace, key, localValue.value);
        void saveAppStorageItem(key, localValue.value, namespace);
        return localValue.value;
      }
    }
    setCachedValue(namespace, key, fallback);
    return fallback;
  } catch {
    const cachedValue = getCachedAppStorageItem(key, fallback, namespace);
    if (cachedValue !== fallback) {
      return cachedValue;
    }
    return localValue?.value ?? fallback;
  }
}

export async function saveAppStorageItem<T>(
  key: string,
  value: T,
  namespace = APP_STORAGE_NAMESPACE,
): Promise<T> {
  const combinedKey = storageKey(namespace, key);
  mutationVersions.set(combinedKey, (mutationVersions.get(combinedKey) ?? 0) + 1);
  setCachedValue(namespace, key, value);
  writeLocalStorageValue(key, value, Date.now());
  const previousWrite = writeQueues.get(combinedKey) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      try {
        const item = await putAppStorageItem(namespace, key, value);
        writeLocalStorageValue(key, value, parseTimestamp(item.updated_at) || Date.now());
      } catch {
        // Keep the UI responsive; a later successful save will replace the server value.
      }
    });
  writeQueues.set(combinedKey, nextWrite);
  void nextWrite.finally(() => {
    if (writeQueues.get(combinedKey) === nextWrite) {
      writeQueues.delete(combinedKey);
    }
  });
  await nextWrite;
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

function readLocalStorageValue<T>(key: string): { updatedAt: number; value: T } | null {
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
  let value: T;
  if (legacyStoresPlainString(key)) {
    value = raw as T;
  } else {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return {
    updatedAt: parseTimestamp(window.localStorage.getItem(localStorageUpdatedAtKey(legacyKey))),
    value,
  };
}

function writeLocalStorageValue<T>(key: string, value: T, updatedAt: number) {
  if (typeof window === "undefined") {
    return;
  }
  const legacyKey = legacyStorageKeyFor(key);
  if (!legacyKey) {
    return;
  }
  if (legacyStoresPlainString(key)) {
    window.localStorage.setItem(legacyKey, String(value ?? ""));
  } else {
    window.localStorage.setItem(legacyKey, JSON.stringify(value));
  }
  window.localStorage.setItem(localStorageUpdatedAtKey(legacyKey), String(updatedAt || Date.now()));
}

function localStorageUpdatedAtKey(key: string) {
  return `${key}.__updatedAt`;
}

function parseTimestamp(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (!value) {
    return 0;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : 0;
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
    "notebook-favorites.v1": "edgelab.notebook-favorites.v1",
    "order-line-modification-confirmation.v1": "edgelab.order-line-modification-confirmation.v1",
    "order-risk-base.v1": "edgelab.order-risk-base.v1",
    "order-sizing-mode.v1": "edgelab.order-sizing-mode.v1",
    "strategy-mistake-tags.v1": "edgelab.strategy-mistake-tags.v1",
  };
  return mappings[key] ?? null;
}

function legacyStoresPlainString(key: string) {
  return (
    key === "active-chart-layout.v1" ||
    key === "active-chart-settings-preset.v1" ||
    key === "chart-layout-cleared-single-horizontal.v1" ||
    key === "order-risk-base.v1" ||
    key === "order-sizing-mode.v1"
  );
}
