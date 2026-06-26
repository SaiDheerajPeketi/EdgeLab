import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Database,
  FileText,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  BacktestCreatePayload,
  BacktestSession,
  BacktestSessionUpdatePayload,
  DatasetCatalog,
  DatasetInstrument,
  DatasetTimeframe,
  Playbook,
  PlaybookPayload,
  StrategySummary,
  StrategySummaryAggregate,
  Trade,
} from "../lib/api";
import { currencyForSession, currencyForSessions } from "../lib/currency";
import { formatMoney, formatPercent } from "../lib/format";
import {
  hydrateOrderCommissionFixed,
  hydrateOrderCommissionMode,
  hydrateOrderCommissionPercent,
  hydrateOrderFeeFixed,
  hydrateOrderFeeMode,
  hydrateOrderFeePercent,
  loadOrderCommissionFixed,
  loadOrderCommissionMode,
  loadOrderCommissionPercent,
  loadOrderFeeFixed,
  loadOrderFeeMode,
  loadOrderFeePercent,
  type OrderCommissionMode,
} from "../lib/orderSettings";
import { sameStrategyName, useBacktestStrategyNames } from "../lib/strategyNames";
import { formatMarketSymbol, symbolBadge } from "../lib/symbols";
import { sessionStrategyName } from "../lib/strategy";
import { ReplayDateTimePicker } from "./ReplayController";
import { ThemedSelect } from "./ThemedSelect";

type Props = {
  datasets: DatasetCatalog | null;
  isLoading: boolean;
  onCreateSession: (payload: BacktestCreatePayload) => Promise<void>;
  onCreatePlaybook: (payload: PlaybookPayload) => Promise<Playbook>;
  onDeleteSession: (sessionId: number) => Promise<void> | void;
  onLoadMoreSessions: () => Promise<void> | void;
  onResumeSession: (sessionId?: number) => Promise<void> | void;
  onUpdateSession: (sessionId: number, payload: BacktestSessionUpdatePayload) => Promise<void> | void;
  playbooks: Playbook[];
  session: BacktestSession | null;
  sessions: BacktestSession[];
  sessionsHasMore: boolean;
  strategySummaries: StrategySummary[];
  trades: Trade[];
  isLoadingMoreSessions: boolean;
};

type PlaybookMode = "none" | "existing" | "new";

const COST_MODE_OPTIONS: Array<{ label: string; value: OrderCommissionMode }> = [
  { label: "None", value: "NONE" },
  { label: "Fixed", value: "FIXED" },
  { label: "Percent", value: "PERCENT" },
];

const CURRENCY_OPTIONS = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "AUD",
  "CAD",
  "CHF",
  "NZD",
  "SGD",
  "HKD",
  "AED",
].map((currency) => ({ label: currency, value: currency }));

const TIMEZONE_IDS = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Zurich",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
];
const TIMEZONE_OPTIONS = TIMEZONE_IDS.map(timezoneOption);

