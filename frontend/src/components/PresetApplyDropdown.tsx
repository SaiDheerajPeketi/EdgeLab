import { Check, ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { OverlaySurface } from "./overlays/OverlaySurface";

type PresetItem = { id: string; name: string; sublabel: string };
type Props = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  items: PresetItem[];
  onApply: (presetId: string) => void;
  onDelete: (presetId: string) => void;
  placeholder: string;
  selectedId: string;
};

export function PresetApplyDropdown({ ariaLabel, className = "", disabled = false, items, onApply, onDelete, placeholder, selectedId }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef("selected");
  const typeaheadRef = useRef({ query: "", timestamp: 0 });
  const menuId = useId();
  const selectedItem = items.find((item) => item.id === selectedId);
  const canOpen = !disabled && items.length > 0;

  function actions() {
    return Array.from(surfaceRef.current?.querySelectorAll<HTMLButtonElement>("[data-preset-action]") ?? []);
  }

  function focusAction(action?: HTMLButtonElement) {
    action?.focus({ preventScroll: true });
    action?.scrollIntoView({ block: "nearest" });
  }

  function focusToolbarFallback() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const controls = Array.from(trigger.closest('[role="group"]')?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? []).filter((control) => control !== trigger && control.tabIndex >= 0 && control.getBoundingClientRect().width > 0);
    const next = controls.find((control) => Boolean(trigger.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? controls.at(-1);
    next?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (canOpen) return;
    if (open) {
      const ownerDocument = triggerRef.current?.ownerDocument;
      const active = ownerDocument?.activeElement;
      if (ownerDocument && active && (active === ownerDocument.body || active === triggerRef.current || surfaceRef.current?.contains(active))) focusToolbarFallback();
    }
    setOpen(false);
  }, [canOpen, open]);

  useEffect(() => {
    if (!open) return;
    const ownerWindow = triggerRef.current?.ownerDocument.defaultView ?? window;
    const frame = ownerWindow.requestAnimationFrame(() => {
      const candidates = Array.from(surfaceRef.current?.querySelectorAll<HTMLButtonElement>('[data-preset-action="apply"]') ?? []);
      const initial = initialFocusRef.current === "last" ? candidates.at(-1) : candidates.find((button) => button.getAttribute("aria-checked") === "true") ?? candidates[0];
      initial?.focus({ preventScroll: true });
      initial?.scrollIntoView({ block: "nearest" });
    });
    return () => ownerWindow.cancelAnimationFrame(frame);
  }, [open]);

  function openMenu(last = false) {
    if (!canOpen) return;
    typeaheadRef.current = { query: "", timestamp: 0 };
    initialFocusRef.current = last ? "last" : "selected";
    setOpen(true);
  }

  function remove(item: PresetItem) {
    const applies = actions().filter((button) => button.dataset.presetAction === "apply");
    const index = applies.findIndex((button) => button.dataset.presetId === item.id);
    const neighbor = applies[index + 1] ?? applies[index - 1];
    if (neighbor) focusAction(neighbor);
    else {
      // The final deletion disables this trigger. Keep focus in the toolbar.
      focusToolbarFallback();
      setOpen(false);
    }
    onDelete(item.id);
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      // Let the browser continue from the opening control in document order.
      triggerRef.current?.focus({ preventScroll: true });
      setOpen(false);
      return;
    }
    const candidates = actions();
    if (!candidates.length) return;
    const index = candidates.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLButtonElement);
    const now = Date.now();
    const previous = typeaheadRef.current;
    const continuingName = previous.query.length > 0 && now - previous.timestamp < 700;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      typeaheadRef.current = { query: "", timestamp: 0 };
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? candidates.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length;
      focusAction(candidates[next]);
    } else if (event.key.length === 1 && (event.key !== " " || continuingName) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      // Space continues a name being typed; standalone Space still applies.
      const query = (continuingName ? previous.query : "") + event.key.toLocaleLowerCase();
      typeaheadRef.current = { query, timestamp: now };
      const ordered = [...candidates.slice(index + 1), ...candidates.slice(0, index + 1)];
      const matching = ordered.find((button) => button.dataset.presetAction === "apply" && button.dataset.presetName?.toLocaleLowerCase().startsWith(query));
      focusAction(matching);
    }
  }

  return (
    <div className={`preset-apply-dropdown ${className}`}>
      <button
        aria-controls={menuId}
        aria-expanded={open && canOpen}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className="preset-apply-trigger"
        disabled={!canOpen}
        onClick={(event) => {
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          if (open) setOpen(false); else openMenu();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowUp");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{selectedItem?.name ?? placeholder}</span>
        <ChevronDown aria-hidden="true" className={open ? "rotate-180" : ""} size={13} />
      </button>
      <OverlaySurface
        anchorRef={triggerRef}
        ariaLabel={ariaLabel}
        className="preset-apply-menu"
        estimatedHeight={Math.min(items.length * 52 + 12, 384)}
        id={menuId}
        onDismiss={() => setOpen(false)}
        onKeyDown={handleMenuKeyDown}
        open={open && canOpen}
        preferredWidth={288}
        role="menu"
        surfaceRef={surfaceRef}
      >
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <div className={`preset-apply-row ${selected ? "preset-apply-row-active" : ""}`} key={item.id} role="none">
              <button
                aria-checked={selected}
                aria-label={`Apply ${item.name}`}
                className="preset-apply-option"
                data-preset-action="apply"
                data-preset-id={item.id}
                data-preset-name={item.name}
                onClick={(event) => { event.stopPropagation(); onApply(item.id); setOpen(false); }}
                role="menuitemradio"
                tabIndex={-1}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]">{item.sublabel}</span>
                </span>
                {selected && <Check aria-hidden="true" className="shrink-0 text-[var(--text-primary)]" size={13} />}
              </button>
              <button
                aria-label={`Delete ${item.name}`}
                className="preset-apply-delete"
                data-preset-action="delete"
                data-preset-id={item.id}
                onClick={(event) => { event.stopPropagation(); remove(item); }}
                role="menuitem"
                tabIndex={-1}
                title={`Delete ${item.name}`}
                type="button"
              ><Trash2 aria-hidden="true" size={14} /></button>
            </div>
          );
        })}
      </OverlaySurface>
    </div>
  );
}
