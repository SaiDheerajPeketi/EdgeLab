import {
  AlertCircle,
  Check,
  ChevronDown,
  Info,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { OverlaySurface } from "../overlays/OverlaySurface";

type Tone = "neutral" | "info" | "success" | "warning" | "error";
type ActionTone = "primary" | "secondary" | "quiet" | "destructive";

const focus = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ui-canvas)]";
const disabled = "disabled:cursor-not-allowed disabled:opacity-45";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; tone?: ActionTone }>(function Button({ children, className = "", disabled: isDisabled, loading = false, tone = "secondary", ...props }, ref) {
  const tones: Record<ActionTone, string> = {
    primary: "bg-[var(--accent-primary)] text-[var(--on-interaction)] hover:bg-cyan-200 active:bg-cyan-100",
    secondary: "bg-[var(--ui-raised)] text-[var(--text-primary)] hover:bg-[var(--ui-floating)] ring-1 ring-inset ring-[var(--ui-border-subtle)]",
    quiet: "text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]",
    destructive: "bg-[var(--loss-soft)] text-[var(--loss-text)] hover:bg-rose-400/20 ring-1 ring-inset ring-rose-300/20",
  };
  return <button {...props} ref={ref} disabled={isDisabled || loading} aria-busy={loading || undefined} className={`inline-flex min-h-[var(--control-height)] items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm font-semibold transition-[background-color,color,box-shadow] duration-[var(--motion-app-fast)] ${focus} ${disabled} ${tones[tone]} ${className}`}>
    {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
    <span>{children}</span>
  </button>;
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; pressed?: boolean; tooltip?: string }>(function IconButton({ className = "", icon: Icon, label, pressed, tooltip, ...props }, ref) {
  return <Tooltip content={tooltip ?? label}><button {...props} ref={ref} data-icon-button="true" aria-label={label} aria-pressed={pressed} className={`grid h-[var(--control-height)] w-[var(--control-height)] shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] transition hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)] aria-pressed:bg-[var(--ui-selection)] aria-pressed:text-[var(--text-primary)] ${focus} ${disabled} ${className}`}><Icon aria-hidden="true" /></button></Tooltip>;
});

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { error?: string; hint?: string; label: string };
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ className = "", error, hint, id, label, ...props }, ref) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const detailId = `${controlId}-detail`;
  return <label className="block min-w-0 text-xs font-medium text-[var(--text-secondary)]" htmlFor={controlId}><span>{label}</span><input {...props} ref={ref} id={controlId} aria-invalid={Boolean(error) || undefined} aria-describedby={error || hint ? detailId : undefined} className={`mt-1 min-h-[var(--control-height)] w-full rounded-[var(--radius-sm)] border bg-[var(--ui-inset)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] read-only:text-[var(--text-secondary)] ${error ? "border-rose-300/50" : "border-[var(--ui-border-strong)]"} ${focus} ${disabled} ${className}`} />{error || hint ? <span id={detailId} className={`mt-1.5 flex gap-1.5 text-xs leading-5 ${error ? "text-[var(--loss-text)]" : "text-[var(--text-secondary)]"}`}>{error ? <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}{error ?? hint}</span> : null}</label>;
});

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string }>(function SelectField({ children, className = "", hint, id, label, ...props }, ref) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return <label className="block text-xs font-medium text-[var(--text-secondary)]" htmlFor={controlId}>{label}<span className="relative mt-1 block"><select {...props} ref={ref} id={controlId} className={`min-h-[var(--control-height)] w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--ui-border-strong)] bg-[var(--ui-inset)] px-3 pe-10 text-sm text-[var(--text-primary)] ${focus} ${disabled} ${className}`}>{children}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" /></span>{hint ? <span className="mt-1.5 block text-xs leading-5 text-[var(--text-secondary)]">{hint}</span> : null}</label>;
});

export type ComboboxOption = {
  description?: string;
  disabled?: boolean;
  keywords?: string;
  label: string;
  value: string;
};

