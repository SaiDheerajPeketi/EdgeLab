import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { OverlaySurface } from "./overlays/OverlaySurface";

type ThemedDatePickerProps = {
  ariaLabel?: string;
  className?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

type DateParts = {
  day: number;
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

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ThemedDatePicker({
  ariaLabel = "Choose date",
  className = "",
  onChange,
  placeholder = "Select date",
  value,
}: ThemedDatePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const dayButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const yearButtonRefs = useRef(new Map<number, HTMLButtonElement>());
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const selected = parseDateValue(value);
  const fallbackDate = selected ?? datePartsFromDate(new Date());
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(fallbackDate.year);
  const [viewMonth, setViewMonth] = useState(fallbackDate.month);
  const [focusedDate, setFocusedDate] = useState(fallbackDate);
  const [viewMode, setViewMode] = useState<"calendar" | "years">("calendar");
  const [yearPageStart, setYearPageStart] = useState(yearRangeStart(fallbackDate.year));
  const [focusedYear, setFocusedYear] = useState(fallbackDate.year);

  useEffect(() => {
    if (!open) {
      const nextSelected = parseDateValue(value);
      if (nextSelected) {
        setViewYear(nextSelected.year);
        setViewMonth(nextSelected.month);
        setFocusedDate(nextSelected);
      }
    }
  }, [open, value]);

  useEffect(() => {
    if (!open || viewMode !== "calendar") {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      dayButtonRefs.current.get(focusedDate.day)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedDate.day, focusedDate.month, focusedDate.year, open, viewMode]);

  useEffect(() => {
    if (!open || viewMode !== "years") {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      yearButtonRefs.current.get(focusedYear)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedYear, open, viewMode, yearPageStart]);

  function togglePicker() {
    if (open) {
      setOpen(false);
      return;
    }
    const nextSelected = parseDateValue(value) ?? datePartsFromDate(new Date());
    setViewYear(nextSelected.year);
    setViewMonth(nextSelected.month);
    setFocusedDate(nextSelected);
    setViewMode("calendar");
    setYearPageStart(yearRangeStart(nextSelected.year));
    setFocusedYear(nextSelected.year);
    setOpen(true);
  }

  function moveView(delta: number) {
    if (viewMode === "years") {
      setYearPageStart((current) => current + delta * 12);
      setFocusedYear((current) => current + delta * 12);
      return;
    }
    focusDate(addMonths(focusedDate, delta));
  }

  function toggleYearPicker() {
    if (viewMode === "calendar") {
      setYearPageStart(yearRangeStart(viewYear));
      setFocusedYear(viewYear);
      setViewMode("years");
      return;
    }
    setViewMode("calendar");
  }

  function selectYear(year: number) {
    const nextDate = {
      day: Math.min(focusedDate.day, daysInMonth(year, viewMonth)),
      month: viewMonth,
      year,
    };
    setViewYear(year);
    setFocusedYear(year);
    setFocusedDate(nextDate);
    setViewMode("calendar");
  }

  function selectDay(day: number) {
    onChange(formatDateValue(viewYear, viewMonth, day));
    setOpen(false);
  }

  function clearDate() {
    onChange("");
    setOpen(false);
  }

  function focusDate(nextDate: DateParts) {
    setViewYear(nextDate.year);
    setViewMonth(nextDate.month);
    setFocusedDate(nextDate);
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextDate: DateParts | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextDate = addDays(focusedDate, -1);
        break;
      case "ArrowRight":
        nextDate = addDays(focusedDate, 1);
        break;
      case "ArrowUp":
        nextDate = addDays(focusedDate, -7);
        break;
      case "ArrowDown":
        nextDate = addDays(focusedDate, 7);
        break;
      case "Home":
        nextDate = addDays(focusedDate, -weekdayOf(focusedDate));
        break;
      case "End":
        nextDate = addDays(focusedDate, 6 - weekdayOf(focusedDate));
        break;
      case "PageUp":
        nextDate = addMonths(focusedDate, event.shiftKey ? -12 : -1);
        break;
      case "PageDown":
        nextDate = addMonths(focusedDate, event.shiftKey ? 12 : 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectDay(focusedDate.day);
        return;
      default:
        return;
    }
    event.preventDefault();
    focusDate(nextDate);
  }

  function handleYearKeyDown(event: KeyboardEvent<HTMLButtonElement>, year: number) {
    let nextYear: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextYear = year - 1;
        break;
      case "ArrowRight":
        nextYear = year + 1;
        break;
      case "ArrowUp":
        nextYear = year - 3;
        break;
      case "ArrowDown":
        nextYear = year + 3;
        break;
      case "Home":
        nextYear = year - ((year - yearPageStart) % 3);
        break;
      case "End":
        nextYear = year + (2 - ((year - yearPageStart) % 3));
        break;
      case "PageUp":
        nextYear = year - 12;
        break;
      case "PageDown":
        nextYear = year + 12;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectYear(year);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (nextYear < yearPageStart) {
      setYearPageStart((current) => current - 12);
    } else if (nextYear > yearPageStart + 11) {
      setYearPageStart((current) => current + 12);
    }
    setFocusedYear(nextYear);
  }

  const cells = calendarCells(viewYear, viewMonth);
  const visibleYears = Array.from({ length: 12 }, (_, index) => yearPageStart + index);
  const announcedMonth = `${MONTH_NAMES[viewMonth - 1]} ${viewYear}`;

  return (
    <div className={`replay-date-picker ${className}`}>
      <button
        aria-controls={dialogId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="replay-date-trigger w-full touch-manipulation motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11"
        onClick={togglePicker}
        ref={triggerRef}
        type="button"
      >
        <CalendarDays aria-hidden="true" size={15} />
        <span className={selected ? "" : "text-slate-500"}>
          {selected ? formatDateDisplay(selected) : placeholder}
        </span>
      </button>

      <OverlaySurface
        anchorRef={triggerRef}
        ariaLabelledBy={titleId}
        className="replay-date-popover replay-date-popover-floating"
        estimatedHeight={360}
        id={dialogId}
        onDismiss={() => setOpen(false)}
        open={open}
        preferredWidth={320}
        role="dialog"
        surfaceRef={popoverRef}
      >
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          {viewMode === "years"
            ? `Years ${yearPageStart} through ${yearPageStart + 11}`
            : announcedMonth}
        </span>

        <div className="replay-date-popover-header">
          <button
            aria-label={viewMode === "years" ? "Previous 12 years" : "Previous month"}
            className="replay-date-icon-button touch-manipulation motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
            onClick={() => moveView(-1)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={15} />
          </button>
          <button
            aria-expanded={viewMode === "years"}
            aria-label={viewMode === "years" ? "Return to calendar" : "Choose a year"}
            className="replay-date-title-button min-h-11 touch-manipulation motion-reduce:transition-none"
            onClick={toggleYearPicker}
            type="button"
          >
            <span className="replay-date-title-label" id={titleId}>
              {viewMode === "years"
                ? `${yearPageStart}\u2013${yearPageStart + 11}`
                : announcedMonth}
            </span>
            <span className="replay-date-title-hint">
              {viewMode === "years" ? "Choose year" : "Change year"}
            </span>
          </button>
          <button
            aria-label={viewMode === "years" ? "Next 12 years" : "Next month"}
            className="replay-date-icon-button touch-manipulation motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
            onClick={() => moveView(1)}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </div>

        {viewMode === "years" ? (
          <div aria-label="Choose year" className="replay-date-year-grid" role="grid">
            {chunk(visibleYears, 3).map((row) => (
              <div className="contents" key={row[0]} role="row">
                {row.map((year) => (
                  <button
                    aria-label={`Choose ${year}`}
                    aria-selected={year === viewYear}
                    className={`replay-date-year-cell touch-manipulation motion-reduce:transition-none ${year === viewYear ? "replay-date-year-cell-active" : ""}`}
                    key={year}
                    onClick={() => selectYear(year)}
                    onFocus={() => setFocusedYear(year)}
                    onKeyDown={(event) => handleYearKeyDown(event, year)}
                    ref={(node) => {
                      if (node) {
                        yearButtonRefs.current.set(year, node);
                      } else {
                        yearButtonRefs.current.delete(year);
                      }
                    }}
                    role="gridcell"
                    tabIndex={year === focusedYear ? 0 : -1}
                    type="button"
                  >
                    {year}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div aria-hidden="true" className="replay-date-weekdays">
              {WEEKDAY_NAMES.map((day) => (
                <span key={day}>{day.slice(0, 2)}</span>
              ))}
            </div>

            <div aria-labelledby={titleId} className="replay-date-grid" role="grid">
              {chunk(cells, 7).map((row) => (
                <div className="contents" key={row[0].key} role="row">
                  {row.map((cell) => {
                    if (cell.day == null) {
                      return (
                        <span
                          aria-hidden="true"
                          className="replay-date-cell replay-date-cell-empty"
                          key={cell.key}
                          role="gridcell"
                        />
                      );
                    }
                    const day = cell.day;
                    const date = { day, month: viewMonth, year: viewYear };
                    const isSelected = sameDate(selected, date);
                    const isFocused = sameDate(focusedDate, date);
                    return (
                      <button
                        aria-label={formatDateAccessible(date)}
                        aria-selected={isSelected}
                        className={`replay-date-cell touch-manipulation motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 ${isSelected ? "replay-date-cell-active" : ""}`}
                        key={cell.key}
                        onClick={() => selectDay(day)}
                        onFocus={() => setFocusedDate(date)}
                        onKeyDown={handleDayKeyDown}
                        ref={(node) => {
                          if (node) {
                            dayButtonRefs.current.set(day, node);
                          } else {
                            dayButtonRefs.current.delete(day);
                          }
                        }}
                        role="gridcell"
                        tabIndex={isFocused ? 0 : -1}
                        type="button"
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="replay-date-actions">
          <button
            className="control-button min-h-11 px-3 text-xs touch-manipulation motion-reduce:transition-none"
            disabled={!value}
            onClick={clearDate}
            type="button"
          >
            <X aria-hidden="true" size={14} />
            Clear
          </button>
        </div>
      </OverlaySurface>
    </div>
  );
}

function parseDateValue(value: string): DateParts | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  const parts = {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
  if (
    !Number.isFinite(parts.year) ||
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.day > daysInMonth(parts.year, parts.month)
  ) {
    return null;
  }
  return parts;
}

function datePartsFromDate(date: Date): DateParts {
  return {
    day: date.getDate(),
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  };
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

function chunk<T>(values: T[], size: number) {
  const rows: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows;
}

function addDays(parts: DateParts, amount: number): DateParts {
  return datePartsFromDate(new Date(parts.year, parts.month - 1, parts.day + amount));
}

function addMonths(parts: DateParts, amount: number): DateParts {
  const monthStart = new Date(parts.year, parts.month - 1 + amount, 1);
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth() + 1;
  return {
    day: Math.min(parts.day, daysInMonth(year, month)),
    month,
    year,
  };
}

function weekdayOf(parts: DateParts) {
  return new Date(parts.year, parts.month - 1, parts.day).getDay();
}

function sameDate(left: DateParts | null, right: DateParts) {
  return Boolean(
    left &&
      left.day === right.day &&
      left.month === right.month &&
      left.year === right.year,
  );
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function yearRangeStart(year: number) {
  return Math.floor(year / 10) * 10;
}

function formatDateValue(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatDateDisplay(parts: DateParts) {
  return `${MONTH_NAMES[parts.month - 1].slice(0, 3)} ${pad2(parts.day)} ${parts.year}`;
}

function formatDateAccessible(parts: DateParts) {
  return `${WEEKDAY_NAMES[weekdayOf(parts)]}, ${MONTH_NAMES[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
