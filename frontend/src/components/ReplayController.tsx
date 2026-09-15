import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  StepForward,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useBacktestStore } from "../store/backtestStore";
import { ThemedSelect } from "./ThemedSelect";
import { OverlaySurface } from "./overlays/OverlaySurface";

type Props = {
  dateFormat?: ReplayDateFormat;
  dayOfWeekLabels?: boolean;
  isOrderPaneOpen: boolean;
  onTransientOverlayOpenChange?: (open: boolean) => void;
  onReplayTimeframeChange?: (timeframe: string) => void;
  onToggleOrderPane: () => void;
  replayStepBars?: number;
  replayTimeframe?: string | null;
  replayTimeframeLabel?: string | null;
  replayTimeframeOptions?: Array<{
    label: string;
    sublabel?: string;
    value: string;
  }>;
  showOrderToggle?: boolean;
  timeHoursFormat?: TimeHoursFormat;
};

type ReplayDateFormat = "dd MMM yy" | "MMM dd yyyy" | "yyyy-MM-dd";
type TimeHoursFormat = "12-hour" | "24-hour";

const CUSTOM_SPEED_VALUE = "custom";
const MIN_CUSTOM_BARS_PER_SECOND = 0.1;
const MAX_CUSTOM_BARS_PER_SECOND = 50;
const SPEED_PRESETS = [
  { label: "0.5x", value: "400" },
  { label: "1x", value: "200" },
  { label: "2.5x", value: "80" },
  { label: "5x", value: "40" },
].sort((left, right) => Number(right.value) - Number(left.value));