/** Searchable single-select with listbox keyboard semantics and viewport-aware placement. */
export function Combobox({
  disabled: isDisabled,
  emptyMessage = "No matching options",
  hint,
  label,
  onChange,
  options,
  placeholder = "Search options…",
  value,
}: {
  disabled?: boolean;
  emptyMessage?: string;
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  placeholder?: string;
  value: string | null;
}) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const anchorRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;
  const [query, setQuery] = useState(selected?.label ?? "");
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || selected?.label === query) return options;
    return options.filter((option) => `${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [options, query, selected?.label]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) setQuery(selected?.label ?? "");
  }, [open, selected?.label]);
  useEffect(() => setActiveIndex(0), [query]);

  const choose = (option: ComboboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setQuery(option.label);
    setOpen(false);
    window.requestAnimationFrame(() => anchorRef.current?.focus());
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => Math.min(Math.max(current + delta, 0), Math.max(filtered.length - 1, 0)));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery(selected?.label ?? "");
    }
  };

  return <label className="block min-w-0 text-xs font-medium text-[var(--text-secondary)]" htmlFor={id}>
    {label}
    <span className="relative mt-1 block">
      <input
        aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${filtered[activeIndex].value}` : undefined}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        autoComplete="off"
        className={`min-h-[var(--control-height)] w-full rounded-[var(--radius-sm)] border border-[var(--ui-border-strong)] bg-[var(--ui-inset)] px-3 pe-10 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] ${focus} ${disabled}`}
        disabled={isDisabled}
        id={id}
        onBlur={() => { if (!surfaceRef.current?.matches(":focus-within")) setOpen(false); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        ref={anchorRef}
        role="combobox"
        value={query}
      />
      <ChevronDown aria-hidden="true" className={`pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)] transition-transform duration-[var(--motion-app-fast)] ${open ? "rotate-180" : ""}`} />
    </span>
    {hint ? <span className="mt-1.5 block text-xs leading-5 text-[var(--text-secondary)]">{hint}</span> : null}
    <OverlaySurface anchorRef={anchorRef} triggerRef={anchorRef} surfaceRef={surfaceRef} open={open && !isDisabled} onDismiss={() => setOpen(false)} preferredWidth={280} estimatedHeight={280} id={listboxId} role="listbox" ariaLabel={`${label} options`} className="z-[180] rounded-[var(--radius-md)] bg-[var(--ui-floating)] p-1.5 shadow-[var(--elevation-floating)] ring-1 ring-[var(--ui-border-strong)] transition-[opacity,transform] duration-[var(--motion-app-fast)]">
      {filtered.length ? filtered.map((option, index) => <button key={option.value} id={`${id}-option-${option.value}`} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)} className={`flex min-h-[var(--control-height)] w-full items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-start ${focus} ${disabled} ${index === activeIndex ? "bg-[var(--ui-selection)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]"}`}><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{option.label}</span>{option.description ? <span className="mt-0.5 block truncate text-xs opacity-70">{option.description}</span> : null}</span>{option.value === value ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-cyan-200" /> : null}</button>) : <p className="px-3 py-6 text-center text-sm text-[var(--text-secondary)]">{emptyMessage}</p>}
    </OverlaySurface>
  </label>;
}

export function Toggle({ checked, disabled: isDisabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={isDisabled} onClick={() => onChange(!checked)} className={`relative h-7 w-12 rounded-full border transition-colors ${checked ? "border-cyan-200/60 bg-cyan-300/30" : "border-[var(--ui-border-strong)] bg-[var(--ui-inset)]"} ${focus} ${disabled}`}><span aria-hidden="true" className={`absolute top-1 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} /></button>;
}

export function Checkbox({ checked, disabled: isDisabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="inline-flex min-h-[var(--control-height)] cursor-pointer items-center gap-2 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={checked} disabled={isDisabled} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" /><span aria-hidden="true" className={`grid h-5 w-5 place-items-center rounded border ${checked ? "border-cyan-200 bg-cyan-300 text-[var(--on-interaction)]" : "border-[var(--ui-border-strong)] bg-[var(--ui-inset)]"} peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ui-focus)] peer-disabled:opacity-45`}>{checked ? <Check className="h-3.5 w-3.5" /> : null}</span><span>{label}</span></label>;
}

export function RadioGroup<T extends string>({ label, onChange, options, value }: { label: string; onChange: (value: T) => void; options: readonly { label: string; value: T; description?: string }[]; value: T }) {
  return <fieldset><legend className="mb-2 text-xs font-medium text-[var(--text-secondary)]">{label}</legend><div className="grid gap-1">{options.map((option) => <label key={option.value} className="flex min-h-[var(--control-height)] cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:bg-white/[0.04]"><input type="radio" name={label} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="h-4 w-4 accent-cyan-300" /><span className="text-sm text-[var(--text-primary)]">{option.label}{option.description ? <span className="ms-2 text-xs text-[var(--text-secondary)]">{option.description}</span> : null}</span></label>)}</div></fieldset>;
}

export function Slider({ label, value, min, max, step = 1, unit = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  const id = useId();
  return <label htmlFor={id} className="block text-xs font-medium text-[var(--text-secondary)]"><span className="flex justify-between gap-3"><span>{label}</span><output className="font-data tabular-nums text-[var(--text-primary)]">{value}{unit}</output></span><input id={id} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 h-10 w-full accent-cyan-300" /></label>;
}

export function SegmentedControl<T extends string>({ label, onChange, options, value }: { label: string; onChange: (value: T) => void; options: readonly { label: string; value: T }[]; value: T }) {
  return <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--ui-inset)] p-1 ring-1 ring-inset ring-[var(--ui-border-subtle)]">{options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={`min-h-8 shrink-0 rounded px-3 text-xs font-semibold ${focus} ${value === option.value ? "bg-[var(--ui-selection)] text-cyan-100 shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>{option.label}</button>)}</div>;
}

export function Tabs<T extends string>({ label, onChange, tabs, value }: { label: string; onChange: (value: T) => void; tabs: readonly { label: string; value: T; panelId?: string }[]; value: T }) {
  return <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--ui-border-subtle)]">{tabs.map((tab) => <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} aria-controls={tab.panelId} tabIndex={value === tab.value ? 0 : -1} onClick={() => onChange(tab.value)} onKeyDown={(event) => { const index = tabs.findIndex((item) => item.value === value); if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const delta = event.key === "ArrowRight" ? 1 : -1; onChange(tabs[(index + delta + tabs.length) % tabs.length].value); } }} className={`min-h-[var(--control-height)] shrink-0 border-b-2 px-3 text-sm ${focus} ${value === tab.value ? "border-cyan-300 font-semibold text-cyan-100" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}>{tab.label}</button>)}</div>;
}

export function Card({ children, className = "", selected = false, ...props }: HTMLAttributes<HTMLElement> & { selected?: boolean }) { return <section {...props} className={`rounded-[var(--radius-lg)] bg-[var(--ui-surface)] p-4 ${selected ? "ring-2 ring-cyan-300/45" : "ring-1 ring-inset ring-[var(--ui-border-subtle)]"} ${className}`}>{children}</section>; }
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) { const tones: Record<Tone, string> = { neutral: "bg-white/[0.06] text-[var(--text-secondary)]", info: "bg-blue-300/10 text-blue-100", success: "bg-emerald-300/10 text-emerald-100", warning: "bg-amber-300/10 text-amber-100", error: "bg-rose-300/10 text-rose-100" }; return <span className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>; }
export function Table({ children, label, className = "" }: { children: ReactNode; label: string; className?: string }) { return <div className="max-w-full overflow-auto"><table aria-label={label} className={`w-full border-separate border-spacing-0 text-sm [&_th]:sticky [&_th]:top-0 [&_th]:bg-[var(--ui-surface)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_th]:text-xs [&_th]:font-semibold [&_th]:text-[var(--text-secondary)] [&_td]:border-t [&_td]:border-[var(--ui-border-subtle)] [&_td]:px-3 [&_td]:py-2 [&_.numeric]:text-end [&_.numeric]:font-data [&_.numeric]:tabular-nums ${className}`}>{children}</table></div>; }

