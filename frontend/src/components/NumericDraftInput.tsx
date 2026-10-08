import { useEffect, useId, useState } from "react";

type Props = {
  label: string;
  value: string | number | boolean | null;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  integer?: boolean;
  disabled?: boolean;
  resetKey?: string;
  className?: string;
  compact?: boolean;
};

/** Keep unfinished edits local; only valid values update the chart. */
export function NumericDraftInput({ label, value, onChange, min, max, step = "any", integer = false,
  disabled = false, resetKey, compact = false, className = "input-control h-9 min-w-0 text-xs" }: Props) {
  const applied = value === null ? "" : String(value);
  const [draft, setDraft] = useState(applied);
  const errorId = useId();
  useEffect(() => { setDraft(applied); }, [applied, disabled, resetKey, min, max, step, integer]);
  function errorFor(raw: string) {
    if (!raw.trim() || !Number.isFinite(Number(raw))) return "Enter a number.";
    const parsed = Number(raw);
    if (integer && !Number.isSafeInteger(parsed)) return "Enter a whole number.";
    if (min !== undefined && parsed < min) return `Enter ${min} or higher.`;
    if (max !== undefined && parsed > max) return `Enter ${max} or lower.`;
    return null;
  }
  const error = errorFor(draft);
  return <span className="grid min-w-0 gap-1.5">
    <input data-number-draft aria-label={label} aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)}
      title={compact && error ? `${error} The chart keeps its last applied value.` : undefined}
      className={className} disabled={disabled} min={min} max={max} step={step} type="number" value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (!disabled && !errorFor(next)) onChange(Number(next));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
        if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); setDraft(applied);
        }
      }} />
    {error ? <span id={errorId} role="alert" className={`break-words text-[11px] leading-4 text-[var(--loss-text)] ${compact ? "normal-case tracking-normal" : ""}`}>{error} The chart keeps its last applied value.</span> : null}
  </span>;
}
