import { getStoredAuthSession, hasWorkspaceAccess, subscribeAuthSession } from "./authSession";
import { validatePineAlertEvents, type PineAlertEvents, type PineAlertEvent } from "./pineAlertEvents";

export type PineChartAlertSignal = {
  id: string; sourceId: string; name: string; symbol: string; timeframe: string;
  message: string; time: number; receivedAt: number; freq: PineAlertEvent["freq"];
};
export type PineChartAlertSource = {
  id: string; name: string; symbol: string; timeframe: string;
  ready: boolean; enabled: boolean; reason?: string;
};
export type PineChartAlertSnapshot = {
  generation: number; sources: PineChartAlertSource[]; events: PineChartAlertSignal[];
  toast: PineChartAlertSignal | null; deliveryError: string | null;
};
export type PineChartAlertHandle = {
  id: string; setReady(): void; capture(epoch: number, sequence: number): number | undefined;
  receive(receipt: number, batch: PineAlertEvents | undefined): void;
  disarm(reason?: string): void; dispose(): void;
};
type Registration = {
  name: string; symbol: string; timeframe: string;
  readCurrent: () => { epoch: number; sequence: number; error?: boolean }; owns: () => boolean;
};
type Entry = {
  source: PineChartAlertSource; registration: Registration;
  epoch: number; cutoff: number; captured: number; arm: number;
  pending: Map<number, number>;
};

