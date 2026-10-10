import { ChevronLeft, ChevronRight, Columns3, PanelLeftClose, PanelRightClose, PanelsTopLeft, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton } from "./Primitives";
import { assertAppDataAccess, captureAppDataAccess, type AppDataAccess } from "../../lib/appDataBarrier";

export type WorkspacePanelPreferences<PanelId extends string> = { activePanel: PanelId; collapsed: boolean; dock: "left" | "right"; mode: "compact" | "expanded"; width: number };
export type WorkspacePanelDefinition<PanelId extends string> = { id: PanelId; icon: LucideIcon; label: string; content: ReactNode };

export function WorkspacePanelManager<PanelId extends string>({ children, definitions, label = "Workspace tools", load, onChange, overlayCollapsed = false, value }: { children: ReactNode; definitions: readonly WorkspacePanelDefinition<PanelId>[]; label?: string; overlayCollapsed?: boolean; load?: () => Promise<WorkspacePanelPreferences<PanelId>>; onChange: (value: WorkspacePanelPreferences<PanelId>) => Promise<unknown> | unknown; value: WorkspacePanelPreferences<PanelId> }) {
  const [preferences, setPreferences] = useState(value);
  const [hoverPreview, setHoverPreview] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveRef = useRef({ mounted: true, sequence: 0, onChange });
  if (saveRef.current.onChange !== onChange) { saveRef.current.sequence += 1; saveRef.current.onChange = onChange; }
  const toolsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pointerInsideRef = useRef(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactedRef = useRef(false);
  const dragStartRef = useRef<{ clientX: number; width: number } | null>(null);
  const liveRef = useRef(preferences); liveRef.current = preferences;
  const panels = useMemo(() => definitions.filter((item) => item.content != null), [definitions]);
  const active = panels.find((item) => item.id === preferences.activePanel) ?? panels[0];
  useEffect(() => setPreferences(value), [value]);
  useEffect(() => {
    const state = saveRef.current; state.mounted = true;
    const invalidate = () => { state.sequence += 1; setSaveError(null); };
    const storage = (event: StorageEvent) => { if (event.key === null) invalidate(); };
    window.addEventListener("edgelab:auth-session-change", invalidate);
    window.addEventListener("storage", storage);
    return () => { state.mounted = false; state.sequence += 1; window.removeEventListener("edgelab:auth-session-change", invalidate); window.removeEventListener("storage", storage); };
  }, []);
  useLayoutEffect(() => {
    if (!hoverPreview || !preferences.collapsed) return;
    const measure = () => {
      const bounds = toolsRef.current?.getBoundingClientRect();
      const bottom = bounds?.bottom ?? window.innerHeight;
      setPreviewHeight(Math.max(0, window.innerHeight - bottom - 8));
      const rightAligned = window.matchMedia("(min-width: 1024px)").matches && preferences.dock === "right";
      const availableWidth = rightAligned ? (bounds?.right ?? window.innerWidth) - 8 : window.innerWidth - (bounds?.left ?? 0) - 8;
      setPreviewWidth(Math.max(0, Math.min(preferences.mode === "expanded" ? Math.max(520, preferences.width) : preferences.width, availableWidth)));
      if (bottom <= 0 || bottom >= window.innerHeight) setHoverPreview(false);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [hoverPreview, preferences.collapsed, preferences.dock, preferences.mode, preferences.width]);
  useEffect(() => {
    return () => {
      if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    };
  }, []);
  useEffect(() => { let cancelled = false; void load?.().then((next) => { if (!cancelled && !interactedRef.current) setPreferences(next); }).catch(() => undefined); return () => { cancelled = true; }; }, [load]);
  useEffect(() => {
    const move = (event: PointerEvent) => { const start = dragStartRef.current; if (!start) return; const direction = liveRef.current.dock === "right" ? start.clientX - event.clientX : event.clientX - start.clientX; update({ width: clampWidth(start.width + direction) }, false); };
    const end = () => { if (!dragStartRef.current) return; dragStartRef.current = null; void savePreferences(liveRef.current); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [onChange]);
  async function savePreferences(next: WorkspacePanelPreferences<PanelId>) {
    const state = saveRef.current, sequence = ++state.sequence;
    let access: AppDataAccess | null = null, captured = false, admitted = false;
    const owns = (admissionFailure = false) => {
      if (!state.mounted || state.sequence !== sequence || state.onChange !== onChange || !captured) return false;
      try {
        const current = captureAppDataAccess();
        if (current?.owner !== access?.owner || current?.token !== access?.token || current?.epoch !== access?.epoch) return false;
        if (!admissionFailure) assertAppDataAccess(access);
        return true;
      } catch { return false; }
    };
    try {
      access = captureAppDataAccess(); captured = true;
      assertAppDataAccess(access, true); admitted = true;
      await onChange(next);
      if (owns()) setSaveError(null);
    } catch (error) {
      if (owns(!admitted)) setSaveError(error && typeof error === "object" && "requiresReload" in error
        ? "Panel saves are paused. Open Workspace settings, check the previous save in Storage, then reload."
        : "Could not save panel preferences. Your current layout is kept. Try changing the setting again.");
    }
  }
  function update(patch: Partial<WorkspacePanelPreferences<PanelId>>, persist = true) {
    interactedRef.current = true;
    const restoreFocus = patch.collapsed !== undefined && toolsRef.current?.contains(document.activeElement);
    if (patch.collapsed !== undefined) setHoverPreview(false);
    const next = { ...liveRef.current, ...patch }; liveRef.current = next; setPreferences(next);
    if (persist) void savePreferences(next);
    if (restoreFocus) window.requestAnimationFrame(() => {
      if (liveRef.current.collapsed !== patch.collapsed) return;
      if (patch.collapsed) triggerRef.current?.focus();
      else panelRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    });
  }
  const preview = preferences.collapsed && hoverPreview;
  function enterPreview() {
    pointerInsideRef.current = true;
    if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = null;
  }
  function leavePreview() {
    pointerInsideRef.current = false;
    if (leaveTimerRef.current !== null) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => {
      leaveTimerRef.current = null;
      if (!pointerInsideRef.current && !panelRef.current?.contains(document.activeElement)) setHoverPreview(false);
    }, 180);
  }
  const panel = (preferences.collapsed && !preview) || !active ? null : <aside ref={panelRef} aria-label={label} data-workspace-panel-manager="true" data-hover-preview={preview || undefined} data-motion="workspace-panel" data-dock={preferences.dock} data-mode={preferences.mode} className={`ui-workspace-panel flex shrink-0 flex-col overflow-hidden bg-[var(--ui-surface)] max-lg:w-full max-lg:border-t max-lg:border-[var(--ui-border-subtle)] lg:w-[var(--workspace-panel-width)] ${preview ? `absolute top-full z-[var(--layer-popover)] min-h-0 shadow-[var(--elevation-floating)] ${preferences.dock === "left" ? "left-0" : "left-0 lg:left-auto lg:right-0"}` : "relative min-h-[28rem]"} ${preferences.dock === "left" ? "lg:border-r lg:border-[var(--ui-border-subtle)]" : "lg:border-l lg:border-[var(--ui-border-subtle)]"}`} style={{ "--workspace-panel-width": `${preferences.mode === "expanded" ? Math.max(520, preferences.width) : preferences.width}px`, maxHeight: preview ? previewHeight : undefined, width: preview ? previewWidth : undefined } as React.CSSProperties}>
    <div role="separator" aria-label={`Resize ${label}`} aria-orientation="vertical" aria-valuemin={280} aria-valuemax={720} aria-valuenow={preferences.width} tabIndex={0} onPointerDown={(event) => { dragStartRef.current = { clientX: event.clientX, width: preferences.width }; event.currentTarget.setPointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const physical = event.key === "ArrowRight" ? 24 : -24; update({ width: clampWidth(preferences.width + (preferences.dock === "right" ? -physical : physical)) }); }} className={`absolute inset-y-0 z-10 hidden w-2 cursor-col-resize outline-none hover:bg-[var(--ui-selection)] focus-visible:bg-[var(--ui-selection)] lg:block ${preferences.dock === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`} />
    <header className="flex min-h-12 items-center gap-1 border-b border-[var(--ui-border-subtle)] px-2"><div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label={label}>{panels.map((item) => <button key={item.id} type="button" role="tab" aria-selected={active.id === item.id} onClick={() => update({ activePanel: item.id })} className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${active.id === item.id ? "bg-[var(--ui-selection)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)]"}`}><item.icon aria-hidden="true" className="h-4 w-4" />{item.label}</button>)}</div>{preview ? <IconButton icon={PanelsTopLeft} label="Keep workspace panel open" onClick={() => update({ collapsed: false })} /> : null}<IconButton icon={Columns3} label={preferences.mode === "compact" ? "Expand workspace panel" : "Use compact workspace panel"} onClick={() => update({ mode: preferences.mode === "compact" ? "expanded" : "compact" })} /><IconButton icon={preferences.dock === "right" ? ChevronLeft : ChevronRight} label={`Dock workspace panel to ${preferences.dock === "right" ? "left" : "right"}`} onClick={() => update({ dock: preferences.dock === "right" ? "left" : "right" })} /><IconButton icon={preferences.dock === "right" ? PanelRightClose : PanelLeftClose} label="Collapse workspace panel" onClick={() => update({ collapsed: true })} /></header>
    <div className="min-h-0 flex-1 overflow-auto" role="tabpanel" aria-label={active.label}>{active.content}</div>
  </aside>;
  return <div className="relative flex min-w-0 flex-col lg:flex-row" data-workspace-panel-layout="true" data-overlay-tools={overlayCollapsed && preferences.collapsed ? preferences.dock : undefined}><div className="min-w-0 flex-1" data-workspace-panel-content="true">{children}</div>{active ? <div ref={toolsRef} className={`relative shrink-0 ${preferences.collapsed ? "sticky top-3 self-start" : ""} ${overlayCollapsed && preferences.collapsed ? `lg:absolute lg:top-0 lg:z-[var(--layer-docked-tool)] ${preferences.dock === "left" ? "lg:left-0" : "lg:right-0"}` : ""} ${preferences.dock === "left" ? "lg:order-first" : ""}`} onPointerEnter={enterPreview} onPointerLeave={leavePreview} onBlurCapture={(event) => { if (!pointerInsideRef.current && !event.currentTarget.contains(event.relatedTarget)) setHoverPreview(false); }} onKeyDown={(event) => { if (event.key === "Escape" && preview) { event.preventDefault(); setHoverPreview(false); triggerRef.current?.focus(); } }}>
    {preferences.collapsed ? <button ref={triggerRef} type="button" title={`Open ${active.label}`} data-motion="workspace-panel-trigger" aria-expanded={preview} onPointerEnter={(event) => { if (event.pointerType === "mouse") setHoverPreview(true); }} onClick={() => update({ collapsed: false })} className="ui-workspace-panel-trigger relative z-10 m-2 inline-flex min-h-[var(--control-height)] items-center gap-2 self-start rounded-[var(--radius-sm)] bg-[var(--ui-raised)] px-3 text-xs font-semibold text-[var(--text-secondary)] shadow-[var(--elevation-raised)] ring-1 ring-[var(--ui-border-subtle)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"><PanelsTopLeft aria-hidden="true" className="h-4 w-4 text-[var(--interaction)]" />Tools</button> : null}
    {saveError ? <p role="alert" className="m-2 max-w-[min(22rem,calc(100vw_-_2rem))] rounded-[var(--radius-sm)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] p-3 text-xs text-[var(--text-secondary)]">{saveError}</p> : null}
    {panel}
  </div> : null}</div>;
}

function clampWidth(width: number) { return Math.min(720, Math.max(280, width)); }

export function FloatingWorkspacePanel({ children, dock, label, onSizeChange, size }: { children: ReactNode; dock: "bottom" | "right"; label: string; onSizeChange: (size: number) => void; size: number }) {
  const dragRef = useRef<{ pointer: number; size: number } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = dragRef.current;
      if (!start) return;
      const pointer = dock === "right" ? event.clientX : event.clientY;
      onSizeChange(clampFloatingSize(start.size + start.pointer - pointer, dock));
    };
    const end = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [dock, onSizeChange]);
  const vertical = dock === "right";
  return <aside aria-label={label} data-workspace-panel-manager="floating" data-dock={dock} data-motion="workspace-panel" className={`ui-workspace-panel fixed z-[var(--layer-docked-tool)] flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--ui-border-subtle)] bg-[var(--ui-floating)] shadow-[var(--elevation-modal)] ${vertical ? "bottom-3 right-3 top-16" : "bottom-3 left-3 right-3"}`} style={vertical ? { width: `min(${size}px, calc(100vw - 24px))` } : { height: `min(${size}px, calc(100dvh - 24px))` }}>
    <div role="separator" aria-label={`Resize ${label}`} aria-orientation={vertical ? "vertical" : "horizontal"} aria-valuemin={vertical ? 320 : 280} aria-valuemax={vertical ? 720 : 760} aria-valuenow={size} tabIndex={0} onPointerDown={(event) => { dragRef.current = { pointer: vertical ? event.clientX : event.clientY, size }; event.currentTarget.setPointerCapture(event.pointerId); }} onKeyDown={(event) => { const decrease = event.key === "ArrowRight" || event.key === "ArrowDown"; const increase = event.key === "ArrowLeft" || event.key === "ArrowUp"; if (!decrease && !increase) return; event.preventDefault(); onSizeChange(clampFloatingSize(size + (increase ? 24 : -24), dock)); }} className={`absolute z-10 outline-none hover:bg-[var(--ui-selection)] focus-visible:bg-[var(--ui-selection)] ${vertical ? "inset-y-0 left-0 w-2 -translate-x-1/2 cursor-col-resize" : "inset-x-0 top-0 h-2 -translate-y-1/2 cursor-row-resize"}`} />
    {children}
  </aside>;
}

function clampFloatingSize(size: number, dock: "bottom" | "right") { return Math.min(dock === "right" ? 720 : 760, Math.max(dock === "right" ? 320 : 280, size)); }

export function DockedWorkspacePanel({ children, label, onSizeChange, size }: { children: ReactNode; label: string; onSizeChange: (size: number) => void; size: number }) {
  const dragRef = useRef<{ clientX: number; size: number } | null>(null);
  useEffect(() => {
    const move = (event: PointerEvent) => { const start = dragRef.current; if (start) onSizeChange(clampWidth(start.size + start.clientX - event.clientX)); };
    const end = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [onSizeChange]);
  return <aside aria-label={label} data-workspace-panel-manager="docked" data-dock="right" data-motion="workspace-panel" className="ui-workspace-panel relative min-w-0 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--ui-border-subtle)] bg-[var(--ui-surface)] shadow-[var(--elevation-raised)]" style={{ width: `min(${clampWidth(size)}px, calc(100vw - 24px))` }}>
    <div role="separator" aria-label={`Resize ${label}`} aria-orientation="vertical" aria-valuemin={280} aria-valuemax={720} aria-valuenow={clampWidth(size)} tabIndex={0} onPointerDown={(event) => { dragRef.current = { clientX: event.clientX, size: clampWidth(size) }; event.currentTarget.setPointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); onSizeChange(clampWidth(size + (event.key === "ArrowLeft" ? 24 : -24))); }} className="absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize outline-none hover:bg-[var(--ui-selection)] focus-visible:bg-[var(--ui-selection)] xl:block" />
    {children}
  </aside>;
}
