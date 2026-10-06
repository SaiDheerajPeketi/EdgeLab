import { getAppStorageItem, putAppStorageItem, type AppStorageItem } from "./api";
import { getStoredAuthSession } from "./authSession";
import { appDataLegacyMigrationAllowed, appDataSessionKey, assertAppDataAccess, captureAppDataAccess, registerAppDataParticipant, type AppDataAccess } from "./appDataBarrier";

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
const queuedValues = new Map<string, Map<number, { value: unknown }>>();

registerAppDataParticipant({
  settle: async (owner) => { await Promise.allSettled([...writeQueues].filter(([key]) => key.startsWith(`${owner}:`)).map(([, write]) => write)); },
  invalidate: (owner) => {
    for (const key of memoryCache.keys()) if (key.startsWith(`${owner}:`)) memoryCache.delete(key);
    for (const key of mutationVersions.keys()) if (key.startsWith(`${owner}:`)) mutationVersions.delete(key);
    for (const key of queuedValues.keys()) if (key.startsWith(`${owner}:`)) queuedValues.delete(key);
  },
});

function assertStorageAccess(access: AppDataAccess | null, namespace: string, key: string, combinedKey: string, mutation = false) {
  if (storageKey(namespace, key) !== combinedKey) throw new DOMException("Storage owner changed", "AbortError");
  assertAppDataAccess(access, mutation);
}

function queueValue(combinedKey: string, value: unknown) {
  const version = (mutationVersions.get(combinedKey) ?? 0) + 1;
  mutationVersions.set(combinedKey, version);
  const values = queuedValues.get(combinedKey) ?? new Map<number, { value: unknown }>();
  const entry = { value };
  values.set(version, entry);
  queuedValues.set(combinedKey, values);
  return { entry, remove: () => { values.delete(version); if (!values.size) queuedValues.delete(combinedKey); } };
}
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
  "custom-indicator-audit.v1": "edgelab.custom-indicator-audit.v1",
  "custom-indicator-scripts.v1": "edgelab.custom-indicator-scripts.v1",
  "drawing-presets.v1": "edgelab.drawing-presets.v1",
  "drawing-tool-favorites.v1": "edgelab.drawing-tool-favorites.v1",
  "fib-presets.v1": "edgelab.fib-presets.v1",
  "indicator-favorites.v1": "edgelab.indicator-favorites.v1",
  "journal-account-scope.v1": "edgelab.journal-account-scope.v1",
  "journal-panel-layout.v1": "edgelab.journal-panel-layout.v1",
  "journal-sample-run.v1": "edgelab.journal-sample-run.v1",
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
  "quant-audit.v1": "edgelab.quant-audit.v1",
  "quant-preferences.v1": "edgelab.quant-preferences.v1",
  "quant-workspace.v1": "edgelab.quant-workspace.v1",
  "strategy-mistake-tags.v1": "edgelab.strategy-mistake-tags.v1",
  "settings-center.v1": "edgelab.settings-center.v1",
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
  try { assertAppDataAccess(captureAppDataAccess()); } catch { return fallback; }
  const cached = memoryCache.get(storageKey(namespace, key));
  return cached === undefined ? fallback : (cached as T);
}

