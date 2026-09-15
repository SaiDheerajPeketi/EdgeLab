import type { Candle } from "./api";
import type { SyncedChartCrosshair } from "./chartWorkspace";

export type ChartCrosshairSyncEvent =
  | { type: "crosshair"; value: SyncedChartCrosshair }
  | { type: "disabled" };

type FrameScheduler = {
  cancelFrame: (frameId: number) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
};

export type ChartCrosshairSyncBus = {
  dispose: () => void;
  publish: (value: SyncedChartCrosshair) => void;
  setEnabled: (enabled: boolean) => void;
  subscribe: (listener: (event: ChartCrosshairSyncEvent) => void) => () => void;
};

export function createChartCrosshairSyncBus(
  scheduler: FrameScheduler = {
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
  },
): ChartCrosshairSyncBus {
  const listeners = new Set<(event: ChartCrosshairSyncEvent) => void>();
  let enabled = true;
  let frameId: number | null = null;
  let pending: SyncedChartCrosshair | null = null;
  let revision = 0;

  const emit = (event: ChartCrosshairSyncEvent) => {
    for (const listener of [...listeners]) listener(event);
  };

  const flush = () => {
    frameId = null;
    if (!enabled || !pending) return;
    const value = pending;
    pending = null;
    emit({ type: "crosshair", value });
  };

  const cancelPending = () => {
    pending = null;
    if (frameId == null) return;
    scheduler.cancelFrame(frameId);
    frameId = null;
  };

  return {
    dispose() {
      cancelPending();
      listeners.clear();
    },
    publish(value) {
      if (!enabled) return;
      revision += 1;
      pending = { ...value, revision };
      if (frameId == null) frameId = scheduler.requestFrame(flush);
    },
    setEnabled(nextEnabled) {
      if (enabled === nextEnabled) return;
      enabled = nextEnabled;
      if (enabled) return;
      cancelPending();
      emit({ type: "disabled" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ChartCandleSnapshotStore = {
  getSnapshot: () => Candle | null;
  setSnapshot: (candle: Candle | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createChartCandleSnapshotStore(): ChartCandleSnapshotStore {
  const listeners = new Set<() => void>();
  let snapshot: Candle | null = null;

  return {
    getSnapshot: () => snapshot,
    setSnapshot(candle) {
      if (snapshot === candle) return;
      snapshot = candle;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
