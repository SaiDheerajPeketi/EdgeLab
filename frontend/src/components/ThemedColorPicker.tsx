import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

type Props = {
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  value: string;
};

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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setDraft(normalizedValue);
    }
  }, [isEditing, normalizedValue]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setIsEditing(false);
      setDraft(normalizedValue);
    }
  }, [disabled, normalizedValue]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
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
    setIsEditing(false);
    onChange(normalized);
  }

  function handleDraftBlur() {
    const normalized = normalizeHexColor(draft);
    setIsEditing(false);
    if (normalized) {
      applyColor(normalized);
      return;
    }
    setDraft(normalizedValue);
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraft(normalizedValue);
      setIsEditing(false);
      event.currentTarget.blur();
    }
  }

  function handleDraftChange(nextRawValue: string) {
    if (disabled) {
      return;
    }
    const nextValue = sanitizeHexDraft(nextRawValue);
    setDraft(nextValue);
    const normalized = normalizeHexColor(nextValue, { allowShorthand: false });
    if (normalized) {
      onChange(normalized);
    }
  }

  return (
    <div
      aria-disabled={disabled}
      className={`themed-color-picker ${compact ? "themed-color-picker-compact" : ""} ${disabled ? "themed-color-picker-disabled" : ""} ${className}`}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-label={`${ariaLabel} palette`}
        className="themed-color-swatch"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        style={{ "--selected-color": normalizedValue } as CSSProperties}
        title={ariaLabel}
        type="button"
      >
        <span style={{ backgroundColor: normalizedValue }} />
      </button>
      <input
        aria-label={`${ariaLabel} hex code`}
        className="themed-color-hex"
        disabled={disabled}
        onBlur={handleDraftBlur}
        onChange={(event) => handleDraftChange(event.target.value)}
        onFocus={() => setIsEditing(true)}
        onKeyDown={handleDraftKeyDown}
        spellCheck={false}
        value={draft}
      />

      {open && (
        <div
          aria-label={`${ariaLabel} color palette`}
          className="themed-color-popover"
          role="dialog"
        >
          <div className="themed-color-popover-header">
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
            <span>Hex</span>
            <input
              aria-label={`${ariaLabel} selected color hex code`}
              onBlur={handleDraftBlur}
              onChange={(event) => handleDraftChange(event.target.value)}
              onFocus={() => setIsEditing(true)}
              onKeyDown={handleDraftKeyDown}
              spellCheck={false}
              value={draft}
            />
          </label>
          {COLOR_PALETTES.map((palette) => (
            <div className="themed-color-group" key={palette.label}>
              <div className="themed-color-section-title">{palette.label}</div>
              <div className="themed-color-grid">
                {palette.swatches.map((color) => (
                  <button
                    aria-current={normalizedValue === color ? "true" : undefined}
                    aria-label={`Use ${color}`}
                    className={`themed-color-option ${normalizedValue === color ? "themed-color-option-active" : ""}`}
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
        </div>
      )}
    </div>
  );
}

function sanitizeHexDraft(value: string) {
  const trimmed = value.trim().toUpperCase();
  const hasHash = trimmed.startsWith("#");
  const hex = trimmed.replace(/#/g, "").replace(/[^\dA-F]/g, "").slice(0, 6);
  return `${hasHash ? "#" : ""}${hex}`;
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
