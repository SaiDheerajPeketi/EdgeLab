import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion() {
  return typeof window === "undefined" || window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeReducedMotion(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function useReducedMotionPreference() {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => true);
}
