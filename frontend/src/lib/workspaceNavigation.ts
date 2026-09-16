import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  CalendarDays,
  Calculator,
  MessageSquareQuote,
  PlaySquare,
  Settings,
  Target,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceView } from "./workspace";
import { PRODUCT_TERMS } from "./productLanguage";

export const SIDEBAR_COLLAPSED_WIDTH = 76;
export const SIDEBAR_EXPANDED_WIDTH = 252;

export type WorkspaceNavigationItem = {
  description: string;
  icon: LucideIcon;
  id: WorkspaceView;
  label: string;
};

export type WorkspaceNavigationCluster = {
  children: readonly WorkspaceNavigationItem[];
  icon: LucideIcon;
  label: string;
  primaryId: WorkspaceView;
};

export type WorkspaceNavigationEntry =
  | WorkspaceNavigationItem
  | WorkspaceNavigationCluster;

export type WorkspaceNavigationSection = {
  entries: readonly WorkspaceNavigationEntry[];
  label: string;
  shortLabel: string;
  sidebar: boolean;
};

const resultItems = [
  { id: "dashboard", label: "Overview", description: "Performance at a glance", icon: BarChart3 },
  { id: "reports", label: "Metrics", description: "Detailed performance analytics", icon: BarChart3 },
  { id: "dayView", label: "Day review", description: "Inspect results by trading day", icon: CalendarDays },
  { id: "tradeView", label: "Trade log", description: "Review every completed trade", icon: Activity },
  { id: "notebook", label: "Replay notes", description: "Open notes from your replay work", icon: BookOpen },
] as const satisfies readonly WorkspaceNavigationItem[];

const journalResultItems = [
  { id: "journalDashboard", label: "Overview", description: "Journal performance at a glance", icon: BarChart3 },
  { id: "journalReports", label: "Metrics", description: "Journal performance analytics", icon: BarChart3 },
  { id: "journalDayView", label: "Day review", description: "Review journal entries by day", icon: CalendarDays },
  { id: "journalTrades", label: "Trade log", description: "Browse journaled trades", icon: Activity },
  { id: "journalNotes", label: "Notes", description: "Open your journal notes", icon: BookOpen },
] as const satisfies readonly WorkspaceNavigationItem[];

export const WORKSPACE_NAVIGATION_SECTIONS = [
  {
    label: "Trade live",
    shortLabel: "LIVE",
    sidebar: true,
    entries: [
      { id: "live", label: "Live markets", description: "Watch markets and live structure", icon: Activity },
      { id: "orderFlow", label: "Order flow", description: "Inspect attributed bid and ask activity", icon: Activity },
      { id: "positionSizeCalculator", label: "Position size", description: "Size a trade before entry", icon: Calculator },
      { id: "economicCalendar", label: "Economic calendar", description: "Track scheduled market events", icon: CalendarDays },
    ],
  },
  {
    label: `${PRODUCT_TERMS.replay} & improve`,
    shortLabel: "REPLAY",
    sidebar: true,
    entries: [
      { id: "sessions", label: `${PRODUCT_TERMS.replay} sessions`, description: "Start or resume deliberate practice", icon: PlaySquare },
      { label: "Results", primaryId: "reports", icon: BarChart3, children: resultItems },
      { id: "strategies", label: "Strategies", description: "Define and compare your setups", icon: Target },
      { id: "playbooks", label: "Playbooks", description: "Turn rules into repeatable plans", icon: BookOpen },
      { id: "accounts", label: "Replay accounts", description: "Manage simulated account profiles", icon: WalletCards },
      { id: "settings", label: "Replay settings", description: "Tune replay defaults and behavior", icon: Settings },
    ],
  },
  {
    label: `${PRODUCT_TERMS.journal} & review`,
    shortLabel: "JOURNAL",
    sidebar: true,
    entries: [
      { id: "journalSessions", label: `${PRODUCT_TERMS.journal} sessions`, description: "Capture and review live trading days", icon: PlaySquare },
      { label: "Journal results", primaryId: "journalDashboard", icon: BarChart3, children: journalResultItems },
      { id: "journalStrategies", label: "Strategies", description: "Organize journal strategy tags", icon: Target },
      { id: "journalPlaybooks", label: "Playbooks", description: "Review execution against your plans", icon: BookOpen },
      { id: "journalAccounts", label: "Trading accounts", description: "Manage journal account profiles", icon: WalletCards },
      { id: "financeTracker", label: "Income & expenses", description: "Track trading cash flow", icon: BadgeDollarSign },
      { id: "journalSettings", label: "Journal settings", description: "Configure journal defaults", icon: Settings },
    ],
  },
  {
    label: "Workspace",
    shortLabel: "SYSTEM",
    sidebar: false,
    entries: [
      { id: "globalSettings", label: `Workspace ${PRODUCT_TERMS.settings}`, description: "Manage data and workspace preferences", icon: Settings },
      { id: "feedback", label: "Feedback", description: "Share feedback with the EdgeLab team", icon: MessageSquareQuote },
    ],
  },
] as const satisfies readonly WorkspaceNavigationSection[];

