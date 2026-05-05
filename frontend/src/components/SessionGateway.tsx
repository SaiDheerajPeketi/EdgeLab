import {
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
} from "../lib/api";
import { postPlaybook } from "../lib/api";
import { formatTradingViewSymbol, symbolBadge } from "../lib/symbols";

type Props = {
  datasets: DatasetCatalog | null;
  isLoading: boolean;
  onCreateSession: (payload: BacktestCreatePayload) => Promise<void>;
  onResumeSession: () => void;
  playbooks: Playbook[];
  session: BacktestSession | null;
};

type PlaybookMode = "none" | "existing" | "new";

export function SessionGateway({
  datasets,
  isLoading,
  onCreateSession,
  onResumeSession,
  playbooks,
  session,
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
        const playbook = await postPlaybook({
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
                  ? `${formatTradingViewSymbol(session.symbol)} ${session.timeframe ?? ""} / ${session.strategy_name ?? "No strategy"}`
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
            onClick={onResumeSession}
            type="button"
          >
            <RotateCcw size={16} />
            Resume Session
          </button>
        </div>
      </div>

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
              {playbooks.map((playbook) => (
                <option key={playbook.id} value={playbook.name} />
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
                    {formatTradingViewSymbol(instrument.symbol)}
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
                <select
                  className="input-control h-11"
                  onChange={(event) => setPlaybookId(event.target.value)}
                  value={playbookId}
                >
                  {playbooks.map((playbook) => (
                    <option key={playbook.id} value={playbook.id}>
                      {playbook.name}
                    </option>
                  ))}
                </select>
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
