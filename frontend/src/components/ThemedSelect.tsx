import { Check, ChevronDown } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export type ThemedSelectOption = {
  disabled?: boolean;
  label: ReactNode;
  sublabel?: ReactNode;
  value: string;
};

type Props = {
  align?: "left" | "right";
  ariaLabel?: string;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  menuClassName?: string;
  onChange?: (value: string) => void;
  options: ThemedSelectOption[];
  placeholder?: ReactNode;
  value?: string;
};

export function ThemedSelect({
  align = "left",
  ariaLabel,
  className = "h-10",
  defaultValue,
  disabled = false,
  menuClassName = "",
  onChange,
  options,
  placeholder = "Select",
  value,
}: Props) {
  const fallbackValue = useMemo(
    () => defaultValue ?? options.find((option) => !option.disabled)?.value ?? "",
    [defaultValue, options],
  );
  const [internalValue, setInternalValue] = useState(fallbackValue);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedValue = value ?? internalValue;
  const selectedOption = options.find((option) => option.value === selectedValue);

  useEffect(() => {
    if (value == null) {
      setInternalValue(fallbackValue);
    }
  }, [fallbackValue, value]);

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

  function choose(nextValue: string) {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!nextOption || nextOption.disabled) {
      return;
    }
    if (value == null) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
    setOpen(false);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const enabled = options.filter((option) => !option.disabled);
      if (enabled.length === 0) {
        return;
      }
      const currentIndex = enabled.findIndex((option) => option.value === selectedValue);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? 0
          : (currentIndex + direction + enabled.length) % enabled.length;
      choose(enabled[nextIndex].value);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    }
  }

  return (
    <div className={`themed-select ${open ? "themed-select-open" : ""} ${className}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="themed-select-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <span className={`themed-select-value ${selectedOption ? "" : "text-slate-500"}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown className={`themed-select-chevron ${open ? "rotate-180" : ""}`} size={15} />
      </button>

      {open && !disabled && (
        <div
          className={`themed-select-menu ${align === "right" ? "right-0" : "left-0"} ${menuClassName}`}
          role="listbox"
        >
          {options.map((option) => {
            const selected = option.value === selectedValue;
            return (
              <button
                aria-selected={selected}
                className={`themed-select-option ${selected ? "themed-select-option-active" : ""}`}
                disabled={option.disabled}
                key={option.value}
                onClick={() => choose(option.value)}
                role="option"
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.sublabel && (
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {option.sublabel}
                    </span>
                  )}
                </span>
                {selected && <Check className="shrink-0 text-cyan-100" size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
