import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { OverlaySurface } from "./overlays/OverlaySurface";

type Props = {
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  value: string;
};

type ColorChannel = "blue" | "green" | "red";

const FALLBACK_COLOR = "#32D3EE";
const COLOR_PALETTES = [
  {
    label: "Chart",
    swatches: ["#32D3EE", "#38BDF8", "#60A5FA", "#A78BFA"],
  },
  {
    label: "Signal",
    swatches: ["#22C55E", "#84CC16", "#FBBF24", "#F97316"],
  },
  {
    label: "Risk",
    swatches: ["#FB7185", "#EF4444", "#F472B6", "#C084FC"],
  },
  {
    label: "Neutral",
    swatches: ["#F8FAFC", "#CBD5E1", "#94A3B8", "#64748B"],
  },
];

const CHANNELS: Array<{ key: ColorChannel; label: string }> = [
  { key: "red", label: "Red" },
  { key: "green", label: "Green" },
  { key: "blue", label: "Blue" },
];

export function ThemedColorPicker({
  ariaLabel = "Color",
  className = "",
  compact = false,
  disabled = false,
  onChange,
  value,
}: Props) {
  const normalizedValue = useMemo(
    () => normalizeHexColor(value) ?? FALLBACK_COLOR,
    [value],
  );
  const [draft, setDraft] = useState(normalizedValue);
  const [isEditing, setIsEditing] = useState(false);
  const [hexError, setHexError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const swatchRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverHexRef = useRef<HTMLInputElement | null>(null);
  const pickerId = useId();
  const titleId = `${pickerId}-title`;
  const errorId = `${pickerId}-error`;
  const rgb = hexToRgb(normalizedValue);

  useEffect(() => {
    if (!isEditing) {
      setDraft(normalizedValue);
      setHexError(null);
    }
    // A new committed value is the only external event that should clear an
    // invalid draft; blur alone leaves the recovery message visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedValue]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setIsEditing(false);
      setDraft(normalizedValue);
      setHexError(null);
    }
  }, [disabled, normalizedValue]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      popoverHexRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function applyColor(nextValue: string) {
    if (disabled) {
      return;
    }
    const normalized = normalizeHexColor(nextValue);
    if (!normalized) {
      return;
    }
    setDraft(normalized);
    setHexError(null);
    setIsEditing(false);
    onChange(normalized);
  }

  function validateDraft(nextDraft: string) {
    const normalized = normalizeHexColor(nextDraft);
    if (!normalized) {
      setHexError("Enter a 3- or 6-digit hex color, such as #32D3EE.");
      return null;
    }
    setHexError(null);
    return normalized;
  }

  function handleDraftBlur() {
    setIsEditing(false);
    const normalized = validateDraft(draft);
    if (normalized) {
      applyColor(normalized);
    }
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const normalized = validateDraft(draft);
      if (normalized) {
        applyColor(normalized);
      }
    }
    if (event.key === "Escape") {
      setDraft(normalizedValue);
      setHexError(null);
      setIsEditing(false);
    }
  }

  function handleDraftChange(nextRawValue: string) {
    if (disabled) {
      return;
    }
    const nextValue = nextRawValue.toUpperCase();
    setDraft(nextValue);
    const normalized = normalizeHexColor(nextValue, { allowShorthand: false });
    if (normalized) {
      setHexError(null);
      onChange(normalized);
    } else {
      setHexError("Enter a 3- or 6-digit hex color, such as #32D3EE.");
    }
  }

  function updateChannel(channel: ColorChannel, nextValue: number) {
    applyColor(
      rgbToHex({
        ...rgb,
        [channel]: nextValue,
      }),
    );
  }

  return (
    <div
      aria-disabled={disabled}
      className={`themed-color-picker ${compact ? "themed-color-picker-compact" : ""} ${disabled ? "themed-color-picker-disabled" : ""} ${className}`}
      ref={rootRef}
    >
      <button
        aria-controls={pickerId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${ariaLabel} palette`}
        className="themed-color-swatch touch-manipulation motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={swatchRef}
        style={{ "--selected-color": normalizedValue } as CSSProperties}
        title={ariaLabel}
        type="button"
      >
        <span style={{ backgroundColor: normalizedValue }} />
      </button>
      <input
        aria-describedby={hexError ? errorId : undefined}
        aria-invalid={Boolean(hexError)}
        aria-label={`${ariaLabel} hex code`}
        className="themed-color-hex motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11"
        disabled={disabled}
        maxLength={7}
        onBlur={handleDraftBlur}
        onChange={(event) => handleDraftChange(event.target.value)}
        onFocus={() => setIsEditing(true)}
        onKeyDown={handleDraftKeyDown}
        spellCheck={false}
        value={draft}
      />

      {!open && hexError && (
        <span
          className="absolute left-0 top-full z-[300] mt-1 w-64 rounded border border-rose-400/30 bg-[#16090d] px-2 py-1.5 text-[11px] leading-4 text-rose-200 shadow-panel"
          id={errorId}
          role="alert"
        >
          {hexError}
        </span>
      )}

      <OverlaySurface
        anchorRef={rootRef}
        ariaLabelledBy={titleId}
        className="themed-color-popover"
        estimatedHeight={540}
        id={pickerId}
        onDismiss={() => setOpen(false)}
        open={open && !disabled}
        preferredWidth={288}
        role="dialog"
        surfaceRef={popoverRef}
        triggerRef={swatchRef}
      >
        <div className="themed-color-popover-header" id={titleId}>
          <span>{ariaLabel}</span>
          <code>{normalizedValue}</code>
        </div>
        <div
          className="themed-color-preview"
          style={{ "--selected-color": normalizedValue } as CSSProperties}
        >
          <span className="themed-color-preview-swatch" />
          <div>
            <span>Selected</span>
            <strong>{normalizedValue}</strong>
          </div>
        </div>
        <label className="themed-color-popover-field">
          <span>Hex value</span>
          <input
            aria-describedby={hexError ? errorId : undefined}
            aria-invalid={Boolean(hexError)}
            aria-label={`${ariaLabel} selected color hex code`}
            maxLength={7}
            onBlur={handleDraftBlur}
            onChange={(event) => handleDraftChange(event.target.value)}
            onFocus={() => setIsEditing(true)}
            onKeyDown={handleDraftKeyDown}
            ref={popoverHexRef}
            spellCheck={false}
            value={draft}
          />
          {hexError && (
            <span className="normal-case tracking-normal text-rose-200" id={errorId} role="alert">
              {hexError}
            </span>
          )}
        </label>

        <div aria-label="RGB channels" className="grid gap-1.5 rounded border border-white/[0.07] bg-black/25 p-2" role="group">
          {CHANNELS.map((channel) => {
            const inputId = `${pickerId}-${channel.key}`;
            return (
              <label className="grid grid-cols-[3rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-[10px] font-bold text-slate-300" htmlFor={inputId} key={channel.key}>
                <span>{channel.label}</span>
                <input
                  aria-valuetext={`${rgb[channel.key]} of 255`}
                  className="h-11 w-full cursor-pointer touch-manipulation accent-cyan-300"
                  id={inputId}
                  max={255}
                  min={0}
                  onChange={(event) => updateChannel(channel.key, Number(event.target.value))}
                  type="range"
                  value={rgb[channel.key]}
                />
                <output className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-right font-mono tabular-nums text-cyan-100" htmlFor={inputId}>
                  {rgb[channel.key]}
                </output>
              </label>
            );
          })}
        </div>

        {COLOR_PALETTES.map((palette) => (
          <div className="themed-color-group" key={palette.label}>
            <div className="themed-color-section-title">{palette.label}</div>
            <div className="themed-color-grid">
              {palette.swatches.map((color) => (
                <button
                  aria-current={normalizedValue === color ? "true" : undefined}
                  aria-label={`Use ${color}`}
                  className={`themed-color-option min-h-11 touch-manipulation motion-reduce:transition-none ${normalizedValue === color ? "themed-color-option-active" : ""}`}
                  key={color}
                  onClick={() => {
                    applyColor(color);
                    setOpen(false);
                  }}
                  style={{ "--swatch-color": color } as CSSProperties}
                  type="button"
                >
                  <span />
                  <i aria-hidden="true" className="themed-color-option-check" />
                </button>
              ))}
            </div>
          </div>
        ))}
      </OverlaySurface>
    </div>
  );
}

function normalizeHexColor(
  value: string | undefined,
  options: { allowShorthand?: boolean } = {},
) {
  const { allowShorthand = true } = options;
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;
  if (allowShorthand && /^[\da-f]{3}$/i.test(withoutHash)) {
    return `#${withoutHash
      .split("")
      .map((char) => char + char)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[\da-f]{6}$/i.test(withoutHash)) {
    return `#${withoutHash.toUpperCase()}`;
  }
  return null;
}

function hexToRgb(value: string) {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  };
}

function rgbToHex({ blue, green, red }: Record<ColorChannel, number>) {
  return `#${[red, green, blue]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}