export async function loadAppStorageItem<T>(
  key: string,
  fallback: T,
  namespace = APP_STORAGE_NAMESPACE,
): Promise<T> {
  const access = captureAppDataAccess();
  assertAppDataAccess(access);
  const combinedKey = storageKey(namespace, key);
  const versionAtStart = mutationVersions.get(combinedKey) ?? 0;
  const localValue = readLocalStorageValue<T>(key);
  try {
    const item = await getAppStorageItem<T>(namespace, key);
    assertStorageAccess(access, namespace, key, combinedKey);
    if ((mutationVersions.get(combinedKey) ?? 0) !== versionAtStart) {
      return getCachedAppStorageItem(key, fallback, namespace);
    }
    if (item.value != null) {
      const serverUpdatedAt = parseTimestamp(item.updated_at);
      if (
        localValue != null &&
        appDataLegacyMigrationAllowed() &&
        localValue.source === "scoped" &&
        localValue.updatedAt > serverUpdatedAt
      ) {
        setCachedValue(namespace, key, localValue.value, combinedKey);
        void saveAppStorageItem(key, localValue.value, namespace).catch(() => undefined);
        return localValue.value;
      }
      setCachedValue(namespace, key, item.value, combinedKey);
      writeLocalStorageValue(key, item.value, serverUpdatedAt, access);
      return item.value;
    }
    if (item.value == null) {
      if (localValue != null && appDataLegacyMigrationAllowed()) {
        setCachedValue(namespace, key, localValue.value, combinedKey);
        void saveAppStorageItem(key, localValue.value, namespace).catch(() => undefined);
        return localValue.value;
      }
    }
    setCachedValue(namespace, key, fallback, combinedKey);
    return fallback;
  } catch {
    assertStorageAccess(access, namespace, key, combinedKey);
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
  const access = captureAppDataAccess();
  assertAppDataAccess(access, true);
  const combinedKey = storageKey(namespace, key);
  const queued = queueValue(combinedKey, value);
  setCachedValue(namespace, key, value, combinedKey);
  try { writeLocalStorageValue(key, value, Date.now(), access); }
  catch (error) { queued.remove(); throw error; }
  const previousWrite = writeQueues.get(combinedKey) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      try {
        assertStorageAccess(access, namespace, key, combinedKey, true);
        const item = await putAppStorageItem(namespace, key, queued.entry.value);
        assertStorageAccess(access, namespace, key, combinedKey);
        writeLocalStorageValue(key, queued.entry.value, parseTimestamp(item.updated_at) || Date.now(), access);
      } catch {
        // Keep the UI responsive; a later successful save will replace the server value.
      } finally { queued.remove(); }
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
  const access = captureAppDataAccess();
  assertAppDataAccess(access, true);
  const combinedKey = storageKey(namespace, key);
  const queued = queueValue(combinedKey, value);
  setCachedValue(namespace, key, value, combinedKey);
  let localPersisted = false;
  try {
    localPersisted = writeLocalStorageValue(key, value, Date.now(), access);
  } catch {
    // The confirmed server write below remains a durable path when local storage is full.
  }

  const previousWrite = writeQueues.get(combinedKey) ?? Promise.resolve();
  let serverPersisted = false;
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      assertStorageAccess(access, namespace, key, combinedKey, true);
      const item = await putAppStorageItem(namespace, key, queued.entry.value);
      assertStorageAccess(access, namespace, key, combinedKey);
      serverPersisted = true;
      try {
        writeLocalStorageValue(key, queued.entry.value, parseTimestamp(item.updated_at) || Date.now(), access);
        localPersisted = true;
      } catch {
        // Server persistence is sufficient; hydration can recover the value remotely.
      }
    });
  writeQueues.set(combinedKey, nextWrite);
  try {
    await nextWrite;
  } catch (error) {
    assertStorageAccess(access, namespace, key, combinedKey);
    if (!localPersisted) {
      throw error;
    }
  } finally {
    queued.remove();
    if (writeQueues.get(combinedKey) === nextWrite) {
      writeQueues.delete(combinedKey);
    }
  }
  return { localPersisted, serverPersisted, value };
}

/** Serialize a strict read/write behind legacy writes; publish only acknowledged values. */
export async function confirmAppStorageOperation<T>(key: string, request: () => Promise<AppStorageItem<T>>, namespace = APP_STORAGE_NAMESPACE, rebaseQueued?: (pending: unknown, confirmed: T) => unknown, options: { readOnly?: boolean } = {}): Promise<AppStorageItem<T>> {
  const access = captureAppDataAccess();
  assertAppDataAccess(access, !options.readOnly);
  const combinedKey = storageKey(namespace, key);
  const versionAtStart = mutationVersions.get(combinedKey) ?? 0;
  const previous = writeQueues.get(combinedKey) ?? Promise.resolve();
  let item: AppStorageItem<T>;
  const next = previous.catch(() => undefined).then(async () => {
    assertStorageAccess(access, namespace, key, combinedKey, !options.readOnly);
    item = await request();
    assertStorageAccess(access, namespace, key, combinedKey);
    const currentVersion = mutationVersions.get(combinedKey) ?? 0;
    if (rebaseQueued && item.value != null) {
      const values = queuedValues.get(combinedKey);
      values?.forEach((entry, version) => { if (version > versionAtStart) entry.value = rebaseQueued(entry.value, item.value!); });
      const latest = values?.get(currentVersion);
      if (latest) {
        setCachedValue(namespace, key, latest.value, combinedKey);
        try { writeLocalStorageValue(key, latest.value, Date.now(), access); } catch { /* Queued server write remains available. */ }
      }
    }
    // A response issued before a newer optimistic edit cannot replace that edit.
    if (currentVersion !== versionAtStart) return;
    mutationVersions.set(combinedKey, currentVersion + 1);
    if (item.value != null) {
      setCachedValue(namespace, key, item.value, combinedKey);
      try { writeLocalStorageValue(key, item.value, parseTimestamp(item.updated_at) || Date.now(), access); }
      catch { /* The server acknowledgment remains durable when local storage is full. */ }
    }
  });
  writeQueues.set(combinedKey, next);
  try { await next; return item!; }
  finally { if (writeQueues.get(combinedKey) === next) writeQueues.delete(combinedKey); }
}

