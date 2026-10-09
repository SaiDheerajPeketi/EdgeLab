import { Code2, Layers, Plus, Search, Star, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import type { ChartIndicatorInstance, ChartIndicatorKind } from "../lib/charting";
import {
  filterIndicatorCatalog,
  getAvailableIndicatorCategories,
  isSingleInstanceIndicator,
  type IndicatorCatalogFilter,
  type IndicatorCatalogItem,
} from "../lib/indicatorCatalog";
import {
  favoriteIndicatorScriptId,
  MAX_INDICATOR_FAVORITES,
  scriptIndicatorFavorite,
  type FavoriteIndicator,
} from "../lib/indicatorFavorites";
import { isPineScriptSource, type CustomIndicatorScript } from "../lib/customIndicators";
import { OverlaySurface } from "./overlays/OverlaySurface";

type Props = {
  anchorRef: RefObject<HTMLElement>;
  id?: string;
  favorites: readonly FavoriteIndicator[];
  indicatorInstances: ChartIndicatorInstance[];
  customScripts?: readonly CustomIndicatorScript[];
  customAddPendingId?: string;
  customAddMessage?: string;
  onAddIndicator: (kind: ChartIndicatorKind) => void;
  onAddCustomIndicator?: (script: CustomIndicatorScript) => void;
  onClose: (restoreFocus: boolean) => void;
  onEditCustomIndicator?: (script: CustomIndicatorScript) => void;
  onToggleFavorite: (favorite: FavoriteIndicator) => void;
};

export function IndicatorCatalogPanel({
  anchorRef,
  id,
  favorites,
  indicatorInstances,
  customScripts = [],
  customAddPendingId,
  customAddMessage,
  onAddIndicator,
  onAddCustomIndicator,
  onClose,
  onEditCustomIndicator,
  onToggleFavorite,
}: Props) {
  const [activeCategory, setActiveCategory] =
    useState<IndicatorCatalogFilter>("all");
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const helpId = useId();
  const resultsId = useId();
  const supportedCategories = useMemo(
    () => getAvailableIndicatorCategories(favorites),
    [favorites],
  );
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const visibleIndicators = useMemo(
    () =>
      filterIndicatorCatalog({
        category: activeCategory,
        favorites,
        query,
      }),
    [activeCategory, favorites, query],
  );
  const visibleScripts = useMemo(() => {
    const terms = normalizeSearch(query).split(" ").filter(Boolean);
    return customScripts.filter((script) => {
      if (activeCategory !== "all" && activeCategory !== "favorites" && script.category !== activeCategory) return false;
      if (activeCategory === "favorites" && !favoriteSet.has(scriptIndicatorFavorite(script.id))) return false;
      const searchable = normalizeSearch([script.name, script.description, script.category, script.origin, ...script.synonyms].join(" "));
      return terms.every((term) => searchable.includes(term));
    });
  }, [activeCategory, customScripts, favoriteSet, query]);
  const unavailableFavorites = useMemo(() => {
    if (activeCategory !== "favorites") return [];
    const terms = normalizeSearch(query).split(" ").filter(Boolean);
    return favorites.filter((favorite) => {
      const scriptId = favoriteIndicatorScriptId(favorite);
      return scriptId != null && !customScripts.some((script) => script.id === scriptId) &&
        terms.every((term) => "unavailable script".includes(term));
    });
  }, [activeCategory, customScripts, favorites, query]);
  const emptyState = useMemo(() => {
    if (query.trim()) {
      return {
        description: "Try a broader term such as trend, volatility, or moving average.",
        title: "No indicators match this search",
      };
    }
    if (activeCategory === "favorites") {
      return {
        description: "Star a study from All to keep it in your quick-add strip.",
        title: "No favorite indicators yet",
      };
    }
    if (activeCategory === "order-flow") {
      return {
        description: "Order-flow studies will appear here when a compatible trade-level feed is connected.",
        title: "Order-flow studies need trade-level data",
      };
    }
    if (activeCategory === "custom") {
      return {
        description: "Create or save an EdgeLab DSL script in the indicator editor.",
        title: "No custom indicators yet",
      };
    }
    return {
      description: "Choose All to browse every supported study.",
      title: "No indicators in this category",
    };
  }, [activeCategory, query]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (
      activeCategory !== "all" &&
      !supportedCategories.some((category) => category.id === activeCategory)
    ) {
      setActiveCategory("all");
    }
  }, [activeCategory, supportedCategories]);

  function activeCount(kind: ChartIndicatorKind) {
    return indicatorInstances.filter((indicator) => indicator.kind === kind).length;
  }

  function isDisabled(kind: ChartIndicatorKind) {
    return isSingleInstanceIndicator(kind) && activeCount(kind) > 0;
  }

  function addIndicator(indicator: IndicatorCatalogItem) {
    if (isDisabled(indicator.kind)) {
      return;
    }
    const nextCount = activeCount(indicator.kind) + 1;
    onAddIndicator(indicator.kind);
    setAnnouncement(
      `${indicator.label} added. ${nextCount} ${nextCount === 1 ? "instance" : "instances"} active.`,
    );
  }

  function resultButtons() {
    return Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-indicator-catalog-add]:not(:disabled)",
      ) ?? [],
    );
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      resultButtons()[0]?.focus();
      return;
    }
    if (event.key === "Enter") {
      const firstAvailable = visibleIndicators.find(
        (indicator) => !isDisabled(indicator.kind),
      );
      if (firstAvailable) {
        event.preventDefault();
        addIndicator(firstAvailable);
      } else if (visibleScripts[0] && onAddCustomIndicator) {
        event.preventDefault();
        onAddCustomIndicator(visibleScripts[0]);
      }
    }
  }

  function handleResultKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const buttons = resultButtons();
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex < 0) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = Math.min(currentIndex + 1, buttons.length - 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      if (currentIndex === 0) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      nextIndex = currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    }
    if (nextIndex == null) {
      return;
    }
    event.preventDefault();
    buttons[nextIndex]?.focus();
  }

  function handleCategoryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-indicator-catalog-category]",
      ) ?? [],
    );
    const currentIndex = buttons.indexOf(event.currentTarget);
    if (currentIndex < 0) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = buttons.length - 1;
    }
    if (nextIndex == null) {
      return;
    }
    event.preventDefault();
    const nextButton = buttons[nextIndex];
    const nextCategory = nextButton?.dataset.indicatorCatalogCategory;
    if (nextCategory) {
      setActiveCategory(nextCategory as IndicatorCatalogFilter);
      nextButton.focus();
    }
  }

  return (
    <OverlaySurface
      align="right"
      anchorRef={anchorRef}
      ariaDescribedBy={helpId}
      ariaLabelledBy={titleId}
      className="indicator-catalog-panel z-[var(--layer-popover)] flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--ui-border-subtle)] bg-[var(--ui-floating)] shadow-[var(--elevation-modal)]"
      estimatedHeight={680}
      id={id}
      minWidth={320}
      mobileSheet
      onDismiss={(reason) => onClose(reason === "escape")}
      onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}
      open
      preferredWidth={760}
      role="dialog"
      surfaceRef={rootRef}
      triggerRef={anchorRef}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--ui-border-subtle)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]" id={titleId}>
            Indicator library
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">
            Search, preview, and add supported studies to this chart.
          </p>
        </div>
        <button
          aria-label="Close indicator library"
          className="grid h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] outline-none transition hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"
          onClick={() => onClose(true)}
          type="button"
        >
          <X size={16} />
        </button>
      </div>

      <div className="grid gap-2 border-b border-[var(--ui-border-subtle)] px-3 py-3">
        <label className="relative flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-inset)] px-3 text-[var(--text-secondary)] focus-within:border-[var(--ui-focus)] focus-within:ring-2 focus-within:ring-[var(--ui-focus)]">
          <span className="sr-only">Search indicators</span>
          <Search aria-hidden="true" size={15} />
          <input
            aria-controls={resultsId}
            aria-label="Search indicators by name, description, category, or synonym"
            className="min-w-0 flex-1 bg-transparent text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] sm:text-sm"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search RSI, volatility, moving average…"
            ref={searchInputRef}
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label="Clear indicator search"
              className="grid h-7 w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 place-items-center rounded text-[var(--text-secondary)] outline-none transition hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"
              onClick={() => {
                setQuery("");
                searchInputRef.current?.focus();
              }}
              type="button"
            >
              <X size={13} />
            </button>
          ) : null}
        </label>

        <div
          aria-label="Indicator categories"
          className="flex min-w-0 gap-1 overflow-x-auto pb-1"
          role="toolbar"
        >
          <CategoryButton
            active={activeCategory === "all"}
            category="all"
            label="All"
            onClick={setActiveCategory}
            onKeyDown={handleCategoryKeyDown}
          />
          {supportedCategories.map((category) => (
            <CategoryButton
              active={activeCategory === category.id}
              category={category.id}
              key={category.id}
              label={category.label}
              onClick={setActiveCategory}
              onKeyDown={handleCategoryKeyDown}
            />
          ))}
        </div>
      </div>

      {customAddMessage ? <p role="status" className="break-words border-b border-[var(--ui-border-subtle)] px-4 py-2 text-xs leading-5 text-[var(--text-secondary)]">{customAddMessage}</p> : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between gap-3 px-1 text-[11px] text-[var(--text-secondary)]">
          <span aria-live="polite">
            {visibleIndicators.length + visibleScripts.length + unavailableFavorites.length} {visibleIndicators.length + visibleScripts.length + unavailableFavorites.length === 1 ? "indicator" : "indicators"}
          </span>
          <span className="truncate">Previews illustrate behavior, not live data</span>
        </div>

        {visibleIndicators.length + visibleScripts.length + unavailableFavorites.length > 0 ? (
          <div
            aria-label="Indicator results"
            className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-2"
            id={resultsId}
            role="list"
          >
            {visibleIndicators.map((indicator) => {
              const count = activeCount(indicator.kind);
              const disabled = isDisabled(indicator.kind);
              const favorite = favoriteSet.has(indicator.kind);
              const favoriteLimitReached =
                !favorite && favorites.length >= MAX_INDICATOR_FAVORITES;
              const addLabel = disabled
                ? `${indicator.label} is active; this study supports one instance`
                : count > 0
                  ? `Add another ${indicator.label} indicator; ${count} active`
                  : `Add ${indicator.label} indicator`;
              return (
                <article
                  className="group grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] p-2.5 transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-hover)]"
                  key={indicator.kind}
                  role="listitem"
                >
                  <IndicatorPreview indicator={indicator} />
                  <div className="flex min-w-0 flex-col">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {indicator.label}
                        </h3>
                        <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                          {indicator.category}
                        </span>
                      </div>
                      <button
                        aria-disabled={favoriteLimitReached}
                        aria-label={
                          favoriteLimitReached
                            ? `Cannot add ${indicator.label} to favorites; limit of ${MAX_INDICATOR_FAVORITES} reached`
                            : `${favorite ? "Remove" : "Add"} ${indicator.label} ${favorite ? "from" : "to"} favorite indicators`
                        }
                        aria-pressed={favorite}
                        className={`grid h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 shrink-0 place-items-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${
                          favoriteLimitReached ? "cursor-not-allowed opacity-35" : ""
                        } ${
                          favorite
                            ? "bg-[var(--ui-selection)] text-[var(--text-accent)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-accent)]"
                        }`}
                        onClick={() => {
                          if (favoriteLimitReached) {
                            setAnnouncement(
                              `Favorite limit reached. Remove one of your ${MAX_INDICATOR_FAVORITES} favorites first.`,
                            );
                            return;
                          }
                          onToggleFavorite(indicator.kind);
                          setAnnouncement(
                            `${indicator.label} ${favorite ? "removed from" : "added to"} favorites.`,
                          );
                        }}
                        title={
                          favoriteLimitReached
                            ? `Keep up to ${MAX_INDICATOR_FAVORITES} favorite indicators`
                            : undefined
                        }
                        type="button"
                      >
                        <Star fill={favorite ? "currentColor" : "none"} size={14} />
                      </button>
                    </div>
                    <p className="mt-1 min-h-10 text-xs leading-5 text-[var(--text-secondary)]">
                      {indicator.description}
                    </p>
                    <button
                      aria-label={addLabel}
                      className="mt-2 inline-flex min-h-9 [@media(pointer:coarse)]:min-h-11 items-center justify-center gap-1.5 self-start rounded-md border border-[var(--ui-border-strong)] bg-[var(--ui-selection)] px-2.5 text-xs font-semibold text-[var(--text-accent)] outline-none transition hover:border-[var(--ui-focus)] hover:bg-[var(--ui-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] disabled:cursor-not-allowed disabled:border-[var(--ui-border-subtle)] disabled:bg-[var(--ui-inset)] disabled:text-[var(--text-muted)] disabled:opacity-50"
                      data-indicator-catalog-add
                      disabled={disabled}
                      onClick={() => addIndicator(indicator)}
                      onKeyDown={handleResultKeyDown}
                      type="button"
                    >
                      {disabled ? <Layers size={13} /> : <Plus size={13} />}
                      {disabled ? "Active" : count > 0 ? `Add ${count + 1}` : "Add"}
                    </button>
                  </div>
                </article>
              );
            })}
            {visibleScripts.map((script) => {
              const count = indicatorInstances.filter((indicator) => indicator.kind === "custom" && indicator.customScriptId === script.id).length;
              const favoriteId = scriptIndicatorFavorite(script.id);
              const favorite = favoriteSet.has(favoriteId);
              const favoriteLimitReached = !favorite && favorites.length >= MAX_INDICATOR_FAVORITES;
              return (
                <article className="group grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] p-2.5 transition hover:border-[var(--ui-border-strong)] hover:bg-[var(--ui-hover)]" key={script.id} role="listitem">
                  <IndicatorPreview indicator={script} />
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{script.name}</h3>
                        <span className="text-[10px] font-medium text-[var(--text-secondary)]">{script.origin === "first-party" ? isPineScriptSource(script.source) ? "Built-in indicator" : "EdgeLab script" : `My script · v${script.revision}`}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          aria-disabled={favoriteLimitReached}
                          aria-label={favoriteLimitReached ? `Cannot add ${script.name} to favorites; limit of ${MAX_INDICATOR_FAVORITES} reached` : `${favorite ? "Remove" : "Add"} ${script.name} ${favorite ? "from" : "to"} favorite indicators`}
                          aria-pressed={favorite}
                          className={`grid h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 place-items-center rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${favoriteLimitReached ? "cursor-not-allowed opacity-35" : ""} ${favorite ? "bg-[var(--ui-selection)] text-[var(--text-accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-accent)]"}`}
                          onClick={() => {
                            if (favoriteLimitReached) {
                              setAnnouncement(`Favorite limit reached. Remove one of your ${MAX_INDICATOR_FAVORITES} favorites first.`);
                              return;
                            }
                            onToggleFavorite(favoriteId);
                            setAnnouncement(`${script.name} ${favorite ? "removed from" : "added to"} favorites.`);
                          }}
                          title={favoriteLimitReached ? `Keep up to ${MAX_INDICATOR_FAVORITES} favorite indicators` : favorite ? "Remove favorite" : "Add favorite"}
                          type="button"
                        ><Star fill={favorite ? "currentColor" : "none"} size={14} /></button>
                        {onEditCustomIndicator ? <button aria-label={`Open ${script.name} in the indicator editor`} className="grid h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 shrink-0 place-items-center rounded-md text-[var(--text-secondary)] outline-none transition hover:bg-[var(--ui-hover)] hover:text-[var(--text-accent)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]" onClick={() => onEditCustomIndicator(script)} type="button"><Code2 size={14} /></button> : null}
                      </div>
                    </div>
                    <p className="mt-1 min-h-10 text-xs leading-5 text-[var(--text-secondary)]">{script.description}</p>
                    <button aria-label={customAddPendingId === script.id ? `Adding ${script.name}` : `Add ${script.name} ${script.origin === "first-party" && isPineScriptSource(script.source) ? "built-in indicator" : "EdgeLab script"}${count ? `; ${count} active` : ""}`} className="mt-2 inline-flex min-h-9 [@media(pointer:coarse)]:min-h-11 items-center justify-center gap-1.5 self-start rounded-md border border-[var(--ui-border-strong)] bg-[var(--ui-selection)] px-2.5 text-xs font-semibold text-[var(--text-accent)] outline-none transition hover:border-[var(--ui-focus)] hover:bg-[var(--ui-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] disabled:cursor-not-allowed disabled:opacity-40" data-indicator-catalog-add disabled={!onAddCustomIndicator || !!customAddPendingId} onClick={() => onAddCustomIndicator?.(script)} onKeyDown={handleResultKeyDown} type="button"><Plus size={13} />{customAddPendingId === script.id ? "Adding…" : count ? `Add ${count + 1}` : "Add"}</button>
                  </div>
                </article>
              );
            })}
            {unavailableFavorites.map((favorite) => (
              <article className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] p-3" key={favorite} role="listitem">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">Unavailable script</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">This script may still be loading or has been deleted. You can remove its favorite to free a slot.</p>
                </div>
                <button aria-label="Remove unavailable script from favorite indicators" className="grid h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 shrink-0 place-items-center rounded-md bg-[var(--ui-selection)] text-[var(--text-accent)] outline-none transition hover:bg-[var(--ui-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]" onClick={() => { onToggleFavorite(favorite); setAnnouncement("Unavailable script removed from favorites."); }} type="button"><Star fill="currentColor" size={14} /></button>
              </article>
            ))}
          </div>
        ) : (
          <div
            className="grid min-h-52 place-items-center rounded-xl border border-dashed border-[var(--ui-border-subtle)] bg-[var(--ui-inset)] px-6 text-center"
            id={resultsId}
          >
            <div className="max-w-sm">
              <Search className="mx-auto text-[var(--text-secondary)]" size={22} />
              <h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                {emptyState.title}
              </h3>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                {emptyState.description}
              </p>
              <button
                className="mt-3 min-h-9 [@media(pointer:coarse)]:min-h-11 rounded-md border border-[var(--ui-border-subtle)] px-3 text-xs font-semibold text-[var(--text-secondary)] outline-none transition hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"
                onClick={() => {
                  setQuery("");
                  setActiveCategory("all");
                  searchInputRef.current?.focus();
                }}
                type="button"
              >
                Clear filters
              </button>
            </div>
          </div>
        )}
      </div>

      <p
        className="border-t border-[var(--ui-border-subtle)] px-4 py-2.5 text-[11px] leading-4 text-[var(--text-secondary)]"
        id={helpId}
      >
        Star up to {MAX_INDICATOR_FAVORITES} studies for quick add. Use arrows to move,
        Enter to add, and Escape to return to the Indicators button.
      </p>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </OverlaySurface>
  );
}