export function Tooltip({ children, content }: { children: ReactNode; content: string }) {
  const [open, setOpen] = useState(false); const anchorRef = useRef<HTMLSpanElement>(null); const surfaceRef = useRef<HTMLDivElement>(null); const id = useId();
  return <><span ref={anchorRef} aria-describedby={open ? id : undefined} className="inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocusCapture={() => setOpen(true)} onBlurCapture={() => setOpen(false)}>{children}</span><OverlaySurface anchorRef={anchorRef} surfaceRef={surfaceRef} open={open} onDismiss={() => setOpen(false)} portal preferredWidth={180} estimatedHeight={48} gap={6} id={id} role="tooltip" className="z-[190] rounded-[var(--radius-sm)] bg-[var(--ui-floating)] px-2.5 py-1.5 text-xs leading-5 text-[var(--text-primary)] shadow-[var(--elevation-floating)] ring-1 ring-[var(--ui-border-strong)]">{content}</OverlaySurface></>;
}

export function Popover({ anchor, children, label, open, onOpenChange, align = "left" }: { anchor: (props: { ref: React.RefObject<HTMLButtonElement>; onClick: () => void; expanded: boolean }) => ReactNode; children: ReactNode; label: string; open: boolean; onOpenChange: (open: boolean) => void; align?: "left" | "right" }) {
  const anchorRef = useRef<HTMLButtonElement>(null); const surfaceRef = useRef<HTMLDivElement>(null);
  return <>{anchor({ ref: anchorRef, onClick: () => onOpenChange(!open), expanded: open })}<OverlaySurface anchorRef={anchorRef} triggerRef={anchorRef} surfaceRef={surfaceRef} open={open} onDismiss={() => onOpenChange(false)} align={align} preferredWidth={280} role="dialog" ariaLabel={label} className="z-[180] rounded-[var(--radius-md)] bg-[var(--ui-floating)] p-3 text-[var(--text-primary)] shadow-[var(--elevation-floating)] ring-1 ring-[var(--ui-border-strong)]">{children}</OverlaySurface></>;
}

