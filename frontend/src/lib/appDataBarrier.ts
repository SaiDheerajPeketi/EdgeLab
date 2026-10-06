import { getStoredAuthSession } from "./authSession";

const EPOCH_PREFIX = "edgelab.app-data-generation.v1.";
const UNCERTAIN_PREFIX = "edgelab.app-data-uncertain.v1.";
export type AppDataOperation = { version: 2; id: string; method: string; path: string; expected?: Readonly<Record<string, number>> };
type Epoch = { revision: string; phase: "ready" | "replacing" | "uncertain"; operation?: AppDataOperation };
export type AppDataAccess = { owner: string; token: string | null; epoch: string };
const initialEpochs = new Map<string, Epoch>();
const blockedOwners = new Set<string>();
const uncertainOwners = new Set<string>();
const participants = new Set<{ settle: (owner: string) => Promise<void>; invalidate: (owner: string) => void }>();

function readEpoch(owner: string): Epoch {
  const raw = typeof window === "undefined" ? null : window.localStorage.getItem(`${EPOCH_PREFIX}${owner}`);
  if (!raw) return { revision: "", phase: "ready" };
  const value = JSON.parse(raw) as Epoch;
  if (!value || typeof value.revision !== "string" || !value.revision ||
      !["ready", "replacing", "uncertain"].includes(value.phase)) throw new Error("Invalid data replacement state.");
  return value;
}

// Snapshot every owner at page startup. A suspended tab must never adopt a
// replacement just because that owner is encountered for the first time later.
if (typeof window !== "undefined") {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(EPOCH_PREFIX)) initialEpochs.set(key.slice(EPOCH_PREFIX.length), readEpoch(key.slice(EPOCH_PREFIX.length)));
    }
    const id = getStoredAuthSession()?.user.id;
    if (id) initialEpochs.set(`user-${id}`, readEpoch(`user-${id}`));
  } catch { /* A corrupt or inaccessible marker is rejected at admission. */ }
}

export class AppDataReloadRequiredError extends Error {
  readonly requiresReload = true;
  constructor(message = "Account data is being replaced or has changed in another tab. Reload the workspace before continuing.") {
    super(message);
    this.name = "AppDataReloadRequiredError";
  }
}

export function captureAppDataAccess(): AppDataAccess | null {
  const session = getStoredAuthSession();
  if (!session?.user.id) return null;
  const owner = `user-${session.user.id}`;
  return { owner, token: session.token ?? null, epoch: initialEpochs.get(owner)?.revision ?? "" };
}

export function assertAppDataAccess(access: AppDataAccess | null, mutation = false, allowBlocked = false) {
  if (!access) return;
  const current = captureAppDataAccess();
  if (!current || current.owner !== access.owner || current.token !== access.token) {
    throw new DOMException("Account session changed", "AbortError");
  }
  let epoch: Epoch;
  try { epoch = readEpoch(access.owner); } catch { throw new AppDataReloadRequiredError("The browser could not verify the account replacement state. Reload before continuing."); }
  if (epoch.revision !== access.epoch || (!allowBlocked && blockedOwners.has(access.owner)) ||
      initialEpochs.get(access.owner)?.phase === "replacing") throw new AppDataReloadRequiredError();
  if (mutation && (epoch.phase !== "ready" || uncertainOwners.has(access.owner) || hasRequestMarkers(access.owner, true))) {
    throw new AppDataReloadRequiredError("A previous account save has an unverified result. Further saves and imports are paused until its server completion is confirmed.");
  }
}

export function appDataSessionKey(base: string, owner: string) {
  const revision = initialEpochs.get(owner)?.revision;
  return revision ? `${base}.data-${revision}` : base;
}

export function appDataLegacyMigrationAllowed() {
  const access = captureAppDataAccess();
  assertAppDataAccess(access);
  return !access || (!readEpoch(access.owner).revision && !hasRequestMarkers(access.owner));
}

