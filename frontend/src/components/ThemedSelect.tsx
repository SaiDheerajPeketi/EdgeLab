import { Check, ChevronDown } from "lucide-react";
import type {
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { OverlaySurface } from "./overlays/OverlaySurface";

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

const TYPEAHEAD_RESET_MS = 700;

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
  const [activeIndex, setActiveIndex] = useState(-1);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const typeaheadRef = useRef({ query: "", timestamp: 0 });
  const listboxId = useId();
  const optionIdPrefix = `${listboxId}-option`;
  const selectedValue = value ?? internalValue;
  const selectedOption = options.find((option) => option.value === selectedValue);

  useEffect(() => {
    if (value == null) {
      setInternalValue(fallbackValue);
    }
  }, [fallbackValue, value]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedIndex = options.findIndex(
      (option) => !option.disabled && option.value === selectedValue,
    );
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options));
  }, [open, options, selectedValue]);

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(`${optionIdPrefix}-${activeIndex}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, optionIdPrefix]);

  function setOpenState(nextOpen: boolean) {
    if (disabled && nextOpen) {
      return;
    }
    setOpen(nextOpen);
  }

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

  function handleTriggerClick(event: MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    setOpen((current) => !current);
  }

  function handleTriggerBlur(event: FocusEvent<HTMLButtonElement>) {
    const nextTarget = event.relatedTarget;
    if (
      open &&
      !(nextTarget instanceof Node &&
        (rootRef.current?.contains(nextTarget) || menuRef.current?.contains(nextTarget)))
    ) {
      setOpen(false);
    }
  }

  function moveActive(direction: 1 | -1) {
    setActiveIndex((current) => nextEnabledIndex(options, current, direction));
  }

  function handleTypeahead(key: string) {
    const now = Date.now();
    const previous = typeaheadRef.current;
    const query =
      now - previous.timestamp > TYPEAHEAD_RESET_MS
        ? key.toLocaleLowerCase()
        : `${previous.query}${key.toLocaleLowerCase()}`;
    typeaheadRef.current = { query, timestamp: now };

    const startIndex = activeIndex >= 0 ? activeIndex + 1 : 0;
    const match = findTypeaheadMatch(options, query, startIndex);
    if (match >= 0) {
      setOpen(true);
      setActiveIndex(match);
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        const selectedIndex = options.findIndex(
          (option) => !option.disabled && option.value === selectedValue,
        );
        setActiveIndex(
          selectedIndex >= 0
            ? selectedIndex
            : event.key === "ArrowDown"
              ? firstEnabledIndex(options)
              : lastEnabledIndex(options),
        );
      } else {
        moveActive(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex(options));
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(lastEnabledIndex(options));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && activeIndex >= 0) {
        choose(options[activeIndex].value);
      } else {
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab" && open) {
      setOpen(false);
      return;
    }
    if (
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      handleTypeahead(event.key);
    }
  }

  const activeOptionId =
    open && activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined;

  return (
    <div
      className={`themed-select ${open ? "themed-select-open" : ""} ${className}`}
      ref={rootRef}
    >
      <button
        aria-activedescendant={activeOptionId}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className="themed-select-trigger touch-manipulation motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11"
        disabled={disabled}
        onBlur={handleTriggerBlur}
        onKeyDown={handleTriggerKeyDown}
        onClick={handleTriggerClick}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span className={`themed-select-value ${selectedOption ? "" : "text-slate-500"}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`themed-select-chevron motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          size={15}
        />
      </button>

      <OverlaySurface
        align={align}
        anchorRef={triggerRef}
        ariaLabel={ariaLabel}
        className={`themed-select-menu ${portal ? "themed-select-menu-floating" : align === "right" ? "right-0" : "left-0"} ${menuClassName}`}
        estimatedHeight={288}
        id={listboxId}
        minWidth={180}
        onDismiss={() => setOpenState(false)}
        open={open && !disabled}
        portal={portal}
        role="listbox"
        surfaceRef={menuRef}
      >
        {options.map((option, index) => {
          const selected = option.value === selectedValue;
          const active = index === activeIndex;
          return (
            <button
              aria-disabled={option.disabled || undefined}
              aria-selected={selected}
              className={`themed-select-option touch-manipulation motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 ${selected || active ? "themed-select-option-active" : ""}`}
              disabled={option.disabled}
              id={`${optionIdPrefix}-${index}`}
              key={option.value}
              onClick={(event) => handleOptionClick(event, option.value)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => !option.disabled && setActiveIndex(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.sublabel && (
                  <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                    {option.sublabel}
                  </span>
                )}
              </span>
              {selected && <Check aria-hidden="true" className="shrink-0 text-cyan-100" size={14} />}
            </button>
          );
        })}
      </OverlaySurface>
    </div>
  );
}

function firstEnabledIndex(options: ThemedSelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

function lastEnabledIndex(options: ThemedSelectOption[]) {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index].disabled) {
      return index;
    }
  }
  return -1;
}

function nextEnabledIndex(
  options: ThemedSelectOption[],
  current: number,
  direction: 1 | -1,
) {
  if (options.length === 0) {
    return -1;
  }
  let index = current;
  for (let attempts = 0; attempts < options.length; attempts += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index].disabled) {
      return index;
    }
  }
  return -1;
}

function findTypeaheadMatch(
  options: ThemedSelectOption[],
  query: string,
  startIndex: number,
) {
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (startIndex + offset) % options.length;
    const option = options[index];
    if (
      !option.disabled &&
      optionText(option.label).toLocaleLowerCase().startsWith(query)
    ) {
      return index;
    }
  }
  return -1;
}

function optionText(label: ReactNode) {
  return typeof label === "string" || typeof label === "number" ? String(label) : "";
}
