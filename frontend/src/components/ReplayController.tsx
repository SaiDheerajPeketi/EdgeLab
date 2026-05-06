import {
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  StepForward,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBacktestStore } from "../store/backtestStore";
import { ThemedSelect } from "./ThemedSelect";

type Props = {
  isOrderPaneOpen: boolean;
  onToggleOrderPane: () => void;
  showOrderToggle?: boolean;
};

const CUSTOM_SPEED_VALUE = "custom";
const MIN_CUSTOM_BARS_PER_SECOND = 0.1;
const MAX_CUSTOM_BARS_PER_SECOND = 50;
const SPEED_PRESETS = [
  { label: "0.5x", value: "900" },
  { label: "1x", value: "450" },
  { label: "2.5x", value: "180" },
  { label: "5x", value: "80" },
];

export function ReplayController({
  isOrderPaneOpen,
  onToggleOrderPane,
  showOrderToggle = true,
}: Props) {
  const {
    state,
    isPlaying,
    isStepping,
    speedMs,
    setPlaying,
    setSpeed,
    stepForward,
    resetReplay,
    jumpToOffset,
    jumpToTimestamp,
  } = useBacktestStore();
  const [jumpOffset, setJumpOffset] = useState("");
  const [jumpTime, setJumpTime] = useState("");
  const [customSpeed, setCustomSpeed] = useState(() =>
    formatBarsPerSecond(msToBarsPerSecond(speedMs)),
  );
  const customSpeedRef = useRef<HTMLInputElement | null>(null);
  const currentOffset = state?.session.current_offset ?? 0;
  const currentTimestamp =
    state?.current_candle?.timestamp ?? state?.session.start_at ?? null;
  const selectedSpeedValue = useMemo(
    () =>
      SPEED_PRESETS.some((preset) => Number(preset.value) === speedMs)
        ? String(speedMs)
        : CUSTOM_SPEED_VALUE,
    [speedMs],
  );

  useEffect(() => {
    setJumpTime(toReplayInputValue(currentTimestamp));
  }, [currentTimestamp]);

  useEffect(() => {
    setCustomSpeed(formatBarsPerSecond(msToBarsPerSecond(speedMs)));
  }, [speedMs]);

  function handlePresetSpeedChange(value: string) {
    if (value === CUSTOM_SPEED_VALUE) {
      window.requestAnimationFrame(() => customSpeedRef.current?.focus());
      return;
    }
    setSpeed(Number(value));
  }

  function handleCustomSpeedChange(value: string) {
    setCustomSpeed(value);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    setSpeed(barsPerSecondToMs(parsed));
  }

  return (
    <section className="rounded-md border border-white/10 bg-ink-850 px-4 py-3 shadow-panel">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {showOrderToggle && (
            <button
              className={`control-button ${isOrderPaneOpen ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : ""}`}
              disabled={!state}
              onClick={onToggleOrderPane}
              type="button"
            >
              {isOrderPaneOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
              Ticket
            </button>
          )}
          <button
            className="control-button"
            disabled={!state}
            onClick={() => setPlaying(!isPlaying)}
            type="button"
          >
            {isPlaying ? <Pause size={17} /> : <Play size={17} />}
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button
            className="control-button"
            disabled={!state || isStepping}
            onClick={() => void stepForward(1)}
            type="button"
          >
            <SkipForward size={17} />
            Step
          </button>
          <button
            className="control-button"
            disabled={!state || isStepping}
            onClick={() => void stepForward(10)}
            type="button"
          >
            <StepForward size={17} />
            10 Bars
          </button>
          <button
            className="icon-button"
            onClick={() => void resetReplay()}
            title="New replay session"
            type="button"
          >
            <RotateCcw size={17} />
          </button>

          <ThemedSelect
            ariaLabel="Replay speed"
            className="h-10 w-32"
            onChange={handlePresetSpeedChange}
            options={[
              ...SPEED_PRESETS,
              {
                label: "Custom",
                sublabel: `${MIN_CUSTOM_BARS_PER_SECOND}-${MAX_CUSTOM_BARS_PER_SECOND} bars/s`,
                value: CUSTOM_SPEED_VALUE,
              },
            ]}
            value={selectedSpeedValue}
          />
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 text-xs font-semibold text-slate-500">
            <input
              aria-label="Custom replay speed in bars per second"
              className="w-16 bg-transparent text-right text-sm font-semibold text-slate-100 outline-none"
              inputMode="decimal"
              max={MAX_CUSTOM_BARS_PER_SECOND}
              min={MIN_CUSTOM_BARS_PER_SECOND}
              onChange={(event) => handleCustomSpeedChange(event.target.value)}
              ref={customSpeedRef}
              step="0.1"
              type="number"
              value={customSpeed}
            />
            bars/s
          </label>
          <span className="rounded-md bg-white/5 px-3 py-2 text-sm text-slate-400">
            Bar {currentOffset.toLocaleString()}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input-control h-10 w-32"
            onChange={(event) => setJumpOffset(event.target.value)}
            placeholder="Offset"
            type="number"
            value={jumpOffset}
          />
          <button
            className="control-button"
            disabled={!jumpOffset}
            onClick={() => void jumpToOffset(Number(jumpOffset))}
            type="button"
          >
            Go
          </button>
          <input
            className="input-control h-10 w-52"
            onChange={(event) => setJumpTime(event.target.value)}
            type="datetime-local"
            value={jumpTime}
          />
          <button
            className="control-button"
            disabled={!state || !jumpTime}
            onClick={() => void jumpToTimestamp(toDatasetTimestamp(jumpTime))}
            type="button"
          >
            Go Date
          </button>
        </div>
      </div>
    </section>
  );
}

function toReplayInputValue(value: string | null) {
  if (!value) {
    return "";
  }
  const normalized = value.trim().replace(" ", "T");
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? `${match[1]}T${match[2]}` : "";
}

function toDatasetTimestamp(value: string) {
  return value.length === 16 ? `${value}:00` : value;
}

function msToBarsPerSecond(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return msToBarsPerSecond(450);
  }
  return 1000 / value;
}

function barsPerSecondToMs(value: number) {
  const clamped = Math.min(
    MAX_CUSTOM_BARS_PER_SECOND,
    Math.max(MIN_CUSTOM_BARS_PER_SECOND, value),
  );
  return Math.round(1000 / clamped);
}

function formatBarsPerSecond(value: number) {
  if (!Number.isFinite(value)) {
    return "1";
  }
  return Number(value.toFixed(value >= 10 ? 1 : 2)).toString();
}
