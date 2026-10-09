import { useId, useLayoutEffect, useState } from "react";
import { formatPineUtcTime, parsePineUtcTime } from "../lib/pineInteractiveInputs";
import type { PineScalar } from "../lib/pineProtocol";

type Props = {
  label: string; value: PineScalar; onChange: (value: number) => void;
  disabled?: boolean; resetKey?: string; min?: number; max?: number;
  className?: string;
};

/** Edits use explicit UTC fields; incomplete dates never change the applied timestamp. */
export function PineDateTimeInput({ label, value, onChange, disabled = false, resetKey, min, max,
  className = "input-control min-h-11 w-full min-w-0 text-xs" }: Props) {
  const applied = formatPineUtcTime(value);
  const [draft, setDraft] = useState(applied);
  const hintId = useId(), errorId = useId();
  useLayoutEffect(() => { setDraft(applied); }, [applied, disabled, resetKey, min, max]);
  const parsed = parsePineUtcTime(draft);
  const error = parsed === undefined ? "Enter a complete UTC date and time."
    : min !== undefined && parsed < min ? `Choose ${formatPineUtcTime(min) || min} UTC or later.`
    : max !== undefined && parsed > max ? `Choose ${formatPineUtcTime(max) || max} UTC or earlier.` : null;
  const commit = () => {
    if (disabled || error || parsed === undefined) return;
    if (parsed !== value) onChange(parsed);
    setDraft(formatPineUtcTime(parsed));
  };
  return <span className="grid min-w-0 gap-1.5">
    <input aria-label={label} aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`} aria-invalid={Boolean(error)}
      className={className} disabled={disabled} type="datetime-local" step="0.001" value={draft}
      min={min === undefined ? undefined : formatPineUtcTime(min)} max={max === undefined ? undefined : formatPineUtcTime(max)}
      onChange={event => { if (!disabled) setDraft(event.target.value); }} onBlur={commit}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(applied); }
      }} />
    <span id={hintId} className="text-[11px] leading-4 text-[var(--text-muted)]">UTC · date and time, including milliseconds</span>
    {error ? <span id={errorId} role="alert" className="break-words text-[11px] leading-4 text-[var(--loss-text)]">{error} The chart keeps its last applied value.</span> : null}
  </span>;
}
