import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";

type Props = {
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
  onChange: (value: string) => void;
  value: string;
};

const FALLBACK_COLOR = "#32D3EE";

export function ThemedColorPicker({
  ariaLabel = "Color",
  className = "",
  compact = false,
  onChange,
  value,
}: Props) {
  const normalizedValue = useMemo(
    () => normalizeHexColor(value) ?? FALLBACK_COLOR,
    [value],
  );
  const [draft, setDraft] = useState(normalizedValue);

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

  function applyColor(nextValue: string) {
    const normalized = normalizeHexColor(nextValue);
    if (!normalized) {
      return;
    }
    setDraft(normalized);
    onChange(normalized);
  }

  function handleDraftBlur() {
    const normalized = normalizeHexColor(draft);
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
      event.currentTarget.blur();
    }
  }

  return (
    <div
      className={`themed-color-picker ${compact ? "themed-color-picker-compact" : ""} ${className}`}
    >
      <label
        className="themed-color-swatch"
        style={{ "--selected-color": normalizedValue } as CSSProperties}
        title={ariaLabel}
      >
        <span style={{ backgroundColor: normalizedValue }} />
        <input
          aria-label={ariaLabel}
          onChange={(event) => applyColor(event.target.value)}
          type="color"
          value={normalizedValue}
        />
      </label>
      <input
        aria-label={`${ariaLabel} hex code`}
        className="themed-color-hex"
        onBlur={handleDraftBlur}
        onChange={(event) => {
          const nextValue = event.target.value.toUpperCase();
          setDraft(nextValue);
          const normalized = normalizeHexColor(nextValue);
          if (normalized) {
            onChange(normalized);
          }
        }}
        onKeyDown={handleDraftKeyDown}
        spellCheck={false}
        value={draft}
      />
    </div>
  );
}

function normalizeHexColor(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }
  const withoutHash = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[\da-f]{3}$/i.test(withoutHash)) {
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
