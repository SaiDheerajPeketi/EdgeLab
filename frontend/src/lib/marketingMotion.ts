import { useSyncExternalStore } from "react";
import { prefersReducedMotion } from "./motionPreferences";

type MotionChoice = "full" | "reduced";
const STORAGE_KEY = "edgelab.marketing.motion.v1";
const listeners = new Set<() => void>();
let choice: MotionChoice | null = null;
try {
  const stored = typeof window === "undefined" ? null : window.sessionStorage.getItem(STORAGE_KEY);
  if (stored === "full" || stored === "reduced") choice = stored;
} catch { /* Keep the control usable when browser storage is unavailable. */ }

export function prefersMarketingReducedMotion() {
  return choice === null ? prefersReducedMotion() : choice === "reduced";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => { listeners.delete(listener); query.removeEventListener("change", listener); };
}

export function setMarketingMotionChoice(next: MotionChoice) {
  choice = next;
  try { window.sessionStorage.setItem(STORAGE_KEY, next); } catch { /* In-memory choice still applies. */ }
  listeners.forEach(listener => listener());
}

export function useMarketingReducedMotionPreference() {
  return useSyncExternalStore(subscribe, prefersMarketingReducedMotion, () => true);
}
