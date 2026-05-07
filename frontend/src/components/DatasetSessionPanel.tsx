import { CalendarDays, Database, PlayCircle, RefreshCw, SlidersHorizontal } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  BacktestCreatePayload,
  BacktestSession,
  DatasetCatalog,
  DatasetInstrument,
  DatasetTimeframe,
  Playbook,
} from "../lib/api";
import { formatMarketSymbol, symbolBadge } from "../lib/symbols";
import { ThemedSelect } from "./ThemedSelect";

type Props = {
  datasets: DatasetCatalog | null;
  isLoading: boolean;
  playbooks: Playbook[];
  session: BacktestSession | null;
  onCreateSession: (payload: BacktestCreatePayload) => Promise<void>;
};

export function DatasetSessionPanel({
  datasets,
  isLoading,
  onCreateSession,
  playbooks,
  session,
}: Props) {
  const instruments = datasets?.instruments ?? [];
  const [instrumentId, setInstrumentId] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [strategy, setStrategy] = useState(session?.strategy_name ?? "London Continuation");
  const [playbookId, setPlaybookId] = useState("");
  const [startingBalance, setStartingBalance] = useState("100000");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);

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

  useEffect(() => {
    if (!selectedInstrument && instruments[0]) {
      setInstrumentId(instruments[0].id);
      return;
    }
    if (selectedInstrument && !instrumentId) {
      setInstrumentId(selectedInstrument.id);
    }
  }, [instrumentId, instruments, selectedInstrument]);

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

  function handleInstrumentSelect(instrument: DatasetInstrument) {
    setInstrumentId(instrument.id);
    setTimeframe(instrument.timeframes[0]?.timeframe ?? "");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedInstrument || !selectedTimeframe) {
      return;
    }
    const payload: BacktestCreatePayload = {
      name: `${selectedInstrument.symbol} ${selectedTimeframe.timeframe} Replay`,
      symbol: selectedInstrument.symbol,
      instrument: selectedInstrument.id,
      timeframe: selectedTimeframe.timeframe,
      csv_path: selectedTimeframe.csv_path,
      currency: selectedInstrument.currency,
      pnl_multiplier: selectedInstrument.pnl_multiplier,
      timezone: selectedInstrument.timezone,
      strategy_name: strategy || null,
      playbook_id: playbookId ? Number(playbookId) : null,
      start_timestamp: startDate ? new Date(startDate).toISOString() : null,
      end_timestamp: endDate ? new Date(endDate).toISOString() : null,
      initial_balance: Number(startingBalance) || 100000,
    };
    void onCreateSession(payload);
  }

  return (
    <section className="dataset-session-strip">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="min-w-44">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-100">
            <Database size={16} className="text-cyan-200" />
            Dataset Session
          </div>
          <div className="mt-1 max-w-72 truncate text-xs text-slate-500">
            {datasets?.root ?? "Scanning preprocessed datasets"}
          </div>
        </div>

        <div className="instrument-tabs">
          {instruments.map((instrument) => (
            <button
              className={`instrument-tab ${selectedInstrument?.id === instrument.id ? "instrument-tab-active" : ""}`}
              key={instrument.id}
              onClick={() => handleInstrumentSelect(instrument)}
              type="button"
            >
              <span className="instrument-tab-badge">{symbolBadge(instrument.symbol)}</span>
              <span className="instrument-tab-symbol">{formatMarketSymbol(instrument.symbol)}</span>
              <span>{instrument.timeframes.length} TF</span>
            </button>
          ))}
          {instruments.length === 0 && (
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
              No datasets found
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
                title={`${formatTimeframeRows(item)} · ${item.imported ? "Imported" : "CSV direct"}`}
                type="button"
              >
                {item.timeframe}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {session && (
            <div className="hidden rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100 shadow-inner xl:block">
              Active: <strong>{formatMarketSymbol(session.symbol)}</strong> {session.timeframe ?? ""} · {session.strategy_name ?? "No strategy"}
            </div>
          )}
          <button
            className="control-button h-9 border-cyan-300/25 bg-cyan-300/10 px-3 text-xs text-cyan-100"
            onClick={() => setSetupOpen((value) => !value)}
            type="button"
          >
            <SlidersHorizontal size={14} />
            Session
          </button>
        </div>
      </div>

      <form
        className={`dataset-session-form ${setupOpen ? "grid" : "hidden"} gap-3 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]`}
        onSubmit={handleSubmit}
      >
        <label className="form-field">
          <span>Instrument</span>
          <ThemedSelect
            ariaLabel="Instrument"
            className="h-10"
            onChange={setInstrumentId}
            options={instruments.map((instrument) => ({
              label: instrument.name,
              sublabel: instrument.symbol,
              value: instrument.id,
            }))}
            value={selectedInstrument?.id ?? ""}
          />
        </label>

        <label className="form-field hidden xl:block">
          <span>Timeframe</span>
          <ThemedSelect
            ariaLabel="Dataset timeframe"
            className="h-10"
            onChange={setTimeframe}
            options={(selectedInstrument?.timeframes ?? []).map((item) => ({
              label: item.timeframe,
              sublabel: formatTimeframeRows(item),
              value: item.timeframe,
            }))}
            value={selectedTimeframe?.timeframe ?? ""}
          />
        </label>

        <label className="form-field">
          <span>Strategy</span>
          <input
            className="input-control h-10"
            onChange={(event) => setStrategy(event.target.value)}
            value={strategy}
          />
        </label>

        <label className="form-field">
          <span>Balance</span>
          <input
            className="input-control h-10"
            min={1}
            onChange={(event) => setStartingBalance(event.target.value)}
            type="number"
            value={startingBalance}
          />
        </label>

        <label className="form-field">
          <span>Playbook</span>
          <ThemedSelect
            ariaLabel="Session playbook"
            className="h-10 min-w-36"
            onChange={setPlaybookId}
            options={[
              { label: "Unlinked", value: "" },
              ...playbooks.map((playbook) => ({
                label: playbook.name,
                value: String(playbook.id),
              })),
            ]}
            value={playbookId}
          />
        </label>

        <label className="form-field xl:col-span-2">
          <span>Start Date</span>
          <input
            className="input-control h-10"
            onChange={(event) => setStartDate(event.target.value)}
            type="datetime-local"
            value={startDate}
          />
        </label>

        <label className="form-field xl:col-span-2">
          <span>End Date</span>
          <input
            className="input-control h-10"
            onChange={(event) => setEndDate(event.target.value)}
            type="datetime-local"
            value={endDate}
          />
        </label>

        <button
          className="control-button h-10 self-end border-cyan-300/30 bg-cyan-300/10 text-cyan-100 xl:col-span-1"
          disabled={!selectedTimeframe || isLoading}
          type="submit"
        >
          {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <PlayCircle size={16} />}
          Start
        </button>
      </form>

      {selectedTimeframe && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <CalendarDays size={14} />
          <span>{formatDate(selectedTimeframe.first_timestamp)}</span>
          <span>to</span>
          <span>{formatDate(selectedTimeframe.last_timestamp)}</span>
          <span>·</span>
          <span className="truncate">{selectedTimeframe.csv_path}</span>
        </div>
      )}
    </section>
  );
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
  return timeframe.rows > 0 ? `${timeframe.rows.toLocaleString()} bars` : "Rows counted on start";
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
    case "Weekly":
      return 604800;
    case "Monthly":
      return 2592000;
    default:
      return 60;
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
