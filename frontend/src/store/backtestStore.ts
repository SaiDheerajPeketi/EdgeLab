import { create } from "zustand";
import {
  BacktestState,
  Candle,
  DatasetMeta,
  JournalPayload,
  OrderPayload,
  OrderUpdatePayload,
  Playbook,
  Trade,
  advanceBacktest,
  createBacktest,
  deleteBacktestOrder,
  getBars,
  getLatestBacktest,
  getMeta,
  getPlaybooks,
  jumpBacktest,
  patchBacktestOrder,
  patchJournal,
  postBacktestOrder,
} from "../lib/api";

const WINDOW_SIZE = 1500;

type BacktestStore = {
  bars: Candle[];
  barOffset: number;
  meta: DatasetMeta | null;
  state: BacktestState | null;
  playbooks: Playbook[];
  isLoading: boolean;
  isStepping: boolean;
  isPlaying: boolean;
  speedMs: number;
  error: string | null;
  loadInitial: () => Promise<void>;
  newSession: () => Promise<void>;
  stepForward: (steps?: number) => Promise<void>;
  resetReplay: () => Promise<void>;
  jumpToOffset: (offset: number) => Promise<void>;
  jumpToTimestamp: (timestamp: string) => Promise<void>;
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  placeOrder: (payload: OrderPayload) => Promise<void>;
  amendOrder: (orderId: number, payload: OrderUpdatePayload) => Promise<void>;
  cancelOrder: (orderId: number) => Promise<void>;
  updateJournal: (tradeId: number, payload: JournalPayload) => Promise<Trade>;
};

export const useBacktestStore = create<BacktestStore>((set, get) => ({
  bars: [],
  barOffset: 0,
  meta: null,
  state: null,
  playbooks: [],
  isLoading: false,
  isStepping: false,
  isPlaying: false,
  speedMs: 450,
  error: null,

  loadInitial: async () => {
    set({ isLoading: true, error: null });
    try {
      const [meta, state, playbooks] = await Promise.all([
        getMeta(),
        getLatestBacktest(),
        getPlaybooks(),
      ]);
      const { bars, barOffset } = await loadWindow(state.session.current_offset);
      set({ meta, state, playbooks, bars, barOffset, isLoading: false });
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false, isPlaying: false });
    }
  },

  newSession: async () => {
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const state = await createBacktest();
      const { bars, barOffset } = await loadWindow(state.session.current_offset);
      set({ state, bars, barOffset, isLoading: false });
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  stepForward: async (steps = 1) => {
    const sessionId = get().state?.session.id;
    if (!sessionId || get().isStepping) {
      return;
    }

    set({ isStepping: true });
    try {
      const state = await advanceBacktest(sessionId, steps);
      const bars = await ensureBarsForOffset(
        get().bars,
        get().barOffset,
        state.session.current_offset,
      );
      set({
        state,
        bars: bars.bars,
        barOffset: bars.barOffset,
        error: null,
        isStepping: false,
        isPlaying: state.session.status === "ACTIVE" ? get().isPlaying : false,
      });
    } catch (error) {
      set({ error: toErrorMessage(error), isPlaying: false, isStepping: false });
    }
  },

  resetReplay: async () => {
    await get().newSession();
  },

  jumpToOffset: async (offset: number) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const state = await jumpBacktest(sessionId, { offset });
      const { bars, barOffset } = await loadWindow(state.session.current_offset);
      set({ state, bars, barOffset, isLoading: false });
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  jumpToTimestamp: async (timestamp: string) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const state = await jumpBacktest(sessionId, { timestamp });
      const { bars, barOffset } = await loadWindow(state.session.current_offset);
      set({ state, bars, barOffset, isLoading: false });
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  setPlaying: (value) => set({ isPlaying: value }),
  setSpeed: (value) => set({ speedMs: value }),

  placeOrder: async (payload) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    try {
      const state = await postBacktestOrder(sessionId, payload);
      set({ state, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  amendOrder: async (orderId, payload) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    try {
      const state = await patchBacktestOrder(sessionId, orderId, payload);
      set({ state, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  cancelOrder: async (orderId) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    try {
      const state = await deleteBacktestOrder(sessionId, orderId);
      set({ state, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  updateJournal: async (tradeId, payload) => {
    const trade = await patchJournal(tradeId, payload);
    await get().loadInitial();
    return trade;
  },
}));

async function loadWindow(currentOffset: number) {
  const barOffset = Math.max(0, currentOffset - WINDOW_SIZE + 1);
  const limit = currentOffset - barOffset + 1;
  const response = await getBars(barOffset, limit);
  return { bars: response.bars, barOffset };
}

async function ensureBarsForOffset(
  bars: Candle[],
  barOffset: number,
  offset: number,
) {
  if (offset < barOffset || offset >= barOffset + WINDOW_SIZE) {
    return loadWindow(offset);
  }

  const loadedThrough = barOffset + bars.length - 1;
  if (offset <= loadedThrough) {
    return { bars, barOffset };
  }

  const response = await getBars(loadedThrough + 1, offset - loadedThrough);
  return { bars: [...bars, ...response.bars], barOffset };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}
