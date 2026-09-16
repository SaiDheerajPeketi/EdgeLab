import { create } from "zustand";
import { ResultTradesLoadLease } from "./resultTradesLoadLease.js";
import {
  ApiError,
  BacktestReplayUpdate,
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
  MetricsCurves,
  MetricsSummary,
  OrderPayload,
  OrderUpdatePayload,
  PositionUpdatePayload,
  Playbook,
  PlaybookPayload,
  PlaybookUpdatePayload,
  StrategySummary,
  Trade,
  TradeStrategyPayload,
  advanceBacktestCompact,
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
  getMetricsCurves,
  getMetricsSummary,
  getMeta,
  getPlaybooks,
  getTradesPage,
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

const WINDOW_SIZE = 5000;
const WINDOW_HISTORY_BARS = 1000;
const WINDOW_PREFETCH_BARS = 2500;
const RESULT_SESSIONS_PAGE_LIMIT = 50;
const RESULT_TRADES_PAGE_LIMIT = 100;

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
  resultSessionsNextCursor: string | null;
  resultSessionsHasMore: boolean;
  resultSessionsLoadError: string | null;
  strategySummaries: StrategySummary[];
  resultTrades: Trade[];
  resultTradesNextOffset: number;
  resultTradesNextCursor: string | null;
  resultTradesHasMore: boolean;
  resultTradesLoaded: boolean;
  resultTradesLoading: boolean;
  resultTradesLoadingVersion: number | null;
  resultTradesLoadError: string | null;
  isLoading: boolean;
  isLoadingMoreSessions: boolean;
  isStepping: boolean;
  isPlaying: boolean;
  pendingReplaySyncOffset: number | null;
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
  stepBackward: (steps?: number) => Promise<void>;
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
  resultSessionsNextCursor: null,
  resultSessionsHasMore: false,
  resultSessionsLoadError: null,
  strategySummaries: [],
  resultTrades: [],
  resultTradesNextOffset: 0,
  resultTradesNextCursor: null,
  resultTradesHasMore: false,
  resultTradesLoaded: false,
  resultTradesLoading: false,
  resultTradesLoadingVersion: null,
  resultTradesLoadError: null,
  isLoading: false,
  isLoadingMoreSessions: false,
  isStepping: false,
  isPlaying: false,
  pendingReplaySyncOffset: null,
  speedMs: 200,
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
        resultSessions: uniqueSessions(shell.recent_sessions),
        resultSessionsNextOffset: shell.recent_sessions_next_offset,
        resultSessionsNextCursor: shell.recent_sessions_next_cursor,
        resultSessionsHasMore: shell.recent_sessions_has_more,
        resultSessionsLoadError: null,
        strategySummaries: shell.strategy_summaries,
        resultTrades: [],
        resultTradesNextOffset: 0,
        resultTradesNextCursor: null,
        resultTradesHasMore: false,
        resultTradesLoaded: false,
        error: null,
        isLoading: false,
      });
      hydrateShellData();
      return;
    } catch {
      try {
        const bootstrap = await getBootstrap();
        const tradeLoadVersion = startResultTradesLoad();
        set({
          datasets: bootstrap.datasets,
          playbooks: bootstrap.playbooks,
          resultSessions: uniqueSessions(bootstrap.recent_sessions),
          resultSessionsNextOffset: bootstrap.recent_sessions_next_offset,
          resultSessionsNextCursor: bootstrap.recent_sessions_next_cursor,
          resultSessionsHasMore: bootstrap.recent_sessions_has_more,
          resultSessionsLoadError: null,
          strategySummaries: bootstrap.strategy_summaries,
          resultTrades: bootstrap.recent_trades,
          resultTradesNextOffset: bootstrap.recent_trades.length,
          resultTradesNextCursor: null,
          resultTradesHasMore: bootstrap.recent_trades.length >= bootstrap.recent_trade_limit,
          resultTradesLoaded: true,
          error: null,
          isLoading: false,
        });
        if (bootstrap.recent_trades.length >= bootstrap.recent_trade_limit) {
          void hydrateRemainingResultTrades(tradeLoadVersion);
        }
        return;
      } catch {
        try {
          const tradeLoadVersion = startResultTradesLoad(true);
          const [datasetsResult, playbooksResult, sessionsResult, tradesResult] = await Promise.allSettled([
            getDatasets(),
            getPlaybooks(),
            getBacktests(),
            loadTradeSnapshot(),
          ]);
          const datasets = datasetsResult.status === "fulfilled" ? datasetsResult.value : null;
          const playbooks = playbooksResult.status === "fulfilled" ? playbooksResult.value : [];
          const resultSessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];
          const uniqueResultSessions = uniqueSessions(resultSessions);
          const resultSessionsLoadError =
            sessionsResult.status === "rejected" ? toErrorMessage(sessionsResult.reason) : null;
          const tradeSnapshot =
            tradesResult.status === "fulfilled" ? tradesResult.value : emptyTradeSnapshot();
          set({
            datasets,
            playbooks,
            resultSessions: uniqueResultSessions,
            resultSessionsNextOffset: uniqueResultSessions.length,
            resultSessionsNextCursor: null,
            resultSessionsHasMore: false,
            resultSessionsLoadError,
            strategySummaries: [],
            resultTrades: tradeSnapshot.resultTrades,
            resultTradesNextOffset: tradeSnapshot.resultTradesNextOffset,
            resultTradesNextCursor: tradeSnapshot.resultTradesNextCursor,
            resultTradesHasMore: tradeSnapshot.resultTradesHasMore,
            resultTradesLoaded: tradesResult.status === "fulfilled",
            resultTradesLoadError: tradesResult.status === "rejected" ? toErrorMessage(tradesResult.reason) : null,
            error: firstRejectedMessage([
              datasetsResult,
              playbooksResult,
              sessionsResult,
              tradesResult,
            ]),
            isLoading: false,
          });
          settleResultTradesLoading(tradeLoadVersion);
          if (tradeSnapshot.resultTradesHasMore) {
            void hydrateRemainingResultTrades(tradeLoadVersion);
          }
        } catch (error) {
          const message = toErrorMessage(error);
          set({ error: message, isLoading: false, isPlaying: false, resultSessionsLoadError: message });
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
        resultSessionsNextCursor: shell.resultSessionsNextCursor,
        resultSessionsLoadError: null,
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
      const tradeTarget = Math.max(get().resultTrades.length, RESULT_TRADES_PAGE_LIMIT);
      const {
        playbooks,
        resultSessions,
        resultSessionsHasMore,
        resultSessionsNextOffset,
        resultSessionsNextCursor,
        strategySummaries,
        resultTrades,
        resultTradesNextOffset,
        resultTradesNextCursor,
        resultTradesHasMore,
      } = await loadResultsData(sessionTarget, tradeTarget);
      const tradeLoadVersion = startResultTradesLoad();
      set({
        playbooks,
        resultSessions,
        resultSessionsHasMore,
        resultSessionsNextOffset,
        resultSessionsNextCursor,
        strategySummaries,
        resultTrades,
        resultTradesNextOffset,
        resultTradesNextCursor,
        resultTradesHasMore,
        resultTradesLoaded: true,
        error: null,
      });
      if (resultTradesHasMore && isCurrentResultTradesLoad(tradeLoadVersion)) {
        void hydrateRemainingResultTrades(tradeLoadVersion);
      }
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  ensureResultTradesLoaded: async () => {
    if ((get().resultTradesLoaded && !get().resultTradesLoadError) || get().resultTradesLoading) {
      return;
    }
    const tradeLoadVersion = startResultTradesLoad(true);
    set({ resultTradesLoadError: null });
    try {
      const tradeSnapshot = await loadTradeSnapshot();
      if (!isCurrentResultTradesLoad(tradeLoadVersion)) {
        return;
      }
      set({
        resultTrades: tradeSnapshot.resultTrades,
        resultTradesNextOffset: tradeSnapshot.resultTradesNextOffset,
        resultTradesNextCursor: tradeSnapshot.resultTradesNextCursor,
        resultTradesHasMore: tradeSnapshot.resultTradesHasMore,
        resultTradesLoaded: true,
        resultTradesLoadError: null,
        error: null,
      });
      if (tradeSnapshot.resultTradesHasMore) {
        void hydrateRemainingResultTrades(tradeLoadVersion);
      }
    } catch (error) {
      if (!isCurrentResultTradesLoad(tradeLoadVersion)) return;
      const message = toErrorMessage(error);
      set({ error: message, resultTradesLoadError: message });
    } finally {
      settleResultTradesLoading(tradeLoadVersion);
    }
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
      resultSessionsNextCursor,
    } = get();
    if (isLoadingMoreSessions || !resultSessionsHasMore) {
      return;
    }
    set({ isLoadingMoreSessions: true });
    try {
      const nextLimit = resultSessions.length + RESULT_SESSIONS_PAGE_LIMIT;
      const [page, strategySummaries] = await Promise.all([
        getBacktestSessionSummaries({
          cursor: resultSessionsNextCursor,
          offset: resultSessionsNextOffset,
          limit: RESULT_SESSIONS_PAGE_LIMIT,
        }),
        getBacktestStrategySummaries(nextLimit),
      ]);
      set((current) => ({
        resultSessions: mergeSessions(current.resultSessions, page.items),
        resultSessionsHasMore: page.has_more,
        resultSessionsNextOffset: page.next_offset,
        resultSessionsNextCursor: page.next_cursor,
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
      const initialState = await getBacktest(sessionId);
      const hydrationVersion = startReplayHydration();
      set((current) => ({
        meta: null,
        state: initialState,
        bars: [],
        barOffset: initialState.session.start_offset,
        pendingReplaySyncOffset: null,
        resultSessions: upsertSession(current.resultSessions, initialState.session),
        strategySummaries: current.strategySummaries,
        isLoading: true,
      }));
      void hydrateReplaySession(initialState, hydrationVersion);
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
      const hydrationVersion = startReplayHydration();
      set((current) => ({
        meta: null,
        state: initialState,
        bars: [],
        barOffset: initialState.session.start_offset,
        pendingReplaySyncOffset: null,
        resultSessions: upsertSession(current.resultSessions, initialState.session),
        strategySummaries: current.strategySummaries,
        isLoading: true,
      }));
      void hydrateReplaySession(initialState, hydrationVersion);
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
          pendingReplaySyncOffset: deletingActiveSession ? null : current.pendingReplaySyncOffset,
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
    const previousState = get().state;
    const sessionId = previousState?.session.id;
    if (!sessionId || get().isStepping || get().isLoading || !previousState) {
      return;
    }

    set({ isStepping: true });
    try {
      if (
        steps > 0 &&
        previousState.session.end_offset != null
      ) {
        const targetOffset = Math.min(
          previousState.session.current_offset + steps,
          previousState.session.end_offset,
        );
        const bars = await ensureBarsForOffset(
          get().bars,
          get().barOffset,
          targetOffset,
          previousState.session.id,
          previousState.session.start_offset,
          previousState.session.end_offset,
        );
        if (!canAdvanceLocally(previousState, bars.bars, bars.barOffset, targetOffset)) {
          throw new Error("server advance required");
        }
        const currentCandle = bars.bars[targetOffset - bars.barOffset] ?? previousState.current_candle;
        const state: BacktestState = {
          ...previousState,
          session: {
            ...previousState.session,
            current_offset: targetOffset,
            status:
              targetOffset >= previousState.session.end_offset
                ? "COMPLETE"
                : "ACTIVE",
          },
          current_candle: currentCandle,
          position: advancePositionLocally(previousState, currentCandle),
        };
        set({
          state,
          bars: bars.bars,
          barOffset: bars.barOffset,
          pendingReplaySyncOffset: targetOffset,
          error: null,
          isStepping: false,
          isPlaying: state.session.status === "ACTIVE" ? get().isPlaying : false,
        });
        return;
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "server advance required") {
        set({ error: toErrorMessage(error), isPlaying: false, isStepping: false });
        return;
      }
    }
    try {
      const replayBaseState = get().pendingReplaySyncOffset == null
        ? previousState
        : await syncPendingReplayOffset();
      const replaySessionId = replayBaseState?.session.id ?? sessionId;
      const replay = await advanceBacktestCompact(replaySessionId, steps);
      const state = mergeReplayUpdate(replayBaseState ?? previousState, replay);
      const bars = await ensureBarsForOffset(
        get().bars,
        get().barOffset,
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
        state.session.end_offset,
      );
      set({
        state,
        bars: bars.bars,
        barOffset: bars.barOffset,
        pendingReplaySyncOffset: null,
        error: null,
        isStepping: false,
        isPlaying: state.session.status === "ACTIVE" ? get().isPlaying : false,
      });
      if (didTradeHistoryChange(previousState, state)) {
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

  stepBackward: async (steps = 1) => {
    const previousState = get().state;
    const sessionId = previousState?.session.id;
    if (!sessionId || get().isStepping || get().isLoading || !previousState) {
      return;
    }

    const targetOffset = Math.max(
      previousState.session.start_offset,
      previousState.session.current_offset - Math.max(1, steps),
    );
    if (targetOffset === previousState.session.current_offset) {
      return;
    }

    set({ isStepping: true, isPlaying: false, error: null });
    try {
      const bars = await ensureBarsForOffset(
        get().bars,
        get().barOffset,
        targetOffset,
        previousState.session.id,
        previousState.session.start_offset,
        previousState.session.end_offset,
      );
      const currentCandle = bars.bars[targetOffset - bars.barOffset] ?? previousState.current_candle;
      set({
        state: {
          ...previousState,
          session: {
            ...previousState.session,
            current_offset: targetOffset,
            status: "ACTIVE",
          },
          current_candle: currentCandle,
          position: advancePositionLocally(previousState, currentCandle),
        },
        bars: bars.bars,
        barOffset: bars.barOffset,
        pendingReplaySyncOffset: targetOffset,
        error: null,
        isStepping: false,
        isPlaying: false,
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
    const requestVersion = ++replaySeekRequestVersion;
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const state = await jumpBacktest(sessionId, { offset });
      const { bars, barOffset } = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
        state.session.end_offset,
      );
      if (requestVersion !== replaySeekRequestVersion) {
        return;
      }
      set((current) => ({
        state,
        bars,
        barOffset,
        pendingReplaySyncOffset: null,
        isLoading: false,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
    } catch (error) {
      if (requestVersion !== replaySeekRequestVersion) {
        return;
      }
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  jumpToTimestamp: async (timestamp: string) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    const requestVersion = ++replaySeekRequestVersion;
    set({ isLoading: true, isPlaying: false, error: null });
    try {
      const state = await jumpBacktest(sessionId, { timestamp });
      const { bars, barOffset } = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
        state.session.end_offset,
      );
      if (requestVersion !== replaySeekRequestVersion) {
        return;
      }
      set((current) => ({
        state,
        bars,
        barOffset,
        pendingReplaySyncOffset: null,
        isLoading: false,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
    } catch (error) {
      if (requestVersion !== replaySeekRequestVersion) {
        return;
      }
      set({ error: toErrorMessage(error), isLoading: false });
    }
  },

  setPlaying: (value) => {
    set({ isPlaying: value });
    if (!value) {
      void syncPendingReplayOffset();
    }
  },
  setSpeed: (value) => set({ speedMs: value }),

  placeOrder: async (payload) => {
    try {
      await syncPendingReplayOffset();
      const sessionId = get().state?.session.id;
      if (!sessionId) {
        return false;
      }
      const state = await postBacktestOrder(sessionId, payload);
      set({ state, pendingReplaySyncOffset: null, error: null });
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
    try {
      await syncPendingReplayOffset();
      const sessionId = get().state?.session.id;
      if (!sessionId) {
        return;
      }
      const state = await patchBacktestOrder(sessionId, orderId, payload);
      set({ state, pendingReplaySyncOffset: null, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  updatePosition: async (payload) => {
    try {
      await syncPendingReplayOffset();
      const sessionId = get().state?.session.id;
      if (!sessionId) {
        return;
      }
      const state = await patchBacktestPosition(sessionId, payload);
      set({ state, pendingReplaySyncOffset: null, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  cancelOrder: async (orderId) => {
    try {
      await syncPendingReplayOffset();
      const sessionId = get().state?.session.id;
      if (!sessionId) {
        return;
      }
      const state = await deleteBacktestOrder(sessionId, orderId);
      set({ state, pendingReplaySyncOffset: null, error: null });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  updateJournal: async (tradeId, payload) => {
    try {
      const trade = await patchJournal(tradeId, payload);
      const activeSessionId = get().state?.session.id;
      const shouldRefreshActiveMetrics = activeSessionId === trade.session_id;
      const shouldRefreshMetricSummary =
        shouldRefreshActiveMetrics && journalPayloadNeedsMetricSummary(payload);
      const shouldRefreshMetricCurves =
        shouldRefreshActiveMetrics && journalPayloadNeedsMetricCurves(payload);
      const tradeTarget = Math.max(get().resultTrades.length, RESULT_TRADES_PAGE_LIMIT);
      const [results, metricsSummary, metricsCurves] = await Promise.all([
        loadResultsData(
          Math.max(get().resultSessions.length, RESULT_SESSIONS_PAGE_LIMIT),
          tradeTarget,
        ),
        shouldRefreshMetricSummary ? getMetricsSummary(trade.session_id) : Promise.resolve(null),
        shouldRefreshMetricCurves ? getMetricsCurves(trade.session_id) : Promise.resolve(null),
      ]);
      set((current) => ({
        resultSessions: uniqueSessions(results.resultSessions),
        resultSessionsHasMore: results.resultSessionsHasMore,
        resultSessionsNextOffset: results.resultSessionsNextOffset,
        resultSessionsNextCursor: results.resultSessionsNextCursor,
        strategySummaries: results.strategySummaries,
        resultTrades: results.resultTrades,
        resultTradesNextOffset: results.resultTradesNextOffset,
        resultTradesNextCursor: results.resultTradesNextCursor,
        resultTradesHasMore: results.resultTradesHasMore,
        state: mergeActiveTradeState(current.state, trade, metricsSummary, metricsCurves),
        error: null,
      }));
      const tradeLoadVersion = startResultTradesLoad();
      if (results.resultTradesHasMore && isCurrentResultTradesLoad(tradeLoadVersion)) {
        void hydrateRemainingResultTrades(tradeLoadVersion);
      }
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
      const tradeTarget = Math.max(get().resultTrades.length, RESULT_TRADES_PAGE_LIMIT);
      const [results, metricsSummary, metricsCurves] = await Promise.all([
        loadResultsData(
          Math.max(get().resultSessions.length, RESULT_SESSIONS_PAGE_LIMIT),
          tradeTarget,
        ),
        shouldRefreshActiveMetrics ? getMetricsSummary(trade.session_id) : Promise.resolve(null),
        shouldRefreshActiveMetrics ? getMetricsCurves(trade.session_id) : Promise.resolve(null),
      ]);
      set((current) => ({
        resultSessions: uniqueSessions(results.resultSessions),
        resultSessionsHasMore: results.resultSessionsHasMore,
        resultSessionsNextOffset: results.resultSessionsNextOffset,
        resultSessionsNextCursor: results.resultSessionsNextCursor,
        strategySummaries: results.strategySummaries,
        resultTrades: results.resultTrades,
        resultTradesNextOffset: results.resultTradesNextOffset,
        resultTradesNextCursor: results.resultTradesNextCursor,
        resultTradesHasMore: results.resultTradesHasMore,
        state: mergeActiveTradeState(current.state, trade, metricsSummary, metricsCurves),
        error: null,
      }));
      const tradeLoadVersion = startResultTradesLoad();
      if (results.resultTradesHasMore && isCurrentResultTradesLoad(tradeLoadVersion)) {
        void hydrateRemainingResultTrades(tradeLoadVersion);
      }
      return trade;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      throw error;
    }
  },
}));

function upsertSession(sessions: BacktestSession[], session: BacktestSession) {
  const deduped = uniqueSessions(sessions);
  if (deduped.some((item) => item.id === session.id)) {
    return deduped.map((item) => (item.id === session.id ? session : item));
  }
  return [session, ...deduped];
}

function mergeSessions(existing: BacktestSession[], incoming: BacktestSession[]) {
  const merged = uniqueSessions(existing);
  for (const session of incoming) {
    const index = merged.findIndex((item) => item.id === session.id);
    if (index >= 0) {
      merged[index] = session;
      continue;
    }
    merged.push(session);
  }
  return uniqueSessions(merged);
}

function uniqueSessions(sessions: BacktestSession[]) {
  const byId = new Map<number, BacktestSession>();
  const orderedIds: number[] = [];
  for (const session of sessions) {
    if (!byId.has(session.id)) {
      orderedIds.push(session.id);
    }
    byId.set(session.id, session);
  }
  return orderedIds.flatMap((id) => {
    const session = byId.get(id);
    return session ? [session] : [];
  });
}

function mergeTrades(existing: Trade[], incoming: Trade[]) {
  const merged = [...existing];
  for (const trade of incoming) {
    const index = merged.findIndex((item) => item.id === trade.id);
    if (index >= 0) {
      merged[index] = trade;
      continue;
    }
    merged.push(trade);
  }
  return merged;
}

async function loadResultsData(
  sessionTarget = RESULT_SESSIONS_PAGE_LIMIT,
  tradeTarget = RESULT_TRADES_PAGE_LIMIT,
) {
  const [shell, tradeSnapshot] = await Promise.all([
    getBootstrapShell(sessionTarget),
    loadTradeSnapshot(tradeTarget),
  ]);
  return {
    playbooks: shell.playbooks,
    resultSessions: uniqueSessions(shell.recent_sessions),
    resultSessionsNextOffset: shell.recent_sessions_next_offset,
    resultSessionsNextCursor: shell.recent_sessions_next_cursor,
    resultSessionsHasMore: shell.recent_sessions_has_more,
    strategySummaries: shell.strategy_summaries,
    resultTrades: tradeSnapshot.resultTrades,
    resultTradesNextOffset: tradeSnapshot.resultTradesNextOffset,
    resultTradesNextCursor: tradeSnapshot.resultTradesNextCursor,
    resultTradesHasMore: tradeSnapshot.resultTradesHasMore,
  };
}

async function loadShellSnapshot(sessionTarget = RESULT_SESSIONS_PAGE_LIMIT) {
  const shell = await getBootstrapShell(sessionTarget);
  return {
    playbooks: shell.playbooks,
    resultSessions: uniqueSessions(shell.recent_sessions),
    resultSessionsNextOffset: shell.recent_sessions_next_offset,
    resultSessionsNextCursor: shell.recent_sessions_next_cursor,
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
  const window = await loadWindow(
    latestState.session.current_offset,
    latestState.session.id,
    latestState.session.start_offset,
    latestState.session.end_offset,
  );
  return { meta, state: latestState, window };
}

function mergeActiveTradeState(
  state: BacktestState | null,
  trade: Trade,
  metricsSummary: MetricsSummary | null,
  metricsCurves: MetricsCurves | null,
) {
  if (!state || state.session.id !== trade.session_id) {
    return state;
  }

  return {
    ...state,
    trades: state.trades.map((item) => (item.id === trade.id ? trade : item)),
    metrics: mergeMetrics(state.metrics, metricsSummary, metricsCurves),
  };
}

function mergeMetrics(
  metrics: Metrics,
  metricsSummary: MetricsSummary | null,
  metricsCurves: MetricsCurves | null,
): Metrics {
  if (!metricsSummary && !metricsCurves) {
    return metrics;
  }
  return {
    ...metrics,
    ...(metricsSummary ?? {}),
    ...(metricsCurves ?? {}),
  };
}

function journalPayloadNeedsMetricSummary(payload: JournalPayload) {
  return (
    payload.strategy_name !== undefined ||
    payload.commission_mode !== undefined ||
    payload.commission_value !== undefined ||
    payload.commission_amount !== undefined ||
    payload.fee_mode !== undefined ||
    payload.fee_value !== undefined ||
    payload.fee_amount !== undefined
  );
}

function journalPayloadNeedsMetricCurves(payload: JournalPayload) {
  return payload.strategy_name !== undefined;
}

type TradeSnapshot = {
  resultTrades: Trade[];
  resultTradesNextOffset: number;
  resultTradesNextCursor: string | null;
  resultTradesHasMore: boolean;
};

const resultTradesLoadLease = new ResultTradesLoadLease();
let replayHydrationVersion = 0;
let replaySeekRequestVersion = 0;

function emptyTradeSnapshot(): TradeSnapshot {
  return {
    resultTrades: [],
    resultTradesNextOffset: 0,
    resultTradesNextCursor: null,
    resultTradesHasMore: false,
  };
}

function startResultTradesLoad(ownsLoading = false) {
  const { loadingOwner, version } = resultTradesLoadLease.begin(ownsLoading);
  useBacktestStore.setState({
    resultTradesLoading: ownsLoading,
    resultTradesLoadingVersion: loadingOwner,
  });
  return version;
}

function isCurrentResultTradesLoad(version: number) {
  return resultTradesLoadLease.isCurrent(version);
}

function settleResultTradesLoading(version: number) {
  if (resultTradesLoadLease.settle(version)) {
    useBacktestStore.setState({ resultTradesLoading: false, resultTradesLoadingVersion: null });
  }
}

function startReplayHydration() {
  replayHydrationVersion += 1;
  return replayHydrationVersion;
}

function isCurrentReplayHydration(version: number) {
  return replayHydrationVersion === version;
}

async function hydrateReplaySession(state: BacktestState, version: number) {
  const session = state.session;
  const [metaResult, windowResult] = await Promise.allSettled([
    getMeta(session.id),
    loadWindow(
      session.current_offset,
      session.id,
      session.start_offset,
      session.end_offset,
    ),
  ]);
  if (!isCurrentReplayHydration(version)) {
    return;
  }

  if (windowResult.status === "rejected") {
    useBacktestStore.setState({
      error: toErrorMessage(windowResult.reason),
      isLoading: false,
      isPlaying: false,
    });
    return;
  }

  useBacktestStore.setState((current) => ({
    meta: metaResult.status === "fulfilled" ? metaResult.value : current.meta,
    bars: windowResult.value.bars,
    barOffset: windowResult.value.barOffset,
    error: metaResult.status === "rejected" ? toErrorMessage(metaResult.reason) : null,
    isLoading: false,
    replaySeekVersion: current.replaySeekVersion + 1,
  }));
}

async function loadTradeSnapshot(targetCount = RESULT_TRADES_PAGE_LIMIT): Promise<TradeSnapshot> {
  const trades: Trade[] = [];
  let nextOffset = 0;
  let nextCursor: string | null = null;
  let hasMore = true;

  while (trades.length < targetCount && hasMore) {
    const page = await getTradesPage(undefined, {
      cursor: nextCursor,
      offset: nextOffset,
      limit: Math.min(RESULT_TRADES_PAGE_LIMIT, Math.max(1, targetCount - trades.length)),
    });
    trades.push(...page.items);
    nextOffset = page.next_offset;
    nextCursor = page.next_cursor;
    hasMore = page.has_more;
    if (page.items.length === 0) {
      break;
    }
  }

  return {
    resultTrades: trades,
    resultTradesNextOffset: nextOffset,
    resultTradesNextCursor: nextCursor,
    resultTradesHasMore: hasMore,
  };
}

async function hydrateRemainingResultTrades(version: number) {
  // Finish older pages after first paint so workspace gets fast initial trade payload.
  while (isCurrentResultTradesLoad(version)) {
    const snapshot = useBacktestStore.getState();
    if (!snapshot.resultTradesHasMore) {
      return;
    }
    const page = await getTradesPage(undefined, {
      cursor: snapshot.resultTradesNextCursor,
      offset: snapshot.resultTradesNextOffset,
      limit: RESULT_TRADES_PAGE_LIMIT,
    });
    if (!isCurrentResultTradesLoad(version)) {
      return;
    }
    useBacktestStore.setState((current) => ({
      resultTrades: mergeTrades(current.resultTrades, page.items),
      resultTradesNextOffset: page.next_offset,
      resultTradesNextCursor: page.next_cursor,
      resultTradesHasMore: page.has_more,
      error: current.error,
    }));
    if (!page.has_more || page.items.length === 0) {
      return;
    }
  }
}

async function loadWindow(
  currentOffset: number,
  sessionId?: number,
  startOffset = 0,
  endOffset: number | null = null,
) {
  const effectiveStartOffset = Math.max(0, startOffset);
  const effectiveEndOffset = endOffset ?? currentOffset;
  const barOffset = Math.max(effectiveStartOffset, currentOffset - WINDOW_HISTORY_BARS);
  const limit = Math.max(
    1,
    Math.min(WINDOW_SIZE, effectiveEndOffset - barOffset + 1),
  );
  const response = await getBars(barOffset, limit, sessionId);
  return { bars: response.bars, barOffset };
}

async function ensureBarsForOffset(
  bars: Candle[],
  barOffset: number,
  offset: number,
  sessionId?: number,
  startOffset = 0,
  endOffset: number | null = null,
) {
  if (bars.length === 0 || offset < barOffset || offset >= barOffset + bars.length) {
    return loadWindow(offset, sessionId, startOffset, endOffset);
  }

  const loadedThrough = barOffset + bars.length - 1;
  const effectiveEndOffset = endOffset ?? offset;
  const desiredLoadedThrough = Math.min(
    effectiveEndOffset,
    Math.max(offset, offset + WINDOW_PREFETCH_BARS),
  );
  if (desiredLoadedThrough <= loadedThrough) {
    return { bars, barOffset };
  }

  const limit = Math.max(1, desiredLoadedThrough - loadedThrough);
  const response = await getBars(loadedThrough + 1, limit, sessionId);
  return mergeBarWindow(bars, barOffset, response.bars);
}

function mergeBarWindow(
  existingBars: Candle[],
  barOffset: number,
  incomingBars: Candle[],
) {
  if (incomingBars.length === 0) {
    return { bars: existingBars, barOffset };
  }
  const mergedBars = [...existingBars, ...incomingBars];
  if (mergedBars.length <= WINDOW_SIZE) {
    return { bars: mergedBars, barOffset };
  }
  const overflow = mergedBars.length - WINDOW_SIZE;
  return {
    bars: mergedBars.slice(overflow),
    barOffset: barOffset + overflow,
  };
}

async function syncPendingReplayOffset() {
  const snapshot = useBacktestStore.getState();
  const pendingOffset = snapshot.pendingReplaySyncOffset;
  const sessionId = snapshot.state?.session.id;
  if (pendingOffset == null || !sessionId) {
    return snapshot.state;
  }
  const state = await jumpBacktest(sessionId, { offset: pendingOffset });
  let bars = snapshot.bars;
  let barOffset = snapshot.barOffset;
  const offsetLoaded =
    bars.length > 0 &&
    state.session.current_offset >= barOffset &&
    state.session.current_offset < barOffset + bars.length;
  if (!offsetLoaded) {
    const loadedWindow = await loadWindow(
      state.session.current_offset,
      state.session.id,
      state.session.start_offset,
      state.session.end_offset,
    );
    bars = loadedWindow.bars;
    barOffset = loadedWindow.barOffset;
  }
  useBacktestStore.setState({
    state,
    bars,
    barOffset,
    pendingReplaySyncOffset: null,
    error: null,
  });
  return state;
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

function mergeReplayUpdate(previous: BacktestState, update: BacktestReplayUpdate): BacktestState {
  return {
    session: update.session,
    current_candle: update.current_candle,
    position: update.position,
    orders: update.orders ?? previous.orders,
    executions: update.executions ?? previous.executions,
    trades: update.trades ?? previous.trades,
    metrics: update.metrics ?? previous.metrics,
  };
}

function didTradeHistoryChange(previous: BacktestState, next: BacktestState) {
  if (previous.trades.length !== next.trades.length) {
    return true;
  }
  const previousLatest = previous.trades[0];
  const nextLatest = next.trades[0];
  if (!previousLatest && !nextLatest) {
    return false;
  }
  if (!previousLatest || !nextLatest) {
    return true;
  }
  return (
    previousLatest.id !== nextLatest.id ||
    previousLatest.status !== nextLatest.status ||
    previousLatest.exit_offset !== nextLatest.exit_offset ||
    previousLatest.realized_pnl !== nextLatest.realized_pnl
  );
}

function canAdvanceLocally(
  state: BacktestState,
  bars: Candle[],
  barOffset: number,
  targetOffset: number,
) {
  const quantity = state.position?.quantity ?? 0;
  const side = state.position?.side ?? "FLAT";
  if (state.orders.some((order) => order.status === "PENDING")) {
    return false;
  }
  if (side === "FLAT" || quantity <= 0 || !state.position) {
    return true;
  }
  for (let offset = state.session.current_offset + 1; offset <= targetOffset; offset += 1) {
    const candle = bars[offset - barOffset];
    if (!candle || positionManagementTriggerHit(state.position, candle)) {
      return false;
    }
  }
  return true;
}

function positionManagementTriggerHit(
  position: NonNullable<BacktestState["position"]>,
  candle: Candle,
) {
  return (
    positionStopHit(position, candle) ||
    positionTargetHit(position, candle) ||
    positionBreakevenTriggerHit(position, candle)
  );
}

function positionStopHit(position: NonNullable<BacktestState["position"]>, candle: Candle) {
  if (position.stop_loss == null) {
    return false;
  }
  if (position.side === "LONG") {
    return candle.low <= position.stop_loss;
  }
  if (position.side === "SHORT") {
    return candle.high >= position.stop_loss;
  }
  return false;
}

function positionTargetHit(position: NonNullable<BacktestState["position"]>, candle: Candle) {
  if (position.take_profit == null) {
    return false;
  }
  if (position.side === "LONG") {
    return candle.high >= position.take_profit;
  }
  if (position.side === "SHORT") {
    return candle.low <= position.take_profit;
  }
  return false;
}

function positionBreakevenTriggerHit(
  position: NonNullable<BacktestState["position"]>,
  candle: Candle,
) {
  if (
    position.breakeven_moved ||
    position.breakeven_trigger_r == null ||
    position.stop_loss == null ||
    position.quantity <= 0
  ) {
    return false;
  }
  const risk =
    position.side === "LONG"
      ? position.avg_price - position.stop_loss
      : position.stop_loss - position.avg_price;
  if (risk <= 0) {
    return false;
  }
  const trigger =
    position.side === "LONG"
      ? position.avg_price + risk * position.breakeven_trigger_r
      : position.avg_price - risk * position.breakeven_trigger_r;
  return position.side === "LONG" ? candle.high >= trigger : candle.low <= trigger;
}

function advancePositionLocally(state: BacktestState, candle: Candle | null) {
  const position = state.position;
  if (!position || position.quantity <= 0 || position.side === "FLAT" || !candle) {
    return position;
  }
  const multiplier = state.session.pnl_multiplier > 0 ? state.session.pnl_multiplier : 1;
  const rawPnl =
    position.side === "LONG"
      ? (candle.close - position.avg_price) * position.quantity
      : (position.avg_price - candle.close) * position.quantity;
  return {
    ...position,
    unrealized_pnl: rawPnl * multiplier,
  };
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
