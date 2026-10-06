import { useSyncExternalStore } from "react";
import { deleteAuthSession } from "../../lib/api";
import { clearStoredAuthSession, getStoredAuthSession, subscribeAuthSession } from "../../lib/authSession";
import type { SaveState } from "./SettingsPrimitives";

const states = new Map<string, SaveState>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(token: string, state: SaveState) {
  states.set(token, state);
  listeners.forEach((listener) => listener());
}

/** Revocation belongs to the exact session that requested it, across renderer switches. */
export function useAccountSession() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const token = session?.token ?? "";
  const state = useSyncExternalStore(subscribe, () => states.get(token) ?? "idle");
  async function endSession() {
    if (!token || getStoredAuthSession()?.token !== token || states.get(token) === "saving") return;
    publish(token, "saving");
    try {
      const response = await deleteAuthSession(token);
      if (response?.ok !== true) throw new Error("Session revocation was not confirmed.");
      if (getStoredAuthSession()?.token !== token) { states.delete(token); return; }
      states.delete(token);
      clearStoredAuthSession();
      window.location.assign("/auth/signin");
    } catch {
      if (getStoredAuthSession()?.token === token) publish(token, "error");
      else states.delete(token);
    }
  }
  return { session, state, endSession };
}
