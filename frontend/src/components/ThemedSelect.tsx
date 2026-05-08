import { Check, ChevronDown } from "lucide-react";
import type {
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  onOpenChange?: (open: boolean) => void;
  options: ThemedSelectOption[];
  placeholder?: ReactNode;
  portal?: boolean;
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
  onOpenChange,
  options,
  placeholder = "Select",
  portal = false,
  value,
}: Props) {
  const fallbackValue = useMemo(
    () => defaultValue ?? options.find((option) => !option.disabled)?.value ?? "",
    [defaultValue, options],
  );
  const [internalValue, setInternalValue] = useState(fallbackValue);
  const [open, setOpen] = useState(false);
  const [floatingPosition, setFloatingPosition] = useState<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedValue = value ?? internalValue;
  const selectedOption = options.find((option) => option.value === selectedValue);
  const portalHost = portal ? currentPortalHost() : null;

  useEffect(() => {
    if (value == null) {
      setInternalValue(fallbackValue);
    }
  }, [fallbackValue, value]);

  useEffect(() => {
    onOpenChange?.(open);
    return () => {
      if (open) {
        onOpenChange?.(false);
      }
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
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

  useLayoutEffect(() => {
    if (!open || !portal || !rootRef.current) {
      return;
    }

    function syncFloatingPosition() {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const rect = root.getBoundingClientRect();
      const margin = 12;
      const width = Math.max(rect.width, 180);
      const left = Math.min(
        Math.max(margin, rect.left),
        window.innerWidth - width - margin,
      );
      const top = Math.min(
        rect.bottom + 8,
        Math.max(margin, window.innerHeight - 300),
      );
      setFloatingPosition({
        left,
        maxHeight: Math.max(160, window.innerHeight - top - margin),
        top,
        width,
      });
    }

    syncFloatingPosition();
    window.addEventListener("resize", syncFloatingPosition);
    window.addEventListener("scroll", syncFloatingPosition, true);
    return () => {
      window.removeEventListener("resize", syncFloatingPosition);
      window.removeEventListener("scroll", syncFloatingPosition, true);
    };
  }, [open, portal]);

  function choose(nextValue: string) {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!nextOption || nextOption.disabled) {
      return;
    }
    if (value == null) {
      setInternalValue(nextValue);
    }
    setOpen(false);
    onChange?.(nextValue);
  }

  function handleOptionClick(
    event: MouseEvent<HTMLButtonElement>,
    nextValue: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    choose(nextValue);
  }

  function handleTriggerPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    setOpen((current) => !current);
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

  const menu = open && !disabled ? (
    <div
      className={`themed-select-menu ${portal ? "themed-select-menu-floating" : align === "right" ? "right-0" : "left-0"} ${menuClassName}`}
      ref={menuRef}
      role="listbox"
      style={
        portal && floatingPosition
          ? {
              left: floatingPosition.left,
              maxHeight: floatingPosition.maxHeight,
              top: floatingPosition.top,
              width: floatingPosition.width,
            }
          : undefined
      }
    >
      {options.map((option) => {
        const selected = option.value === selectedValue;
        return (
          <button
            aria-selected={selected}
            className={`themed-select-option ${selected ? "themed-select-option-active" : ""}`}
            disabled={option.disabled}
            key={option.value}
            onClick={(event) => handleOptionClick(event, option.value)}
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
  ) : null;

  return (
    <div className={`themed-select ${open ? "themed-select-open" : ""} ${className}`} ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="themed-select-trigger"
        disabled={disabled}
        onKeyDown={handleTriggerKeyDown}
        onPointerDown={handleTriggerPointerDown}
        type="button"
      >
        <span className={`themed-select-value ${selectedOption ? "" : "text-slate-500"}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown className={`themed-select-chevron ${open ? "rotate-180" : ""}`} size={15} />
      </button>

      {portal ? floatingPosition && menu && portalHost && createPortal(menu, portalHost) : menu}
    </div>
  );
}

function currentPortalHost() {
  return document.fullscreenElement ?? document.body;
}