export function registerAppDataParticipant(participant: { settle: (owner: string) => Promise<void>; invalidate: (owner: string) => void }) {
  participants.add(participant);
  return () => participants.delete(participant);
}

function hasRequestMarkers(owner: string, uncertainOnly = false) {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(`${UNCERTAIN_PREFIX}${owner}.`) &&
        (!uncertainOnly || markerPhase(window.localStorage.getItem(key)) !== "pending")) return true;
  }
  return false;
}

function markerPhase(raw: string | null) {
  if (raw === "p") return "pending";
  try { const value = JSON.parse(raw ?? "null"); return parseOperation(value) && value.phase === "pending" ? "pending" : "uncertain"; }
  catch { return "uncertain"; }
}

function parseOperation(value: unknown): AppDataOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as AppDataOperation;
  return item.version === 2 && typeof item.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.id) &&
    ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(item.method) && typeof item.path === "string" && item.path.startsWith("/")
    ? { version: 2, id: item.id, method: item.method, path: item.path, ...(item.expected ? { expected: item.expected } : {}) } : null;
}

function recordUncertain(owner: string, marker?: string) {
  uncertainOwners.add(owner);
  // The original per-request marker is already durable. Even if this update
  // fails or the tab disappears before catch, exclusive import sees that marker.
  if (marker) { try {
    const raw = window.localStorage.getItem(marker);
    const value = raw && raw !== "p" && raw !== "u" ? JSON.parse(raw) : null;
    window.localStorage.setItem(marker, parseOperation(value) ? JSON.stringify({ ...value, phase: "uncertain" }) : "u");
  } catch { /* Retain pending marker. */ } }
}

export type RequestProgress = { sent: () => void; completed: () => void; operation?: AppDataOperation };
export async function runAppDataRequest<T>(access: AppDataAccess | null, portableMutation: boolean, execute: (progress: RequestProgress) => Promise<T>, specification?: { method: string; path: string }): Promise<T> {
  const run = async () => {
    assertAppDataAccess(access, portableMutation);
    const id = access && portableMutation && window.navigator?.locks && window.crypto?.randomUUID ? window.crypto.randomUUID() : null;
    const operation: AppDataOperation | undefined = id && specification ? { version: 2, id, ...specification } : undefined;
    const marker = id && access ? `${UNCERTAIN_PREFIX}${access.owner}.${id}` : null;
    if (marker) {
      const value = operation ? JSON.stringify({ ...operation, phase: "pending" }) : "p";
      window.localStorage.setItem(marker, value);
      if (window.localStorage.getItem(marker) !== value) throw new Error("The browser could not reserve a safe account save. No request was sent.");
    }
    let sent = false;
    let completed = false;
    let result: T;
    try { result = await execute({ operation, sent: () => { sent = true; }, completed: () => { completed = true; } }); }
    catch (error) {
      if (access && portableMutation && sent && !completed) recordUncertain(access.owner, marker ?? undefined);
      // Never publish a previous session's response or error.
      assertAppDataAccess(access);
      throw error;
    } finally {
      if (marker && (completed || !sent)) {
        try { window.localStorage.removeItem(marker); }
        catch { if (access) recordUncertain(access.owner, marker); }
      }
    }
    assertAppDataAccess(access);
    return result;
  };
  // Existing reads and writes remain usable where Web Locks is unavailable;
  // replacement itself requires the cross-tab lock and fails before any POST.
  const locks = typeof window === "undefined" ? undefined : window.navigator?.locks;
  return access && locks ? await locks.request(`edgelab.app-data.${access.owner}`, { mode: "shared" }, run) as T : run();
}

function purgeOwnerMirrors(owner: string) {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    if (!storage) continue;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith("edgelab.") && !key.startsWith(EPOCH_PREFIX) && !key.startsWith(UNCERTAIN_PREFIX) &&
          (key.endsWith(`.${owner}`) || key.endsWith(`.${owner}.__updatedAt`) || key.includes(`.${owner}.data-`))) storage.removeItem(key);
    }
  }
}

