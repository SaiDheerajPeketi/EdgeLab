import type { WorkspaceView } from "./workspace";

export type NavigationSurfaceState = {
  draft?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  openPanel?: string | null;
  scrollLeft: number;
  scrollTop: number;
  selectedId?: string | number | null;
};

const memory = new Map<WorkspaceView, NavigationSurfaceState>();
const STORAGE_KEY = "edgelab.navigation-surfaces.v2";

hydrateMemory();

export function rememberNavigationState(view: WorkspaceView, state: NavigationSurfaceState) {
  memory.set(view, structuredCloneSafe(state));
  persistMemory();
}

export function updateNavigationState(
  view: WorkspaceView,
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
  if (state.selectedId != null) query.set("selected", String(state.selectedId));
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

export function navigationStateFor(view: WorkspaceView) {
  const state = memory.get(view);
  return state ? structuredCloneSafe(state) : null;
}

export function rememberWindowScroll(view: WorkspaceView) {
  if (typeof window === "undefined") return;
  const current = memory.get(view);
  rememberNavigationState(view, {
    ...current,
    scrollLeft: window.scrollX,
    scrollTop: window.scrollY,
  });
}

export function restoreWindowScroll(view: WorkspaceView) {
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
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, NavigationSurfaceState>;
    Object.entries(stored).forEach(([view, state]) => {
      if (state && Number.isFinite(state.scrollLeft) && Number.isFinite(state.scrollTop)) {
        memory.set(view as WorkspaceView, structuredCloneSafe(state));
      }
    });
  } catch {
    // Navigation remains usable when storage is unavailable or contains stale data.
  }
}

function persistMemory() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(memory)));
  } catch {
    // In-memory restoration remains available for the current document.
  }
}

function safeToken(value: string | null) {
  if (!value) return null;
  const clean = value.trim().slice(0, 160);
  return clean || null;
}
