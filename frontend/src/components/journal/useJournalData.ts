import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  backfillLegacyJournal,
  createCanonicalTrade,
  createJournalAccount,
  createJournalTag,
  importJournalCsv,
  listCanonicalTrades,
  listJournalAccounts,
  listJournalDailyNotes,
  listJournalImports,
  listJournalTags,
  rollbackJournalImport,
  syncBrokerConnectionToJournal,
  updateCanonicalTradeReview,
  upsertJournalDailyNote,
  type CanonicalTrade,
  type CanonicalTradeCreate,
  type CanonicalTradeReviewUpdate,
  type JournalAccount,
  type JournalAccountCreate,
  type JournalBackfillResult,
  type JournalDailyNote,
  type JournalImportCreate,
  type JournalImportRun,
  type JournalTag,
  type JournalTagCategory,
} from "../../lib/journalApi";
import {
  DEFAULT_JOURNAL_SCOPE,
  hydrateJournalScope,
  loadJournalSampleRunId,
  loadJournalScope,
  saveJournalSampleRunId,
  saveJournalScope,
  type JournalAccountScope,
} from "../../lib/journalWorkspaceState";

export type JournalDataState = {
  accounts: JournalAccount[];
  error: string | null;
  imports: JournalImportRun[];
  loading: boolean;
  migration: "checking" | "migrating" | "ready" | "warning";
  migrationResult: JournalBackfillResult | null;
  notes: JournalDailyNote[];
  scope: JournalAccountScope;
  tags: JournalTag[];
  trades: CanonicalTrade[];
};

