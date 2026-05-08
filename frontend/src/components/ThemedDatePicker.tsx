import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

const WEEKDAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function ThemedDatePicker({
  ariaLabel,
  className = "",
  onChange,
  placeholder = "Select date",
  value,
}: ThemedDatePickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const selected = parseDateValue(value);
  const fallbackDate = selected ?? datePartsFromDate(new Date());
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(fallbackDate.year);
  const [viewMonth, setViewMonth] = useState(fallbackDate.month);
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      const nextSelected = parseDateValue(value);
      if (nextSelected) {
        setViewYear(nextSelected.year);
        setViewMonth(nextSelected.month);
      }
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      return;
    }

    function syncPopoverPosition() {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }
      const rect = trigger.getBoundingClientRect();
      const margin = 12;
      const width = Math.min(320, window.innerWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.left),
        window.innerWidth - width - margin,
      );
      const top = Math.min(
        rect.bottom + 10,
        Math.max(margin, window.innerHeight - 360),
      );
      setPopoverPosition({
        left,
        maxHeight: Math.max(240, window.innerHeight - top - margin),
        top,
        width,
      });
    }

    syncPopoverPosition();
    window.addEventListener("resize", syncPopoverPosition);
    window.addEventListener("scroll", syncPopoverPosition, true);
    return () => {
      window.removeEventListener("resize", syncPopoverPosition);
      window.removeEventListener("scroll", syncPopoverPosition, true);
    };
  }, [open]);

  function openPicker() {
    const nextSelected = parseDateValue(value) ?? datePartsFromDate(new Date());
    setViewYear(nextSelected.year);
    setViewMonth(nextSelected.month);
    setOpen((current) => !current);
  }

  function moveMonth(delta: number) {
    const date = new Date(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(date.getFullYear());
    setViewMonth(date.getMonth() + 1);
  }

  function selectDay(day: number) {
    onChange(formatDateValue(viewYear, viewMonth, day));
    setOpen(false);
  }

  function clearDate() {
    onChange("");
    setOpen(false);
  }

  const cells = calendarCells(viewYear, viewMonth);
  const portalHost = currentPortalHost();

  return (
    <div className={`replay-date-picker ${className}`} ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className="replay-date-trigger w-full"
        onClick={openPicker}
        ref={triggerRef}
        type="button"
      >
        <CalendarDays size={15} />
        <span className={selected ? "" : "text-slate-500"}>
          {selected ? formatDateDisplay(selected) : placeholder}
        </span>
      </button>

      {open && popoverPosition && portalHost && createPortal(
        <div
          className="replay-date-popover replay-date-popover-floating"
          ref={popoverRef}
          role="dialog"
          style={{
            left: popoverPosition.left,
            maxHeight: popoverPosition.maxHeight,
            top: popoverPosition.top,
            width: popoverPosition.width,
          }}
        >
          <div className="replay-date-popover-header">
            <button
              aria-label="Previous month"
              className="replay-date-icon-button"
              onClick={() => moveMonth(-1)}
              type="button"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="min-w-0 text-center">
              <div className="text-sm font-semibold text-white">
                {MONTH_NAMES[viewMonth - 1]} {viewYear}
              </div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Date Filter
              </div>
            </div>
            <button
              aria-label="Next month"
              className="replay-date-icon-button"
              onClick={() => moveMonth(1)}
              type="button"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="replay-date-weekdays">
            {WEEKDAY_NAMES.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="replay-date-grid">
            {cells.map((cell) => {
              const isSelected =
                cell.day != null &&
                selected?.year === viewYear &&
                selected.month === viewMonth &&
                selected.day === cell.day;
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

          <div className="replay-date-actions">
            <button
              className="control-button h-9 px-3 text-xs"
              disabled={!value}
              onClick={clearDate}
              type="button"
            >
              <X size={14} />
              Clear
            </button>
          </div>
        </div>,
        portalHost,
      )}
    </div>
  );
}

function currentPortalHost() {
  return document.fullscreenElement ?? document.body;
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

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function formatDateValue(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatDateDisplay(parts: DateParts) {
  return `${MONTH_NAMES[parts.month - 1].slice(0, 3)} ${pad2(parts.day)} ${parts.year}`;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}
