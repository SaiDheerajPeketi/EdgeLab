import { create, type StoreApi, type UseBoundStore } from "zustand";
import { ResultTradesLoadLease } from "./resultTradesLoadLease.js";
import { assertAppDataAccess, captureAppDataAccess, type AppDataAccess } from "../lib/appDataBarrier";
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
  getApiBearerToken,
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
  replayLoadAttempted: boolean;
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
  replayOperationVersion: number;
  failedReplayAction: (
    | { type: "jumpToOffset"; offset: number }
    | { type: "jumpToTimestamp"; timestamp: string }
  ) & { operationVersion: number } | null;
  createPlaybook: (payload: PlaybookPayload) => Promise<Playbook>;
  updatePlaybook: (playbookId: number, payload: PlaybookUpdatePayload) => Promise<Playbook>;
  deletePlaybook: (playbookId: number) => Promise<void>;
  invalidateReplaySelection: () => void;
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
  ensureLatestReplayLoaded: () => Promise<boolean>;

  loadMoreSessions: () => Promise<void>;
  loadSession: (sessionId: number) => Promise<boolean>;
  newSession: (payload?: BacktestCreatePayload) => Promise<boolean>;
  updateSession: (sessionId: number, payload: BacktestSessionUpdatePayload) => Promise<BacktestSession>;
  deleteSession: (sessionId: number) => Promise<void>;
  stepForward: (steps?: number) => Promise<void>;
  stepBackward: (steps?: number) => Promise<void>;
  resetReplay: () => Promise<void>;
  jumpToOffset: (offset: number) => Promise<void>;
  jumpToTimestamp: (timestamp: string) => Promise<void>;
  retryFailedReplayAction: () => Promise<void>;
  setPlaying: (value: boolean) => void;
  setSpeed: (value: number) => void;
  placeOrder: (payload: OrderPayload) => Promise<boolean>;
  amendOrder: (orderId: number, payload: OrderUpdatePayload) => Promise<void>;
  updatePosition: (payload: PositionUpdatePayload) => Promise<void>;
  cancelOrder: (orderId: number) => Promise<void>;
  updateJournal: (tradeId: number, payload: JournalPayload) => Promise<Trade>;
  updateTradeStrategy: (tradeId: number, payload: TradeStrategyPayload) => Promise<Trade>;
};