function CategoryButton({
  active,
  category,
  label,
  onClick,
  onKeyDown,
}: {
  active: boolean;
  category: IndicatorCatalogFilter;
  label: string;
  onClick: (category: IndicatorCatalogFilter) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-9 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 shrink-0 rounded-md px-3 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${
        active
          ? "bg-[var(--ui-selection)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)]"
      }`}
      data-indicator-catalog-category={category}
      onClick={() => onClick(category)}
      onKeyDown={onKeyDown}
      type="button"
    >
      {label}
    </button>
  );
}

const AVERAGE_PATHS: Partial<Record<ChartIndicatorKind, string>> = {
  dema: "M7 44 C18 42 21 29 32 31 S45 37 54 23 S72 13 89 17",
  ema: "M7 43 C20 44 20 33 32 34 S45 39 55 27 S74 19 89 14",
  hma: "M7 45 C20 46 23 38 34 37 S46 39 55 24 S75 12 89 15",
  sma: "M7 42 C20 41 25 37 34 36 S48 34 57 29 S74 22 89 20",
  tema: "M7 46 C17 45 23 37 32 38 S45 42 55 25 S73 11 89 14",
  wma: "M7 44 C20 44 23 36 34 36 S47 38 56 28 S73 18 89 17",
};

function IndicatorPreview({ indicator }: { indicator: Pick<IndicatorCatalogItem, "color" | "preview"> & { kind?: ChartIndicatorKind } }) {
  const grid = (
    <>
      <path d="M7 16H89M7 32H89M7 48H89" stroke="currentColor" opacity="0.08" />
      <path d="M24 7V57M48 7V57M72 7V57" stroke="currentColor" opacity="0.06" />
    </>
  );
  let graphic;

  if (indicator.preview === "average") {
    graphic = (
      <path
        d={(indicator.kind ? AVERAGE_PATHS[indicator.kind] : undefined) ?? AVERAGE_PATHS.ema}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.5"
      />
    );
  } else if (indicator.preview === "bands" || indicator.preview === "channel") {
    graphic = (
      <>
        <path
          d="M7 19 C24 13 32 19 47 15 S72 9 89 15 L89 46 C73 40 63 45 48 43 S23 49 7 43 Z"
          fill="currentColor"
          opacity="0.1"
        />
        <path
          d="M7 19 C24 13 32 19 47 15 S72 9 89 15 M7 43 C23 49 33 40 48 43 S73 40 89 46"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <path
          d="M7 31 C22 26 34 32 48 28 S72 23 89 28"
          fill="none"
          stroke="currentColor"
          strokeDasharray={indicator.preview === "channel" ? "4 3" : undefined}
          strokeWidth="1.5"
        />
      </>
    );
  } else if (indicator.preview === "zones") {
    graphic = (
      <>
        <rect fill="currentColor" height="13" opacity="0.18" rx="2" width="40" x="8" y="13" />
        <rect fill="#fb7185" height="12" opacity="0.17" rx="2" width="39" x="49" y="37" />
        <path d="M8 27H48M49 36H88" stroke="currentColor" strokeDasharray="3 2" />
        <path d="M12 45 L28 36 L42 39 L57 25 L72 29 L86 17" fill="none" stroke="var(--text-secondary)" opacity="0.65" strokeWidth="1.5" />
      </>
    );
  } else if (indicator.preview === "histogram") {
    graphic = (
      <>
        {[18, 25, 34, 41, 50, 58, 66, 74].map((x, index) => {
          const height = [7, 13, 20, 10, 6, 14, 22, 12][index];
          return (
            <rect
              fill="currentColor"
              height={height}
              key={x}
              opacity={index < 4 ? 0.42 : 0.72}
              width="6"
              x={x}
              y={32 - height / 2}
            />
          );
        })}
        <path d="M7 37 C22 41 30 18 44 23 S62 42 89 20" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M7 40 C24 34 32 27 46 29 S67 35 89 24" fill="none" stroke="var(--text-secondary)" opacity="0.55" strokeWidth="1.4" />
      </>
    );
  } else if (indicator.preview === "oscillator") {
    graphic = (
      <>
        <path d="M7 18H89M7 46H89" stroke="currentColor" strokeDasharray="3 3" opacity="0.35" />
        <path d="M7 36 C16 47 25 45 32 29 S46 13 55 29 S70 50 89 23" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
      </>
    );
  } else if (indicator.preview === "range") {
    graphic = (
      <>
        <path d="M7 47 C18 44 24 21 34 24 S48 39 58 30 S72 14 89 19" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M7 50H89" stroke="currentColor" opacity="0.25" />
      </>
    );
  } else if (indicator.preview === "trend") {
    graphic = (
      <>
        <path d="M7 44 L20 38 L31 40 L43 29 L53 31" fill="none" stroke="#fb7185" strokeLinecap="round" strokeWidth="2.5" />
        <path d="M53 31 L65 22 L76 25 L89 13" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
        <circle cx="53" cy="31" fill="currentColor" r="2.5" />
      </>
    );
  } else {
    graphic = (
      <>
        {[10, 21, 32, 43, 54, 65, 76].map((x, index) => (
          <rect
            fill="currentColor"
            height={[12, 22, 16, 29, 18, 25, 14][index]}
            key={x}
            opacity="0.18"
            width="7"
            x={x}
            y={52 - [12, 22, 16, 29, 18, 25, 14][index]}
          />
        ))}
        <path d="M7 39 C20 36 30 39 43 31 S68 25 89 21" fill="none" stroke="currentColor" strokeWidth="2.4" />
      </>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-[var(--ui-border-subtle)] bg-[var(--ui-inset)]"
      style={{ color: indicator.color }}
    >
      <svg fill="none" height="64" viewBox="0 0 96 64" width="96">
        {grid}
        {graphic}
      </svg>
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
