import { Bell, Bot, Braces, Columns3, Eye, List, ListTree, NotebookPen } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { WorkspacePanelManager } from "../ui/WorkspacePanelManager";
import { hydrateJournalPanelPreferences, loadJournalPanelPreferences, saveJournalPanelPreferences, type JournalPanelId } from "../../lib/journalWorkspaceState";

const PANEL_META = {
  journal: { label: "Journal", icon: NotebookPen }, watchlist: { label: "Watchlist", icon: List }, quant: { label: "Quant", icon: Bot },
  "data-window": { label: "Data window", icon: Eye }, objects: { label: "Objects", icon: Columns3 }, code: { label: "Code", icon: Braces },
  "order-book": { label: "Order book", icon: ListTree }, alerts: { label: "Alerts", icon: Bell },
} as const;

export type JournalPanelSlots = Partial<Record<JournalPanelId, ReactNode>>;

export function JournalPanelManager({ children, slots, label = "Workspace tools" }: { children: ReactNode; slots: JournalPanelSlots; label?: string }) {
  const definitions = useMemo(() => (Object.keys(slots) as JournalPanelId[]).filter((id) => slots[id] != null).map((id) => ({ id, ...PANEL_META[id], content: slots[id] })), [slots]);
  return <WorkspacePanelManager definitions={definitions} label={label} load={hydrateJournalPanelPreferences} onChange={saveJournalPanelPreferences} value={loadJournalPanelPreferences()}>{children}</WorkspacePanelManager>;
}