export const useBacktestStore: UseBoundStore<StoreApi<BacktestStore>> = create<BacktestStore>((set, get) => ({
  bars: [],
  barOffset: 0,
  replaySeekVersion: 0,
  replayLoadAttempted: false,
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
  replayOperationVersion: 0,
  failedReplayAction: null,

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

  invalidateReplaySelection: () => invalidateReplaySelection(),

  loadInitial: async () => {
    const owner = beginReplaySelection(null, false);
    startResultTradesLoad();
    const hydrateShellData = () => {
      void Promise.allSettled([getDatasets()]).then(([datasetsResult]) => {
        if (!isCurrentReplayOwner(owner)) return;
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

    try {
      const shell = await getBootstrapShell();
      if (!isCurrentReplayOwner(owner)) return;
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
      if (!isCurrentReplayOwner(owner)) return;
      try {
        const bootstrap = await getBootstrap();
        if (!isCurrentReplayOwner(owner)) return;
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
          void hydrateRemainingResultTrades(tradeLoadVersion, owner);
        }
        return;
      } catch {
        if (!isCurrentReplayOwner(owner)) return;
        try {
          const tradeLoadVersion = startResultTradesLoad(true);
          const [datasetsResult, playbooksResult, sessionsResult, tradesResult] = await Promise.allSettled([
            getDatasets(),
            getPlaybooks(),
            getBacktests(),
            loadTradeSnapshot(),
          ]);
          settleResultTradesLoading(tradeLoadVersion);
          if (!isCurrentReplayOwner(owner)) return;
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
            void hydrateRemainingResultTrades(tradeLoadVersion, owner);
          }
        } catch (error) {
          if (!isCurrentReplayOwner(owner)) return;
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

  refreshDatasets: () => runDatasetOperation(async (owner) => {
    set({ isLoading: true, error: null });
    try {
      const response = await refreshDatasetsApi();
      assertDatasetOwner(owner);
      set({ datasets: response.catalog, isLoading: false, error: null });
      return response;
    } catch (error) {
      if (datasetOwnerIsCurrent(owner)) set({ error: toErrorMessage(error), isLoading: false });
      throw error;
    }
  }),

  applyDatasetCatalog: (datasets) => {
    set({ datasets, error: null });
  },

  refreshDatasetStatus: () => runDatasetOperation(async (owner) => {
    try {
      const status = await getDatasetRefreshStatus();
      assertDatasetOwner(owner);
      if (!status.running) {
        const datasets = await getDatasets().catch(() => null);
        assertDatasetOwner(owner);
        if (datasets) {
          set({ datasets });
        }
      }
      return status;
    } catch (error) {
      if (datasetOwnerIsCurrent(owner)) set({ error: toErrorMessage(error) });
      throw error;
    }
  }),

  updateDatasetAsset: (assetId, payload) => runDatasetOperation(async (owner) => {
    try {
      const datasets = await patchDatasetAsset(assetId, payload);
      assertDatasetOwner(owner);
      set({ datasets, error: null });
    } catch (error) {
      if (datasetOwnerIsCurrent(owner)) set({ error: toErrorMessage(error) });
      throw error;
    }
  }),

  updateDatasetSettings: (payload) => runDatasetOperation(async (owner) => {
    set({ isLoading: true, error: null });
    try {
      const datasets = await patchDatasetSettings(payload);
      assertDatasetOwner(owner);
      set({ datasets, isLoading: false, error: null });
    } catch (error) {
      if (datasetOwnerIsCurrent(owner)) set({ error: toErrorMessage(error), isLoading: false });
      throw error;
    }
  }),

  refreshShellSnapshot: async (targetCount) => {
    const operationVersion = get().replayOperationVersion;
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
        error: current.replayOperationVersion === operationVersion ? null : current.error,
      }));
    } catch (error) {
      if (get().replayOperationVersion === operationVersion) set({ error: toErrorMessage(error) });
    }
  },

  refreshResults: async () => {
    const operationVersion = get().replayOperationVersion;
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
      set((current) => ({
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
        error: current.replayOperationVersion === operationVersion ? null : current.error,
      }));
      if (resultTradesHasMore && isCurrentResultTradesLoad(tradeLoadVersion)) {
        void hydrateRemainingResultTrades(tradeLoadVersion);
      }
    } catch (error) {
      if (get().replayOperationVersion === operationVersion) set({ error: toErrorMessage(error) });
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
    if (get().isLoading) return false;
    if (get().state != null) {
      return activeReplayOwner == null ||
        (hydratedReplayGeneration === replayGeneration && isCurrentReplayOwner(activeReplayOwner));
    }
    const owner = beginReplaySelection(null);
    try {
      let state = await getLatestBacktest();
      if (!isCurrentReplayOwner(owner)) return false;
      owner.sessionId = state.session.id;
      if (deletingReplaySessions.has(replayMutationKey(owner))) {
        set({ error: "This replay session is being deleted.", isLoading: false });
        return false;
      }
      const tail = replayMutationTails.get(replayMutationKey(owner));
      if (tail) {
        await tail;
        if (!isCurrentReplayOwner(owner)) return false;
        state = await getBacktest(owner.sessionId);
        if (!isCurrentReplayOwner(owner)) return false;
      }
      return await publishReplaySelection(state, owner);
    } catch (error) {
      if (isCurrentReplayOwner(owner)) {
        set({ error: error instanceof ApiError && error.status === 404 ? null : toErrorMessage(error), isLoading: false });
      }
      return false;
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
    const owner = beginReplaySelection(sessionId);
    const key = replayMutationKey(owner);
    const tail = replayMutationTails.get(key);
    if (deletingReplaySessions.has(key)) {
      set({ error: "This replay session is being deleted.", isLoading: false });
      return false;
    }
    try {
      if (tail) {
        await tail;
        if (!isCurrentReplayOwner(owner)) return false;
      }
      if (!isCurrentReplayOwner(owner)) return false;
      const state = await getBacktest(sessionId);
      if (!isCurrentReplayOwner(owner)) return false;
      return await publishReplaySelection(state, owner);
    } catch (error) {
      if (isCurrentReplayOwner(owner)) set({ error: toErrorMessage(error), isLoading: false });
      return false;
    }
  },

  newSession: async (payload = {}) => {
    const owner = beginReplaySelection(null);
    try {
      const state = await createBacktest(payload);
      if (!isCurrentReplayOwner(owner)) return false;
      owner.sessionId = state.session.id;
      return await publishReplaySelection(state, owner);
    } catch (error) {
      if (isCurrentReplayOwner(owner)) set({ error: toErrorMessage(error), isLoading: false });
      return false;
    }
  },

  updateSession: async (sessionId, payload) => {
    const owner: ReplayOwner = {
      generation: replayGeneration, access: captureAppDataAccess(), token: getApiBearerToken(), sessionId,
    };
    const seekVersion = replaySeekRequestVersion;
    const admitted = () => replayAccountIsCurrent(owner) && !deletingReplaySessions.has(replayMutationKey(owner));
    try {
      const session = await runReplayMutation(owner, () => updateBacktestSession(sessionId, payload), () => true, admitted);
      if (!session || !replayAccountIsCurrent(owner)) throw new DOMException("Account session changed", "AbortError");
      const keys = ["name", "currency", "timezone", "pnl_multiplier", "strategy_name", "playbook_id", "status",
        "initial_balance", "default_commission_mode", "default_commission_value", "default_fee_mode", "default_fee_value"] as const;
      const metadata = Object.fromEntries(keys.filter((key) => payload[key] !== undefined &&
        (key !== "status" || seekVersion === replaySeekRequestVersion)).map((key) => [key, session[key]]));
      set((current) => {
        const previous = current.resultSessions.find((item) => item.id === session.id);
        return {
          resultSessions: upsertSession(current.resultSessions, previous ? { ...previous, ...metadata } : session),
          state: current.state && current.state.session.id === session.id
            ? { ...current.state, session: { ...current.state.session, ...metadata } } : current.state,
          error: isCurrentReplayOwner(owner) ? null : current.error,
        };
      });
      if (get().resultTradesLoaded) void get().refreshResults();
      else void get().refreshShellSnapshot();
      return session;
    } catch (error) {
      if (isCurrentReplayOwner(owner)) set({ error: toErrorMessage(error) });
      throw error;
    }
  },

  deleteSession: async (sessionId) => {
    const owner: ReplayOwner = {
      generation: replayGeneration, access: captureAppDataAccess(), token: getApiBearerToken(), sessionId,
    };
    const key = replayMutationKey(owner);
    if (deletingReplaySessions.has(key)) return;
    const tail = replayMutationTails.get(key);
    deletingReplaySessions.add(key);
    if (activeReplayOwner?.sessionId === sessionId || get().state?.session.id === sessionId) invalidateReplaySelection();
    try {
      if (tail) {
        await tail;
        if (!replayAccountIsCurrent(owner)) return;
      }
      if (!replayAccountIsCurrent(owner)) return;
      await deleteBacktestSession(sessionId);
      if (!replayAccountIsCurrent(owner)) return;
      if (activeReplayOwner?.sessionId === sessionId || get().state?.session.id === sessionId) invalidateReplaySelection();
      set((current) => ({
        resultSessions: current.resultSessions.filter((session) => session.id !== sessionId),
        resultTrades: current.resultTrades.filter((trade) => trade.session_id !== sessionId), error: null,
      }));
      if (get().resultTradesLoaded) void get().refreshResults();
      else void get().refreshShellSnapshot();
    } catch (error) {
      if (replayAccountIsCurrent(owner)) set({ error: toErrorMessage(error) });
      throw error;
    } finally { deletingReplaySessions.delete(key); }
  },

  stepForward: async (steps = 1) => {
    const previousState = get().state;
    const sessionId = previousState?.session.id;
    if (!sessionId || get().isStepping || get().isLoading || !previousState) {
      return;
    }

    const owner = captureReplayOwner();
    if (!owner) return;
    const seekVersion = replaySeekRequestVersion;
    const current = () => isCurrentReplayOwner(owner) && seekVersion === replaySeekRequestVersion;
    set({ isStepping: true, failedReplayAction: null, replayOperationVersion: ++replayOperationVersion });
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
        if (!current()) return;
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
      if (!current()) return;
      if (!(error instanceof Error) || error.message !== "server advance required") {
        set({ error: toErrorMessage(error), isPlaying: false, isStepping: false });
        return;
      }
    }
    try {
      const replayBaseState = get().pendingReplaySyncOffset == null
        ? previousState
        : await syncPendingReplayOffset(owner);
      if (!current()) return;
      if (!replayBaseState) { set({ isStepping: false }); return; }
      const replay = await runReplayMutation(owner, () => advanceBacktestCompact(sessionId, steps), current);
      if (!current()) return;
      if (!replay) { set({ isStepping: false }); return; }
      const state = mergeReplayUpdate(replayBaseState ?? previousState, replay);
      const bars = await ensureBarsForOffset(
        get().bars,
        get().barOffset,
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
        state.session.end_offset,
      );
      if (!current()) return;
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
      if (!current()) return;
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

    const owner = captureReplayOwner();
    if (!owner) return;
    const seekVersion = replaySeekRequestVersion;
    const current = () => isCurrentReplayOwner(owner) && seekVersion === replaySeekRequestVersion;
    set({ isStepping: true, isPlaying: false, error: null, failedReplayAction: null, replayOperationVersion: ++replayOperationVersion });
    try {
      const bars = await ensureBarsForOffset(
        get().bars,
        get().barOffset,
        targetOffset,
        previousState.session.id,
        previousState.session.start_offset,
        previousState.session.end_offset,
      );
      if (!current()) return;
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
      if (!current()) return;
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
    const owner = captureReplayOwner();
    if (!owner) return;
    const requestVersion = ++replaySeekRequestVersion;
    const operationVersion = ++replayOperationVersion;
    set({ isLoading: true, isStepping: false, isPlaying: false, error: null, failedReplayAction: null, replayOperationVersion: operationVersion });
    try {
      const state = await runReplayMutation(owner, () => jumpBacktest(sessionId, { offset }),
        () => requestVersion === replaySeekRequestVersion);
      if (!state || !isCurrentReplayOwner(owner) || requestVersion !== replaySeekRequestVersion) return;
      const { bars, barOffset } = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
        state.session.end_offset,
      );
      if (!isCurrentReplayOwner(owner) || requestVersion !== replaySeekRequestVersion) {
        return;
      }
      set((current) => ({
        state,
        bars,
        barOffset,
        pendingReplaySyncOffset: null,
        isLoading: false,
        failedReplayAction: null,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
    } catch (error) {
      if (!isCurrentReplayOwner(owner) || requestVersion !== replaySeekRequestVersion) {
        return;
      }
      const message = toErrorMessage(error);
      set({ error: message, isLoading: false, failedReplayAction: { type: "jumpToOffset", offset, operationVersion } });
    }
  },

  jumpToTimestamp: async (timestamp: string) => {
    const sessionId = get().state?.session.id;
    if (!sessionId) {
      return;
    }
    const owner = captureReplayOwner();
    if (!owner) return;
    const requestVersion = ++replaySeekRequestVersion;
    const operationVersion = ++replayOperationVersion;
    set({ isLoading: true, isStepping: false, isPlaying: false, error: null, failedReplayAction: null, replayOperationVersion: operationVersion });
    try {
      const state = await runReplayMutation(owner, () => jumpBacktest(sessionId, { timestamp }),
        () => requestVersion === replaySeekRequestVersion);
      if (!state || !isCurrentReplayOwner(owner) || requestVersion !== replaySeekRequestVersion) return;
      const { bars, barOffset } = await loadWindow(
        state.session.current_offset,
        state.session.id,
        state.session.start_offset,
        state.session.end_offset,
      );
      if (!isCurrentReplayOwner(owner) || requestVersion !== replaySeekRequestVersion) {
        return;
      }
      set((current) => ({
        state,
        bars,
        barOffset,
        pendingReplaySyncOffset: null,
        isLoading: false,
        failedReplayAction: null,
        replaySeekVersion: current.replaySeekVersion + 1,
      }));
    } catch (error) {
      if (!isCurrentReplayOwner(owner) || requestVersion !== replaySeekRequestVersion) {
        return;
      }
      const message = toErrorMessage(error);
      set({ error: message, isLoading: false, failedReplayAction: { type: "jumpToTimestamp", timestamp, operationVersion } });
    }
  },

  retryFailedReplayAction: async () => {
    const action = get().failedReplayAction;
    if (!action || action.operationVersion !== get().replayOperationVersion) {
      return;
    }
    if (action?.type === "jumpToOffset") {
      await get().jumpToOffset(action.offset);
    } else if (action?.type === "jumpToTimestamp") {
      await get().jumpToTimestamp(action.timestamp);
    }
  },

  setPlaying: (value) => {
    const owner = captureReplayOwner();
    if (!owner) return;
    set({ isPlaying: value });
    if (!value) {
      void syncReplayOnPause(owner).catch((error) => {
        if (isCurrentReplayOwner(owner)) set({ error: toErrorMessage(error) });
      });
    }
  },
  setSpeed: (value) => set({ speedMs: value }),

  placeOrder: async (payload) => mutateReplayOrder((sessionId) => postBacktestOrder(sessionId, payload), true),

  amendOrder: async (orderId, payload) => {
    await mutateReplayOrder((sessionId) => patchBacktestOrder(sessionId, orderId, payload));
  },

  updatePosition: async (payload) => {
    await mutateReplayOrder((sessionId) => patchBacktestPosition(sessionId, payload));
  },

  cancelOrder: async (orderId) => {
    await mutateReplayOrder((sessionId) => deleteBacktestOrder(sessionId, orderId));
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
type DatasetOwner = { access: AppDataAccess | null; token: string | null };
let datasetOperationTail: Promise<void> = Promise.resolve();
let pendingDatasetOperations = 0;
const MAX_PENDING_DATASET_OPERATIONS = 32;

function datasetOwnerIsCurrent(owner: DatasetOwner) {
  try {
    assertAppDataAccess(owner.access);
    const access = captureAppDataAccess();
    return getApiBearerToken() === owner.token && access?.owner === owner.access?.owner &&
      access?.token === owner.access?.token && access?.epoch === owner.access?.epoch;
  } catch { return false; }
}

function assertDatasetOwner(owner: DatasetOwner) {
  if (!datasetOwnerIsCurrent(owner)) throw new DOMException("Account data changed during dataset settings update", "AbortError");
}

/** Catalog responses contain every instrument, so reads and writes dispatch in order. */
async function runDatasetOperation<T>(execute: (owner: DatasetOwner) => Promise<T>): Promise<T> {
  const owner = { access: captureAppDataAccess(), token: getApiBearerToken() };
  assertDatasetOwner(owner);
  if (pendingDatasetOperations >= MAX_PENDING_DATASET_OPERATIONS) throw new Error("Dataset settings are busy. Wait for the pending requests to finish.");
  pendingDatasetOperations += 1;
  const operation = datasetOperationTail.then(() => { assertDatasetOwner(owner); return execute(owner); });
  datasetOperationTail = operation.then(() => {}, () => {});
  try { return await operation; }
  finally { pendingDatasetOperations -= 1; }
}

type ReplayOwner = {
  generation: number;
  access: AppDataAccess | null;
  token: string | null;
  sessionId: number | null;
};
let replayGeneration = 0;
let hydratedReplayGeneration: number | null = null;
let activeReplayOwner: ReplayOwner | null = null;
let replayPauseSync: { generation: number; task: Promise<void> } | null = null;
// Entries retain only unresolved local writes and release after settlement.
const replayMutationTails = new Map<string, Promise<void>>();
const replayMutationCounts = new Map<string, number>();
const deletingReplaySessions = new Set<string>();
const MAX_PENDING_REPLAY_SESSIONS = 64;
const MAX_PENDING_REPLAY_WRITES_PER_SESSION = 32;
let replaySeekRequestVersion = 0;
let replayOperationVersion = 0;

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

function replayAccountIsCurrent(owner: ReplayOwner) {
  try {
    assertAppDataAccess(owner.access);
    const access = captureAppDataAccess();
    return getApiBearerToken() === owner.token && access?.owner === owner.access?.owner &&
      access?.token === owner.access?.token && access?.epoch === owner.access?.epoch;
  } catch { return false; }
}

function replayMutationKey(owner: ReplayOwner) {
  return JSON.stringify([owner.access?.owner ?? owner.token, owner.access?.epoch ?? null, owner.sessionId]);
}

function isCurrentReplayOwner(owner: ReplayOwner) {
  if (owner.generation !== replayGeneration || !replayAccountIsCurrent(owner)) return false;
  if (owner.sessionId != null && deletingReplaySessions.has(replayMutationKey(owner))) return false;
  const selected = useBacktestStore.getState().state?.session.id;
  return owner.sessionId == null || selected == null || selected === owner.sessionId;
}

function captureReplayOwner(): ReplayOwner | null {
  const sessionId = useBacktestStore.getState().state?.session.id;
  if (!sessionId || (activeReplayOwner && !isCurrentReplayOwner(activeReplayOwner))) return null;
  return { generation: replayGeneration, access: captureAppDataAccess(), token: getApiBearerToken(), sessionId };
}

function clearReplaySelection(loading: boolean, attempted: boolean) {
  ++replaySeekRequestVersion;
  hydratedReplayGeneration = null;
  useBacktestStore.setState((current) => ({
    state: null, meta: null, bars: [], barOffset: 0, pendingReplaySyncOffset: null,
    isPlaying: false, isStepping: false, isLoading: loading,
    error: null, failedReplayAction: null, replayLoadAttempted: attempted,
    replaySeekVersion: current.replaySeekVersion + 1,
    replayOperationVersion: ++replayOperationVersion,
  }));
}

function invalidateReplaySelection() {
  ++replayGeneration;
  activeReplayOwner = null;
  clearReplaySelection(false, true);
}

function beginReplaySelection(sessionId: number | null, attempted = true): ReplayOwner {
  const owner: ReplayOwner = {
    generation: ++replayGeneration, access: captureAppDataAccess(), token: getApiBearerToken(), sessionId,
  };
  activeReplayOwner = owner;
  clearReplaySelection(true, attempted);
  return owner;
}

async function runReplayMutation<T>(
  owner: ReplayOwner, execute: () => Promise<T>, eligible = () => true,
  admitted = () => isCurrentReplayOwner(owner),
): Promise<T | null> {
  if (owner.sessionId == null || !admitted() || !eligible()) return null;
  const key = replayMutationKey(owner);
  const previous = replayMutationTails.get(key);
  const count = replayMutationCounts.get(key) ?? 0;
  if ((!previous && replayMutationTails.size >= MAX_PENDING_REPLAY_SESSIONS) || count >= MAX_PENDING_REPLAY_WRITES_PER_SESSION) {
    throw new Error("Too many replay changes are pending. Wait for them to finish.");
  }
  replayMutationCounts.set(key, count + 1);
  const result = (async () => {
    if (previous) await previous;
    if (!admitted() || !eligible()) return null;
    return execute();
  })();
  const tail = result.then(() => undefined, () => undefined);
  replayMutationTails.set(key, tail);
  void tail.then(() => {
    const remaining = (replayMutationCounts.get(key) ?? 1) - 1;
    if (remaining) replayMutationCounts.set(key, remaining);
    else replayMutationCounts.delete(key);
    if (replayMutationTails.get(key) === tail) replayMutationTails.delete(key);
  });
  return result;
}

async function publishReplaySelection(state: BacktestState, owner: ReplayOwner): Promise<boolean> {
  if (!isCurrentReplayOwner(owner)) return false;
  if (state.session.id !== owner.sessionId) throw new Error("The replay response belongs to a different session.");
  useBacktestStore.setState((current) => ({
    state, barOffset: state.session.start_offset,
    resultSessions: upsertSession(current.resultSessions, state.session),
  }));
  const accepted = await hydrateReplaySession(state, owner);
  if (!accepted || !isCurrentReplayOwner(owner)) return false;
  const current = useBacktestStore.getState();
  if (current.resultTradesLoaded) void current.refreshResults();
  else void current.refreshShellSnapshot();
  return true;
}

async function hydrateReplaySession(state: BacktestState, owner: ReplayOwner): Promise<boolean> {
  const session = state.session;
  if (!isCurrentReplayOwner(owner)) return false;
  const [metaResult, windowResult] = await Promise.allSettled([
    getMeta(session.id), loadWindow(session.current_offset, session.id, session.start_offset, session.end_offset),
  ]);
  if (!isCurrentReplayOwner(owner)) return false;
  if (windowResult.status === "rejected") {
    useBacktestStore.setState({ error: toErrorMessage(windowResult.reason), isLoading: false, isPlaying: false });
    return false;
  }
  useBacktestStore.setState((current) => ({
    meta: metaResult.status === "fulfilled" ? metaResult.value : current.meta,
    bars: windowResult.value.bars, barOffset: windowResult.value.barOffset,
    error: metaResult.status === "rejected" ? toErrorMessage(metaResult.reason) : null,
    isLoading: false, replaySeekVersion: current.replaySeekVersion + 1,
  }));
  if (metaResult.status !== "fulfilled") return false;
  hydratedReplayGeneration = owner.generation;
  return true;
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

async function hydrateRemainingResultTrades(version: number, owner?: ReplayOwner) {
  // Finish older pages after first paint so workspace gets fast initial trade payload.
  while (isCurrentResultTradesLoad(version) && (!owner || isCurrentReplayOwner(owner))) {
    const snapshot = useBacktestStore.getState();
    if (!snapshot.resultTradesHasMore) {
      return;
    }
    const page = await getTradesPage(undefined, {
      cursor: snapshot.resultTradesNextCursor,
      offset: snapshot.resultTradesNextOffset,
      limit: RESULT_TRADES_PAGE_LIMIT,
    });
    if (!isCurrentResultTradesLoad(version) || (owner && !isCurrentReplayOwner(owner))) {
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

async function syncReplayOnPause(owner: ReplayOwner) {
  if (replayPauseSync?.generation === owner.generation) return replayPauseSync.task;
  const task = (async () => {
    if (useBacktestStore.getState().isStepping) {
      await new Promise<void>((resolve) => {
        const unsubscribe = useBacktestStore.subscribe((current) => {
          if (!current.isStepping || !isCurrentReplayOwner(owner)) { unsubscribe(); resolve(); }
        });
      });
    }
    if (isCurrentReplayOwner(owner) && !useBacktestStore.getState().isLoading) await syncPendingReplayOffset(owner);
  })();
  replayPauseSync = { generation: owner.generation, task };
  const clear = () => { if (replayPauseSync?.task === task) replayPauseSync = null; };
  void task.then(clear, clear);
  return task;
}

async function syncPendingReplayOffset(owner: ReplayOwner): Promise<BacktestState | null> {
  if (!isCurrentReplayOwner(owner)) return null;
  const snapshot = useBacktestStore.getState();
  const pendingOffset = snapshot.pendingReplaySyncOffset;
  const sessionId = snapshot.state?.session.id;
  const seekVersion = replaySeekRequestVersion;
  if (snapshot.isLoading || !sessionId || sessionId !== owner.sessionId) return null;
  if (pendingOffset == null) return snapshot.state;
  const unchanged = () => {
    const current = useBacktestStore.getState();
    return !current.isLoading && seekVersion === replaySeekRequestVersion && current.state === snapshot.state && current.pendingReplaySyncOffset === pendingOffset;
  };
  const state = await runReplayMutation(owner, () => jumpBacktest(sessionId, { offset: pendingOffset }), unchanged);
  if (!state || !isCurrentReplayOwner(owner) || !unchanged()) return null;
  let bars = snapshot.bars;
  let barOffset = snapshot.barOffset;
  const loaded = bars.length > 0 && state.session.current_offset >= barOffset && state.session.current_offset < barOffset + bars.length;
  if (!loaded) {
    const window = await loadWindow(state.session.current_offset, sessionId, state.session.start_offset, state.session.end_offset);
    if (!isCurrentReplayOwner(owner) || !unchanged()) return null;
    bars = window.bars; barOffset = window.barOffset;
  }
  useBacktestStore.setState({ state, bars, barOffset, pendingReplaySyncOffset: null, error: null });
  return state;
}

async function mutateReplayOrder(
  execute: (sessionId: number) => Promise<BacktestState>, refreshClosedTrades = false,
): Promise<boolean> {
  const owner = captureReplayOwner();
  const snapshot = useBacktestStore.getState();
  if (!owner || owner.sessionId == null || snapshot.isLoading || snapshot.isStepping) return false;
  const sessionId = owner.sessionId;
  const seekVersion = replaySeekRequestVersion;
  const current = () => {
    const state = useBacktestStore.getState();
    return isCurrentReplayOwner(owner) && seekVersion === replaySeekRequestVersion && !state.isLoading && !state.isStepping;
  };
  useBacktestStore.setState({ failedReplayAction: null, replayOperationVersion: ++replayOperationVersion });
  try {
    const synced = await syncPendingReplayOffset(owner);
    if (!synced || !current()) return false;
    const offset = synced.session.current_offset;
    const eligible = () => {
      const state = useBacktestStore.getState();
      return current() && state.pendingReplaySyncOffset == null && state.state?.session.current_offset === offset;
    };
    const state = await runReplayMutation(owner, () => execute(sessionId), eligible);
    if (!state || !eligible()) return false;
    useBacktestStore.setState({ state, pendingReplaySyncOffset: null, error: null });
    if (refreshClosedTrades && state.trades.some((trade) => trade.status === "CLOSED")) {
      const current = useBacktestStore.getState();
      if (current.resultTradesLoaded) void current.refreshResults();
      else void current.refreshShellSnapshot();
    }
    return true;
  } catch (error) {
    if (current()) useBacktestStore.setState({ error: toErrorMessage(error) });
    return false;
  }
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
