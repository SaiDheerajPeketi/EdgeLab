import type { WorkspaceView } from "./workspace";
import { getStoredAuthSession } from "./authSession";
import { appDataSessionKey, assertAppDataAccess, captureAppDataAccess, registerAppDataParticipant } from "./appDataBarrier";

export type NavigationSurfaceId = WorkspaceView | `journal:${string}` | `reports:${string}` | `settings:${string}` | `chart:${string}`;

export type NavigationSurfaceState = {
  draft?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  openPanel?: string | null;
  scrollLeft: number;
  scrollTop: number;
  selectedId?: string | number | Array<string | number> | null;
  viewport?: Record<string, number | string | boolean | null>;
};

const memory = new Map<NavigationSurfaceId, NavigationSurfaceState>();
const STORAGE_PREFIX = "edgelab.navigation-surfaces.v3";
let activeOwner = ownerSegment();

registerAppDataParticipant({ settle: async () => undefined, invalidate: (owner) => { if (owner === activeOwner) memory.clear(); } });

hydrateMemory();
if (typeof window !== "undefined") window.addEventListener("edgelab:auth-session-change", reloadNavigationStateForAuth);

export function rememberNavigationState(view: NavigationSurfaceId, state: NavigationSurfaceState) {
  try { assertAppDataAccess(captureAppDataAccess()); } catch { return; }
  reloadNavigationStateForAuth();
  memory.set(view, structuredCloneSafe(state));
  persistMemory();
}

export function updateNavigationState(
  view: NavigationSurfaceId,
  patch: Partial<NavigationSurfaceState>,
) {
  const current = memory.get(view) ?? { scrollLeft: 0, scrollTop: 0 };
  rememberNavigationState(view, { ...current, ...patch });
}

/** Encodes restorable product context without putting drafts or private filters in the URL. */
export function navigationDeepLink(
  view: WorkspaceView,
  state: Pick<NavigationSurfaceState, "openPanel" | "selectedId"> = {},
) {
  const query = new URLSearchParams();
  if (state.openPanel) query.set("panel", state.openPanel);
  if (state.selectedId != null && !Array.isArray(state.selectedId)) query.set("selected", String(state.selectedId));
  const suffix = query.toString();
  return `#workspace/${encodeURIComponent(view)}${suffix ? `?${suffix}` : ""}`;
}

export function parseNavigationDeepLink(hash: string) {
  const match = hash.match(/^#workspace\/([^?]+)(?:\?(.+))?$/);
  if (!match) return null;
  const query = new URLSearchParams(match[2] ?? "");
  return {
    view: decodeURIComponent(match[1]) as WorkspaceView,
    openPanel: safeToken(query.get("panel")),
    selectedId: safeToken(query.get("selected")),
  };
}

export function navigationStateFor(view: NavigationSurfaceId) {
  try { assertAppDataAccess(captureAppDataAccess()); } catch { return null; }
  reloadNavigationStateForAuth();
  const state = memory.get(view);
  return state ? structuredCloneSafe(state) : null;
}

export function rememberWindowScroll(view: NavigationSurfaceId) {
  if (typeof window === "undefined") return;
  const current = memory.get(view);
  rememberNavigationState(view, {
    ...current,
    scrollLeft: window.scrollX,
    scrollTop: window.scrollY,
  });
}

export function restoreWindowScroll(view: NavigationSurfaceId) {
  if (typeof window === "undefined") return () => undefined;
  const state = navigationStateFor(view);
  if (!state) return () => undefined;
  let secondFrame = 0;
  const firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(() => window.scrollTo({ left: state.scrollLeft, top: state.scrollTop }));
  });
  return () => {
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
  };
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function hydrateMemory() {
  if (typeof window === "undefined") return;
  try {
    assertAppDataAccess(captureAppDataAccess());
    const stored = JSON.parse(window.sessionStorage.getItem(storageKey(activeOwner)) ?? "{}") as Record<string, NavigationSurfaceState>;
    Object.entries(stored).forEach(([view, state]) => {
      if (state && Number.isFinite(state.scrollLeft) && Number.isFinite(state.scrollTop)) {
        memory.set(view as NavigationSurfaceId, structuredCloneSafe(state));
      }
    });
  } catch {
    // Navigation remains usable when storage is unavailable or contains stale data.
  }
}

function persistMemory() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(activeOwner), JSON.stringify(Object.fromEntries(memory)));
  } catch {
    // In-memory restoration remains available for the current document.
  }
}

export function reloadNavigationStateForAuth() {
  const nextOwner = ownerSegment();
  if (nextOwner === activeOwner) return;
  memory.clear();
  activeOwner = nextOwner;
  hydrateMemory();
}

function ownerSegment() {
  const user = getStoredAuthSession()?.user;
  return user?.id ? `user-${user.id}` : user?.email ? `user-${encodeURIComponent(user.email.toLowerCase())}` : "anonymous";
}

function storageKey(owner: string) {
  return appDataSessionKey(`${STORAGE_PREFIX}.${owner}`, owner);
}

function safeToken(value: string | null) {
  if (!value) return null;
  const clean = value.trim().slice(0, 160);
  return clean || null;
}