export function ReplayController({
  dateFormat = "dd MMM yy",
  dayOfWeekLabels = false,
  isOrderPaneOpen,
  onTransientOverlayOpenChange,
  onReplayTimeframeChange,
  onToggleOrderPane,
  replayStepBars = 1,
  replayTimeframe = null,
  replayTimeframeLabel = null,
  replayTimeframeOptions = [],
  showOrderToggle = true,
  timeHoursFormat = "24-hour",
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
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [replayTimeframeMenuOpen, setReplayTimeframeMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const customSpeedRef = useRef<HTMLInputElement | null>(null);
  const currentOffset = state?.session.current_offset ?? 0;
  const minJumpOffset = state?.session.start_offset ?? 0;
  const maxJumpOffset = state?.session.end_offset ?? null;
  const parsedJumpOffset = parseReplayOffset(jumpOffset);
  const clampedJumpOffset =
    parsedJumpOffset == null
      ? null
      : clampReplayOffset(parsedJumpOffset, minJumpOffset, maxJumpOffset);
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

  useEffect(() => {
    onTransientOverlayOpenChange?.(
      datePickerOpen || replayTimeframeMenuOpen || speedMenuOpen,
    );
    return () => onTransientOverlayOpenChange?.(false);
  }, [
    datePickerOpen,
    onTransientOverlayOpenChange,
    replayTimeframeMenuOpen,
    speedMenuOpen,
  ]);

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

  async function handleJumpToOffset() {
    if (!state || clampedJumpOffset == null) {
      return;
    }
    await jumpToOffset(clampedJumpOffset);
    setJumpOffset("");
  }

  async function handleJumpToTimestamp() {
    if (!state || !jumpTime) {
      return;
    }
    await jumpToTimestamp(toDatasetTimestamp(jumpTime));
  }

  return (
    <section className="replay-controller-bar rounded-md border border-white/10 bg-ink-850 px-4 py-3 shadow-panel">
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
            onClick={() => void stepForward(replayStepBars)}
            title={
              replayStepBars > 1
                ? `Advance ${replayStepBars.toLocaleString()} source bars`
                : "Advance one bar"
            }
            type="button"
          >
            <SkipForward size={17} />
            Step
          </button>
          <button
            className="control-button"
            disabled={!state || isStepping}
            onClick={() => void stepForward(replayStepBars * 10)}
            title={
              replayStepBars > 1
                ? `Advance ${(replayStepBars * 10).toLocaleString()} source bars`
                : "Advance ten bars"
            }
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

          <div className="flex shrink-0 flex-nowrap items-center gap-2">
            <ThemedSelect
              ariaLabel="Replay speed"
              className="h-10 w-32"
              onChange={handlePresetSpeedChange}
              onOpenChange={setSpeedMenuOpen}
              options={[
                ...SPEED_PRESETS,
                {
                  label: "Custom",
                  sublabel: `${MIN_CUSTOM_BARS_PER_SECOND}-${MAX_CUSTOM_BARS_PER_SECOND} replay bars/s`,
                  value: CUSTOM_SPEED_VALUE,
                },
              ]}
              portal
              value={selectedSpeedValue}
            />
            <label className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 text-xs font-semibold text-slate-500">
              <input
                aria-label="Custom replay speed in replay bars per second"
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
              replay bars/s
            </label>
          </div>
          <span className="rounded-md bg-white/5 px-3 py-2 text-sm text-slate-400">
            Bar {currentOffset.toLocaleString()}
          </span>
          {replayTimeframeLabel && (
            replayTimeframe && replayTimeframeOptions.length > 1 && onReplayTimeframeChange ? (
              <div className="replay-timeframe-control">
                <span className="replay-timeframe-label">Replay</span>
                <ThemedSelect
                  ariaLabel="Replay timeframe"
                  className="replay-timeframe-select h-8 w-28"
                  onChange={onReplayTimeframeChange}
                  onOpenChange={setReplayTimeframeMenuOpen}
                  options={replayTimeframeOptions}
                  portal
                  value={replayTimeframe}
                />
              </div>
            ) : (
              <span className="replay-timeframe-static">
                Replay {replayTimeframeLabel}
              </span>
            )
          )}
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
            disabled={!state || clampedJumpOffset == null}
            onClick={() => void handleJumpToOffset()}
            type="button"
          >
            Go
          </button>
          <div className="flex shrink-0 flex-nowrap items-center gap-2">
            <ReplayDateTimePicker
              currentTimestamp={currentTimestamp}
              dateFormat={dateFormat}
              dayOfWeekLabels={dayOfWeekLabels}
              disabled={!state}
              onChange={setJumpTime}
              onOpenChange={setDatePickerOpen}
              timeHoursFormat={timeHoursFormat}
              value={jumpTime}
            />
            <button
              className="control-button shrink-0"
              disabled={!state || !jumpTime}
              onClick={() => void handleJumpToTimestamp()}
              type="button"
            >
              Go Date
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ReplayDateTimePicker({
  currentTimestamp,
  dateFormat,
  dayOfWeekLabels,
  disabled,
  dialogLabel = "Replay Date",
  onChange,
  onOpenChange,
  placeholder = "Select replay date",
  timeHoursFormat,
  value,
}: {
  currentTimestamp: string | null;
  dateFormat: ReplayDateFormat;
  dayOfWeekLabels: boolean;
  dialogLabel?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  placeholder?: string;
  timeHoursFormat: TimeHoursFormat;
  value: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const selected = parseReplayDateTime(value) ?? parseReplayDateTime(toReplayInputValue(currentTimestamp));
  const [viewYear, setViewYear] = useState(() => selected?.year ?? new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => selected?.month ?? new Date().getMonth() + 1);
  const [viewMode, setViewMode] = useState<"calendar" | "years">("calendar");
  const [yearPageStart, setYearPageStart] = useState(() => yearRangeStart(selected?.year ?? new Date().getFullYear()));
  const [draftDay, setDraftDay] = useState(() => selected?.day ?? 1);
  const [draftHour, setDraftHour] = useState(() => selected?.hour ?? 0);
  const [draftMinute, setDraftMinute] = useState(() => selected?.minute ?? 0);

  useEffect(() => {
    onOpenChange?.(open);
    return () => {
      if (open) {
        onOpenChange?.(false);
      }
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLElement>("[data-replay-picker-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const nextSelected = parseReplayDateTime(value) ?? parseReplayDateTime(toReplayInputValue(currentTimestamp));
    if (!nextSelected || open) {
      return;
    }
    setViewYear(nextSelected.year);
    setViewMonth(nextSelected.month);
    setYearPageStart(yearRangeStart(nextSelected.year));
    setDraftDay(nextSelected.day);
    setDraftHour(nextSelected.hour);
    setDraftMinute(nextSelected.minute);
  }, [currentTimestamp, open, value]);

  function openPicker() {
    if (disabled) {
      return;
    }
    const nextSelected = parseReplayDateTime(value) ?? parseReplayDateTime(toReplayInputValue(currentTimestamp));
    if (nextSelected) {
      setViewYear(nextSelected.year);
      setViewMonth(nextSelected.month);
      setYearPageStart(yearRangeStart(nextSelected.year));
      setDraftDay(nextSelected.day);
      setDraftHour(nextSelected.hour);
      setDraftMinute(nextSelected.minute);
    }
    setViewMode("calendar");
    setOpen((isOpen) => !isOpen);
  }

  function moveView(delta: number) {
    if (viewMode === "years") {
      setYearPageStart((current) => current + delta * 12);
      return;
    }
    const date = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(date.getFullYear());
    setViewMonth(date.getMonth() + 1);
  }

  function toggleYearPicker() {
    if (viewMode === "calendar") {
      setYearPageStart(yearRangeStart(viewYear));
      setViewMode("years");
      return;
    }
    setViewMode("calendar");
  }

  function selectYear(year: number) {
    setViewYear(year);
    setViewMode("calendar");
  }

  function selectDay(day: number) {
    setDraftDay(day);
  }

  function applyTime() {
    const day = Math.min(draftDay, daysInMonth(viewYear, viewMonth));
    onChange(formatReplayDateTime(viewYear, viewMonth, day, draftHour, draftMinute));
    setOpen(false);
  }

  function cancelDraft() {
    const nextSelected = parseReplayDateTime(value) ?? parseReplayDateTime(toReplayInputValue(currentTimestamp));
    if (nextSelected) {
      setViewYear(nextSelected.year);
      setViewMonth(nextSelected.month);
      setDraftDay(nextSelected.day);
      setDraftHour(nextSelected.hour);
      setDraftMinute(nextSelected.minute);
    }
    setOpen(false);
  }

  function handleDraftHourChange(value: string) {
    if (timeHoursFormat === "12-hour") {
      setDraftHour(to24Hour(clampTimePart(value, 12, 1), hourPeriod(draftHour)));
      return;
    }
    setDraftHour(clampTimePart(value, 23));
  }

  function togglePeriod(nextPeriod: "AM" | "PM") {
    if (nextPeriod === hourPeriod(draftHour)) {
      return;
    }
    setDraftHour(nextPeriod === "PM" ? draftHour + 12 : draftHour - 12);
  }

  const cells = calendarCells(viewYear, viewMonth);
  const visibleYears = Array.from({ length: 12 }, (_, index) => yearPageStart + index);
  const displayValue = selected
    ? formatPickerDisplay(selected, {
        dateFormat,
        dayOfWeekLabels,
        timeHoursFormat,
      })
    : placeholder;
  const is12Hour = timeHoursFormat === "12-hour";
  const currentPeriod = hourPeriod(draftHour);
  const activeDraftDay = Math.min(draftDay, daysInMonth(viewYear, viewMonth));

  return (
    <div className="replay-date-picker">
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`replay-date-trigger ${is12Hour ? "replay-date-trigger-12" : ""}`}
        disabled={disabled}
        onClick={openPicker}
        ref={triggerRef}
        type="button"
      >
        <CalendarDays size={15} />
        <span>{displayValue}</span>
      </button>

      <OverlaySurface
        align="right"
        anchorRef={triggerRef}
        ariaLabel={dialogLabel}
        className="replay-date-popover replay-date-popover-floating z-[180]"
        estimatedHeight={430}
        id={popoverId}
        onDismiss={() => setOpen(false)}
        open={open}
        preferredWidth={340}
        role="dialog"
        surfaceRef={popoverRef}
        triggerRef={triggerRef}
      >
          <div className="replay-date-popover-header">
            <button
              aria-label={viewMode === "years" ? "Previous 12 years" : "Previous month"}
              className="replay-date-icon-button"
              data-replay-picker-initial-focus="true"
              onClick={() => moveView(-1)}
              type="button"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              aria-expanded={viewMode === "years"}
              aria-label={viewMode === "years" ? "Return to calendar" : "Choose a year"}
              className="replay-date-title-button"
              onClick={toggleYearPicker}
              type="button"
            >
              <span className="replay-date-title-label">
                {viewMode === "years"
                  ? `${yearPageStart}\u2013${yearPageStart + 11}`
                  : `${MONTH_NAMES[viewMonth - 1]} ${viewYear}`}
              </span>
              <span className="replay-date-title-hint">
                {viewMode === "years" ? "Choose year" : `${dialogLabel} \u00b7 Change year`}
              </span>
            </button>
            <button
              aria-label={viewMode === "years" ? "Next 12 years" : "Next month"}
              className="replay-date-icon-button"
              onClick={() => moveView(1)}
              type="button"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {viewMode === "years" ? (
            <div className="replay-date-year-grid">
              {visibleYears.map((year) => (
                <button
                  aria-label={`Choose ${year}`}
                  className={`replay-date-year-cell ${year === viewYear ? "replay-date-year-cell-active" : ""}`}
                  key={year}
                  onClick={() => selectYear(year)}
                  type="button"
                >
                  {year}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="replay-date-weekdays">
                {WEEKDAY_NAMES.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>

              <div className="replay-date-grid">
                {cells.map((cell) => {
                  const isSelected =
                    cell.day != null &&
                    activeDraftDay === cell.day;
                  return (
                    <button
                      className={`replay-date-cell ${cell.day == null ? "replay-date-cell-empty" : ""} ${isSelected ? "replay-date-cell-active" : ""}`}
                      disabled={cell.day == null}
                      key={cell.key}
                      onClick={() => cell.day != null && selectDay(cell.day)}
                      type="button"
                    >
                      {cell.day ?? ""}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className={`replay-time-row ${is12Hour ? "replay-time-row-12" : ""}`}>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <Clock3 size={13} />
              Time
            </span>
            <label>
              <span>HH</span>
              <input
                max={is12Hour ? 12 : 23}
                min={is12Hour ? 1 : 0}
                onChange={(event) => handleDraftHourChange(event.target.value)}
                type="number"
                value={formatHourInputValue(draftHour, timeHoursFormat)}
              />
            </label>
            <label>
              <span>MM</span>
              <input
                max={59}
                min={0}
                onChange={(event) => setDraftMinute(clampTimePart(event.target.value, 59))}
                type="number"
                value={String(draftMinute).padStart(2, "0")}
              />
            </label>
            {is12Hour && (
              <div className="replay-period-toggle" aria-label="Time period">
                {(["AM", "PM"] as const).map((period) => (
                  <button
                    className={period === currentPeriod ? "replay-period-toggle-active" : ""}
                    key={period}
                    onClick={() => togglePeriod(period)}
                    type="button"
                  >
                    {period}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="replay-date-actions">
            <button className="control-button h-9 px-3 text-xs" onClick={cancelDraft} type="button">
              <X size={14} />
              Cancel
            </button>
            <button
              className="control-button h-9 border-cyan-300/30 bg-cyan-300/10 px-3 text-xs text-cyan-100"
              onClick={applyTime}
              type="button"
            >
              <Check size={14} />
              Set
            </button>
          </div>
      </OverlaySurface>
    </div>
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

function parseReplayOffset(value: string) {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function clampReplayOffset(value: number, min: number, max: number | null) {
  const lowerBound = Math.max(0, min);
  const upperBound = max == null ? Number.POSITIVE_INFINITY : Math.max(lowerBound, max);
  return Math.min(Math.max(value, lowerBound), upperBound);
}

type ReplayDateParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const FULL_WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseReplayDateTime(value: string): ReplayDateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute] = match;
  const parts = {
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    month: Number(month),
    year: Number(year),
  };
  if (
    !Number.isFinite(parts.year) ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > daysInMonth(parts.year, parts.month) ||
    parts.hour < 0 ||
    parts.hour > 23 ||
    parts.minute < 0 ||
    parts.minute > 59
  ) {
    return null;
  }
  return parts;
}

function calendarCells(year: number, month: number) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const totalDays = daysInMonth(year, month);
  const cells: Array<{ day: number | null; key: string }> = [];
  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({ day: null, key: `blank-${index}` });
  }
  for (let day = 1; day <= totalDays; day += 1) {
    cells.push({ day, key: `day-${day}` });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: null, key: `tail-${cells.length}` });
  }
  return cells;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function yearRangeStart(year: number) {
  return Math.floor(year / 10) * 10;
}

function formatReplayDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
}

function formatPickerDisplay(
  parts: ReplayDateParts,
  settings: {
    dateFormat: ReplayDateFormat;
    dayOfWeekLabels: boolean;
    timeHoursFormat: TimeHoursFormat;
  },
) {
  return `${formatReplayDateLabel(parts, settings)} ${formatReplayTimeLabel(parts, settings.timeHoursFormat)}`;
}

function formatReplayDateLabel(
  parts: ReplayDateParts,
  settings: {
    dateFormat: ReplayDateFormat;
    dayOfWeekLabels: boolean;
  },
) {
  const weekday = settings.dayOfWeekLabels
    ? `${FULL_WEEKDAY_NAMES[new Date(parts.year, parts.month - 1, parts.day).getDay()]} `
    : "";
  const month = MONTH_NAMES[parts.month - 1].slice(0, 3);
  const shortYear = String(parts.year).slice(-2);

  if (settings.dateFormat === "yyyy-MM-dd") {
    return `${weekday}${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  }

  if (settings.dateFormat === "MMM dd yyyy") {
    return `${weekday}${month} ${pad2(parts.day)} ${parts.year}`;
  }

  return `${weekday}${pad2(parts.day)} ${month} '${shortYear}`;
}

function formatReplayTimeLabel(
  parts: Pick<ReplayDateParts, "hour" | "minute">,
  timeHoursFormat: TimeHoursFormat,
) {
  if (timeHoursFormat === "12-hour") {
    return `${formatHourInputValue(parts.hour, timeHoursFormat)}:${pad2(parts.minute)} ${hourPeriod(parts.hour)}`;
  }
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function formatHourInputValue(hour: number, timeHoursFormat: TimeHoursFormat) {
  if (timeHoursFormat === "12-hour") {
    return pad2(to12Hour(hour));
  }
  return pad2(hour);
}

function hourPeriod(hour: number): "AM" | "PM" {
  return hour >= 12 ? "PM" : "AM";
}

function to12Hour(hour: number) {
  return hour % 12 || 12;
}

function to24Hour(hour: number, period: "AM" | "PM") {
  if (period === "AM") {
    return hour === 12 ? 0 : hour;
  }
  return hour === 12 ? 12 : hour + 12;
}

function clampTimePart(value: string, max: number, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
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