export function Menu({ anchor, items, label, open, onOpenChange }: { anchor: (props: { ref: React.RefObject<HTMLButtonElement>; onClick: () => void; expanded: boolean }) => ReactNode; items: readonly { id: string; label: string; icon?: LucideIcon; disabled?: boolean; destructive?: boolean; onSelect: () => void }[]; label: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Popover anchor={anchor} label={label} open={open} onOpenChange={onOpenChange} align="right"><div role="menu" aria-label={label} className="grid gap-1">{items.map((item) => { const Icon = item.icon; return <button key={item.id} role="menuitem" type="button" disabled={item.disabled} onClick={() => { item.onSelect(); onOpenChange(false); }} className={`flex min-h-[var(--control-height)] items-center gap-2 rounded-[var(--radius-sm)] px-2.5 text-start text-sm ${focus} ${disabled} ${item.destructive ? "text-[var(--loss-text)] hover:bg-[var(--loss-soft)]" : "text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)]"}`}>{Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}{item.label}</button>; })}</div></Popover>;
}

type ModalSurfaceProps = {
  ariaDescribedBy?: string;
  ariaLabelledBy?: string;
  children: ReactNode;
  className?: string;
  dismissBlocked?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  label?: string;
  onClose: () => void;
  open: boolean;
  placement?: "bottom" | "right";
};

function ModalFrame({ ariaDescribedBy, ariaLabelledBy, children, className = "", dismissBlocked = false, initialFocusRef, label, onClose, placement = "right", kind }: Omit<ModalSurfaceProps, "open"> & { kind: "dialog" | "drawer" }) {
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; window.requestAnimationFrame(() => (initialFocusRef?.current ?? frameRef.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))?.focus()); const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !dismissBlocked) { event.preventDefault(); onClose(); } if (event.key === "Tab" && frameRef.current) trapFocus(event, frameRef.current); }; document.addEventListener("keydown", key); return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); previous?.focus({ preventScroll: true }); }; }, [dismissBlocked, initialFocusRef, onClose]);
  const bottomDrawer = kind === "drawer" && placement === "bottom";
  const base = kind === "drawer" ? bottomDrawer ? "ui-drawer-surface ui-drawer-surface-bottom max-h-[90dvh] w-full overflow-auto rounded-t-[var(--radius-lg)] bg-[var(--ui-modal)] shadow-[var(--elevation-modal)]" : "ui-drawer-surface h-full w-[min(30rem,100vw)] overflow-auto bg-[var(--ui-modal)] shadow-[var(--elevation-modal)]" : "ui-dialog-surface max-h-[min(90dvh,52rem)] w-full max-w-lg overflow-auto rounded-[var(--radius-lg)] bg-[var(--ui-modal)] shadow-[var(--elevation-modal)]";
  return createPortal(<div data-modal-backdrop="true" className={`ui-modal-backdrop fixed inset-0 z-[200] flex bg-[var(--ui-overlay-backdrop)] ${kind === "drawer" ? bottomDrawer ? "items-end justify-center" : "justify-end" : "items-center justify-center p-3"}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !dismissBlocked) onClose(); }}><div data-motion={kind} data-drawer-placement={kind === "drawer" ? placement : undefined} data-modal-surface={kind} ref={frameRef} role="dialog" aria-modal="true" aria-label={ariaLabelledBy ? undefined : label} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} className={`${base} ${className}`}>{children}</div></div>, document.body);
}
export function Dialog(props: ModalSurfaceProps) { return props.open ? <ModalFrame {...props} kind="dialog" /> : null; }
export function Drawer(props: ModalSurfaceProps) { return props.open ? <ModalFrame {...props} kind="drawer" /> : null; }
export function DialogHeader({ title, description, onClose }: { title: string; description?: string; onClose: () => void }) { return <header className="flex items-start gap-3 border-b border-[var(--ui-border-subtle)] p-4"><div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>{description ? <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{description}</p> : null}</div><IconButton icon={X} label="Close" onClick={onClose} /></header>; }

export function Banner({ action, children, title, tone = "info" }: { action?: ReactNode; children: ReactNode; title: string; tone?: Tone }) { const Icon = tone === "error" ? AlertCircle : tone === "success" ? Check : Info; const tones: Record<Tone, string> = { neutral: "bg-white/[0.04] text-[var(--text-secondary)]", info: "bg-blue-300/[0.08] text-blue-100", success: "bg-emerald-300/[0.08] text-emerald-100", warning: "bg-amber-300/[0.08] text-amber-100", error: "bg-rose-300/[0.08] text-rose-100" }; return <section role={tone === "error" ? "alert" : "status"} className={`flex flex-wrap items-start gap-3 rounded-[var(--radius-md)] p-3 ${tones[tone]}`}><Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{title}</h3><div className="mt-0.5 text-xs leading-5 opacity-80">{children}</div></div>{action}</section>; }

type ToastRecord = { id: string; message: string; title: string; tone?: Tone; duration?: number };
const ToastContext = createContext<(toast: Omit<ToastRecord, "id">) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) { const [toasts, setToasts] = useState<ToastRecord[]>([]); const push = useMemo(() => (toast: Omit<ToastRecord, "id">) => { const id = crypto.randomUUID(); setToasts((current) => [...current, { ...toast, id }]); window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), toast.duration ?? 6000); }, []); return <ToastContext.Provider value={push}>{children}{typeof document === "undefined" ? null : createPortal(<div className="pointer-events-none fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] end-4 z-[220] grid w-[min(24rem,calc(100vw-2rem))] gap-2" role="region" aria-label="Notifications" aria-live="polite">{toasts.map((toast) => <div key={toast.id} className="pointer-events-auto rounded-[var(--radius-md)] bg-[var(--ui-floating)] p-3 shadow-[var(--elevation-floating)] ring-1 ring-[var(--ui-border-strong)]"><div className="flex gap-3"><div className="min-w-0 flex-1"><strong className="text-sm text-[var(--text-primary)]">{toast.title}</strong><p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">{toast.message}</p></div><IconButton icon={X} label="Dismiss notification" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} /></div></div>)}</div>, document.body)}</ToastContext.Provider>; }
export function useToast() { return useContext(ToastContext); }

function trapFocus(event: KeyboardEvent, container: HTMLElement) { const elements = [...container.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]; const first = elements[0]; const last = elements.at(-1); if (!first || !last) return; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
