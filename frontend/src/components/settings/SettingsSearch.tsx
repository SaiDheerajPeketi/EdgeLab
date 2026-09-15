import { useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import {
  SETTINGS_CATEGORIES,
  searchSettings,
  type SettingsCategoryId,
  type SettingsControl,
} from "./settingsCatalog";
import { fieldClassName } from "./SettingsPrimitives";

export function SettingsSearch({
  onSelect,
}: {
  onSelect: (result: SettingsControl) => void;
}) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SettingsCategoryId | "all">("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(
    () => (query.trim() ? searchSettings(query, filter).slice(0, 8) : []),
    [filter, query],
  );
  const open = results.length > 0;

  function choose(result: SettingsControl) {
    onSelect(result);
    setQuery("");
    setActiveIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    if (!open) return;
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
    <div className="relative">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search settings — try ‘broker’, ‘risk’, or ‘backup’"
            aria-label="Search settings"
            aria-autocomplete="list"
            aria-controls={open ? listboxId : undefined}
            aria-expanded={open}
            aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
            role="combobox"
            className={`${fieldClassName} pl-9 pr-9`}
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear settings search" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <select aria-label="Filter settings search by category" value={filter} onChange={(event) => { setFilter(event.target.value as SettingsCategoryId | "all"); setActiveIndex(0); }} className={fieldClassName}>
          <option value="all">All categories</option>
          {SETTINGS_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select>
      </div>
      {query.trim() && !open ? <p className="absolute z-30 mt-2 w-full rounded-md border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-zinc-400 shadow-2xl" role="status">No supported setting matches “{query.trim()}”.</p> : null}
      {open ? (
        <ul id={listboxId} role="listbox" className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-md border border-white/10 bg-zinc-950 p-1.5 shadow-2xl">
          {results.map((result, index) => {
            const category = SETTINGS_CATEGORIES.find((item) => item.id === result.category);
            return (
              <li key={`${result.category}-${result.id}`} id={`${listboxId}-${index}`} role="option" aria-selected={index === activeIndex}>
                <button type="button" onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)} className={`w-full rounded px-3 py-2.5 text-left ${index === activeIndex ? "bg-white/10" : "hover:bg-white/5"}`}>
                  <span className="block text-sm font-medium text-zinc-100">{highlight(result.label, query)}</span>
                  <span className="mt-0.5 block text-xs text-zinc-500">{category?.label} · {result.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function highlight(label: string, query: string) {
  const term = query.trim().split(/\s+/).find((part) => label.toLowerCase().includes(part.toLowerCase()));
  if (!term) return label;
  const start = label.toLowerCase().indexOf(term.toLowerCase());
  return <>{label.slice(0, start)}<mark className="bg-cyan-300/20 text-cyan-100">{label.slice(start, start + term.length)}</mark>{label.slice(start + term.length)}</>;
}