export async function runAppDataReplacement<T>(owner: { id: number; token: string }, execute: (sent: () => void, operation?: AppDataOperation) => Promise<T>, specification?: { expected: Readonly<Record<string, number>> }): Promise<T> {
  const access = captureAppDataAccess();
  if (!access) throw new Error("Sign in before replacing account data.");
  if (access.owner !== `user-${owner.id}` || access.token !== owner.token) throw new DOMException("Account session changed", "AbortError");
  assertAppDataAccess(access, true);
  const locks = window.navigator?.locks;
  if (!locks || !window.crypto?.randomUUID) throw new Error("This browser cannot coordinate a safe import across tabs. Use a secure browser with Web Locks support.");
  // Verify durable browser storage before closing admission or waiting.
  const probeKey = `edgelab.app-data-probe.${window.crypto.randomUUID()}`;
  window.localStorage.setItem(probeKey, "probe");
  if (window.localStorage.getItem(probeKey) !== "probe") throw new Error("The browser could not reserve a safe import. No request was sent.");
  window.localStorage.removeItem(probeKey);
  blockedOwners.add(access.owner);
  let advanced = false;
  let sent = false;
  let success = false;
  try {
    // Queued work is rejected before it can send; already-sent API work retains
    // its shared lock through the response body. Both finish before replacement.
    await Promise.all([...participants].map((participant) => participant.settle(access.owner)));
    const result = await locks.request(`edgelab.app-data.${access.owner}`, { mode: "exclusive" }, async () => {
      assertAppDataAccess(access, true, true);
      if (hasRequestMarkers(access.owner)) throw new AppDataReloadRequiredError("A previous account save has an unverified result. Import is paused until its server completion is confirmed.");
      const operation: AppDataOperation | undefined = specification ? { version: 2, id: window.crypto.randomUUID(), method: "POST", path: "/app-data/import", expected: specification.expected } : undefined;
      const setEpoch = (phase: Epoch["phase"]) => {
        const value = JSON.stringify({ revision: window.crypto.randomUUID(), phase, ...(phase !== "ready" && operation ? { operation } : {}) } satisfies Epoch);
        window.localStorage.setItem(`${EPOCH_PREFIX}${access.owner}`, value);
        if (window.localStorage.getItem(`${EPOCH_PREFIX}${access.owner}`) !== value) throw new Error("The browser could not record the account replacement state.");
      };
      setEpoch("replacing");
      advanced = true;
      try {
        purgeOwnerMirrors(access.owner);
        participants.forEach((participant) => participant.invalidate(access.owner));
        // Identity is checked after local cleanup; no old token can use a new owner.
        const current = captureAppDataAccess();
        if (!current || current.owner !== access.owner || current.token !== access.token) throw new DOMException("Account session changed", "AbortError");
        const result = await execute(() => { sent = true; }, operation);
        success = true;
        return result;
      } finally {
        if (sent && !success) recordUncertain(access.owner);
        // A tab opened during replacement captured the first revision and must
        // reload too; it cannot replay defaults or reads obtained mid-import.
        setEpoch(success || !sent ? "ready" : "uncertain");
      }
    });
    const current = captureAppDataAccess();
    if (!current || current.owner !== access.owner || current.token !== access.token) throw new DOMException("Account session changed", "AbortError");
    return result as T;
  } finally {
    if (!advanced) blockedOwners.delete(access.owner);
  }
}

export function appDataRecoveryNeeded(owner: string) {
  return readEpoch(owner).phase !== "ready" || hasRequestMarkers(owner) || uncertainOwners.has(owner);
}

