import { CalendarDays, Database, PlayCircle, RefreshCw } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  BacktestCreatePayload,
  BacktestSession,
  DatasetCatalog,
  DatasetInstrument,
  DatasetTimeframe,
  Playbook,
} from "../lib/api";

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
    setStartDate(toLocalInputValue(selectedTimeframe.first_timestamp));
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
      strategy_name: strategy || null,
      playbook_id: playbookId ? Number(playbookId) : null,
      start_timestamp: startDate ? new Date(startDate).toISOString() : null,
      end_timestamp: endDate ? new Date(endDate).toISOString() : null,
      initial_balance: Number(startingBalance) || 100000,
    };
    void onCreateSession(payload);
  }

  return (
    <section className="terminal-panel p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Database size={16} className="text-cyan-200" />
            Dataset Watchlist
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {datasets?.root ?? "Scanning preprocessed datasets"}
          </div>
        </div>
        {session && (
          <div className="rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
            Active: {session.symbol} {session.timeframe ?? ""} · {session.strategy_name ?? "No strategy"}
          </div>
        )}
      </div>

      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {instruments.map((instrument) => (
          <button
            className={`symbol-chip ${selectedInstrument?.id === instrument.id ? "symbol-chip-active" : ""}`}
            key={instrument.id}
            onClick={() => handleInstrumentSelect(instrument)}
            type="button"
          >
            <span className="font-semibold text-white">{instrument.symbol}</span>
            <span>{instrument.timeframes.length} TF</span>
          </button>
        ))}
        {instruments.length === 0 && (
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
            No datasets found yet
          </div>
        )}
      </div>

      <form className="grid gap-3 xl:grid-cols-[1.1fr_1fr_1fr_1fr_auto]" onSubmit={handleSubmit}>
        <label className="form-field">
          <span>Instrument</span>
          <select
            className="input-control h-10"
            onChange={(event) => setInstrumentId(event.target.value)}
            value={selectedInstrument?.id ?? ""}
          >
            {instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Timeframe</span>
          <select
            className="input-control h-10"
            onChange={(event) => setTimeframe(event.target.value)}
            value={selectedTimeframe?.timeframe ?? ""}
          >
            {selectedInstrument?.timeframes.map((item) => (
              <option key={item.timeframe} value={item.timeframe}>
                {item.timeframe} · {item.rows.toLocaleString()} bars
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Strategy</span>
          <input
            className="input-control h-10"
            list="strategy-playbooks"
            onChange={(event) => setStrategy(event.target.value)}
            value={strategy}
          />
          <datalist id="strategy-playbooks">
            {playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.name} />
            ))}
          </datalist>
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
          <select
            className="input-control h-10 min-w-36"
            onChange={(event) => setPlaybookId(event.target.value)}
            value={playbookId}
          >
            <option value="">Unlinked</option>
            {playbooks.map((playbook) => (
              <option key={playbook.id} value={playbook.id}>
                {playbook.name}
              </option>
            ))}
          </select>
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
          className="control-button h-10 self-end border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
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
          <span>{selectedTimeframe.csv_path}</span>
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

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
