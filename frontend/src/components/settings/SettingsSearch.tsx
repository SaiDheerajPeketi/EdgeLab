import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import {
  SETTINGS_CATEGORIES,
  searchSettings,
  type SettingsCategoryId,
  type SettingsControl,
} from "./settingsCatalog";
import { OverlaySurface } from "../overlays/OverlaySurface";
import { ThemedSelect } from "../ThemedSelect";
import { fieldClassName } from "./SettingsPrimitives";

export function SettingsSearch({
  onSelect,
}: {
  onSelect: (result: SettingsControl) => void;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SettingsCategoryId | "all">("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(
    () => (query.trim() ? searchSettings(query, filter).slice(0, 8) : []),
    [filter, query],
  );
  const open = expanded && results.length > 0;
  useEffect(() => {
    if (!open) return;
    surfaceRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${listboxId}-${activeIndex}`)}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listboxId, open]);

  function choose(result: SettingsControl) {
    setExpanded(false);
    onSelect(result);
    setQuery("");
    setActiveIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
      setActiveIndex(0);
      return;
    }
    if (!open) {
      if (results.length && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setExpanded(true); setActiveIndex(event.key === "ArrowUp" ? results.length - 1 : 0); }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + results.length) % results.length;
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[Math.min(activeIndex, results.length - 1)]);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setExpanded(true); setActiveIndex(0); }}
            onFocus={() => setExpanded(true)}
            onKeyDown={onKeyDown}
            placeholder="Search settings — try ‘broker’, ‘risk’, or ‘backup’"
            aria-label="Search settings"
            aria-autocomplete="list"
            aria-controls={open ? listboxId : undefined}
            aria-expanded={open}
            aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
            role="combobox"
            className={`${fieldClassName} settings-search-input ps-9 pe-9`}
          />
          {query ? (
            <button type="button" onClick={() => { setQuery(""); setExpanded(false); setActiveIndex(0); inputRef.current?.focus({ preventScroll: true }); }} aria-label="Clear settings search" className="absolute end-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]">
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <ThemedSelect ariaLabel="Filter settings search by category" value={filter}
          onChange={(value) => { setFilter(value as SettingsCategoryId | "all"); setActiveIndex(0); setExpanded(true); inputRef.current?.focus({ preventScroll: true }); }}
          onOpenChange={(next) => { if (next) setExpanded(false); }}
          className="h-11 min-w-0" portal
          options={[{ value: "all", label: "All categories" }, ...SETTINGS_CATEGORIES.map((category) => ({ value: category.id, label: category.label }))]} />
      </div>
      <OverlaySurface anchorRef={rootRef} triggerRef={inputRef} surfaceRef={surfaceRef}
        open={Boolean(expanded && query.trim())} onDismiss={() => setExpanded(false)}
        id={listboxId} role={open ? "listbox" : "status"} ariaLabel={open ? "Settings search results" : undefined}
        estimatedHeight={320} className="z-[var(--layer-popover)] rounded-md bg-[var(--ui-floating)] p-1.5 text-[var(--text-primary)] shadow-[var(--elevation-floating)]">
        {!results.length ? <p className="ui-resilient-text px-3 py-2.5 text-sm text-[var(--text-secondary)]">No supported setting matches “{query.trim()}”.</p> : results.map((result, index) => {
          const category = SETTINGS_CATEGORIES.find((item) => item.id === result.category);
          return <button key={`${result.category}-${result.id}`} id={`${listboxId}-${index}`} type="button"
            role="option" aria-selected={index === activeIndex} tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)}
            className={`w-full rounded px-3 py-2.5 text-start ${index === activeIndex ? "bg-[var(--ui-selection)]" : "hover:bg-[var(--ui-hover)]"}`}>
            <span className="ui-resilient-text block text-sm font-medium text-[var(--text-primary)]" dir="auto">{highlight(result.label, query)}</span>
            <span className="ui-resilient-text mt-0.5 block text-xs text-[var(--text-secondary)]" dir="auto">{category?.label} · {result.description}</span>
          </button>;
        })}
      </OverlaySurface>
    </div>
  );
}

function highlight(label: string, query: string) {
  const term = query.trim().split(/\s+/).find((part) => label.toLowerCase().includes(part.toLowerCase()));
  if (!term) return label;
  const start = label.toLowerCase().indexOf(term.toLowerCase());
  return <>{label.slice(0, start)}<mark className="bg-[var(--ui-selection)] text-[var(--text-primary)]">{label.slice(start, start + term.length)}</mark>{label.slice(start + term.length)}</>;
}