export function SessionGateway({
  datasets,
  isLoading,
  onCreateSession,
  onCreatePlaybook,
  onDeleteSession,
  onLoadMoreSessions,
  onResumeSession,
  onUpdateSession,
  playbooks,
  session,
  sessions,
  sessionsHasMore,
  strategySummaries,
  trades,
  isLoadingMoreSessions,
}: Props) {
  const instruments = datasets?.instruments ?? [];
  const savedStrategyNames = useBacktestStrategyNames();
  const [instrumentId, setInstrumentId] = useState("");
  const [instrumentSearch, setInstrumentSearch] = useState("");
  const [instrumentMenuOpen, setInstrumentMenuOpen] = useState(false);
  const [timeframe, setTimeframe] = useState("");
  const [strategy, setStrategy] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [sessionNameEdited, setSessionNameEdited] = useState(false);
  const [playbookMode, setPlaybookMode] = useState<PlaybookMode>("none");
  const [playbookId, setPlaybookId] = useState("");
  const [newPlaybookName, setNewPlaybookName] = useState("");
  const [entryRules, setEntryRules] = useState("");
  const [exitRules, setExitRules] = useState("");
  const [riskRules, setRiskRules] = useState("Risk 1% or less until the setup is validated.");
  const [sessionNotes, setSessionNotes] = useState("");
  const [startingBalance, setStartingBalance] = useState("100000");
  const [commissionMode, setCommissionMode] = useState<OrderCommissionMode>(() =>
    loadOrderCommissionMode(),
  );
  const [fixedCommission, setFixedCommission] = useState(() => loadOrderCommissionFixed());
  const [percentCommission, setPercentCommission] = useState(() => loadOrderCommissionPercent());
  const [feeMode, setFeeMode] = useState<OrderCommissionMode>(() => loadOrderFeeMode());
  const [fixedFee, setFixedFee] = useState(() => loadOrderFeeFixed());
  const [percentFee, setPercentFee] = useState(() => loadOrderFeePercent());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedStrategyName, setSelectedStrategyName] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<BacktestSession | null>(null);
  const [deletingSession, setDeletingSession] = useState<BacktestSession | null>(null);
  const instrumentPickerRef = useRef<HTMLDivElement | null>(null);

  const selectedInstrument = useMemo(
    () => instruments.find((instrument) => instrument.id === instrumentId) ?? instruments[0],
    [instrumentId, instruments],
  );
  const selectedTimeframe = useMemo(
    () =>
      selectedInstrument?.timeframes.find((item) => item.timeframe === timeframe) ??
      selectedInstrument?.timeframes[0],
    [selectedInstrument, timeframe],
  );
  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => String(playbook.id) === playbookId) ?? null,
    [playbookId, playbooks],
  );
  const strategyGroups = useMemo(
    () =>
      strategySummaries.length > 0
        ? buildStrategyGroupsFromSummaries(strategySummaries)
        : buildStrategyGroups(sessions, trades),
    [sessions, strategySummaries, trades],
  );
  const selectedStrategyGroup = useMemo(
    () =>
      selectedStrategyName
        ? strategyGroups.find((group) => sameStrategyName(group.name, selectedStrategyName)) ?? null
        : null,
    [selectedStrategyName, strategyGroups],
  );
  const defaultSessionName = useMemo(
    () => buildDefaultSessionName(strategy, selectedInstrument, selectedTimeframe),
    [selectedInstrument, selectedTimeframe, strategy],
  );
  const strategySelectValue = selectedStrategyName ?? "";
  const strategySelectOptions = useMemo(
    () => buildExistingStrategyOptions(strategyGroups, savedStrategyNames, playbooks),
    [playbooks, savedStrategyNames, strategyGroups],
  );
  const selectedInstrumentLabel = selectedInstrument
    ? buildInstrumentOptionLabel(selectedInstrument)
    : "";
  const visibleInstrumentOptions = useMemo(
    () => filterInstrumentOptions(instruments, instrumentSearch, selectedInstrumentLabel),
    [instrumentSearch, instruments, selectedInstrumentLabel],
  );

  useEffect(() => {
    if (selectedInstrument && instrumentId !== selectedInstrument.id) {
      setInstrumentId(selectedInstrument.id);
    }
  }, [instrumentId, selectedInstrument]);

  useEffect(() => {
    setInstrumentSearch(selectedInstrumentLabel);
  }, [selectedInstrumentLabel]);

  useEffect(() => {
    if (selectedInstrument && !selectedTimeframe && selectedInstrument.timeframes[0]) {
      setTimeframe(selectedInstrument.timeframes[0].timeframe);
    }
  }, [selectedInstrument, selectedTimeframe]);

  useEffect(() => {
    if (!selectedTimeframe) {
      return;
    }
    setStartDate(defaultReplayStartValue(selectedTimeframe));
    setEndDate(toLocalInputValue(selectedTimeframe.last_timestamp));
  }, [selectedTimeframe?.csv_path]);

  useEffect(() => {
    if (playbookMode === "existing" && playbooks.length > 0 && !playbookId) {
      setPlaybookId(String(playbooks[0].id));
    }
    if (playbookId && !playbooks.some((playbook) => String(playbook.id) === playbookId)) {
      setPlaybookId("");
      setPlaybookMode("none");
    }
  }, [playbookId, playbookMode, playbooks]);

  useEffect(() => {
    if (
      selectedStrategyName &&
      !strategySelectOptions.some((option) => sameStrategyName(option.value, selectedStrategyName))
    ) {
      setSelectedStrategyName(null);
    }
  }, [selectedStrategyName, strategySelectOptions]);

  useEffect(() => {
    if (!sessionNameEdited) {
      setSessionName(defaultSessionName);
    }
  }, [defaultSessionName, sessionNameEdited]);

  useEffect(() => {
    if (editingSession && !sessions.some((item) => item.id === editingSession.id)) {
      setEditingSession(null);
    }
    if (deletingSession && !sessions.some((item) => item.id === deletingSession.id)) {
      setDeletingSession(null);
    }
  }, [deletingSession, editingSession, sessions]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      hydrateOrderCommissionMode(),
      hydrateOrderCommissionFixed(),
      hydrateOrderCommissionPercent(),
      hydrateOrderFeeMode(),
      hydrateOrderFeeFixed(),
      hydrateOrderFeePercent(),
    ]).then(([nextCommissionMode, nextFixedCommission, nextPercentCommission, nextFeeMode, nextFixedFee, nextPercentFee]) => {
      if (!active) {
        return;
      }
      setCommissionMode(nextCommissionMode);
      setFixedCommission(nextFixedCommission);
      setPercentCommission(nextPercentCommission);
      setFeeMode(nextFeeMode);
      setFixedFee(nextFixedFee);
      setPercentFee(nextPercentFee);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!instrumentMenuOpen) {
      return;
    }

    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (instrumentPickerRef.current?.contains(target)) {
        return;
      }
      setInstrumentMenuOpen(false);
      commitInstrumentSearch();
    }

    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [instrumentMenuOpen, instrumentSearch, instruments, selectedInstrumentLabel]);

  function selectInstrument(instrument: DatasetInstrument) {
    setInstrumentId(instrument.id);
    setInstrumentSearch(buildInstrumentOptionLabel(instrument));
    setTimeframe(instrument.timeframes[0]?.timeframe ?? "");
  }

  function chooseInstrument(instrument: DatasetInstrument) {
    selectInstrument(instrument);
    setInstrumentMenuOpen(false);
  }

  function handleInstrumentSearchChange(value: string) {
    setInstrumentSearch(value);
    setInstrumentMenuOpen(instruments.length > 0);
    const exactMatch = findExactInstrumentMatch(instruments, value);
    if (exactMatch) {
      selectInstrument(exactMatch);
    }
  }

  function commitInstrumentSearch() {
    const match = findInstrumentSearchMatch(instruments, instrumentSearch);
    if (match) {
      selectInstrument(match);
    } else {
      setInstrumentSearch(selectedInstrumentLabel);
    }
    setInstrumentMenuOpen(false);
  }

  function applyExistingStrategyName(strategyName: string) {
    const group = strategyGroups.find((item) => sameStrategyName(item.name, strategyName)) ?? null;
    setSelectedStrategyName(strategyName);
    setStrategy(strategyName);
    const linkedPlaybookId = linkedPlaybookIdForStrategy(strategyName, group, playbooks);
    if (linkedPlaybookId != null) {
      setPlaybookMode("existing");
      setPlaybookId(String(linkedPlaybookId));
    }
  }

  function applyExistingStrategy(group: GatewayStrategyGroup) {
    applyExistingStrategyName(group.name);
  }

  function handleStrategySelect(value: string) {
    if (!value) {
      setSelectedStrategyName(null);
      return;
    }
    applyExistingStrategyName(value);
  }

  function startNewStrategy() {
    setSelectedStrategyName(null);
    setStrategy("");
    setPlaybookMode("none");
    setPlaybookId("");
  }

  function handleStrategyNameChange(value: string) {
    setStrategy(value);
    const matchingOption = strategySelectOptions.find((option) => sameStrategyName(option.value, value));
    const matchingGroup = strategyGroups.find((group) => sameStrategyName(group.name, value)) ?? null;
    setSelectedStrategyName(matchingOption?.value ?? null);
    if (matchingOption) {
      const linkedPlaybookId = linkedPlaybookIdForStrategy(matchingOption.value, matchingGroup, playbooks);
      if (linkedPlaybookId != null) {
        setPlaybookMode("existing");
        setPlaybookId(String(linkedPlaybookId));
      }
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedStrategy = strategy.trim();
    const trimmedSessionName = sessionName.trim() || defaultSessionName;
    if (submitting || isLoading || !selectedInstrument || !selectedTimeframe || !trimmedStrategy || !trimmedSessionName) {
      return;
    }

    setSubmitting(true);
    try {
      let attachedPlaybookId =
        playbookMode === "existing" && playbookId ? Number(playbookId) : null;

      if (playbookMode === "new" && newPlaybookName.trim()) {
        const playbook = await onCreatePlaybook({
          name: newPlaybookName.trim(),
          description: sessionNotes.trim() || `Rules for ${trimmedStrategy}`,
          rules: buildPlaybookRules(entryRules, exitRules, riskRules),
        });
        attachedPlaybookId = playbook.id;
      }

      await onCreateSession({
        name: trimmedSessionName,
        symbol: selectedInstrument.symbol,
        instrument: selectedInstrument.id,
        timeframe: selectedTimeframe.timeframe,
        csv_path: selectedTimeframe.csv_path,
        currency: selectedInstrument.currency,
        pnl_multiplier: selectedInstrument.pnl_multiplier,
        timezone: selectedInstrument.timezone,
        strategy_name: trimmedStrategy,
        playbook_id: attachedPlaybookId,
        start_timestamp: startDate ? new Date(startDate).toISOString() : null,
        end_timestamp: endDate ? new Date(endDate).toISOString() : null,
        initial_balance: Number(startingBalance) || 100000,
        default_commission_mode: commissionMode,
        default_commission_value: costValueForPayload(commissionMode, fixedCommission, percentCommission),
        default_fee_mode: feeMode,
        default_fee_value: costValueForPayload(feeMode, fixedFee, percentFee),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveSessionDetails(
    sessionId: number,
    payload: BacktestSessionUpdatePayload,
  ) {
    await onUpdateSession(sessionId, payload);
    setEditingSession(null);
  }

  async function confirmDeleteSession(sessionId: number) {
    await onDeleteSession(sessionId);
    setDeletingSession(null);
  }

  return (
    <section className="session-gateway">
      <div className="session-gateway-hero">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">
            <Target size={14} />
            EdgeLab / Your Edge Engineered
          </div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-white xl:text-5xl">
            Choose the session that sharpens your edge.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
            Start with a strategy, attach the rules you want to grade against, then enter replay with the right market and date window.
          </p>
        </div>

        <div className="session-resume-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                Resume
              </div>
              <div className="mt-2 text-lg font-semibold text-white">
                {session ? session.name : "No saved session yet"}
              </div>
              <div className="mt-1 text-sm text-slate-400">
                {session
                  ? `${formatMarketSymbol(session.symbol)} ${session.timeframe ?? ""} / ${session.strategy_name ?? "No strategy"}`
                  : "Create a session to unlock replay."}
              </div>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-md bg-white text-xs font-black text-ink-950">
              {session ? symbolBadge(session.symbol) : "NEW"}
            </div>
          </div>
          <button
            className="control-button mt-5 w-full border-emerald-300/30 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20"
            disabled={!session}
            onClick={() => onResumeSession(session?.id)}
            type="button"
          >
            <RotateCcw size={16} />
            Resume Session
          </button>
        </div>
      </div>

      <section className="terminal-panel min-w-0 p-4 xl:p-5">
        <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
              <BarChart3 size={14} />
              Strategy Workspace
            </div>
            <h2 className="mt-2 text-lg font-semibold text-white">
              Strategies, Sessions, Results
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              Pick a strategy to continue an existing session, or use its name when creating the next replay.
            </p>
          </div>
          <span className="status-pill">
            <Activity size={14} />
            {strategyGroups.length} strategies
          </span>
        </div>

        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          {strategyGroups.map((group) => (
            <article
              className={`min-w-0 cursor-pointer rounded-md border p-4 transition ${
                selectedStrategyGroup?.name === group.name
                  ? "border-cyan-300/35 bg-cyan-300/10"
                  : "border-white/10 bg-black/20 hover:border-cyan-300/25 hover:bg-cyan-300/5"
              }`}
              key={group.name}
              onClick={() => {
                applyExistingStrategy(group);
              }}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    className="block max-w-full truncate text-left text-base font-semibold text-white transition hover:text-cyan-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      applyExistingStrategy(group);
                    }}
                    title="View strategy metrics and use this strategy for the new session form"
                    type="button"
                  >
                    {group.name}
                  </button>
                  <div className="mt-1 text-xs text-slate-500">
                    {group.sessions.length} sessions · {group.aggregate.closedTrades} closed trades
                  </div>
                </div>
                <div className={`shrink-0 text-sm font-semibold ${toneForNumber(group.aggregate.netPnl)}`}>
                  {formatMoney(
                    group.aggregate.netPnl,
                    currencyForSessions(group.sessions.map((row) => row.session), datasets),
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <GatewayMetric label="Win" value={formatPercent(group.aggregate.winRate)} />
                <GatewayMetric label="PF" value={formatRatio(group.aggregate.profitFactor)} />
                <GatewayMetric label="Avg R" value={formatOptionalNumber(group.aggregate.averageR)} />
              </div>

              <div className="mt-3 grid gap-2">
                {group.sessions.map((row) => (
                  <div
                    className={`grid min-w-0 gap-2 rounded-md border p-2 transition sm:grid-cols-[minmax(0,1fr)_auto] ${
                      row.session.id === session?.id
                        ? "border-cyan-300/35 bg-cyan-300/10"
                        : "border-white/10 bg-[#080c11] hover:border-cyan-300/25 hover:bg-cyan-300/5"
                    }`}
                    key={`${group.name}:${row.session.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <button
                      className="grid min-w-0 gap-3 rounded px-1 py-0.5 text-left sm:grid-cols-[minmax(0,1fr)_auto]"
                      onClick={() => onResumeSession(row.session.id)}
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-100">
                          {row.session.name}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {formatMarketSymbol(row.session.symbol)} · {row.session.timeframe ?? "M1"} · {row.session.status}
                        </span>
                      </span>
                      <span className="flex items-center justify-between gap-3 sm:justify-end">
                        <span className="text-right">
                          <span className={`block text-sm font-semibold ${toneForNumber(row.aggregate.netPnl)}`}>
                            {formatMoney(row.aggregate.netPnl, currencyForSession(row.session, datasets))}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {row.aggregate.closedTrades} trades · {formatPercent(row.aggregate.winRate)}
                          </span>
                        </span>
                        <ArrowRight size={15} className="text-slate-500" />
                      </span>
                    </button>
                    <SessionActionButtons
                      onDelete={setDeletingSession}
                      onEdit={setEditingSession}
                      session={row.session}
                    />
                  </div>
                ))}
              </div>
            </article>
          ))}
          {strategyGroups.length === 0 && (
            <div className="rounded-md border border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-slate-500 xl:col-span-2">
              Create a session to start building strategy results.
            </div>
          )}
        </div>

        {sessionsHasMore && (
          <div className="mt-4 flex justify-center">
            <button
              className="control-button"
              disabled={isLoadingMoreSessions}
              onClick={() => void onLoadMoreSessions()}
              type="button"
            >
              <RefreshCw
                className={isLoadingMoreSessions ? "animate-spin motion-reduce:animate-none" : ""}
                size={16}
              />
              {isLoadingMoreSessions ? "Loading older sessions..." : "Load older sessions"}
            </button>
          </div>
        )}

        {selectedStrategyGroup && (
          <StrategyDetails
            activeSessionId={session?.id ?? null}
            datasets={datasets}
            group={selectedStrategyGroup}
            onDeleteSession={setDeletingSession}
            onEditSession={setEditingSession}
            onResumeSession={onResumeSession}
          />
        )}
      </section>

      <form
        autoComplete="off"
        className="session-builder"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="session-step">
          <div className="session-step-number">1</div>
          <div>
            <h2 className="text-base font-semibold text-white">Strategy</h2>
            <p className="mt-1 text-sm text-slate-500">
              Every session belongs to one strategy so reports and reviews stay clean.
            </p>
          </div>
        </div>
        <div className="session-form-grid">
          <div className="form-field">
            <span>Existing Strategy</span>
            <div className="flex min-w-0 gap-2">
              <ThemedSelect
                ariaLabel="Existing strategy"
                className="h-11 min-w-0 flex-1"
                disabled={strategySelectOptions.length === 0}
                onChange={handleStrategySelect}
                options={strategySelectOptions}
                placeholder={strategySelectOptions.length === 0 ? "No saved strategies" : "Select strategy"}
                value={strategySelectValue}
              />
              <button
                className="control-button h-11 shrink-0 px-3"
                onClick={startNewStrategy}
                type="button"
              >
                <Plus size={16} />
                New
              </button>
            </div>
          </div>
          <label className="form-field xl:col-span-2">
            <span>Strategy Name</span>
            <input
              autoComplete="off"
              className="input-control h-11"
              onChange={(event) => handleStrategyNameChange(event.target.value)}
              placeholder="Type strategy name"
              required
              value={strategy}
            />
          </label>
          <label className="form-field xl:col-span-2">
            <span>Session Name</span>
            <input
              className="input-control h-11 normal-case tracking-normal"
              onChange={(event) => {
                setSessionName(event.target.value);
                setSessionNameEdited(true);
              }}
              placeholder={defaultSessionName}
              required
              value={sessionName}
            />
          </label>
          <label className="form-field">
            <span>Starting Balance</span>
            <input
              className="input-control h-11"
              min={1}
              onChange={(event) => setStartingBalance(event.target.value)}
              type="number"
              value={startingBalance}
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <CostConfigCard
            fixedValue={fixedCommission}
            mode={commissionMode}
            onFixedValueChange={setFixedCommission}
            onModeChange={setCommissionMode}
            onPercentValueChange={setPercentCommission}
            percentValue={percentCommission}
            title="Default Commissions"
          />
          <CostConfigCard
            fixedValue={fixedFee}
            mode={feeMode}
            onFixedValueChange={setFixedFee}
            onModeChange={setFeeMode}
            onPercentValueChange={setPercentFee}
            percentValue={percentFee}
            title="Default Fees"
          />
        </div>

        <div className="session-step">
          <div className="session-step-number">2</div>
          <div>
            <h2 className="text-base font-semibold text-white">Market And Window</h2>
            <p className="mt-1 text-sm text-slate-500">
              Pick the instrument, timeframe, and replay date range before opening the chart.
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="session-form-grid">
            <div className="form-field xl:col-span-2">
              <span>Instrument</span>
              <div className="themed-select" ref={instrumentPickerRef}>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-500"
                  size={16}
                />
                <input
                  aria-expanded={instrumentMenuOpen}
                  aria-label="Instrument"
                  className={`input-control h-11 pl-9 pr-10 normal-case tracking-normal ${
                    instrumentMenuOpen ? "border-cyan-300/50 ring-2 ring-cyan-300/15" : ""
                  }`}
                  disabled={instruments.length === 0}
                  onChange={(event) => handleInstrumentSearchChange(event.target.value)}
                  onFocus={() => setInstrumentMenuOpen(instruments.length > 0)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitInstrumentSearch();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setInstrumentMenuOpen(false);
                      setInstrumentSearch(selectedInstrumentLabel);
                    }
                  }}
                  placeholder={instruments.length === 0 ? "No datasets found" : "Search instrument"}
                  role="combobox"
                  value={instrumentSearch}
                />
                <button
                  aria-label="Open instruments"
                  className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-slate-500 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={instruments.length === 0}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setInstrumentMenuOpen((open) => !open)}
                  type="button"
                >
                  <ChevronDown
                    className={`transition ${instrumentMenuOpen ? "rotate-180 text-cyan-100" : ""}`}
                    size={16}
                  />
                </button>
                {instrumentMenuOpen && (
                  <div className="themed-select-menu w-full" role="listbox">
                    {visibleInstrumentOptions.length > 0 ? (
                      visibleInstrumentOptions.map((instrument) => {
                        const active = selectedInstrument?.id === instrument.id;
                        return (
                          <button
                            className={`themed-select-option ${active ? "themed-select-option-active" : ""}`}
                            key={instrument.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => chooseInstrument(instrument)}
                            role="option"
                            type="button"
                          >
                            <span className="session-instrument-badge">
                              {symbolBadge(instrument.symbol)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">
                                {formatMarketSymbol(instrument.symbol)}
                              </span>
                              <span className="block truncate text-xs text-slate-500">
                                {instrument.name || `${instrument.timeframes.length} timeframes`}
                              </span>
                            </span>
                            <span className="ml-auto shrink-0 text-xs text-slate-500">
                              {instrument.timeframes.length}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-3 py-4 text-sm font-semibold normal-case tracking-normal text-slate-500">
                        No matching instruments
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-400">
              <div className="flex items-center gap-3">
                {selectedInstrument ? (
                  <>
                    <span className="session-instrument-badge">
                      {symbolBadge(selectedInstrument.symbol)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-white">
                        {formatMarketSymbol(selectedInstrument.symbol)}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {selectedInstrument.timeframes.length} timeframes
                      </span>
                    </span>
                  </>
                ) : (
                  <span>No datasets found.</span>
                )}
              </div>
            </div>
          </div>

          {selectedInstrument && (
            <div className="dataset-timeframes">
              {selectedInstrument.timeframes.map((item) => (
                <button
                  className={`timeframe-button ${selectedTimeframe?.timeframe === item.timeframe ? "timeframe-button-active" : ""}`}
                  key={item.timeframe}
                  onClick={() => setTimeframe(item.timeframe)}
                  title={`${formatTimeframeRows(item)} · CSV direct`}
                  type="button"
                >
                  {item.timeframe}
                </button>
              ))}
            </div>
          )}

          <div className="session-form-grid">
            <div className="form-field">
              <span>Start Date</span>
              <ReplayDateTimePicker
                currentTimestamp={selectedTimeframe?.first_timestamp ?? null}
                dateFormat="dd MMM yy"
                dayOfWeekLabels
                dialogLabel="Start Date"
                disabled={!selectedTimeframe}
                onChange={setStartDate}
                placeholder="Select start date"
                timeHoursFormat="24-hour"
                value={startDate}
              />
            </div>
            <div className="form-field">
              <span>End Date</span>
              <ReplayDateTimePicker
                currentTimestamp={selectedTimeframe?.last_timestamp ?? null}
                dateFormat="dd MMM yy"
                dayOfWeekLabels
                dialogLabel="End Date"
                disabled={!selectedTimeframe}
                onChange={setEndDate}
                placeholder="Select end date"
                timeHoursFormat="24-hour"
                value={endDate}
              />
            </div>
            <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-400">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                <CalendarRange size={14} />
                Data Range
              </div>
              <div className="mt-2">
                {selectedTimeframe
                  ? `${formatDate(selectedTimeframe.first_timestamp)} to ${formatDate(selectedTimeframe.last_timestamp)}`
                  : "Select a dataset"}
              </div>
            </div>
          </div>
        </div>

        <div className="session-step">
          <div className="session-step-number">3</div>
          <div>
            <h2 className="text-base font-semibold text-white">Playbook Rules</h2>
            <p className="mt-1 text-sm text-slate-500">
              Optional, but useful when you want each trade judged against written conditions.
            </p>
          </div>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <ModeButton
              active={playbookMode === "none"}
              icon={CheckCircle2}
              label="No Playbook"
              onClick={() => setPlaybookMode("none")}
            />
            <ModeButton
              active={playbookMode === "existing"}
              disabled={playbooks.length === 0}
              icon={BookOpenCheck}
              label="Attach Existing"
              onClick={() => setPlaybookMode("existing")}
            />
            <ModeButton
              active={playbookMode === "new"}
              icon={FileText}
              label="Create Rules"
              onClick={() => setPlaybookMode("new")}
            />
          </div>

          {playbookMode === "existing" && (
            <div className="session-form-grid">
              <label className="form-field">
                <span>Playbook</span>
                <ThemedSelect
                  ariaLabel="Session playbook"
                  className="h-11"
                  onChange={setPlaybookId}
                  options={playbooks.map((playbook) => ({
                    label: playbook.name,
                    value: String(playbook.id),
                  }))}
                  value={playbookId}
                />
              </label>
              <div className="rounded-md border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-400 xl:col-span-2">
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                  Rules Preview
                </div>
                <p className="mt-2 whitespace-pre-wrap">
                  {selectedPlaybook?.rules || selectedPlaybook?.description || "This playbook does not have saved rules yet."}
                </p>
              </div>
            </div>
          )}

          {playbookMode === "new" && (
            <div className="grid gap-3">
              <label className="form-field">
                <span>Playbook Name</span>
                <input
                  className="input-control h-11"
                  onChange={(event) => setNewPlaybookName(event.target.value)}
                  placeholder={`${strategy || "Strategy"} rules`}
                  required={playbookMode === "new"}
                  value={newPlaybookName}
                />
              </label>
              <div className="grid gap-3 xl:grid-cols-3">
                <RuleBox label="Entry Conditions" onChange={setEntryRules} value={entryRules} />
                <RuleBox label="Exit Conditions" onChange={setExitRules} value={exitRules} />
                <RuleBox label="Risk Conditions" onChange={setRiskRules} value={riskRules} />
              </div>
              <label className="form-field">
                <span>Session Notes</span>
                <textarea
                  className="input-control min-h-20 py-3 normal-case tracking-normal"
                  onChange={(event) => setSessionNotes(event.target.value)}
                  placeholder="Market context, key levels, bias, or checklist notes"
                  value={sessionNotes}
                />
              </label>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Database size={15} />
            {datasets?.root ?? "Dataset catalog loading"}
          </div>
          <button
            className="control-button h-11 border-cyan-300/30 bg-cyan-300/10 px-5 text-cyan-100 hover:bg-cyan-300/20"
            disabled={!selectedTimeframe || isLoading || submitting || !strategy.trim()}
            type="submit"
          >
            {submitting || isLoading ? <RefreshCw size={16} className="animate-spin" /> : <PlayCircle size={16} />}
            Create Session
          </button>
        </div>
      </form>
      {editingSession && (
        <SessionEditDialog
          onClose={() => setEditingSession(null)}
          onSave={saveSessionDetails}
          playbooks={playbooks}
          session={editingSession}
        />
      )}
      {deletingSession && (
        <SessionDeleteDialog
          onClose={() => setDeletingSession(null)}
          onDelete={confirmDeleteSession}
          session={deletingSession}
        />
      )}
    </section>
  );
}

function ModeButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof CheckCircle2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`session-mode-button ${active ? "session-mode-button-active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function CostConfigCard({
  fixedValue,
  mode,
  onFixedValueChange,
  onModeChange,
  onPercentValueChange,
  percentValue,
  title,
}: {
  fixedValue: string;
  mode: OrderCommissionMode;
  onFixedValueChange: (value: string) => void;
  onModeChange: (value: OrderCommissionMode) => void;
  onPercentValueChange: (value: string) => void;
  percentValue: string;
  title: string;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {COST_MODE_OPTIONS.map((option) => (
          <button
            className={`segmented ${mode === option.value ? "segmented-active" : ""}`}
            key={option.value}
            onClick={() => onModeChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
      {mode !== "NONE" && (
        <label className="form-field mt-3">
          <span>{mode === "FIXED" ? "Fixed amount" : "Percent amount"}</span>
          <input
            className="input-control h-10"
            min="0"
            onChange={(event) =>
              mode === "FIXED"
                ? onFixedValueChange(event.target.value)
                : onPercentValueChange(event.target.value)
            }
            step={mode === "FIXED" ? "0.01" : "0.0001"}
            type="number"
            value={mode === "FIXED" ? fixedValue : percentValue}
          />
        </label>
      )}
    </section>
  );
}

function SessionActionButtons({
  onDelete,
  onEdit,
  session,
}: {
  onDelete: (session: BacktestSession) => void;
  onEdit: (session: BacktestSession) => void;
  session: BacktestSession;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        className="icon-button h-8 w-8"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(session);
        }}
        title="Edit session details"
        type="button"
      >
        <Pencil size={14} />
      </button>
      <button
        className="icon-button h-8 w-8 border-rose-300/20 text-rose-200 hover:bg-rose-300/10 hover:text-rose-100"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(session);
        }}
        title="Delete session"
        type="button"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function SessionEditDialog({
  onClose,
  onSave,
  playbooks,
  session,
}: {
  onClose: () => void;
  onSave: (sessionId: number, payload: BacktestSessionUpdatePayload) => Promise<void> | void;
  playbooks: Playbook[];
  session: BacktestSession;
}) {
  const [name, setName] = useState(session.name);
  const [strategyName, setStrategyName] = useState(session.strategy_name ?? "");
  const [playbookId, setPlaybookId] = useState(session.playbook_id == null ? "" : String(session.playbook_id));
  const [initialBalance, setInitialBalance] = useState(String(session.initial_balance ?? 100000));
  const [currency, setCurrency] = useState(session.currency ?? "USD");
  const [timezone, setTimezone] = useState(session.timezone ?? "UTC");
  const [pnlMultiplier, setPnlMultiplier] = useState(String(session.pnl_multiplier ?? 1));
  const [commissionMode, setCommissionMode] = useState<OrderCommissionMode>(
    session.default_commission_mode ?? "NONE",
  );
  const [fixedCommission, setFixedCommission] = useState(() =>
    session.default_commission_mode === "FIXED" ? formatCostValue(session.default_commission_value) : "0",
  );
  const [percentCommission, setPercentCommission] = useState(() =>
    session.default_commission_mode === "PERCENT" ? formatCostValue(session.default_commission_value) : "0",
  );
  const [feeMode, setFeeMode] = useState<OrderCommissionMode>(session.default_fee_mode ?? "NONE");
  const [fixedFee, setFixedFee] = useState(() =>
    session.default_fee_mode === "FIXED" ? formatCostValue(session.default_fee_value) : "0",
  );
  const [percentFee, setPercentFee] = useState(() =>
    session.default_fee_mode === "PERCENT" ? formatCostValue(session.default_fee_value) : "0",
  );
  const [status, setStatus] = useState<BacktestSession["status"]>(session.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(session.name);
    setStrategyName(session.strategy_name ?? "");
    setPlaybookId(session.playbook_id == null ? "" : String(session.playbook_id));
    setInitialBalance(String(session.initial_balance ?? 100000));
    setCurrency(session.currency ?? "USD");
    setTimezone(session.timezone ?? "UTC");
    setPnlMultiplier(String(session.pnl_multiplier ?? 1));
    setCommissionMode(session.default_commission_mode ?? "NONE");
    setFixedCommission(
      session.default_commission_mode === "FIXED" ? formatCostValue(session.default_commission_value) : "0",
    );
    setPercentCommission(
      session.default_commission_mode === "PERCENT" ? formatCostValue(session.default_commission_value) : "0",
    );
    setFeeMode(session.default_fee_mode ?? "NONE");
    setFixedFee(session.default_fee_mode === "FIXED" ? formatCostValue(session.default_fee_value) : "0");
    setPercentFee(session.default_fee_mode === "PERCENT" ? formatCostValue(session.default_fee_value) : "0");
    setStatus(session.status);
    setError(null);
  }, [session]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const balanceValue = Number(initialBalance);
    const multiplierValue = Number(pnlMultiplier);
    if (!trimmedName) {
      setError("Session name is required");
      return;
    }
    if (!Number.isFinite(balanceValue) || balanceValue <= 0) {
      setError("Starting balance must be greater than 0");
      return;
    }
    if (!Number.isFinite(multiplierValue) || multiplierValue <= 0) {
      setError("P&L calibration must be greater than 0");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(session.id, {
        name: trimmedName,
        strategy_name: strategyName.trim() || null,
        playbook_id: playbookId ? Number(playbookId) : null,
        initial_balance: balanceValue,
        currency: currency.trim() || null,
        timezone: timezone.trim() || null,
        pnl_multiplier: multiplierValue,
        status,
        default_commission_mode: commissionMode,
        default_commission_value: costValueForPayload(commissionMode, fixedCommission, percentCommission),
        default_fee_mode: feeMode,
        default_fee_value: costValueForPayload(feeMode, fixedFee, percentFee),
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save session");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[260] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <form
        autoComplete="off"
        className="grid w-[min(760px,100%)] max-h-[calc(100vh-48px)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-md border border-cyan-300/15 bg-[#071018] shadow-panel"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
              Session Details
            </div>
            <h3 className="mt-1 truncate text-base font-semibold text-white">
              Edit {session.name}
            </h3>
          </div>
          <button className="icon-button h-9 w-9" onClick={onClose} type="button">
            <X size={15} />
          </button>
        </div>

        <div className="grid min-h-0 gap-4 overflow-auto p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <ReadOnlyPill label="Market" value={`${formatMarketSymbol(session.symbol)} · ${session.timeframe ?? "M1"}`} />
            <ReadOnlyPill label="Instrument" value={session.instrument ?? "Default"} />
            <ReadOnlyPill label="Dataset" value={session.csv_path ?? "Dataset catalog"} />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="form-field">
              <span>Session Name</span>
              <input
                className="input-control h-10 normal-case tracking-normal"
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label className="form-field">
              <span>Strategy Name</span>
              <input
                autoComplete="off"
                className="input-control h-10 normal-case tracking-normal"
                onChange={(event) => setStrategyName(event.target.value)}
                placeholder="No strategy"
                value={strategyName}
              />
            </label>
            <label className="form-field">
              <span>Playbook</span>
              <ThemedSelect
                className="h-10"
                onChange={setPlaybookId}
                options={[
                  { label: "No playbook", value: "" },
                  ...playbooks.map((playbook) => ({
                    label: playbook.name,
                    value: String(playbook.id),
                  })),
                ]}
                portal
                value={playbookId}
              />
            </label>
            <label className="form-field">
              <span>Status</span>
              <ThemedSelect
                className="h-10"
                onChange={(value) => setStatus(value as BacktestSession["status"])}
                options={[
                  { label: "Active", value: "ACTIVE" },
                  { label: "Complete", value: "COMPLETE" },
                ]}
                portal
                value={status}
              />
            </label>
            <label className="form-field">
              <span>Starting Balance</span>
              <input
                className="input-control h-10"
                min="0.01"
                onChange={(event) => setInitialBalance(event.target.value)}
                step="0.01"
                type="number"
                value={initialBalance}
              />
            </label>
            <label className="form-field">
              <span>P&L Calibration</span>
              <input
                className="input-control h-10"
                min="0.000001"
                onChange={(event) => setPnlMultiplier(event.target.value)}
                step="0.000001"
                type="number"
                value={pnlMultiplier}
              />
            </label>
            <label className="form-field">
              <span>Currency</span>
              <ThemedSelect
                className="h-10"
                onChange={setCurrency}
                options={selectOptionsWithValue(CURRENCY_OPTIONS, currency)}
                portal
                value={currency}
              />
            </label>
            <label className="form-field">
              <span>Timestamp Timezone</span>
              <ThemedSelect
                className="h-10"
                menuClassName="max-w-[360px]"
                onChange={setTimezone}
                options={selectOptionsWithValue(TIMEZONE_OPTIONS, timezone, timezoneOption)}
                portal
                value={timezone}
              />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <CostConfigCard
              fixedValue={fixedCommission}
              mode={commissionMode}
              onFixedValueChange={setFixedCommission}
              onModeChange={setCommissionMode}
              onPercentValueChange={setPercentCommission}
              percentValue={percentCommission}
              title="Default Commissions"
            />
            <CostConfigCard
              fixedValue={fixedFee}
              mode={feeMode}
              onFixedValueChange={setFixedFee}
              onModeChange={setFeeMode}
              onPercentValueChange={setPercentFee}
              percentValue={percentFee}
              title="Default Fees"
            />
          </div>
          {error && (
            <div className="rounded-md border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-sm font-semibold text-rose-100">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-4 py-3">
          <button className="control-button h-9" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="control-button h-9 border-cyan-300/30 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20"
            disabled={saving}
            type="submit"
          >
            {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function SessionDeleteDialog({
  onClose,
  onDelete,
  session,
}: {
  onClose: () => void;
  onDelete: (sessionId: number) => Promise<void> | void;
  session: BacktestSession;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await onDelete(session.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not delete session");
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[260] grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        className="w-[min(460px,100%)] rounded-md border border-rose-300/20 bg-[#071018] p-4 shadow-panel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-200">
              Delete Session
            </div>
            <h3 className="mt-2 text-lg font-semibold text-white">
              {session.name}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              This removes the session and its linked replay orders, executions, trades, and results.
            </p>
          </div>
          <button className="icon-button h-9 w-9" onClick={onClose} type="button">
            <X size={15} />
          </button>
        </div>
        {error && (
          <div className="mt-4 rounded-md border border-rose-300/25 bg-rose-300/10 px-3 py-2 text-sm font-semibold text-rose-100">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button className="control-button h-9" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="control-button h-9 border-rose-300/30 bg-rose-300/10 text-rose-100 hover:bg-rose-300/20"
            disabled={deleting}
            onClick={() => void handleDelete()}
            type="button"
          >
            {deleting ? <RefreshCw size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadOnlyPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-200" title={value}>
        {value}
      </div>
    </div>
  );
}

type GatewayAggregate = {
  averageR: number | null;
  closedTrades: number;
  grossLoss: number;
  grossProfit: number;
  netPnl: number;
  profitFactor: number | null;
  rSamples: number;
  rSum: number;
  winRate: number;
  wins: number;
};

type GatewaySessionResult = {
  aggregate: GatewayAggregate;
  session: BacktestSession;
};

type GatewayStrategyGroup = {
  aggregate: GatewayAggregate;
  name: string;
  sessions: GatewaySessionResult[];
};

function buildDefaultSessionName(
  strategy: string,
  instrument: DatasetInstrument | undefined,
  timeframe: DatasetTimeframe | undefined,
) {
  const strategyName = strategy.trim() || "Strategy";
  if (!instrument || !timeframe) {
    return strategyName;
  }
  return `${strategyName} / ${instrument.symbol} ${timeframe.timeframe}`;
}

function buildInstrumentOptionLabel(instrument: DatasetInstrument) {
  const symbol = formatMarketSymbol(instrument.symbol);
  const name = instrument.name.trim();
  if (!name || sameInstrumentSearchText(name, symbol) || sameInstrumentSearchText(name, instrument.symbol)) {
    return symbol;
  }
  return `${symbol} - ${name}`;
}

function findExactInstrumentMatch(instruments: DatasetInstrument[], value: string) {
  const search = normalizeInstrumentSearch(value);
  if (!search) {
    return null;
  }
  return (
    instruments.find((instrument) =>
      instrumentSearchAliases(instrument).some(
        (alias) => normalizeInstrumentSearch(alias) === search,
      ),
    ) ?? null
  );
}

function findInstrumentSearchMatch(instruments: DatasetInstrument[], value: string) {
  const exactMatch = findExactInstrumentMatch(instruments, value);
  if (exactMatch) {
    return exactMatch;
  }

  const search = normalizeInstrumentSearch(value);
  if (!search) {
    return null;
  }
  return (
    instruments.find((instrument) =>
      instrumentSearchAliases(instrument).some((alias) =>
        normalizeInstrumentSearch(alias).includes(search),
      ),
    ) ?? null
  );
}

function filterInstrumentOptions(
  instruments: DatasetInstrument[],
  value: string,
  selectedLabel: string,
) {
  const search = normalizeInstrumentSearch(value);
  if (!search || search === normalizeInstrumentSearch(selectedLabel)) {
    return instruments;
  }

  const startsWithMatches: DatasetInstrument[] = [];
  const containsMatches: DatasetInstrument[] = [];
  for (const instrument of instruments) {
    const aliases = instrumentSearchAliases(instrument).map(normalizeInstrumentSearch);
    if (aliases.some((alias) => alias.startsWith(search))) {
      startsWithMatches.push(instrument);
      continue;
    }
    if (aliases.some((alias) => alias.includes(search))) {
      containsMatches.push(instrument);
    }
  }
  return [...startsWithMatches, ...containsMatches];
}

function instrumentSearchAliases(instrument: DatasetInstrument) {
  return [
    instrument.id,
    instrument.name,
    instrument.symbol,
    formatMarketSymbol(instrument.symbol),
    buildInstrumentOptionLabel(instrument),
  ];
}

function sameInstrumentSearchText(left: string, right: string) {
  return normalizeInstrumentSearch(left) === normalizeInstrumentSearch(right);
}

function normalizeInstrumentSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildExistingStrategyOptions(
  strategyGroups: GatewayStrategyGroup[],
  savedStrategyNames: string[],
  playbooks: Playbook[],
) {
  const options: Array<{ label: string; sublabel?: string; value: string }> = [];

  function push(name: string, sublabel?: string) {
    const trimmedName = name.trim();
    if (
      !trimmedName ||
      sameStrategyName(trimmedName, "Unassigned") ||
      options.some((option) => sameStrategyName(option.value, trimmedName))
    ) {
      return;
    }
    options.push({ label: trimmedName, sublabel, value: trimmedName });
  }

  for (const group of strategyGroups) {
    const sessionLabel = `${group.sessions.length} session${group.sessions.length === 1 ? "" : "s"}`;
    const tradeLabel = `${group.aggregate.closedTrades} closed trade${group.aggregate.closedTrades === 1 ? "" : "s"}`;
    push(group.name, `${sessionLabel} / ${tradeLabel}`);
  }
  for (const name of savedStrategyNames) {
    push(name, "Saved strategy");
  }
  for (const playbook of playbooks) {
    push(playbook.name, "Playbook");
  }

  return options.sort((left, right) => left.value.localeCompare(right.value));
}

function linkedPlaybookIdForStrategy(
  strategyName: string,
  group: GatewayStrategyGroup | null,
  playbooks: Playbook[],
) {
  if (group) {
    const linkedPlaybookId = latestLinkedPlaybookId(group, playbooks);
    if (linkedPlaybookId != null) {
      return linkedPlaybookId;
    }
  }

  const matchingPlaybook = playbooks.find((playbook) => sameStrategyName(playbook.name, strategyName));
  return matchingPlaybook?.id ?? null;
}

function latestLinkedPlaybookId(group: GatewayStrategyGroup, playbooks: Playbook[]) {
  const playbookIds = new Set(playbooks.map((playbook) => playbook.id));
  for (const row of group.sessions) {
    if (row.session.playbook_id != null && playbookIds.has(row.session.playbook_id)) {
      return row.session.playbook_id;
    }
  }
  const matchingPlaybook = playbooks.find(
    (playbook) => playbook.name.trim().toLowerCase() === group.name.trim().toLowerCase(),
  );
  return matchingPlaybook?.id ?? null;
}

function buildStrategyGroups(
  sessions: BacktestSession[],
  trades: Trade[],
): GatewayStrategyGroup[] {
  const sessionById = new Map(sessions.map((item) => [item.id, item]));
  const tradesBySessionStrategy = new Map<string, Trade[]>();
  const sessionStrategyKeys = new Set<string>();

  for (const session of sessions) {
    const strategyName = sessionStrategyName(session);
    sessionStrategyKeys.add(sessionStrategyKey(session.id, strategyName));
  }

  for (const trade of trades) {
    const session = sessionById.get(trade.session_id);
    if (!session) {
      continue;
    }
    const strategyName = sessionStrategyName(session);
    const key = sessionStrategyKey(session.id, strategyName);
    sessionStrategyKeys.add(key);
    tradesBySessionStrategy.set(key, [
      ...(tradesBySessionStrategy.get(key) ?? []),
      trade,
    ]);
  }

  const groups = new Map<string, GatewaySessionResult[]>();
  for (const key of sessionStrategyKeys) {
    const [sessionIdPart, strategyName] = splitSessionStrategyKey(key);
    const session = sessionById.get(Number(sessionIdPart));
    if (!session) {
      continue;
    }
    groups.set(strategyName, [
      ...(groups.get(strategyName) ?? []),
      {
        aggregate: aggregateGatewayTrades(tradesBySessionStrategy.get(key) ?? []),
        session,
      },
    ]);
  }

  return Array.from(groups.entries())
    .map(([name, strategySessions]) => {
      return {
        aggregate: combineGatewayAggregates(
          strategySessions.map((row) => row.aggregate),
        ),
        name,
        sessions: strategySessions.sort((a, b) => b.session.id - a.session.id),
      };
    })
    .sort((a, b) => {
      if (b.aggregate.closedTrades !== a.aggregate.closedTrades) {
        return b.aggregate.closedTrades - a.aggregate.closedTrades;
      }
      return a.name.localeCompare(b.name);
    });
}

function buildStrategyGroupsFromSummaries(strategySummaries: StrategySummary[]): GatewayStrategyGroup[] {
  return strategySummaries.map((summary) => ({
    aggregate: gatewayAggregateFromSummary(summary.aggregate),
    name: summary.name,
    sessions: summary.sessions.map((row) => ({
      aggregate: gatewayAggregateFromSummary(row.aggregate),
      session: row.session,
    })),
  }));
}

function gatewayAggregateFromSummary(aggregate: StrategySummaryAggregate): GatewayAggregate {
  return {
    averageR: aggregate.average_r,
    closedTrades: aggregate.closed_trades,
    grossLoss: aggregate.gross_loss,
    grossProfit: aggregate.gross_profit,
    netPnl: aggregate.net_pnl,
    profitFactor: aggregate.profit_factor,
    rSamples: aggregate.r_samples,
    rSum: aggregate.r_sum,
    winRate: aggregate.win_rate,
    wins: aggregate.winning_trades,
  };
}

function combineGatewayAggregates(aggregates: GatewayAggregate[]): GatewayAggregate {
  const closedTrades = aggregates.reduce((sum, aggregate) => sum + aggregate.closedTrades, 0);
  const wins = aggregates.reduce((sum, aggregate) => sum + aggregate.wins, 0);
  const grossProfit = aggregates.reduce((sum, aggregate) => sum + aggregate.grossProfit, 0);
  const grossLoss = aggregates.reduce((sum, aggregate) => sum + aggregate.grossLoss, 0);
  const rSum = aggregates.reduce((sum, aggregate) => sum + aggregate.rSum, 0);
  const rSamples = aggregates.reduce((sum, aggregate) => sum + aggregate.rSamples, 0);

  return {
    averageR: rSamples > 0 ? rSum / rSamples : null,
    closedTrades,
    grossLoss,
    grossProfit,
    netPnl: aggregates.reduce((sum, aggregate) => sum + aggregate.netPnl, 0),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    rSamples,
    rSum,
    winRate: closedTrades > 0 ? wins / closedTrades : 0,
    wins,
  };
}

function aggregateGatewayTrades(trades: Trade[]): GatewayAggregate {
  const closedTrades = trades.filter((trade) => trade.status === "CLOSED");
  const netPnl = closedTrades.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const wins = closedTrades.filter((trade) => (trade.realized_pnl ?? 0) > 0);
  const grossWins = wins.reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0);
  const grossLosses = Math.abs(
    closedTrades
      .filter((trade) => (trade.realized_pnl ?? 0) < 0)
      .reduce((sum, trade) => sum + (trade.realized_pnl ?? 0), 0),
  );
  const rValues = closedTrades
    .map((trade) => trade.r_multiple)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    averageR:
      rValues.length > 0
        ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length
        : null,
    closedTrades: closedTrades.length,
    grossLoss: grossLosses,
    grossProfit: grossWins,
    netPnl,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null,
    rSamples: rValues.length,
    rSum: rValues.reduce((sum, value) => sum + value, 0),
    winRate: closedTrades.length > 0 ? wins.length / closedTrades.length : 0,
    wins: wins.length,
  };
}

function GatewayMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-[#080c11] px-2 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-slate-100">
        {value}
      </div>
    </div>
  );
}

function StrategyDetails({
  activeSessionId,
  datasets,
  group,
  onDeleteSession,
  onEditSession,
  onResumeSession,
}: {
  activeSessionId: number | null;
  datasets: DatasetCatalog | null;
  group: GatewayStrategyGroup;
  onDeleteSession: (session: BacktestSession) => void;
  onEditSession: (session: BacktestSession) => void;
  onResumeSession: (sessionId?: number) => Promise<void> | void;
}) {
  const [selectedSessionIds, setSelectedSessionIds] = useState<number[]>([]);

  useEffect(() => {
    setSelectedSessionIds([]);
  }, [group.name]);

  const selectedSessionSet = useMemo(
    () => new Set(selectedSessionIds),
    [selectedSessionIds],
  );
  const filteredRows = useMemo(
    () =>
      selectedSessionIds.length === 0
        ? group.sessions
        : group.sessions.filter((row) => selectedSessionSet.has(row.session.id)),
    [group.sessions, selectedSessionIds.length, selectedSessionSet],
  );
  const filteredAggregate = useMemo(
    () => combineGatewayAggregates(filteredRows.map((row) => row.aggregate)),
    [filteredRows],
  );
  const filteredCurrency = currencyForSessions(
    filteredRows.map((row) => row.session),
    datasets,
  );
  const allSessionsSelected = selectedSessionIds.length === 0;

  function toggleSession(sessionId: number) {
    setSelectedSessionIds((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId],
    );
  }

  return (
    <section className="mt-4 rounded-md border border-cyan-300/20 bg-[#071018] p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">
            Strategy Metrics
          </div>
          <h3 className="mt-2 truncate text-xl font-semibold text-white">
            {group.name}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Aggregated across {group.sessions.length} sessions on the main page.
          </p>
        </div>
        <div className={`text-xl font-semibold ${toneForNumber(filteredAggregate.netPnl)}`}>
          {formatMoney(filteredAggregate.netPnl, filteredCurrency)}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <GatewayMetric label="Sessions" value={`${filteredRows.length}/${group.sessions.length}`} />
        <GatewayMetric label="Closed" value={String(filteredAggregate.closedTrades)} />
        <GatewayMetric label="Win" value={formatPercent(filteredAggregate.winRate)} />
        <GatewayMetric label="PF" value={formatRatio(filteredAggregate.profitFactor)} />
        <GatewayMetric label="Avg R" value={formatOptionalNumber(filteredAggregate.averageR)} />
      </div>

      {group.sessions.length > 1 && (
        <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-2">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Filter Sessions
            </div>
            <button
              className={`h-7 rounded px-2 text-xs font-semibold transition ${
                allSessionsSelected
                  ? "bg-white text-ink-950"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
              onClick={() => setSelectedSessionIds([])}
              type="button"
            >
              All
            </button>
          </div>
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-auto">
            {group.sessions.map((row) => {
              const active =
                allSessionsSelected || selectedSessionSet.has(row.session.id);
              return (
                <button
                  className={`min-w-0 rounded px-2 py-1 text-left text-xs font-semibold transition ${
                    active
                      ? "bg-cyan-300/15 text-cyan-100"
                      : "bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-200"
                  }`}
                  key={row.session.id}
                  onClick={() => toggleSession(row.session.id)}
                  title={row.session.name}
                  type="button"
                >
                  <span className="block max-w-44 truncate">{row.session.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 overflow-auto rounded-md border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-black/25 text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Session</th>
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 font-medium">Closed</th>
              <th className="px-3 py-2 font-medium">Net PnL</th>
              <th className="px-3 py-2 font-medium">Win</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr
                className={`border-t border-white/10 ${
                  row.session.id === activeSessionId ? "bg-cyan-300/10" : ""
                }`}
                key={row.session.id}
              >
                <td className="px-3 py-3">
                  <div className="font-semibold text-slate-100">{row.session.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.session.status}</div>
                </td>
                <td className="px-3 py-3 text-slate-300">
                  {formatMarketSymbol(row.session.symbol)} · {row.session.timeframe ?? "M1"}
                </td>
                <td className="px-3 py-3 tabular-nums text-slate-300">
                  {row.aggregate.closedTrades}
                </td>
                <td className={`px-3 py-3 font-semibold ${toneForNumber(row.aggregate.netPnl)}`}>
                  {formatMoney(row.aggregate.netPnl, currencyForSession(row.session, datasets))}
                </td>
                <td className="px-3 py-3 tabular-nums text-slate-300">
                  {formatPercent(row.aggregate.winRate)}
                </td>
                <td className="px-3 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <SessionActionButtons
                      onDelete={onDeleteSession}
                      onEdit={onEditSession}
                      session={row.session}
                    />
                    <button
                      className="control-button h-9"
                      onClick={() => onResumeSession(row.session.id)}
                      type="button"
                    >
                      Open
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function sessionStrategyKey(sessionId: number, strategyName: string) {
  return `${sessionId}\u0000${strategyName}`;
}

function splitSessionStrategyKey(key: string) {
  return key.split("\u0000") as [string, string];
}

function selectOptionsWithValue(
  options: Array<{ label: string; sublabel?: string; value: string }>,
  value: string,
  makeMissingOption: (value: string) => { label: string; sublabel?: string; value: string } = (
    nextValue,
  ) => ({ label: nextValue, value: nextValue }),
) {
  if (!value || options.some((option) => option.value === value)) {
    return options;
  }
  return [makeMissingOption(value), ...options];
}

function costValueForPayload(mode: OrderCommissionMode, fixedValue: string, percentValue: string) {
  if (mode === "FIXED") {
    return numberOrZero(fixedValue);
  }
  if (mode === "PERCENT") {
    return numberOrZero(percentValue);
  }
  return 0;
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatCostValue(value: number | null | undefined) {
  return String(Number.isFinite(value) ? value : 0);
}

function timezoneOption(timezone: string) {
  return {
    label: `${formatTimezoneOffset(timezone)} · ${formatTimezoneDisplayName(timezone)}`,
    sublabel: timezone,
    value: timezone,
  };
}

function formatTimezoneOffset(timezone: string, date = new Date()) {
  const offsetMinutes = timezoneOffsetMinutes(timezone, date);
  if (offsetMinutes == null) {
    return "UTC";
  }
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatTimezoneDisplayName(timezone: string) {
  const parts = timezone.split("/");
  return (parts.at(-1) ?? timezone).replace(/_/g, " ");
}

function timezoneOffsetMinutes(timezone: string, date: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(date);
    const valueByType = new Map(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(valueByType.get("year")),
      Number(valueByType.get("month")) - 1,
      Number(valueByType.get("day")),
      Number(valueByType.get("hour")),
      Number(valueByType.get("minute")),
      Number(valueByType.get("second")),
    );
    if (!Number.isFinite(asUtc)) {
      return null;
    }
    return Math.round((asUtc - date.getTime()) / 60000);
  } catch {
    return null;
  }
}

function formatRatio(value: number | null | undefined) {
  if (value == null) {
    return "-";
  }
  if (!Number.isFinite(value)) {
    return "∞";
  }
  return value.toFixed(2);
}

function formatOptionalNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(2);
}

function toneForNumber(value: number | null | undefined) {
  if (value == null || value === 0) {
    return "text-slate-100";
  }
  return value > 0 ? "text-emerald-300" : "text-rose-300";
}

function RuleBox({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <textarea
        className="input-control min-h-28 py-3 normal-case tracking-normal"
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Write ${label.toLowerCase()}`}
        value={value}
      />
    </label>
  );
}

function buildPlaybookRules(entry: string, exit: string, risk: string) {
  return [
    "Entry Conditions",
    entry.trim() || "- Not specified",
    "",
    "Exit Conditions",
    exit.trim() || "- Not specified",
    "",
    "Risk Conditions",
    risk.trim() || "- Not specified",
  ].join("\n");
}

function toLocalInputValue(value: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultReplayStartValue(timeframe: DatasetTimeframe) {
  if (!timeframe.first_timestamp) {
    return "";
  }

  const firstDate = new Date(timeframe.first_timestamp);
  if (Number.isNaN(firstDate.getTime())) {
    return "";
  }

  const contextBars = Math.min(300, Math.max(timeframe.rows - 1, 0));
  const contextMs = contextBars * timeframeSeconds(timeframe.timeframe) * 1000;
  return toLocalInputValue(new Date(firstDate.getTime() + contextMs).toISOString());
}

function formatTimeframeRows(timeframe: DatasetTimeframe) {
  return timeframe.rows > 0 ? `${timeframe.rows.toLocaleString()} bars` : "Rows counted on refresh";
}

function timeframeSeconds(timeframe: string) {
  switch (timeframe) {
    case "M1":
      return 60;
    case "M5":
      return 300;
    case "M15":
      return 900;
    case "M30":
      return 1800;
    case "H1":
      return 3600;
    case "H4":
      return 14400;
    case "Daily":
      return 86400;
    default:
      return 300;
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }
  return new Date(value).toLocaleDateString();
}
