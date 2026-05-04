import { create } from "zustand";
import {
  BacktestState,
  BacktestCreatePayload,
  Candle,
  DatasetCatalog,
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
  getDatasets,
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
  datasets: DatasetCatalog | null;
  meta: DatasetMeta | null;
  state: BacktestState | null;
  playbooks: Playbook[];
  isLoading: boolean;
  isStepping: boolean;
  isPlaying: boolean;
  speedMs: number;
  error: string | null;
  loadInitial: () => Promise<void>;
  newSession: (payload?: BacktestCreatePayload) => Promise<void>;
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
  datasets: null,
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
      const [datasetsResult, playbooksResult] = await Promise.allSettled([
        getDatasets(),
        getPlaybooks(),
      ]);
      const datasets = datasetsResult.status === "fulfilled" ? datasetsResult.value : null;
      const playbooks = playbooksResult.status === "fulfilled" ? playbooksResult.value : [];
      const state = await getLatestBacktest().catch(() => createBacktest({}));
      const [meta, window] = await Promise.all([
        getMeta(state.session.id),
        loadWindow(
          state.session.current_offset,
          state.session.id,
          state.session.start_offset,
        ),
      ]);
      set({
        datasets,
        meta,
        state,
        playbooks,
        bars: window.bars,
        barOffset: window.barOffset,
        error:
          datasetsResult.status === "rejected"
            ? toErrorMessage(datasetsResult.reason)
            : playbooksResult.status === "rejected"
              ? toErrorMessage(playbooksResult.reason)
              : null,
        isLoading: false,
      });
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false, isPlaying: false });
    }
  },

  newSession: async (payload = {}) => {
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const state = await createBacktest(payload);
      const [meta, window] = await Promise.all([
        getMeta(state.session.id),
        loadWindow(
          state.session.current_offset,
          state.session.id,
          state.session.start_offset,
        ),
      ]);
      set({
        meta,
        state,
        bars: window.bars,
        barOffset: window.barOffset,
        isLoading: false,
      });
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
        state.session.id,
        state.session.start_offset,
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
    const session = get().state?.session;
    await get().newSession(
      session
        ? {
            name: session.name,
            symbol: session.symbol,
            instrument: session.instrument,
            timeframe: session.timeframe,
            csv_path: session.csv_path,
            strategy_name: session.strategy_name,
            playbook_id: session.playbook_id,
            start_timestamp: session.start_at,
            end_timestamp: session.end_at,
            initial_balance: session.initial_balance,
          }
        : {},
    );
  },

  jumpToOffset: async (offset: number) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const state = await jumpBacktest(sessionId, { offset });
      const { bars, barOffset } = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
      );
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
      const { bars, barOffset } = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
      );
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

async function loadWindow(currentOffset: number, sessionId?: number, startOffset = 0) {
  const barOffset = Math.max(startOffset, currentOffset - WINDOW_SIZE + 1);
  const limit = currentOffset - barOffset + 1;
  const response = await getBars(barOffset, limit, sessionId);
  return { bars: response.bars, barOffset };
}

async function ensureBarsForOffset(
  bars: Candle[],
  barOffset: number,
  offset: number,
  sessionId?: number,
  startOffset = 0,
) {
  if (offset < barOffset || offset >= barOffset + WINDOW_SIZE) {
    return loadWindow(offset, sessionId, startOffset);
  }

  const loadedThrough = barOffset + bars.length - 1;
  if (offset <= loadedThrough) {
    return { bars, barOffset };
  }

  const response = await getBars(loadedThrough + 1, offset - loadedThrough, sessionId);
  return { bars: [...bars, ...response.bars], barOffset };
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}
