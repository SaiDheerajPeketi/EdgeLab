import { create } from "zustand";
import {
  ApiError,
  BacktestState,
  BacktestCreatePayload,
  BacktestSession,
  BacktestSessionUpdatePayload,
  Candle,
  DatasetCatalog,
  DatasetMeta,
  DatasetRefreshResponse,
  DatasetRefreshStatus,
  JournalPayload,
  Metrics,
  OrderPayload,
  OrderUpdatePayload,
  PositionUpdatePayload,
  Playbook,
  PlaybookPayload,
  PlaybookUpdatePayload,
  StrategySummary,
  Trade,
  TradeStrategyPayload,
  advanceBacktest,
  createBacktest,
  deleteBacktestSession,
  deleteBacktestOrder,
  deletePlaybook as deletePlaybookApi,
  getBars,
  getBacktest,
  getBacktestSessionSummaries,
  getBacktestStrategySummaries,
  getBacktests,
  getBootstrap,
  getBootstrapShell,
  getDatasetRefreshStatus,
  getDatasets,
  getLatestBacktest,
  getMetrics,
  getMeta,
  getPlaybooks,
  getTrades,
  jumpBacktest,
  patchDatasetAsset,
  patchDatasetSettings,
  patchBacktestOrder,
  patchBacktestPosition,
  patchJournal,
  patchPlaybook,
  patchTradeStrategy,
  postBacktestOrder,
  postPlaybook,
  refreshDatasets as refreshDatasetsApi,
  updateBacktestSession,
} from "../lib/api";

const WINDOW_SIZE = 1500;
const DEFAULT_CONTEXT_BARS = 300;
const RESULT_SESSIONS_PAGE_LIMIT = 50;

type BacktestStore = {
  bars: Candle[];
  barOffset: number;
  replaySeekVersion: number;
  datasets: DatasetCatalog | null;
  meta: DatasetMeta | null;
  state: BacktestState | null;
  playbooks: Playbook[];
  resultSessions: BacktestSession[];
  resultSessionsNextOffset: number;
  resultSessionsHasMore: boolean;
  strategySummaries: StrategySummary[];
  resultTrades: Trade[];
  resultTradesLoaded: boolean;
  isLoading: boolean;
  isLoadingMoreSessions: boolean;
  isStepping: boolean;
  isPlaying: boolean;
  speedMs: number;
  error: string | null;
  createPlaybook: (payload: PlaybookPayload) => Promise<Playbook>;
  updatePlaybook: (playbookId: number, payload: PlaybookUpdatePayload) => Promise<Playbook>;
  deletePlaybook: (playbookId: number) => Promise<void>;
  loadInitial: () => Promise<void>;
  refreshPlaybooks: () => Promise<void>;
  refreshDatasets: () => Promise<DatasetRefreshResponse>;
  applyDatasetCatalog: (datasets: DatasetCatalog) => void;
  refreshDatasetStatus: () => Promise<DatasetRefreshStatus>;
  updateDatasetAsset: (
    assetId: string,
    payload: { currency?: string | null; timezone?: string | null; pnl_multiplier?: number | null },
  ) => Promise<void>;
  updateDatasetSettings: (payload: { root_path: string }) => Promise<void>;
  refreshShellSnapshot: (targetCount?: number) => Promise<void>;
  refreshResults: () => Promise<void>;
  ensureResultTradesLoaded: () => Promise<void>;
  ensureLatestReplayLoaded: () => Promise<void>;
  loadMoreSessions: () => Promise<void>;
  loadSession: (sessionId: number) => Promise<void>;
  newSession: (payload?: BacktestCreatePayload) => Promise<void>;
  updateSession: (sessionId: number, payload: BacktestSessionUpdatePayload) => Promise<BacktestSession>;
  deleteSession: (sessionId: number) => Promise<void>;
  stepForward: (steps?: number) => Promise<void>;
  resetReplay: () => Promise<void>;
  jumpToOffset: (offset: number) => Promise<void>;
  jumpToTimestamp: (timestamp: string) => Promise<void>;
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  placeOrder: (payload: OrderPayload) => Promise<boolean>;
  amendOrder: (orderId: number, payload: OrderUpdatePayload) => Promise<void>;
  updatePosition: (payload: PositionUpdatePayload) => Promise<void>;
  cancelOrder: (orderId: number) => Promise<void>;
  updateJournal: (tradeId: number, payload: JournalPayload) => Promise<Trade>;
  updateTradeStrategy: (tradeId: number, payload: TradeStrategyPayload) => Promise<Trade>;
};

