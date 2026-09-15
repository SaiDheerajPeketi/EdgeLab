import { getAppStorageItem, putAppStorageItem } from "./api";
import { getStoredAuthSession } from "./authSession";

export const APP_STORAGE_NAMESPACE = "edgelab";

type Listener<T> = (value: T | null) => void;
type LocalStorageValue<T> = {
  source: "legacy" | "scoped";
  updatedAt: number;
  value: T;
};

const memoryCache = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener<unknown>>>();
const mutationVersions = new Map<string, number>();
const writeQueues = new Map<string, Promise<void>>();
const WORKSPACE_SHARE_COPY_APP_STORAGE_KEY =
  /^workspace-share-copy\.v1\.workspace-copy-[a-z0-9-]{8,128}$/i;

const LEGACY_STORAGE_KEY_MAP: Record<string, string> = {
  "active-chart-layout.v1": "edgelab.active-chart-layout.v1",
  "active-chart-settings-preset.v1": "edgelab.active-chart-settings-preset.v1",
  "active-live-chart-layout.v1": "edgelab.active-live-chart-layout.v1",
  "backtest-day-notes.v1": "edgelab.backtest-day-notes.v1",
  "backtest-strategies.v1": "edgelab.backtest-strategies.v1",
  "chart-layout-cleared-single-horizontal.v1": "edgelab.chart-layout-cleared-single-horizontal.v1",
  "chart-layout.v1": "edgelab.chart-layout.v1",
  "chart-layouts.v1": "edgelab.chart-layouts.v1",
  "chart-interaction-preferences.v1": "edgelab.chart-interaction-preferences.v1",
  "chart-settings-presets.v1": "edgelab.chart-settings-presets.v1",
  "drawing-presets.v1": "edgelab.drawing-presets.v1",
  "drawing-tool-favorites.v1": "edgelab.drawing-tool-favorites.v1",
  "fib-presets.v1": "edgelab.fib-presets.v1",
  "indicator-favorites.v1": "edgelab.indicator-favorites.v1",
  "finance-tracker.v1": "edgelab.finance-tracker.v1",
  "live-chart-layout.v1": "edgelab.live-chart-layout.v1",
  "live-chart-layouts.v1": "edgelab.live-chart-layouts.v1",
  "live-journal-strategies.v1": "edgelab.live-journal-strategies.v1",
  "live-journal.v1": "edgelab.live-journal.v1",
  "live-market-catalog.v1": "edgelab.live-market-catalog.v1",
  "live-watchlists.v1": "edgelab.live-watchlists.v1",
  "notebook-favorites.v1": "edgelab.notebook-favorites.v1",
  "notebook-template.v1": "edgelab.notebook-template.v1",
  "order-commission-fixed.v1": "edgelab.order-commission-fixed.v1",
  "order-commission-mode.v1": "edgelab.order-commission-mode.v1",
  "order-commission-percent.v1": "edgelab.order-commission-percent.v1",
  "order-default-quantity.v1": "edgelab.order-default-quantity.v1",
  "order-default-risk-percent.v1": "edgelab.order-default-risk-percent.v1",
  "order-fee-fixed.v1": "edgelab.order-fee-fixed.v1",
  "order-fee-mode.v1": "edgelab.order-fee-mode.v1",
  "order-fee-percent.v1": "edgelab.order-fee-percent.v1",
  "order-line-modification-confirmation.v1": "edgelab.order-line-modification-confirmation.v1",
  "order-risk-base.v1": "edgelab.order-risk-base.v1",
  "order-sizing-mode.v1": "edgelab.order-sizing-mode.v1",
  "strategy-mistake-tags.v1": "edgelab.strategy-mistake-tags.v1",
  "workspace-beta-notice-dismissed.v1": "edgelab.workspace.beta-notice.dismissed.v1",
};