/** Receipt checks never replay requests. A fresh generation discards optimistic mirrors. */
export async function recoverAppDataOperations<T>(access: AppDataAccess, verify: (operation: AppDataOperation) => Promise<T>, identity: () => void): Promise<{ requiresReload: boolean; results: T[] }> {
  const locks = window.navigator?.locks;
  if (!locks || !window.crypto?.randomUUID) throw new Error("This browser cannot coordinate safe recovery across tabs. Use a secure browser with Web Locks support.");
  identity();
  blockedOwners.add(access.owner);
  let advanced = false;
  try {
    await Promise.all([...participants].map((participant) => participant.settle(access.owner)));
    return await locks.request(`edgelab.app-data.${access.owner}`, { mode: "exclusive" }, async () => {
      identity();
      const epochKey = `${EPOCH_PREFIX}${access.owner}`;
      const previousEpoch = window.localStorage.getItem(epochKey);
      const epoch = readEpoch(access.owner);
      const markers = new Map<string, string>();
      const operations = new Map<string, AppDataOperation>();
      const add = (operation: AppDataOperation) => {
        const previous = operations.get(operation.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(operation)) throw new AppDataReloadRequiredError("Conflicting recovery metadata. Saves remain paused.");
        operations.set(operation.id, operation);
      };
      if (epoch.phase !== "ready") {
        const operation = parseOperation(epoch.operation);
        if (!operation || operation.method !== "POST" || operation.path !== "/app-data/import" || !operation.expected) throw new AppDataReloadRequiredError("This interrupted import has no server receipt. Its completion cannot be recovered automatically.");
        add(operation);
      }
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(`${UNCERTAIN_PREFIX}${access.owner}.`)) continue;
        const raw = window.localStorage.getItem(key)!;
        let value;
        try { value = JSON.parse(raw); } catch { /* Older markers cannot prove server completion. */ }
        const operation = parseOperation(value);
        if (!operation || key !== `${UNCERTAIN_PREFIX}${access.owner}.${operation.id}` || !["pending", "uncertain"].includes(value.phase)) throw new AppDataReloadRequiredError("A previous save has no valid server receipt. Its completion cannot be recovered automatically.");
        markers.set(key, raw);
        add(operation);
      }
      if (!operations.size) {
        if (uncertainOwners.has(access.owner)) throw new AppDataReloadRequiredError("A previous save has no server receipt. Saves remain paused.");
        return { requiresReload: false, results: [] as T[] };
      }
      const results: T[] = [];
      for (const operation of operations.values()) { results.push(await verify(operation)); identity(); }
      // Validate the whole batch before changing local state, including writes
      // from older clients which do not participate in the browser lock.
      const currentMarkers = new Map<string, string>();
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(`${UNCERTAIN_PREFIX}${access.owner}.`)) currentMarkers.set(key, window.localStorage.getItem(key)!);
      }
      if (window.localStorage.getItem(epochKey) !== previousEpoch || currentMarkers.size !== markers.size || [...markers].some(([key, value]) => currentMarkers.get(key) !== value)) throw new AppDataReloadRequiredError("Recovery state changed. Check completion again before continuing.");
      // Keep even formerly pending markers blocking after a crash or failed
      // cleanup once a ready generation has been written.
      for (const [key, raw] of markers) {
        const value = JSON.stringify({ ...JSON.parse(raw), phase: "uncertain" });
        window.localStorage.setItem(key, value);
        if (window.localStorage.getItem(key) !== value) throw new Error("The browser could not record recovery. Saves remain paused.");
      }
      purgeOwnerMirrors(access.owner);
      participants.forEach((participant) => participant.invalidate(access.owner));
      identity();
      const ready = JSON.stringify({ revision: window.crypto.randomUUID(), phase: "ready" } satisfies Epoch);
      window.localStorage.setItem(epochKey, ready);
      if (window.localStorage.getItem(epochKey) !== ready) throw new Error("The browser could not record recovery. Saves remain paused.");
      advanced = true;
      for (const key of markers.keys()) {
        window.localStorage.removeItem(key);
        if (window.localStorage.getItem(key) !== null) throw new Error("The browser could not finish recovery. Reload and check completion again.");
      }
      uncertainOwners.delete(access.owner);
      return { requiresReload: true, results };
    }) as { requiresReload: boolean; results: T[] };
  } finally { if (!advanced) blockedOwners.delete(access.owner); }
}
