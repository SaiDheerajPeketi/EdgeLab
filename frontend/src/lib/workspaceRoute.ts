import type { WorkspaceView } from "./workspace";

const ROUTE_TO_WORKSPACE: ReadonlyArray<readonly [string, WorkspaceView]> = [
  ["/app/settings", "globalSettings"],
  ["/app/journal/accounts", "journalAccounts"],
  ["/app/journal/trades", "journalTrades"],
  ["/app/journal/reports", "journalReports"],
  ["/app/journal/settings", "journalSettings"],
  ["/app/journal/analytics", "journalReports"],
  ["/app/journal/notes", "journalNotes"],
  ["/app/journal", "journalDashboard"],
  ["/app/reports", "reports"],
  ["/app/replay", "backtest"],
  ["/app/live", "live"],
  ["/app/quant", "live"],
  ["/app/order-flow", "live"],
];

export function workspaceViewFromPath(pathname: string): WorkspaceView {
  return ROUTE_TO_WORKSPACE.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1]
    ?? "sessions";
}

export function workspacePathForView(view: WorkspaceView): string {
  if (view === "live") return "/app/live";
  if (view === "backtest") return "/app/replay";
  if (view === "globalSettings") return "/app/settings/global";
  if (view === "journalAccounts") return "/app/journal/accounts";
  if (view === "journalTrades" || view === "journal") return "/app/journal/trades";
  if (view === "journalReports") return "/app/journal/analytics";
  if (view === "journalNotes") return "/app/journal/notes";
  if (view === "journalSettings") return "/app/journal/settings";
  if (view.startsWith("journal") || view === "financeTracker") return "/app/journal/dashboard";
  if (["dashboard", "reports", "dayView", "tradeView", "notebook"].includes(view)) return "/app/reports";
  return "/app";
}

export function pushWorkspaceRoute(view: WorkspaceView) {
  if (typeof window === "undefined") return;
  const path = workspacePathForView(view);
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
