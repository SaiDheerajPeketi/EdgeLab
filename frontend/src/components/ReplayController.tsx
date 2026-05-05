import {
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  StepForward,
} from "lucide-react";
import { useState } from "react";
import { useBacktestStore } from "../store/backtestStore";

type Props = {
  isOrderPaneOpen: boolean;
  onToggleOrderPane: () => void;
};

export function ReplayController({ isOrderPaneOpen, onToggleOrderPane }: Props) {
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
  const currentOffset = state?.session.current_offset ?? 0;

  return (
    <section className="rounded-md border border-white/10 bg-ink-850 px-4 py-3 shadow-panel">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`control-button ${isOrderPaneOpen ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : ""}`}
            disabled={!state}
            onClick={onToggleOrderPane}
            type="button"
          >
            {isOrderPaneOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            Order
          </button>
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

          <select
            className="input-control h-10 w-28"
            value={speedMs}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            <option value={900}>0.5x</option>
            <option value={450}>1x</option>
            <option value={180}>2.5x</option>
            <option value={80}>5x</option>
          </select>
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
            disabled={!jumpTime}
            onClick={() => void jumpToTimestamp(new Date(jumpTime).toISOString())}
            type="button"
          >
            Go Date
          </button>
        </div>
      </div>
    </section>
  );
}
