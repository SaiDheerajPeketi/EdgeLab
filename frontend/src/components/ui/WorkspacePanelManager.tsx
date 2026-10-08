import { ChevronLeft, ChevronRight, Columns3, PanelLeftClose, PanelRightClose, PanelsTopLeft, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconButton, Tooltip } from "./Primitives";

export type WorkspacePanelPreferences<PanelId extends string> = { activePanel: PanelId; collapsed: boolean; dock: "left" | "right"; mode: "compact" | "expanded"; width: number };
export type WorkspacePanelDefinition<PanelId extends string> = { id: PanelId; icon: LucideIcon; label: string; content: ReactNode };

export function WorkspacePanelManager<PanelId extends string>({ children, definitions, label = "Workspace tools", load, onChange, value }: { children: ReactNode; definitions: readonly WorkspacePanelDefinition<PanelId>[]; label?: string; load?: () => Promise<WorkspacePanelPreferences<PanelId>>; onChange: (value: WorkspacePanelPreferences<PanelId>) => Promise<unknown> | unknown; value: WorkspacePanelPreferences<PanelId> }) {
  const [preferences, setPreferences] = useState(value);
  const interactedRef = useRef(false);
  const dragStartRef = useRef<{ clientX: number; width: number } | null>(null);
  const liveRef = useRef(preferences); liveRef.current = preferences;
  const panels = useMemo(() => definitions.filter((item) => item.content != null), [definitions]);
  const active = panels.find((item) => item.id === preferences.activePanel) ?? panels[0];
  useEffect(() => setPreferences(value), [value]);
  useEffect(() => { let cancelled = false; void load?.().then((next) => { if (!cancelled && !interactedRef.current) setPreferences(next); }).catch(() => undefined); return () => { cancelled = true; }; }, [load]);
  useEffect(() => {
    const move = (event: PointerEvent) => { const start = dragStartRef.current; if (!start) return; const direction = liveRef.current.dock === "right" ? start.clientX - event.clientX : event.clientX - start.clientX; update({ width: clampWidth(start.width + direction) }, false); };
    const end = () => { if (!dragStartRef.current) return; dragStartRef.current = null; void onChange(liveRef.current); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [onChange]);
  function update(patch: Partial<WorkspacePanelPreferences<PanelId>>, persist = true) { interactedRef.current = true; setPreferences((current) => { const next = { ...current, ...patch }; liveRef.current = next; if (persist) void onChange(next); return next; }); }
  const panel = preferences.collapsed || !active ? null : <aside aria-label={label} data-workspace-panel-manager="true" data-motion="workspace-panel" data-dock={preferences.dock} data-mode={preferences.mode} className={`ui-workspace-panel relative flex min-h-[28rem] shrink-0 flex-col overflow-hidden bg-[var(--ui-surface)] max-xl:w-full max-xl:border-t max-xl:border-[var(--ui-border-subtle)] xl:w-[var(--workspace-panel-width)] ${preferences.dock === "left" ? "xl:order-first xl:border-r xl:border-[var(--ui-border-subtle)]" : "xl:border-l xl:border-[var(--ui-border-subtle)]"}`} style={{ "--workspace-panel-width": `${preferences.mode === "expanded" ? Math.max(520, preferences.width) : preferences.width}px` } as React.CSSProperties}>
    <div role="separator" aria-label={`Resize ${label}`} aria-orientation="vertical" aria-valuemin={280} aria-valuemax={720} aria-valuenow={preferences.width} tabIndex={0} onPointerDown={(event) => { dragStartRef.current = { clientX: event.clientX, width: preferences.width }; event.currentTarget.setPointerCapture(event.pointerId); }} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const physical = event.key === "ArrowRight" ? 24 : -24; update({ width: clampWidth(preferences.width + (preferences.dock === "right" ? -physical : physical)) }); }} className={`absolute inset-y-0 z-10 hidden w-2 cursor-col-resize outline-none hover:bg-[var(--ui-selection)] focus-visible:bg-[var(--ui-selection)] xl:block ${preferences.dock === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`} />
    <header className="flex min-h-12 items-center gap-1 border-b border-[var(--ui-border-subtle)] px-2"><div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label={label}>{panels.map((item) => <button key={item.id} type="button" role="tab" aria-selected={active.id === item.id} onClick={() => update({ activePanel: item.id })} className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${active.id === item.id ? "bg-[var(--ui-selection)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] hover:text-[var(--text-primary)]"}`}><item.icon aria-hidden="true" className="h-4 w-4" />{item.label}</button>)}</div><IconButton icon={Columns3} label={preferences.mode === "compact" ? "Expand workspace panel" : "Use compact workspace panel"} onClick={() => update({ mode: preferences.mode === "compact" ? "expanded" : "compact" })} /><IconButton icon={preferences.dock === "right" ? ChevronLeft : ChevronRight} label={`Dock workspace panel to ${preferences.dock === "right" ? "left" : "right"}`} onClick={() => update({ dock: preferences.dock === "right" ? "left" : "right" })} /><IconButton icon={preferences.dock === "right" ? PanelRightClose : PanelLeftClose} label="Collapse workspace panel" onClick={() => update({ collapsed: true })} /></header>
    <div className="min-h-0 flex-1 overflow-auto" role="tabpanel" aria-label={active.label}>{active.content}</div>
  </aside>;
  return <div className="flex min-w-0 flex-col xl:flex-row"><div className="min-w-0 flex-1">{children}</div>{panel}{preferences.collapsed && active ? <Tooltip content={`Open ${active.label}`}><button type="button" data-motion="workspace-panel-trigger" onClick={() => update({ collapsed: false })} className={`ui-workspace-panel-trigger sticky top-3 z-10 m-2 inline-flex min-h-[var(--control-height)] items-center gap-2 self-start rounded-[var(--radius-sm)] bg-[var(--ui-raised)] px-3 text-xs font-semibold text-[var(--text-secondary)] shadow-[var(--elevation-raised)] ring-1 ring-[var(--ui-border-subtle)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)] ${preferences.dock === "left" ? "xl:order-first" : ""}`}><PanelsTopLeft aria-hidden="true" className="h-4 w-4 text-[var(--interaction)]" />Tools</button></Tooltip> : null}</div>;
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
