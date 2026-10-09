import { getStoredAuthSession, hasWorkspaceAccess, subscribeAuthSession } from "./authSession";
import { validatePineAlertEvents, type PineAlertEvents, type PineAlertEvent } from "./pineAlertEvents";
import { validatePineConditionSamples, type PineConditionSamples } from "./pineConditionSamples";
import { resolvePineAlertMessage } from "./pineAlertPlaceholders";
import { pineCalculationStart } from "./pineCalculationTimeframe";
import { canonicalPineTimeframe, type PineAlertConditionDefinition, type PineContext } from "./pineProtocol";

export type PineConditionFrequency = "once" | "once_per_bar" | "once_per_bar_close" | "all";
export type PineChartConditionState = {
  conditions: PineAlertConditionDefinition[]; timeframe: string;
  frontier: { time: number; confirmed: boolean }; context: PineContext; primaryCutoff: number;
};

export type PineChartAlertSignal = {
  id: string; sourceId: string; name: string; symbol: string; timeframe: string;
  message: string; time: number; receivedAt: number; freq: PineAlertEvent["freq"] | "once"; condition?: string;
};
export type PineChartAlertSource = {
  id: string; name: string; symbol: string; timeframe: string;
  ready: boolean; enabled: boolean; reason?: string;
  conditions: PineAlertConditionDefinition[]; conditionId: string; frequency: PineConditionFrequency;
};
export type PineChartAlertSnapshot = {
  generation: number; sources: PineChartAlertSource[]; events: PineChartAlertSignal[];
  toast: PineChartAlertSignal | null; deliveryError: string | null;
};
export type PineChartAlertHandle = {
  id: string; setReady(conditions?: readonly PineAlertConditionDefinition[]): void; capture(epoch: number, sequence: number): number | undefined;
  collectConditions(receipt: number): boolean;
  receive(receipt: number, batch: PineAlertEvents | undefined, conditions?: PineConditionSamples): void;
  disarm(reason?: string): void; dispose(): void;
};
type Registration = {
  name: string; symbol: string; timeframe: string;
  readCurrent: () => { epoch: number; sequence: number; error?: boolean }; owns: () => boolean;
  readConditions?: () => PineChartConditionState | undefined;
};
type Entry = {
  source: PineChartAlertSource; registration: Registration;
  epoch: number; cutoff: number; captured: number; arm: number;
  pending: Map<number, { arm: number; receivedAt: number }>;
  conditionState?: PineChartConditionState; firedTime: number;
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
    this.snapshot = { ...this.snapshot, ...change, sources: Array.from(this.entries.values(), entry => ({ ...entry.source,
      conditions: entry.source.conditions.map(condition => ({ ...condition })) })) };
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
      timeframe: registration.timeframe.slice(0, 32), ready: false, enabled: false,
      conditions: [], conditionId: "all_calls", frequency: "once_per_bar" },
      registration, epoch: -1, cutoff: -1, captured: -1, arm: 0, pending: new Map(), firedTime: -1 };
    this.entries.set(id, entry); this.emit();
    const pause = (reason?: string, ready = false) => {
      if (this.entries.get(id) !== entry) return;
      entry.source = { ...entry.source, ready, enabled: false, reason };
      entry.arm++; entry.pending.clear(); entry.conditionState = undefined; entry.firedTime = -1; this.emit();
    };
    return {
      id,
      setReady: conditions => { if (this.owned(entry) && this.current(entry)) {
        entry.source = { ...entry.source, ready: true, ...(conditions ? { conditions: conditions.map(condition => ({ ...condition })) } : {}) }; this.emit();
      } },
      disarm: reason => pause(reason),
      collectConditions: receipt => entry.pending.get(receipt)?.arm === entry.arm && entry.source.conditionId !== "all_calls",
      capture: (epoch, sequence) => {
        if (!this.owned(entry) || !entry.source.enabled || !entry.source.ready) return;
        const current = this.current(entry);
        if (!current || current.epoch !== entry.epoch || epoch !== entry.epoch) { pause("The market changed. Enable alerts again when the indicator is ready."); return; }
        if (!Number.isSafeInteger(sequence) || sequence <= entry.cutoff || sequence <= entry.captured || sequence > current.sequence) return;
        if (entry.pending.size >= 32) { pause("Alerts paused because updates arrived too quickly. Enable them again to continue.", true); return; }
        entry.captured = sequence;
        const receipt = ++this.receipt;
        entry.pending.set(receipt, { arm: entry.arm, receivedAt: (this.options.now ?? Date.now)() });
        return receipt;
      },
      receive: (receipt, batch, conditions) => {
        const captured = entry.pending.get(receipt);
        entry.pending.delete(receipt);
        if (!captured || captured.arm !== entry.arm || !this.owned(entry) || !entry.source.ready || !entry.source.enabled) return;
        const current = this.current(entry);
        if (!current || current.epoch !== entry.epoch) { pause("The market changed. Enable alerts again when the indicator is ready."); return; }
        if (entry.source.conditionId !== "all_calls") {
          const state = entry.conditionState, definitionIndex = state?.conditions.findIndex(item => item.id === entry.source.conditionId) ?? -1;
          if (!state || definitionIndex < 0 || !conditions) { pause("Alerts paused after an incomplete response. Run the indicator again before enabling alerts."); return; }
          let checked: PineConditionSamples;
          const signals: PineChartAlertSignal[] = [];
          try {
            checked = validatePineConditionSamples(conditions, state.conditions.length);
            if (checked.calculationTimeframe !== state.timeframe) throw new Error("Calculation timeframe changed.");
            const definition = state.conditions[definitionIndex], symbol = state.context.symbol.split(":"), frequency = entry.source.frequency;
            for (const sample of checked.samples) {
              if (sample.bar.time < pineCalculationStart(state.primaryCutoff, state.timeframe)
                || sample.bar.time < state.frontier.time || sample.bar.time === state.frontier.time && state.frontier.confirmed
                || !sample.conditions[definitionIndex] || frequency === "once_per_bar_close" && !sample.confirmed
                || frequency === "once" && entry.firedTime >= 0
                || (frequency === "once_per_bar" || frequency === "once_per_bar_close") && sample.bar.time <= entry.firedTime) continue;
              const message = resolvePineAlertMessage(definition.message, { ticker: symbol.at(-1)!, exchange: symbol.length > 1 ? symbol[0] : "",
                interval: canonicalPineTimeframe(state.context.timeframe), currency: state.context.currency, basecurrency: state.context.basecurrency,
                bar: sample.bar, plots: sample.plots, receivedAt: captured.receivedAt });
              signals.push({ id: `pine-signal-${++this.serial}`, sourceId: id, name: entry.source.name, symbol: entry.source.symbol,
                timeframe: state.timeframe, message, time: sample.bar.time, receivedAt: captured.receivedAt, freq: frequency, condition: definition.title });
              entry.firedTime = sample.bar.time;
              if (frequency === "once") break;
            }
          } catch { pause("Alerts paused after an invalid response. Run the indicator again before enabling alerts."); return; }
          const latest = signals.at(-1);
          if (latest) {
            this.emit({ events: [...signals.slice().reverse(), ...this.snapshot.events].slice(0, 100), toast: latest, deliveryError: null });
            for (const signal of signals) if (this.owned(entry) && entry.arm === captured.arm && entry.source.enabled) {
              try { this.options.deliver?.(signal); }
              catch { if (this.owned(entry) && entry.arm === captured.arm) this.emit({ deliveryError: "An alert arrived, but sound or browser delivery failed. The message is saved below." }); }
            }
          }
          if (this.owned(entry) && entry.arm === captured.arm) {
            if (checked.dropped) pause(`Alerts paused: ${checked.dropped} calculations exceeded the per-update limit. Check the indicator before enabling alerts again.`, true);
            else if (latest && entry.source.frequency === "once") pause("Alert triggered.", true);
          }
          return;
        }
        if (!batch) return;
        let checked: PineAlertEvents;
        try { checked = validatePineAlertEvents(batch); }
        catch { pause("Alerts paused after an invalid response. Run the indicator again before enabling alerts."); return; }
        const signals = checked.events.map(event => ({ id: `pine-signal-${++this.serial}`, sourceId: id,
          name: entry.source.name, symbol: entry.source.symbol, timeframe: entry.source.timeframe,
          message: event.message, time: event.time, receivedAt: captured.receivedAt, freq: event.freq }));
        const latest = signals.at(-1);
        if (latest) {
          this.emit({ events: [...signals.reverse(), ...this.snapshot.events].slice(0, 100), toast: latest, deliveryError: null });
          // Delivery is immediate, never an effect that can replay old history.
          if (this.owned(entry) && entry.arm === captured.arm && entry.source.enabled) {
            try { this.options.deliver?.(latest); }
            catch { if (this.owned(entry) && entry.arm === captured.arm) this.emit({ deliveryError: "An alert arrived, but sound or browser delivery failed. The message is saved below." }); }
          }
        }
        if (checked.dropped && this.owned(entry) && entry.arm === captured.arm) pause(`Alerts paused: ${checked.dropped} messages exceeded the per-update limit. Check the indicator before enabling alerts again.`, true);
      },
      dispose: () => { if (this.entries.get(id) === entry) { entry.pending.clear(); this.entries.delete(id); this.emit(); } },
    };
  }
  setEnabled(id: string, enabled: boolean) {
    const entry = this.entries.get(id);
    if (!entry || !this.owned(entry)) return false;
    const current = this.current(entry);
    if (enabled && (!entry.source.ready || !current)) return false;
    let conditionState: PineChartConditionState | undefined;
    if (enabled && entry.source.conditionId !== "all_calls") {
      try {
        const state = entry.registration.readConditions?.();
        if (!state || !state.conditions.some(item => item.id === entry.source.conditionId)
          || state.conditions.length !== entry.source.conditions.length
          || state.conditions.some((item, index) => item.id !== entry.source.conditions[index].id
            || item.title !== entry.source.conditions[index].title || item.message !== entry.source.conditions[index].message)
          || !Number.isFinite(state.primaryCutoff) || state.primaryCutoff < 0) return false;
        conditionState = structuredClone(state);
      } catch { return false; }
    }
    entry.arm++; entry.pending.clear();
    entry.conditionState = conditionState; entry.firedTime = -1;
    entry.source = { ...entry.source, enabled, reason: undefined };
    if (enabled && current) { entry.epoch = current.epoch; entry.cutoff = current.sequence; entry.captured = current.sequence; }
    this.emit(); return true;
  }
  configure(id: string, selection: { conditionId: string; frequency?: PineConditionFrequency }) {
    const entry = this.entries.get(id);
    if (!entry || !this.owned(entry) || selection.conditionId !== "all_calls" && !entry.source.conditions.some(item => item.id === selection.conditionId)
      || selection.frequency !== undefined && !["once", "once_per_bar", "once_per_bar_close", "all"].includes(selection.frequency)) return false;
    entry.arm++; entry.pending.clear(); entry.conditionState = undefined; entry.firedTime = -1;
    entry.source = { ...entry.source, conditionId: selection.conditionId, frequency: selection.frequency ?? entry.source.frequency,
      enabled: false, reason: undefined };
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