function storageKey(namespace: string, key: string) {
  return `${storageOwnerSegment()}:${namespace}:${key}`;
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
      if (
        localValue != null &&
        localValue.source === "scoped" &&
        localValue.updatedAt > serverUpdatedAt
      ) {
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
  return value;
}

export async function saveAppStorageItemConfirmed<T>(
  key: string,
  value: T,
  namespace = APP_STORAGE_NAMESPACE,
): Promise<{ localPersisted: boolean; serverPersisted: boolean; value: T }> {
  const combinedKey = storageKey(namespace, key);
  mutationVersions.set(combinedKey, (mutationVersions.get(combinedKey) ?? 0) + 1);
  setCachedValue(namespace, key, value);
  let localPersisted = false;
  try {
    localPersisted = writeLocalStorageValue(key, value, Date.now());
  } catch {
    // The confirmed server write below remains a durable path when local storage is full.
  }

  const previousWrite = writeQueues.get(combinedKey) ?? Promise.resolve();
  let serverPersisted = false;
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      const item = await putAppStorageItem(namespace, key, value);
      serverPersisted = true;
      try {
        writeLocalStorageValue(key, value, parseTimestamp(item.updated_at) || Date.now());
        localPersisted = true;
      } catch {
        // Server persistence is sufficient; hydration can recover the value remotely.
      }
    });
  writeQueues.set(combinedKey, nextWrite);
  try {
    await nextWrite;
  } catch (error) {
    if (!localPersisted) {
      throw error;
    }
  } finally {
    if (writeQueues.get(combinedKey) === nextWrite) {
      writeQueues.delete(combinedKey);
    }
  }
  return { localPersisted, serverPersisted, value };
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

export function isAppStorageLocalStorageKey(key: string) {
  return (
    key.startsWith("edgelab.workspace-share-copy.v1.workspace-copy-") ||
    Object.values(LEGACY_STORAGE_KEY_MAP).some(
      (prefix) => key === prefix || key.startsWith(`${prefix}.`),
    )
  );
}

function setCachedValue<T>(namespace: string, key: string, value: T) {
  const combinedKey = storageKey(namespace, key);
  memoryCache.set(combinedKey, value);
  listeners.get(combinedKey)?.forEach((listener) => listener(value));
}

function readLocalStorageValue<T>(key: string): LocalStorageValue<T> | null {
  if (typeof window === "undefined") {
    return null;
  }
  const localKey = localStorageKeyFor(key);
  const localValue = readLocalStorageKeyValue<T>(key, localKey, "scoped");
  if (localValue != null) {
    return localValue;
  }
  const legacyKey = legacyStorageKeyFor(key);
  if (!legacyKey || legacyKey === localKey) {
    return null;
  }
  return readLocalStorageKeyValue<T>(key, legacyKey, "legacy");
}

function readLocalStorageKeyValue<T>(
  key: string,
  storageKey: string | null,
  source: LocalStorageValue<T>["source"],
): LocalStorageValue<T> | null {
  if (typeof window === "undefined" || !storageKey) {
    return null;
  }
  const raw = window.localStorage.getItem(storageKey);
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
    source,
    updatedAt: parseTimestamp(window.localStorage.getItem(localStorageUpdatedAtKey(storageKey))),
    value,
  };
}

function writeLocalStorageValue<T>(key: string, value: T, updatedAt: number) {
  if (typeof window === "undefined") {
    return false;
  }
  const localKey = localStorageKeyFor(key);
  if (!localKey) {
    return false;
  }
  if (legacyStoresPlainString(key)) {
    window.localStorage.setItem(localKey, String(value ?? ""));
  } else {
    window.localStorage.setItem(localKey, JSON.stringify(value));
  }
  window.localStorage.setItem(localStorageUpdatedAtKey(localKey), String(updatedAt || Date.now()));
  return true;
}

function localStorageKeyFor(key: string) {
  const legacyKey = legacyStorageKeyFor(key);
  return legacyKey ? `${legacyKey}.${storageOwnerSegment()}` : null;
}

function storageOwnerSegment() {
  const user = getStoredAuthSession()?.user;
  if (user?.id) {
    return `user-${user.id}`;
  }
  if (user?.email) {
    return `user-${encodeURIComponent(user.email.toLowerCase())}`;
  }
  return "anonymous";
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
  if (WORKSPACE_SHARE_COPY_APP_STORAGE_KEY.test(key)) {
    return `edgelab.${key}`;
  }
  return LEGACY_STORAGE_KEY_MAP[key] ?? null;
}

function legacyStoresPlainString(key: string) {
  return (
    key === "active-chart-layout.v1" ||
    key === "active-chart-settings-preset.v1" ||
    key === "active-live-chart-layout.v1" ||
    key === "chart-layout-cleared-single-horizontal.v1" ||
    key === "notebook-template.v1" ||
    key === "order-commission-fixed.v1" ||
    key === "order-commission-mode.v1" ||
    key === "order-commission-percent.v1" ||
    key === "order-default-quantity.v1" ||
    key === "order-default-risk-percent.v1" ||
    key === "order-fee-fixed.v1" ||
    key === "order-fee-mode.v1" ||
    key === "order-fee-percent.v1" ||
    key === "order-risk-base.v1" ||
    key === "order-sizing-mode.v1"
  );
}
