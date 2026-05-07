import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CalendarRange,
  CheckCircle2,
  Database,
  FileText,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Target,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  BacktestCreatePayload,
  BacktestSession,
  DatasetCatalog,
  DatasetInstrument,
  DatasetTimeframe,
  Playbook,
  PlaybookPayload,
  Trade,
} from "../lib/api";
import { formatMoney, formatPercent } from "../lib/format";
import { formatMarketSymbol, symbolBadge } from "../lib/symbols";
import { sessionStrategyName } from "../lib/strategy";
import { ThemedSelect } from "./ThemedSelect";

type Props = {
  datasets: DatasetCatalog | null;
  isLoading: boolean;
  onCreateSession: (payload: BacktestCreatePayload) => Promise<void>;
  onCreatePlaybook: (payload: PlaybookPayload) => Promise<Playbook>;
  onResumeSession: (sessionId?: number) => Promise<void> | void;
  playbooks: Playbook[];
  session: BacktestSession | null;
  sessions: BacktestSession[];
  trades: Trade[];
};

type PlaybookMode = "none" | "existing" | "new";

export function SessionGateway({
  datasets,
  isLoading,
  onCreateSession,
  onCreatePlaybook,
  onResumeSession,
  playbooks,
  session,
  sessions,
  trades,
}: Props) {
  const instruments = datasets?.instruments ?? [];
  const [instrumentId, setInstrumentId] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [strategy, setStrategy] = useState(session?.strategy_name ?? "London Continuation");
  const [playbookMode, setPlaybookMode] = useState<PlaybookMode>(playbooks.length > 0 ? "existing" : "none");
  const [playbookId, setPlaybookId] = useState("");
  const [newPlaybookName, setNewPlaybookName] = useState("");
  const [entryRules, setEntryRules] = useState("");
  const [exitRules, setExitRules] = useState("");
  const [riskRules, setRiskRules] = useState("Risk 1% or less until the setup is validated.");
  const [sessionNotes, setSessionNotes] = useState("");
  const [startingBalance, setStartingBalance] = useState("100000");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedStrategyName, setSelectedStrategyName] = useState<string | null>(null);

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
    () => buildStrategyGroups(sessions, trades),
    [sessions, trades],
  );
  const selectedStrategyGroup = useMemo(
    () =>
      strategyGroups.find((group) => group.name === selectedStrategyName) ??
      strategyGroups[0] ??
      null,
    [selectedStrategyName, strategyGroups],
  );

  useEffect(() => {
    if (selectedInstrument && !instrumentId) {
      setInstrumentId(selectedInstrument.id);
    }
  }, [instrumentId, selectedInstrument]);

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
    if (playbooks.length > 0 && !playbookId) {
      setPlaybookId(String(playbooks[0].id));
      if (playbookMode === "none") {
        setPlaybookMode("existing");
      }
    }
  }, [playbookId, playbookMode, playbooks]);

  useEffect(() => {
    if (!strategyGroups[0]) {
      if (selectedStrategyName) {
        setSelectedStrategyName(null);
      }
      return;
    }
    if (
      !selectedStrategyName ||
      !strategyGroups.some((group) => group.name === selectedStrategyName)
    ) {
      setSelectedStrategyName(strategyGroups[0].name);
    }
  }, [selectedStrategyName, strategyGroups]);

  function selectInstrument(instrument: DatasetInstrument) {
    setInstrumentId(instrument.id);
    setTimeframe(instrument.timeframes[0]?.timeframe ?? "");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedInstrument || !selectedTimeframe || !strategy.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      let attachedPlaybookId =
        playbookMode === "existing" && playbookId ? Number(playbookId) : null;

      if (playbookMode === "new" && newPlaybookName.trim()) {
        const playbook = await onCreatePlaybook({
          name: newPlaybookName.trim(),
          description: sessionNotes.trim() || `Rules for ${strategy.trim()}`,
          rules: buildPlaybookRules(entryRules, exitRules, riskRules),
        });
        attachedPlaybookId = playbook.id;
      }

      await onCreateSession({
        name: `${strategy.trim()} / ${selectedInstrument.symbol} ${selectedTimeframe.timeframe}`,
        symbol: selectedInstrument.symbol,
        instrument: selectedInstrument.id,
        timeframe: selectedTimeframe.timeframe,
        csv_path: selectedTimeframe.csv_path,
        currency: selectedInstrument.currency,
        timezone: selectedInstrument.timezone,
        strategy_name: strategy.trim(),
        playbook_id: attachedPlaybookId,
        start_timestamp: startDate ? new Date(startDate).toISOString() : null,
        end_timestamp: endDate ? new Date(endDate).toISOString() : null,
        initial_balance: Number(startingBalance) || 100000,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="session-gateway">
      <div className="session-gateway-hero">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">
            <Target size={14} />
            Backtesting Session
          </div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-white xl:text-5xl">
            Choose the session before the chart.
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
                setSelectedStrategyName(group.name);
                setStrategy(group.name);
              }}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    className="block max-w-full truncate text-left text-base font-semibold text-white transition hover:text-cyan-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedStrategyName(group.name);
                      setStrategy(group.name);
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
                  {formatMoney(group.aggregate.netPnl)}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <GatewayMetric label="Win" value={formatPercent(group.aggregate.winRate)} />
                <GatewayMetric label="PF" value={formatRatio(group.aggregate.profitFactor)} />
                <GatewayMetric label="Avg R" value={formatOptionalNumber(group.aggregate.averageR)} />
              </div>

              <div className="mt-3 grid gap-2">
                {group.sessions.map((row) => (
                  <button
                    className={`grid min-w-0 gap-3 rounded-md border px-3 py-2 text-left transition sm:grid-cols-[minmax(0,1fr)_auto] ${
                      row.session.id === session?.id
                        ? "border-cyan-300/35 bg-cyan-300/10"
                        : "border-white/10 bg-[#080c11] hover:border-cyan-300/25 hover:bg-cyan-300/5"
                    }`}
                    key={`${group.name}:${row.session.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onResumeSession(row.session.id);
                    }}
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
                          {formatMoney(row.aggregate.netPnl)}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {row.aggregate.closedTrades} trades · {formatPercent(row.aggregate.winRate)}
                        </span>
                      </span>
                      <ArrowRight size={15} className="text-slate-500" />
                    </span>
                  </button>
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

        {selectedStrategyGroup && (
          <StrategyDetails
            activeSessionId={session?.id ?? null}
            group={selectedStrategyGroup}
            onResumeSession={onResumeSession}
          />
        )}
      </section>

      <form className="session-builder" onSubmit={(event) => void handleSubmit(event)}>
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
          <label className="form-field xl:col-span-2">
            <span>Strategy Name</span>
            <input
              className="input-control h-11"
              list="gateway-strategies"
              onChange={(event) => setStrategy(event.target.value)}
              required
              value={strategy}
            />
            <datalist id="gateway-strategies">
              {strategyGroups.map((group) => (
                <option key={group.name} value={group.name} />
              ))}
            </datalist>
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
          <div className="session-instrument-grid">
            {instruments.map((instrument) => (
              <button
                className={`session-instrument-card ${selectedInstrument?.id === instrument.id ? "session-instrument-card-active" : ""}`}
                key={instrument.id}
                onClick={() => selectInstrument(instrument)}
                type="button"
              >
                <span className="session-instrument-badge">{symbolBadge(instrument.symbol)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">
                    {formatMarketSymbol(instrument.symbol)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {instrument.timeframes.length} timeframes
                  </span>
                </span>
              </button>
            ))}
            {instruments.length === 0 && (
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-4 text-sm text-slate-500">
                No datasets found.
              </div>
            )}
          </div>

          {selectedInstrument && (
            <div className="dataset-timeframes">
              {selectedInstrument.timeframes.map((item) => (
                <button
                  className={`timeframe-button ${selectedTimeframe?.timeframe === item.timeframe ? "timeframe-button-active" : ""}`}
                  key={item.timeframe}
                  onClick={() => setTimeframe(item.timeframe)}
                  title={`${item.rows.toLocaleString()} bars`}
                  type="button"
                >
                  {item.timeframe}
                </button>
              ))}
            </div>
          )}

          <div className="session-form-grid">
            <label className="form-field">
              <span>Start Date</span>
              <input
                className="input-control h-11"
                onChange={(event) => setStartDate(event.target.value)}
                type="datetime-local"
                value={startDate}
              />
            </label>
            <label className="form-field">
              <span>End Date</span>
              <input
                className="input-control h-11"
                onChange={(event) => setEndDate(event.target.value)}
                type="datetime-local"
                value={endDate}
              />
            </label>
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

type GatewayAggregate = {
  averageR: number | null;
  closedTrades: number;
  netPnl: number;
  profitFactor: number | null;
  winRate: number;
};

type GatewaySessionResult = {
  aggregate: GatewayAggregate;
  session: BacktestSession;
  trades: Trade[];
};

type GatewayStrategyGroup = {
  aggregate: GatewayAggregate;
  name: string;
  sessions: GatewaySessionResult[];
  trades: Trade[];
};

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
        trades: tradesBySessionStrategy.get(key) ?? [],
      },
    ]);
  }

  return Array.from(groups.entries())
    .map(([name, strategySessions]) => {
      const strategyTrades = strategySessions.flatMap((row) =>
        tradesBySessionStrategy.get(sessionStrategyKey(row.session.id, name)) ?? [],
      );
      return {
        aggregate: aggregateGatewayTrades(strategyTrades),
        name,
        sessions: strategySessions.sort((a, b) => b.session.id - a.session.id),
        trades: strategyTrades,
      };
    })
    .sort((a, b) => {
      if (b.aggregate.closedTrades !== a.aggregate.closedTrades) {
        return b.aggregate.closedTrades - a.aggregate.closedTrades;
      }
      return a.name.localeCompare(b.name);
    });
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
    netPnl,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : null,
    winRate: closedTrades.length > 0 ? wins.length / closedTrades.length : 0,
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
  group,
  onResumeSession,
}: {
  activeSessionId: number | null;
  group: GatewayStrategyGroup;
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
    () => aggregateGatewayTrades(filteredRows.flatMap((row) => row.trades)),
    [filteredRows],
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
          {formatMoney(filteredAggregate.netPnl)}
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
                  {formatMoney(row.aggregate.netPnl)}
                </td>
                <td className="px-3 py-3 tabular-nums text-slate-300">
                  {formatPercent(row.aggregate.winRate)}
                </td>
                <td className="px-3 py-3 text-right">
                  <button
                    className="control-button h-9"
                    onClick={() => onResumeSession(row.session.id)}
                    type="button"
                  >
                    Open
                    <ArrowRight size={14} />
                  </button>
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
