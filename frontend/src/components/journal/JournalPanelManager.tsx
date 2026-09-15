import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Bot, Braces, ChevronLeft, ChevronRight, Columns3, Eye, List, NotebookPen, PanelLeftClose, PanelRightClose } from "lucide-react";
import {
  hydrateJournalPanelPreferences,
  loadJournalPanelPreferences,
  saveJournalPanelPreferences,
  type JournalPanelId,
  type JournalPanelPreferences,
} from "../../lib/journalWorkspaceState";

const PANEL_META: Record<JournalPanelId, { label: string; icon: typeof NotebookPen }> = {
  journal: { label: "Journal", icon: NotebookPen },
  watchlist: { label: "Watchlist", icon: List },
  quant: { label: "Quant", icon: Bot },
  "data-window": { label: "Data window", icon: Eye },
  objects: { label: "Objects", icon: Columns3 },
  code: { label: "Code", icon: Braces },
};

export type JournalPanelSlots = Partial<Record<JournalPanelId, ReactNode>>;

export function JournalPanelManager({
  children,
  slots,
  label = "Workspace panels",
}: {
  children: ReactNode;
  slots: JournalPanelSlots;
  label?: string;
}) {
  const [preferences, setPreferences] = useState<JournalPanelPreferences>(() => loadJournalPanelPreferences());
  const dragStartRef = useRef<{ clientX: number; width: number } | null>(null);
  const availablePanels = useMemo(() => (Object.keys(slots) as JournalPanelId[]).filter((panel) => slots[panel] != null), [slots]);
  const activePanel = availablePanels.includes(preferences.activePanel) ? preferences.activePanel : availablePanels[0] ?? "journal";

  useEffect(() => {
    let cancelled = false;
    void hydrateJournalPanelPreferences().then((value) => { if (!cancelled) setPreferences(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const direction = preferences.dock === "right" ? start.clientX - event.clientX : event.clientX - start.clientX;
      update({ width: Math.min(720, Math.max(280, start.width + direction)) }, false);
    };
    const end = () => {
      if (!dragStartRef.current) return;
      dragStartRef.current = null;
      void saveJournalPanelPreferences(preferences);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [preferences]);

  function update(patch: Partial<JournalPanelPreferences>, persist = true) {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      if (persist) void saveJournalPanelPreferences(next);
      return next;
    });
  }

  function resizeBy(delta: number) {
    update({ width: Math.min(720, Math.max(280, preferences.width + delta)) });
  }

  const panel = preferences.collapsed || !availablePanels.length ? null : (
    <aside aria-label={label} className={`relative flex min-h-[28rem] shrink-0 flex-col overflow-hidden border-white/10 bg-[#0a0d11] max-xl:w-full max-xl:border-t xl:w-[var(--journal-panel-width)] ${preferences.dock === "left" ? "xl:order-first xl:border-r" : "xl:border-l"}`} style={{ "--journal-panel-width": `${preferences.mode === "expanded" ? Math.max(520, preferences.width) : preferences.width}px` } as React.CSSProperties}>
      <div
        role="separator"
        aria-label="Resize workspace panel"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={(event) => { dragStartRef.current = { clientX: event.clientX, width: preferences.width }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const physicalDelta = event.key === "ArrowRight" ? 24 : -24;
          resizeBy(preferences.dock === "right" ? -physicalDelta : physicalDelta);
        }}
        className={`absolute inset-y-0 z-10 hidden w-2 cursor-col-resize outline-none hover:bg-cyan-300/20 focus-visible:bg-cyan-300/30 xl:block ${preferences.dock === "right" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
      />
      <div className="flex min-h-12 items-center gap-1 border-b border-white/10 px-2">
        <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label="Workspace panels">
          {availablePanels.map((panelId) => {
            const meta = PANEL_META[panelId];
            const Icon = meta.icon;
            return <button key={panelId} type="button" role="tab" aria-selected={activePanel === panelId} onClick={() => update({ activePanel: panelId })} className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${activePanel === panelId ? "bg-white/10 text-white" : "text-slate-500 hover:bg-white/5 hover:text-slate-200"}`}><Icon aria-hidden="true" className="h-3.5 w-3.5" />{meta.label}</button>;
          })}
        </div>
        <button type="button" onClick={() => update({ mode: preferences.mode === "compact" ? "expanded" : "compact" })} aria-label={preferences.mode === "compact" ? "Expand panel" : "Use compact panel"} className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><Columns3 aria-hidden="true" className="h-4 w-4" /></button>
        <button type="button" onClick={() => update({ dock: preferences.dock === "right" ? "left" : "right" })} aria-label={`Dock panel to ${preferences.dock === "right" ? "left" : "right"}`} className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">{preferences.dock === "right" ? <ChevronLeft aria-hidden="true" className="h-4 w-4" /> : <ChevronRight aria-hidden="true" className="h-4 w-4" />}</button>
        <button type="button" onClick={() => update({ collapsed: true })} aria-label="Collapse workspace panel" className="grid h-9 w-9 place-items-center rounded text-slate-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">{preferences.dock === "right" ? <PanelRightClose aria-hidden="true" className="h-4 w-4" /> : <PanelLeftClose aria-hidden="true" className="h-4 w-4" />}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" role="tabpanel">{slots[activePanel]}</div>
    </aside>
  );

  const collapsedRail = preferences.collapsed && availablePanels.length ? <button type="button" onClick={() => update({ collapsed: false })} className={`sticky top-3 z-10 m-2 inline-flex min-h-10 shrink-0 items-center gap-2 self-start rounded-md border border-white/10 bg-[#0d1117] px-2.5 text-xs font-medium text-slate-300 shadow-xl hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${preferences.dock === "left" ? "xl:order-first" : ""}`} aria-label="Open workspace panel"><NotebookPen aria-hidden="true" className="h-4 w-4 text-cyan-300" />Panel</button> : null;

  return <div className={`flex min-w-0 flex-col xl:flex-row ${preferences.dock === "left" ? "xl:flex-row" : ""}`}>
    <div className="min-w-0 flex-1">{children}</div>
    {panel}
    {collapsedRail}
  </div>;
}