/** Signals belong to one running chart instance, one account and one explicit arm. */
export class PineChartAlertStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private serial = 0;
  private receipt = 0;
  private snapshot: PineChartAlertSnapshot = { generation: 0, sources: [], events: [], toast: null, deliveryError: null };
  constructor(private options: { ownsAccount: () => boolean; deliver?: (signal: PineChartAlertSignal) => void; now?: () => number }) {}
  getGeneration = () => this.snapshot.generation;
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(change: Partial<PineChartAlertSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...change, sources: Array.from(this.entries.values(), entry => ({ ...entry.source })) };
    this.listeners.forEach(listener => listener());
  }
  private owned(entry: Entry) {
    try { return this.entries.get(entry.source.id) === entry && this.options.ownsAccount() && entry.registration.owns(); }
    catch { return false; }
  }
  private current(entry: Entry) {
    try {
      const current = entry.registration.readCurrent();
      return !current.error && Number.isSafeInteger(current.epoch) && current.epoch >= 0
        && Number.isSafeInteger(current.sequence) && current.sequence >= 0 ? current : undefined;
    } catch { return undefined; }
  }
  register(registration: Registration): PineChartAlertHandle | undefined {
    if (this.entries.size >= 64 || !this.options.ownsAccount()) return undefined;
    const id = `pine-chart-alert-${++this.serial}`;
    const entry: Entry = { source: { id, name: registration.name.slice(0, 160), symbol: registration.symbol.slice(0, 160),
      timeframe: registration.timeframe.slice(0, 32), ready: false, enabled: false },
      registration, epoch: -1, cutoff: -1, captured: -1, arm: 0, pending: new Map() };
    this.entries.set(id, entry); this.emit();
    const pause = (reason?: string, ready = false) => {
      if (this.entries.get(id) !== entry) return;
      entry.source = { ...entry.source, ready, enabled: false, reason };
      entry.arm++; entry.pending.clear(); this.emit();
    };
    return {
      id,
      setReady: () => { if (this.owned(entry) && this.current(entry)) { entry.source = { ...entry.source, ready: true }; this.emit(); } },
      disarm: reason => pause(reason),
      capture: (epoch, sequence) => {
        if (!this.owned(entry) || !entry.source.enabled || !entry.source.ready) return;
        const current = this.current(entry);
        if (!current || current.epoch !== entry.epoch || epoch !== entry.epoch) { pause("The market changed. Enable alerts again when the indicator is ready."); return; }
        if (!Number.isSafeInteger(sequence) || sequence <= entry.cutoff || sequence <= entry.captured || sequence > current.sequence) return;
        if (entry.pending.size >= 32) { pause("Alerts paused because updates arrived too quickly. Enable them again to continue.", true); return; }
        entry.captured = sequence;
        const receipt = ++this.receipt;
        entry.pending.set(receipt, entry.arm);
        return receipt;
      },
      receive: (receipt, batch) => {
        const arm = entry.pending.get(receipt);
        entry.pending.delete(receipt);
        if (arm === undefined || arm !== entry.arm || !this.owned(entry) || !entry.source.ready || !entry.source.enabled) return;
        const current = this.current(entry);
        if (!current || current.epoch !== entry.epoch) { pause("The market changed. Enable alerts again when the indicator is ready."); return; }
        if (!batch) return;
        let checked: PineAlertEvents;
        try { checked = validatePineAlertEvents(batch); }
        catch { pause("Alerts paused after an invalid response. Run the indicator again before enabling alerts."); return; }
        const signals = checked.events.map(event => ({ id: `pine-signal-${++this.serial}`, sourceId: id,
          name: entry.source.name, symbol: entry.source.symbol, timeframe: entry.source.timeframe,
          message: event.message, time: event.time, receivedAt: (this.options.now ?? Date.now)(), freq: event.freq }));
        const latest = signals.at(-1);
        if (latest) {
          this.emit({ events: [...signals.reverse(), ...this.snapshot.events].slice(0, 100), toast: latest, deliveryError: null });
          // Delivery is immediate, never an effect that can replay old history.
          if (this.owned(entry)) {
            try { this.options.deliver?.(latest); }
            catch { this.emit({ deliveryError: "An alert arrived, but sound or browser delivery failed. The message is saved below." }); }
          }
        }
        if (checked.dropped) pause(`Alerts paused: ${checked.dropped} messages exceeded the per-update limit. Check the indicator before enabling alerts again.`, true);
      },
      dispose: () => { if (this.entries.get(id) === entry) { entry.pending.clear(); this.entries.delete(id); this.emit(); } },
    };
  }
  setEnabled(id: string, enabled: boolean) {
    const entry = this.entries.get(id);
    if (!entry || !this.owned(entry)) return false;
    const current = this.current(entry);
    if (enabled && (!entry.source.ready || !current)) return false;
    entry.arm++; entry.pending.clear();
    entry.source = { ...entry.source, enabled, reason: undefined };
    if (enabled && current) { entry.epoch = current.epoch; entry.cutoff = current.sequence; entry.captured = current.sequence; }
    this.emit(); return true;
  }
  clearHistory = () => this.emit({ events: [], toast: null, deliveryError: null });
  dismissToast = () => this.emit({ toast: null });
  reset = () => { this.entries.forEach(entry => entry.pending.clear()); this.entries.clear();
    this.emit({ generation: this.snapshot.generation + 1, events: [], toast: null, deliveryError: null }); };
}

function readActor() {
  try { const session = getStoredAuthSession(); return session && hasWorkspaceAccess(session) ? `${session.user.id}:${session.token}` : ""; }
  catch { return ""; }
}

/** The identity event is essential: A → B → A can occur before React rerenders. */
export function createPineChartAlertAccount(deliver?: (signal: PineChartAlertSignal) => void) {
  let actor = readActor();
  const store = new PineChartAlertStore({ ownsAccount: () => !!actor && actor === readActor(), deliver });
  return { store, start() {
    const reconcile = (force = false) => { const next = readActor(); if (force || next !== actor) { actor = next; store.reset(); } };
    const identity = () => reconcile(true);
    const storage = (event: StorageEvent) => { if (event.key === null) reconcile(true); };
    const unsubscribe = subscribeAuthSession(() => reconcile());
    window.addEventListener("edgelab:auth-session-change", identity);
    window.addEventListener("storage", storage);
    reconcile();
    return () => { unsubscribe(); window.removeEventListener("edgelab:auth-session-change", identity);
      window.removeEventListener("storage", storage); actor = ""; store.reset(); };
  } };
}