/** Reserve all related storage queues before awaiting, keeping atomic writes
 * and their cache publication indivisible relative to later legacy writers. */
export async function confirmAppStorageOperations(entries: Array<{ key: string; namespace?: string; rebaseQueued?: (pending: unknown, confirmed: unknown, before: unknown) => unknown }>, request: () => Promise<AppStorageItem[]>, options: { readOnly?: boolean } = {}): Promise<AppStorageItem[]> {
  const access = captureAppDataAccess();
  assertAppDataAccess(access, !options.readOnly);
  const captures = entries.map((entry) => {
    const namespace = entry.namespace ?? APP_STORAGE_NAMESPACE;
    const combinedKey = storageKey(namespace, entry.key);
    return { ...entry, namespace, combinedKey, version: mutationVersions.get(combinedKey) ?? 0, before: memoryCache.get(combinedKey), previous: writeQueues.get(combinedKey) ?? Promise.resolve() };
  });
  if (!captures.length || new Set(captures.map((entry) => entry.combinedKey)).size !== captures.length) throw new Error("Storage operation requires distinct keys.");
  let items: AppStorageItem[];
  const next = Promise.all(captures.map(({ previous }) => previous.catch(() => undefined))).then(async () => {
    const guard = (mutation = false) => { captures.forEach(({ namespace, key, combinedKey }) => assertStorageAccess(access, namespace, key, combinedKey, mutation)); };
    guard(!options.readOnly); items = await request(); guard();
    if (items.length !== captures.length || captures.some(({ namespace, key }) => items.filter((item) => item.namespace === namespace && item.key === key).length !== 1)) throw new Error("Incomplete storage acknowledgment.");
    // Complete every rebase before publishing any member of the bundle.
    const rebases = captures.map(({ namespace, key, combinedKey, version, before, rebaseQueued }) => {
      const item = items.find((item) => item.namespace === namespace && item.key === key)!;
      return Array.from(queuedValues.get(combinedKey)?.entries() ?? []).filter(([pendingVersion]) => pendingVersion > version && rebaseQueued).map(([, entry]) => ({ entry, value: rebaseQueued!(entry.value, item.value, before) }));
    });
    rebases.flat().forEach(({ entry, value }) => { entry.value = value; });
    // Caller orders keys so activation is published before preset subscribers.
    captures.forEach(({ namespace, key, combinedKey, version, rebaseQueued }) => {
      const item = items.find((item) => item.namespace === namespace && item.key === key)!;
      const currentVersion = mutationVersions.get(combinedKey) ?? 0;
      const values = queuedValues.get(combinedKey);
      const latest = values?.get(currentVersion);
      if (latest && rebaseQueued) {
        setCachedValue(namespace, key, latest.value, combinedKey);
        try { writeLocalStorageValue(key, latest.value, Date.now(), access); } catch { /* Queued persistence remains available. */ }
      } else if (currentVersion === version) {
        mutationVersions.set(combinedKey, currentVersion + 1);
        setCachedValue(namespace, key, item.value, combinedKey);
        try { writeLocalStorageValue(key, item.value, parseTimestamp(item.updated_at) || Date.now(), access); } catch { /* Server values remain durable. */ }
      }
    });
  });
  captures.forEach(({ combinedKey }) => writeQueues.set(combinedKey, next));
  try { await next; return items!; }
  finally { captures.forEach(({ combinedKey }) => { if (writeQueues.get(combinedKey) === next) writeQueues.delete(combinedKey); }); }
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
  return (key.endsWith(`.${storageOwnerSegment()}`) || key.endsWith(`.${storageOwnerSegment()}.__updatedAt`) || key.includes(`.${storageOwnerSegment()}.data-`)) && (
    key.startsWith("edgelab.workspace-share-copy.v1.workspace-copy-") ||
    Object.values(LEGACY_STORAGE_KEY_MAP).some(
      (prefix) => key === prefix || key.startsWith(`${prefix}.`),
    )
  );
}

function setCachedValue<T>(namespace: string, key: string, value: T, combinedKey = storageKey(namespace, key)) {
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
  if (!legacyKey || legacyKey === localKey || !appDataLegacyMigrationAllowed()) {
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

function writeLocalStorageValue<T>(key: string, value: T, updatedAt: number, access: AppDataAccess | null = captureAppDataAccess()) {
  assertAppDataAccess(access);
  if (typeof window === "undefined") {
    return false;
  }
  const localKey = localStorageKeyFor(key, access?.owner);
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

function localStorageKeyFor(key: string, owner = storageOwnerSegment()) {
  const legacyKey = legacyStorageKeyFor(key);
  return legacyKey ? appDataSessionKey(`${legacyKey}.${owner}`, owner) : null;
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
