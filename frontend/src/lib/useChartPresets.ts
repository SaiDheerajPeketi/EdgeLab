import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import { assertAppDataAccess, captureAppDataAccess } from "./appDataBarrier";
import { getStoredAuthSession, subscribeAuthSession } from "./authSession";
import { confirmChartPreset, readChartPresets, type ChartPresetIntent, type ChartPresetKind, type PresetRecord } from "./chartPresetOperations";
import { subscribeAppStorageItem } from "./serverStorage";
import { CHART_PRESET_KEYS } from "./chartPresetOperations";

type State<T> = { owner: string; presets: T[]; loaded: boolean; pending: "save" | "delete" | null; error: string | null; notice: string | null; retryAction: "load" | "save" | "delete" | null };

export function useChartPresets<T extends PresetRecord>(kind: ChartPresetKind, sanitize: (raw: unknown) => T[], enabled = true) {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const access = captureAppDataAccess();
  const owner = JSON.stringify([session?.user.id, session?.token, access?.epoch]);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const mounted = useRef(false);
  const ticket = useRef<object | null>(null);
  const failed = useRef<{ owner: string; intent: ChartPresetIntent<T>; applied: (values: T[]) => boolean } | null>(null);
  const [state, setState] = useState<State<T>>({ owner, presets: [], loaded: false, pending: null, error: null, notice: null, retryAction: null });

  function current(operation: object) {
    return mounted.current && ownerRef.current === owner && ticket.current === operation;
  }
  function update(patch: Partial<State<T>>) {
    setState((previous) => previous.owner === owner ? { ...previous, ...patch } : previous);
  }

  async function load() {
    if (!mounted.current || ownerRef.current !== owner || ticket.current) return;
    const operation = {}; ticket.current = operation;
    update({ loaded: false, error: null, retryAction: null });
    try {
      assertAppDataAccess(access);
      const values = await readChartPresets(kind, sanitize);
      if (!current(operation)) return;
      assertAppDataAccess(access);
      update({ presets: values, loaded: true });
    } catch {
      if (current(operation)) update({ error: "Couldn't load saved presets. Your drawing is still here.", retryAction: "load" });
    } finally {
      if (ticket.current === operation) ticket.current = null;
    }
  }

  useEffect(() => {
    mounted.current = true;
    ticket.current = null; failed.current = null;
    setState({ owner, presets: [], loaded: !enabled, pending: null, error: null, notice: null, retryAction: null });
    if (!enabled) return () => { mounted.current = false; ticket.current = null; };
    void load();
    const unsubscribe = subscribeAppStorageItem(CHART_PRESET_KEYS[kind], (raw) => {
      if (ownerRef.current !== owner || !mounted.current) return;
      try {
        assertAppDataAccess(access);
        // Storage publication is already guarded by the strict operation.
        update({ presets: sanitize(raw) });
      } catch { /* An old owner or replaced workspace cannot update this view. */ }
    });
    return () => { mounted.current = false; ticket.current = null; unsubscribe(); };
  }, [owner, kind, enabled]);

  async function execute(intent: ChartPresetIntent<T>, applied: (values: T[]) => boolean): Promise<boolean> {
    if (!enabled || !mounted.current || ownerRef.current !== owner || ticket.current || !state.loaded || state.owner !== owner) return false;
    const operation = {}; ticket.current = operation;
    failed.current = { owner, intent, applied };
    update({ pending: intent.action, error: null, notice: null, retryAction: null });
    try {
      assertAppDataAccess(access, true);
      const values = await confirmChartPreset(kind, intent, sanitize);
      if (!current(operation)) return false;
      assertAppDataAccess(access);
      const unchanged = applied(values);
      failed.current = null;
      update({ presets: values, notice: intent.action === "delete" ? `Deleted "${intent.name}".` : `Saved "${intent.name}".${unchanged ? "" : " Your newer drawing changes were kept."}` });
      return true;
    } catch (error) {
      if (!current(operation)) return false;
      const explanation = error instanceof Error && "requiresReload" in error ? error.message : error instanceof ApiError && error.status === 409 ? error.message : intent.action === "delete" ? "Couldn't confirm deletion. The preset is still available here." : "Couldn't confirm the preset save. Your changes are still here.";
      update({ error: explanation, retryAction: intent.action });
      return false;
    } finally {
      if (current(operation)) update({ pending: null });
      if (ticket.current === operation) ticket.current = null;
    }
  }

  function retry() {
    if (state.owner !== owner || ownerRef.current !== owner) return;
    if (state.retryAction === "load") { void load(); return; }
    const saved = failed.current;
    if (saved?.owner === owner) void execute(saved.intent, saved.applied);
  }
  const visible = state.owner === owner ? state : { ...state, presets: [], loaded: false, pending: null, error: null, notice: null, retryAction: null };
  return { ...visible, execute, retry };
}
