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

export function rememberNavigationState(view: WorkspaceView, state: NavigationSurfaceState) {
  memory.set(view, structuredCloneSafe(state));
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
