import { create } from "zustand";
import {
  BacktestState,
  BacktestCreatePayload,
  BacktestSession,
  Candle,
  DatasetCatalog,
  DatasetMeta,
  DatasetRefreshResponse,
  JournalPayload,
  OrderPayload,
  OrderUpdatePayload,
  Playbook,
  PlaybookPayload,
  Trade,
  advanceBacktest,
  createBacktest,
  deleteBacktestOrder,
  getBars,
  getBacktest,
  getBacktests,
  getDatasets,
  getLatestBacktest,
  getMeta,
  getPlaybooks,
  getTrades,
  jumpBacktest,
  patchDatasetAsset,
  patchDatasetSettings,
  patchBacktestOrder,
  patchJournal,
  postBacktestOrder,
  postPlaybook,
  refreshDatasets as refreshDatasetsApi,
} from "../lib/api";

const WINDOW_SIZE = 1500;
const DEFAULT_CONTEXT_BARS = 300;

type BacktestStore = {
  bars: Candle[];
  barOffset: number;
  datasets: DatasetCatalog | null;
  meta: DatasetMeta | null;
  state: BacktestState | null;
  playbooks: Playbook[];
  resultSessions: BacktestSession[];
  resultTrades: Trade[];
  isLoading: boolean;
  isStepping: boolean;
  isPlaying: boolean;
  speedMs: number;
  error: string | null;
  createPlaybook: (payload: PlaybookPayload) => Promise<Playbook>;
  loadInitial: () => Promise<void>;
  refreshPlaybooks: () => Promise<void>;
  refreshDatasets: () => Promise<DatasetRefreshResponse["summary"] | null>;
  updateDatasetAsset: (
    assetId: string,
    payload: { currency?: string | null; timezone?: string | null },
  ) => Promise<void>;
  updateDatasetSettings: (payload: { root_path: string }) => Promise<void>;
  refreshResults: () => Promise<void>;
  loadSession: (sessionId: number) => Promise<void>;
  newSession: (payload?: BacktestCreatePayload) => Promise<void>;
  stepForward: (steps?: number) => Promise<void>;
  resetReplay: () => Promise<void>;
  jumpToOffset: (offset: number) => Promise<void>;
  jumpToTimestamp: (timestamp: string) => Promise<void>;
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  placeOrder: (payload: OrderPayload) => Promise<boolean>;
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
  resultSessions: [],
  resultTrades: [],
  isLoading: false,
  isStepping: false,
  isPlaying: false,
  speedMs: 450,
  error: null,

  createPlaybook: async (payload) => {
    const playbook = await postPlaybook(payload);
    set((current) => ({
      playbooks: [...current.playbooks.filter((item) => item.id !== playbook.id), playbook],
      error: null,
    }));
    return playbook;
  },

  loadInitial: async () => {
    set({ isLoading: true, error: null });
    try {
      const [datasetsResult, playbooksResult, sessionsResult, tradesResult] = await Promise.allSettled([
        getDatasets(),
        getPlaybooks(),
        getBacktests(),
        getTrades(),
      ]);
      const datasets = datasetsResult.status === "fulfilled" ? datasetsResult.value : null;
      const playbooks = playbooksResult.status === "fulfilled" ? playbooksResult.value : [];
      const resultSessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];
      const resultTrades = tradesResult.status === "fulfilled" ? tradesResult.value : [];
      const initialState = await getLatestBacktest().catch(() => createBacktest({}));
      const meta = await getMeta(initialState.session.id);
      const state = await ensureReplayContext(initialState, meta);
      const window = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
      );
      set({
        datasets,
        meta,
        state,
        playbooks,
        resultSessions,
        resultTrades,
        bars: window.bars,
        barOffset: window.barOffset,
        error: firstRejectedMessage([
          datasetsResult,
          playbooksResult,
          sessionsResult,
          tradesResult,
        ]),
        isLoading: false,
      });
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false, isPlaying: false });
    }
  },

  refreshPlaybooks: async () => {
    try {
      const playbooks = await getPlaybooks();
      set({ playbooks, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  refreshDatasets: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await refreshDatasetsApi();
      set({ datasets: response.catalog, isLoading: false, error: null });
      return response.summary;
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
      throw error;
    }
  },

  updateDatasetAsset: async (assetId, payload) => {
    try {
      const datasets = await patchDatasetAsset(assetId, payload);
      set({ datasets, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  updateDatasetSettings: async (payload) => {
    set({ isLoading: true, error: null });
    try {
      const datasets = await patchDatasetSettings(payload);
      set({ datasets, isLoading: false, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
      throw error;
    }
  },

  refreshResults: async () => {
    try {
      const [resultSessions, resultTrades] = await Promise.all([
        getBacktests(),
        getTrades(),
      ]);
      set({ resultSessions, resultTrades, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  loadSession: async (sessionId) => {
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const initialState = await getBacktest(sessionId);
      const meta = await getMeta(initialState.session.id);
      const state = await ensureReplayContext(initialState, meta);
      const window = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
      );
      set({
        meta,
        state,
        bars: window.bars,
        barOffset: window.barOffset,
        isLoading: false,
      });
      void get().refreshResults();
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  newSession: async (payload = {}) => {
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const initialState = await createBacktest(payload);
      const meta = await getMeta(initialState.session.id);
      const state = await ensureReplayContext(initialState, meta);
      const window = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
      );
      set({
        meta,
        state,
        bars: window.bars,
        barOffset: window.barOffset,
        isLoading: false,
      });
      void get().refreshResults();
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
      if (state.trades.some((trade) => trade.status === "CLOSED")) {
        void get().refreshResults();
      }
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
      return false;
    }
    try {
      const state = await postBacktestOrder(sessionId, payload);
      set({ state, error: null });
      if (state.trades.some((trade) => trade.status === "CLOSED")) {
        void get().refreshResults();
      }
      return true;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      return false;
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
    const activeSessionId = get().state?.session.id;
    if (activeSessionId) {
      const state = await getBacktest(activeSessionId);
      set({ state });
    } else {
      set((current) => ({
        resultTrades: current.resultTrades.map((item) =>
          item.id === trade.id ? trade : item,
        ),
      }));
    }
    await get().refreshResults();
    return trade;
  },
}));

async function loadWindow(currentOffset: number, sessionId?: number, startOffset = 0) {
  const barOffset = Math.max(0, currentOffset - WINDOW_SIZE + 1);
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

async function ensureReplayContext(state: BacktestState, meta: DatasetMeta) {
  if (!isEmptyFreshReplay(state)) {
    return state;
  }

  if (state.session.current_offset >= DEFAULT_CONTEXT_BARS || meta.rows <= 1) {
    return state;
  }

  const sessionEnd = state.session.end_offset ?? meta.rows - 1;
  const targetOffset = Math.min(DEFAULT_CONTEXT_BARS, sessionEnd, meta.rows - 1);
  if (targetOffset <= state.session.current_offset) {
    return state;
  }

  return jumpBacktest(state.session.id, { offset: targetOffset });
}

function isEmptyFreshReplay(state: BacktestState) {
  const position = state.position;
  return (
    state.orders.length === 0 &&
    state.executions.length === 0 &&
    state.trades.length === 0 &&
    (!position || position.side === "FLAT" || position.quantity <= 0)
  );
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function firstRejectedMessage(results: PromiseSettledResult<unknown>[]) {
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  return rejected ? toErrorMessage(rejected.reason) : null;
}