export const MOBILE_PRIMARY_NAVIGATION = [
  {
    destination: "live",
    icon: Activity,
    label: "Live",
    matches: ["live", "positionSizeCalculator", "economicCalendar"],
  },
  {
    destination: "sessions",
    icon: PlaySquare,
    label: "Replay",
    matches: ["sessions", "backtest"],
  },
  {
    destination: "journalSessions",
    icon: BookOpen,
    label: "Journal",
    matches: [
      "journal",
      "journalAccounts",
      "journalDashboard",
      "journalDayView",
      "journalNotes",
      "journalPlaybooks",
      "journalReports",
      "journalSessions",
      "journalSettings",
      "journalStrategies",
      "journalTrades",
      "financeTracker",
    ],
  },
  {
    destination: "reports",
    icon: BarChart3,
    label: "Results",
    matches: ["dashboard", "reports", "dayView", "tradeView", "notebook"],
  },
] as const satisfies readonly {
  destination: WorkspaceView;
  icon: LucideIcon;
  label: string;
  matches: readonly WorkspaceView[];
}[];

const MOBILE_PRIMARY_DESTINATIONS = new Set<WorkspaceView>(
  MOBILE_PRIMARY_NAVIGATION.map((item) => item.destination),
);

export function isWorkspaceNavigationItem(
  entry: WorkspaceNavigationEntry,
): entry is WorkspaceNavigationItem {
  return "id" in entry;
}

export function workspaceNavigationItem(activeView: WorkspaceView) {
  for (const section of WORKSPACE_NAVIGATION_SECTIONS) {
    for (const entry of section.entries) {
      const items = isWorkspaceNavigationItem(entry) ? [entry] : entry.children;
      const item = items.find((candidate) => workspaceNavigationItemIsActive(candidate.id, activeView));
      if (item) return { ...item, section: section.label };
    }
  }
  return { description: "Continue your EdgeLab workflow", id: activeView, label: "Workspace", section: "EdgeLab" };
}

export function workspaceNavigationItemIsActive(
  id: WorkspaceView,
  activeView: WorkspaceView,
) {
  if (id === "sessions") {
    return activeView === "sessions" || activeView === "backtest";
  }
  if (id === "journalTrades") {
    return activeView === "journal" || activeView === "journalTrades";
  }
  return id === activeView;
}

export function workspaceNavigationEntryIsActive(
  entry: WorkspaceNavigationEntry,
  activeView: WorkspaceView,
) {
  return isWorkspaceNavigationItem(entry)
    ? workspaceNavigationItemIsActive(entry.id, activeView)
    : entry.children.some((item) => workspaceNavigationItemIsActive(item.id, activeView));
}

export function mobilePrimaryItemIsActive(
  matches: readonly WorkspaceView[],
  activeView: WorkspaceView,
) {
  return matches.includes(activeView);
}

export function mobileMoreNavigationSections() {
  const sections: Array<{
    entries: WorkspaceNavigationItem[];
    label: string;
    shortLabel: string;
    sidebar: boolean;
  }> = [];

  WORKSPACE_NAVIGATION_SECTIONS.forEach((section) => {
    const entries: WorkspaceNavigationItem[] = [];
    section.entries.forEach((entry) => {
      if (isWorkspaceNavigationItem(entry)) {
        if (!MOBILE_PRIMARY_DESTINATIONS.has(entry.id)) {
          entries.push(entry);
        }
        return;
      }
      entries.push(
        ...entry.children.filter((item) => !MOBILE_PRIMARY_DESTINATIONS.has(item.id)),
      );
    });
    if (entries.length > 0) {
      sections.push({
        entries,
        label: section.label,
        shortLabel: section.shortLabel,
        sidebar: section.sidebar,
      });
    }
  });

  return sections;
}

const SIDEBAR_STORAGE_KEY = "edgelab.workspace-sidebar-collapsed.v1";

export function loadWorkspaceSidebarCollapsed() {
  if (typeof window === "undefined") {
    return true;
  }
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "false";
}

export function saveWorkspaceSidebarCollapsed(collapsed: boolean) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  }
}