export function useJournalData() {
  const [state, setState] = useState<JournalDataState>({
    accounts: [], error: null, imports: [], loading: true, migration: "checking",
    migrationResult: null, notes: [], scope: loadJournalScope(), tags: [], trades: [],
  });
  const mountedRef = useRef(true);
  const initialLoadRef = useRef(false);

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [accounts, trades, tags, notes, imports] = await Promise.all([
        listJournalAccounts(), listCanonicalTrades(), listJournalTags(), listJournalDailyNotes(), listJournalImports(),
      ]);
      const scope = await hydrateJournalScope(accounts.map((account) => account.id));
      if (mountedRef.current) setState((current) => ({ ...current, accounts, trades, tags, notes, imports, scope, loading: false, error: null }));
      return { accounts, trades, tags, notes, imports };
    } catch (error) {
      if (mountedRef.current) setState((current) => ({ ...current, loading: false, error: errorMessage(error, "Journal data could not be loaded.") }));
      throw error;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (initialLoadRef.current) return () => { mountedRef.current = false; };
    initialLoadRef.current = true;
    void (async () => {
      try {
        await fetchAll();
        if (mountedRef.current) setState((current) => ({ ...current, migration: "migrating" }));
        const migrationResult = await backfillLegacyJournal();
        const changed = migrationResult.accounts_created + migrationResult.trades_created + migrationResult.notes_created + migrationResult.tags_created > 0;
        if (changed) await fetchAll(true);
        if (mountedRef.current) setState((current) => ({ ...current, migration: "ready", migrationResult }));
      } catch (error) {
        if (mountedRef.current) setState((current) => ({ ...current, migration: "warning", loading: false, error: current.error ?? errorMessage(error, "Legacy Journal migration could not be verified. Relational data remains available.") }));
      }
    })();
    return () => { mountedRef.current = false; };
  }, [fetchAll]);

  const scopedTrades = useMemo(() => {
    if (state.scope.mode === "all") return state.trades;
    const ids = new Set(state.scope.accountIds);
    return state.trades.filter((trade) => ids.has(trade.account_id));
  }, [state.scope, state.trades]);
  const scopedNotes = useMemo(() => {
    if (state.scope.mode === "all") return state.notes;
    const ids = new Set(state.scope.accountIds);
    return state.notes.filter((note) => note.account_id == null || ids.has(note.account_id));
  }, [state.notes, state.scope]);

  const setScope = useCallback((scope: JournalAccountScope) => {
    setState((current) => ({ ...current, scope }));
    void saveJournalScope(scope).catch(() => setState((current) => ({ ...current, error: "Account scope changed locally but could not sync across devices." })));
  }, []);

  const action = useCallback(async <T,>(work: () => Promise<T>, options: { reload?: boolean } = { reload: true }) => {
    setState((current) => ({ ...current, error: null }));
    try {
      const result = await work();
      if (options.reload !== false) await fetchAll(true);
      return result;
    } catch (error) {
      setState((current) => ({ ...current, error: errorMessage(error, "The Journal action could not be completed.") }));
      throw error;
    }
  }, [fetchAll]);

  return {
    ...state,
    scopedNotes,
    scopedTrades,
    clearError: () => setState((current) => ({ ...current, error: null })),
    refresh: () => fetchAll(false),
    setScope,
    addAccount: (payload: JournalAccountCreate) => action(() => createJournalAccount(payload)),
    addTag: (payload: { category: JournalTagCategory; name: string; color?: string | null }) => action(() => createJournalTag(payload)),
    addTrade: (payload: CanonicalTradeCreate) => action(() => createCanonicalTrade(payload)),
    updateReview: async (tradeId: number, payload: CanonicalTradeReviewUpdate) => {
      const updated = await action(() => updateCanonicalTradeReview(tradeId, payload), { reload: false });
      setState((current) => ({ ...current, trades: current.trades.map((trade) => trade.id === updated.id ? updated : trade) }));
      return updated;
    },
    saveDailyNote: async (date: string, payload: { account_id?: number | null; body: string }) => {
      const updated = await action(() => upsertJournalDailyNote(date, payload), { reload: false });
      setState((current) => ({ ...current, notes: [updated, ...current.notes.filter((note) => note.id !== updated.id)] }));
      return updated;
    },
    importCsv: (payload: JournalImportCreate) => action(() => importJournalCsv(payload)),
    rollbackImport: (runId: number) => action(() => rollbackJournalImport(runId)),
    syncConnection: (connectionId: number) => action(() => syncBrokerConnectionToJournal(connectionId)),
    importSample: async () => {
      const account = state.accounts[0];
      const result = await action(() => importJournalCsv({
        csv_text: SAMPLE_CSV,
        ...(account ? { destination_account_id: account.id } : { destination_account: { name: "EdgeLab sample", provider: "Sample data", currency: "USD", timezone: "UTC", initial_balance: 25_000, color: "#67e8f9" } }),
        source_name: "EdgeLab sample trades",
        source_timezone: "UTC",
        currency: account?.currency ?? "USD",
      }));
      saveJournalSampleRunId(result.run.id);
      return result;
    },
    resetSample: async () => {
      const runId = loadJournalSampleRunId() ?? state.imports.find((run) => run.source_name === "EdgeLab sample trades" && run.status === "COMPLETED")?.id;
      if (!runId) throw new Error("No active sample import was found.");
      const result = await action(() => rollbackJournalImport(runId));
      saveJournalSampleRunId(null);
      return result;
    },
    resetScope: () => setScope(DEFAULT_JOURNAL_SCOPE),
  };
}

const SAMPLE_CSV = [
  "entry_time,exit_time,side,entry_price,exit_price,quantity,pnl,commission,fees,symbol,strategy,stop_loss,take_profit,r,notes,tags",
  "2026-09-08 14:30:00,2026-09-08 15:05:00,LONG,6480,6493,1,13,1.25,0.30,MES,Opening range,6473,6495,1.4,Waited for confirmation,patient;plan followed",
  "2026-09-09 16:10:00,2026-09-09 16:28:00,SHORT,6521,6529,1,-8,1.25,0.30,MES,Failed breakout,6526,6508,-0.8,Chased after first rejection,chase;late entry",
  "2026-09-10 13:45:00,2026-09-10 14:42:00,LONG,6468,6489,1,21,1.25,0.30,MES,Support reclaim,6460,6492,2.1,Best execution of the week,patient;clean exit",
  "2026-09-11 18:05:00,2026-09-11 18:17:00,LONG,6510,6505,2,-10,2.50,0.60,MES,Momentum continuation,6506,6522,-1.0,Increased size after a loss,oversized;loss escalation",
].join("\n");

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
