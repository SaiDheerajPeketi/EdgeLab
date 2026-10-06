import { useSyncExternalStore } from "react";
import { getStoredAuthSession, subscribeAuthSession } from "./authSession";

const pending = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => revision;
const owner = () => String(getStoredAuthSession()?.user.id ?? "anonymous");
const notify = () => { revision += 1; listeners.forEach((listener) => listener()); };

/** Pending saves outlive a renderer; the next form cannot submit the same task twice. */
export async function runJournalMutation<T>(surface: string, work: () => Promise<T>) {
  const key = `${owner()}:${surface}`;
  if (pending.has(key)) throw new Error("A save is already in progress. Wait for it to finish before retrying.");
  pending.add(key); notify();
  try { return await work(); }
  finally { pending.delete(key); notify(); }
}

export function useJournalMutationPending(surface: string) {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  useSyncExternalStore(subscribe, snapshot, () => 0);
  return pending.has(`${session?.user.id ?? "anonymous"}:${surface}`);
}
