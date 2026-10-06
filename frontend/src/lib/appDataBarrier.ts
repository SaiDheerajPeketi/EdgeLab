import { getStoredAuthSession } from "./authSession";

const EPOCH_PREFIX = "edgelab.app-data-generation.v1.";
const UNCERTAIN_PREFIX = "edgelab.app-data-uncertain.v1.";
type Epoch = { revision: string; phase: "ready" | "replacing" | "uncertain" };
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
  return !access || (!readEpoch(access.owner).revision && !hasRequestMarkers(access.owner, true));
}

export function registerAppDataParticipant(participant: { settle: (owner: string) => Promise<void>; invalidate: (owner: string) => void }) {
  participants.add(participant);
  return () => participants.delete(participant);
}

function hasRequestMarkers(owner: string, uncertainOnly = false) {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(`${UNCERTAIN_PREFIX}${owner}.`) &&
        (!uncertainOnly || window.localStorage.getItem(key) !== "p")) return true;
  }
  return false;
}

function recordUncertain(owner: string, marker?: string) {
  uncertainOwners.add(owner);
  // The original per-request marker is already durable. Even if this update
  // fails or the tab disappears before catch, exclusive import sees that marker.
  if (marker) { try { window.localStorage.setItem(marker, "u"); } catch { /* Retain pending marker. */ } }
}

type RequestProgress = { sent: () => void; completed: () => void };
export async function runAppDataRequest<T>(access: AppDataAccess | null, portableMutation: boolean, execute: (progress: RequestProgress) => Promise<T>): Promise<T> {
  const run = async () => {
    assertAppDataAccess(access, portableMutation);
    const marker = access && portableMutation && window.navigator?.locks && window.crypto?.randomUUID
      ? `${UNCERTAIN_PREFIX}${access.owner}.${window.crypto.randomUUID()}` : null;
    if (marker) {
      window.localStorage.setItem(marker, "p");
      if (window.localStorage.getItem(marker) !== "p") throw new Error("The browser could not reserve a safe account save. No request was sent.");
    }
    let sent = false;
    let completed = false;
    let result: T;
    try { result = await execute({ sent: () => { sent = true; }, completed: () => { completed = true; } }); }
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

export async function runAppDataReplacement<T>(owner: { id: number; token: string }, execute: (sent: () => void) => Promise<T>): Promise<T> {
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
      const setEpoch = (phase: Epoch["phase"]) => {
        const value = JSON.stringify({ revision: window.crypto.randomUUID(), phase } satisfies Epoch);
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
        const result = await execute(() => { sent = true; });
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