export const useBacktestStore = create<BacktestStore>((set, get) => ({
  bars: [],
  barOffset: 0,
  replaySeekVersion: 0,
  datasets: null,
  meta: null,
  state: null,
  playbooks: [],
  resultSessions: [],
  resultSessionsNextOffset: 0,
  resultSessionsHasMore: false,
  strategySummaries: [],
  resultTrades: [],
  resultTradesLoaded: false,
  isLoading: false,
  isLoadingMoreSessions: false,
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

  updatePlaybook: async (playbookId, payload) => {
    try {
      const playbook = await patchPlaybook(playbookId, payload);
      set((current) => ({
        playbooks: current.playbooks
          .map((item) => (item.id === playbook.id ? playbook : item))
          .sort((left, right) => left.name.localeCompare(right.name)),
        error: null,
      }));
      return playbook;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  deletePlaybook: async (playbookId) => {
    try {
      await deletePlaybookApi(playbookId);
      set((current) => ({
        playbooks: current.playbooks.filter((item) => item.id !== playbookId),
        resultSessions: current.resultSessions.map((session) =>
          session.playbook_id === playbookId ? { ...session, playbook_id: null } : session,
        ),
        resultTrades: current.resultTrades.map((trade) =>
          trade.playbook_id === playbookId ? { ...trade, playbook_id: null } : trade,
        ),
        state: current.state
          ? {
              ...current.state,
              session:
                current.state.session.playbook_id === playbookId
                  ? { ...current.state.session, playbook_id: null }
                  : current.state.session,
              orders: current.state.orders.map((order) =>
                order.playbook_id === playbookId ? { ...order, playbook_id: null } : order,
              ),
              trades: current.state.trades.map((trade) =>
                trade.playbook_id === playbookId ? { ...trade, playbook_id: null } : trade,
              ),
              position:
                current.state.position?.playbook_id === playbookId
                  ? { ...current.state.position, playbook_id: null }
                  : current.state.position,
            }
          : current.state,
        error: null,
      }));
      void get().refreshResults();
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  loadInitial: async () => {
    const hydrateShellData = () => {
      void Promise.allSettled([getDatasets()]).then(([datasetsResult]) => {
        set((current) => ({
          datasets: datasetsResult.status === "fulfilled" ? datasetsResult.value : current.datasets,
          error:
            current.error ??
            firstRejectedMessage([
              datasetsResult,
            ]),
        }));
      });
    };

    set({ isLoading: true, error: null });
    try {
      const shell = await getBootstrapShell();
      set({
        playbooks: shell.playbooks,
        resultSessions: shell.recent_sessions,
        resultSessionsNextOffset: shell.recent_sessions_next_offset,
        resultSessionsHasMore: shell.recent_sessions_has_more,
        strategySummaries: shell.strategy_summaries,
        resultTradesLoaded: false,
        error: null,
        isLoading: false,
      });
      hydrateShellData();
      return;
    } catch {
      try {
        const bootstrap = await getBootstrap();
        set({
          datasets: bootstrap.datasets,
          playbooks: bootstrap.playbooks,
          resultSessions: bootstrap.recent_sessions,
          resultSessionsNextOffset: bootstrap.recent_sessions_next_offset,
          resultSessionsHasMore: bootstrap.recent_sessions_has_more,
          strategySummaries: bootstrap.strategy_summaries,
          resultTrades: bootstrap.recent_trades,
          resultTradesLoaded: true,
          error: null,
          isLoading: false,
        });
        return;
      } catch {
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
          set({
            datasets,
            playbooks,
            resultSessions,
            resultSessionsNextOffset: resultSessions.length,
            resultSessionsHasMore: false,
            strategySummaries: [],
            resultTrades,
            resultTradesLoaded: true,
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
      }
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
      return response;
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
      throw error;
    }
  },

  applyDatasetCatalog: (datasets) => {
    set({ datasets, error: null });
  },

  refreshDatasetStatus: async () => {
    try {
      const status = await getDatasetRefreshStatus();
      if (!status.running) {
        const datasets = await getDatasets().catch(() => null);
        if (datasets) {
          set({ datasets });
        }
      }
      return status;
    } catch (error) {
      set({ error: toErrorMessage(error) });
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

  refreshShellSnapshot: async (targetCount) => {
    try {
      const shell = await loadShellSnapshot(
        targetCount ?? Math.max(get().resultSessions.length, RESULT_SESSIONS_PAGE_LIMIT),
      );
      set((current) => ({
        playbooks: shell.playbooks,
        resultSessions: shell.resultSessions,
        resultSessionsHasMore: shell.resultSessionsHasMore,
        resultSessionsNextOffset: shell.resultSessionsNextOffset,
        strategySummaries: shell.strategySummaries,
        resultTradesLoaded: current.resultTradesLoaded,
        error: null,
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  refreshResults: async () => {
    try {
      const sessionTarget = Math.max(get().resultSessions.length, RESULT_SESSIONS_PAGE_LIMIT);
      const {
        playbooks,
        resultSessions,
        resultSessionsHasMore,
        resultSessionsNextOffset,
        strategySummaries,
        resultTrades,
      } = await loadResultsData(sessionTarget);
      set({
        playbooks,
        resultSessions,
        resultSessionsHasMore,
        resultSessionsNextOffset,
        strategySummaries,
        resultTrades,
        resultTradesLoaded: true,
        error: null,
      });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  ensureResultTradesLoaded: async () => {
    if (get().resultTradesLoaded) {
      return;
    }
    await get().refreshResults();
  },

  ensureLatestReplayLoaded: async () => {
    if (get().state != null || get().isLoading) {
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const context = await loadLatestReplayContext();
      if (!context) {
        set({ isLoading: false });
        return;
      }
      set((current) => ({
        meta: context.meta,
        state: context.state,
        bars: context.window.bars,
        barOffset: context.window.barOffset,
        isLoading: false,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  loadMoreSessions: async () => {
    const {
      isLoadingMoreSessions,
      resultSessionsHasMore,
      resultSessions,
      resultSessionsNextOffset,
    } = get();
    if (isLoadingMoreSessions || !resultSessionsHasMore) {
      return;
    }
    set({ isLoadingMoreSessions: true });
    try {
      const nextLimit = resultSessions.length + RESULT_SESSIONS_PAGE_LIMIT;
      const [page, strategySummaries] = await Promise.all([
        getBacktestSessionSummaries({
          offset: resultSessionsNextOffset,
          limit: RESULT_SESSIONS_PAGE_LIMIT,
        }),
        getBacktestStrategySummaries(nextLimit),
      ]);
      set((current) => ({
        resultSessions: mergeSessions(current.resultSessions, page.items),
        resultSessionsHasMore: page.has_more,
        resultSessionsNextOffset: page.next_offset,
        strategySummaries,
        isLoadingMoreSessions: false,
        error: null,
      }));
    } catch (error) {
      set({ error: toErrorMessage(error), isLoadingMoreSessions: false });
    }
  },

  loadSession: async (sessionId) => {
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const [initialState, meta] = await Promise.all([
        getBacktest(sessionId),
        getMeta(sessionId),
      ]);
      const state = await ensureReplayContext(initialState, meta);
      const window = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
      );
      set((current) => ({
        meta,
        state,
        bars: window.bars,
        barOffset: window.barOffset,
        resultSessions: upsertSession(current.resultSessions, state.session),
        strategySummaries: current.strategySummaries,
        isLoading: false,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
      if (get().resultTradesLoaded) {
        void get().refreshResults();
      } else {
        void get().refreshShellSnapshot();
      }
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
      set((current) => ({
        meta,
        state,
        bars: window.bars,
        barOffset: window.barOffset,
        resultSessions: upsertSession(current.resultSessions, state.session),
        strategySummaries: current.strategySummaries,
        isLoading: false,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
      if (get().resultTradesLoaded) {
        void get().refreshResults();
      } else {
        void get().refreshShellSnapshot();
      }
    } catch (error) {
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  updateSession: async (sessionId, payload) => {
    try {
      const session = await updateBacktestSession(sessionId, payload);
      set((current) => ({
        resultSessions: upsertSession(current.resultSessions, session),
        state:
          current.state?.session.id === session.id
            ? { ...current.state, session }
            : current.state,
        error: null,
      }));
      if (get().resultTradesLoaded) {
        void get().refreshResults();
      } else {
        void get().refreshShellSnapshot();
      }
      return session;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await deleteBacktestSession(sessionId);
      set((current) => {
        const deletingActiveSession = current.state?.session.id === sessionId;
        return {
          resultSessions: current.resultSessions.filter((session) => session.id !== sessionId),
          resultTrades: current.resultTrades.filter((trade) => trade.session_id !== sessionId),
          strategySummaries: current.strategySummaries,
          resultTradesLoaded: current.resultTradesLoaded,
          state: deletingActiveSession ? null : current.state,
          meta: deletingActiveSession ? null : current.meta,
          bars: deletingActiveSession ? [] : current.bars,
          barOffset: deletingActiveSession ? 0 : current.barOffset,
          replaySeekVersion: deletingActiveSession
            ? current.replaySeekVersion + 1
            : current.replaySeekVersion,
          isPlaying: deletingActiveSession ? false : current.isPlaying,
          error: null,
        };
      });
      if (get().resultTradesLoaded) {
        void get().refreshResults();
      } else {
        void get().refreshShellSnapshot();
      }
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
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
        if (get().resultTradesLoaded) {
          void get().refreshResults();
        } else {
          void get().refreshShellSnapshot();
        }
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
      set((current) => ({
        state,
        bars,
        barOffset,
        isLoading: false,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
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
      set((current) => ({
        state,
        bars,
        barOffset,
        isLoading: false,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
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
        if (get().resultTradesLoaded) {
          void get().refreshResults();
        } else {
          void get().refreshShellSnapshot();
        }
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

  updatePosition: async (payload) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    try {
      const state = await patchBacktestPosition(sessionId, payload);
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
    try {
      const trade = await patchJournal(tradeId, payload);
      const activeSessionId = get().state?.session.id;
      const shouldRefreshActiveMetrics = activeSessionId === trade.session_id;
      const [results, metrics] = await Promise.all([
        loadResultsData(Math.max(get().resultSessions.length, RESULT_SESSIONS_PAGE_LIMIT)),
        shouldRefreshActiveMetrics ? getMetrics(trade.session_id) : Promise.resolve(null),
      ]);
      set((current) => ({
        resultSessions: results.resultSessions,
        resultSessionsHasMore: results.resultSessionsHasMore,
        resultSessionsNextOffset: results.resultSessionsNextOffset,
        strategySummaries: results.strategySummaries,
        resultTrades: results.resultTrades,
        state: mergeActiveTradeState(current.state, trade, metrics),
        error: null,
      }));
      return trade;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  updateTradeStrategy: async (tradeId, payload) => {
    try {
      const trade = await patchTradeStrategy(tradeId, payload);
      const activeSessionId = get().state?.session.id;
      const shouldRefreshActiveMetrics = activeSessionId === trade.session_id;
      const [results, metrics] = await Promise.all([
        loadResultsData(Math.max(get().resultSessions.length, RESULT_SESSIONS_PAGE_LIMIT)),
        shouldRefreshActiveMetrics ? getMetrics(trade.session_id) : Promise.resolve(null),
      ]);
      set((current) => ({
        resultSessions: results.resultSessions,
        resultSessionsHasMore: results.resultSessionsHasMore,
        resultSessionsNextOffset: results.resultSessionsNextOffset,
        strategySummaries: results.strategySummaries,
        resultTrades: results.resultTrades,
        state: mergeActiveTradeState(current.state, trade, metrics),
        error: null,
      }));
      return trade;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },
}));

function upsertSession(sessions: BacktestSession[], session: BacktestSession) {
  if (sessions.some((item) => item.id === session.id)) {
    return sessions.map((item) => (item.id === session.id ? session : item));
  }
  return [session, ...sessions];
}

function mergeSessions(existing: BacktestSession[], incoming: BacktestSession[]) {
  const merged = [...existing];
  for (const session of incoming) {
    const index = merged.findIndex((item) => item.id === session.id);
    if (index >= 0) {
      merged[index] = session;
      continue;
    }
    merged.push(session);
  }
  return merged;
}

async function loadResultsData(sessionTarget = RESULT_SESSIONS_PAGE_LIMIT) {
  const [shell, resultTrades] = await Promise.all([
    getBootstrapShell(sessionTarget),
    getTrades(),
  ]);
  return {
    playbooks: shell.playbooks,
    resultSessions: shell.recent_sessions,
    resultSessionsNextOffset: shell.recent_sessions_next_offset,
    resultSessionsHasMore: shell.recent_sessions_has_more,
    strategySummaries: shell.strategy_summaries,
    resultTrades,
  };
}

async function loadShellSnapshot(sessionTarget = RESULT_SESSIONS_PAGE_LIMIT) {
  const shell = await getBootstrapShell(sessionTarget);
  return {
    playbooks: shell.playbooks,
    resultSessions: shell.recent_sessions,
    resultSessionsNextOffset: shell.recent_sessions_next_offset,
    resultSessionsHasMore: shell.recent_sessions_has_more,
    strategySummaries: shell.strategy_summaries,
  };
}

async function loadLatestReplayContext() {
  const latestState = await getLatestBacktest().catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  });
  if (!latestState) {
    return null;
  }

  const meta = await getMeta(latestState.session.id);
  const state = await ensureReplayContext(latestState, meta);
  const window = await loadWindow(
    state.session.current_offset,
    state.session.id,
    state.session.start_offset,
  );
  return { meta, state, window };
}

function mergeActiveTradeState(
  state: BacktestState | null,
  trade: Trade,
  metrics: Metrics | null,
) {
  if (!state || state.session.id !== trade.session_id) {
    return state;
  }

  return {
    ...state,
    trades: state.trades.map((item) => (item.id === trade.id ? trade : item)),
    metrics: metrics ?? state.metrics,
  };
}

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

function initialDatasetSessionPayload(datasets: DatasetCatalog | null): BacktestCreatePayload {
  for (const instrument of datasets?.instruments ?? []) {
    const timeframe = instrument.timeframes[0];
    if (!timeframe) {
      continue;
    }
    return {
      name: `${instrument.symbol} ${timeframe.timeframe} Replay`,
      symbol: instrument.symbol,
      instrument: instrument.id,
      timeframe: timeframe.timeframe,
      csv_path: timeframe.csv_path,
      currency: instrument.currency,
      pnl_multiplier: instrument.pnl_multiplier,
      timezone: instrument.timezone,
    };
  }
  return {};
}
