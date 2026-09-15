import type { WorkspaceView } from "./workspace";

export const WORKSPACE_ROUTE_DEFINITIONS: ReadonlyArray<{
  path: string;
  view: WorkspaceView;
}> = [
  { path: "/app/settings/:category", view: "globalSettings" },
  { path: "/app/settings", view: "globalSettings" },
  { path: "/app/journal/accounts", view: "journalAccounts" },
  { path: "/app/journal/trades", view: "journalTrades" },
  { path: "/app/journal/reports", view: "journalReports" },
  { path: "/app/journal/settings", view: "journalSettings" },
  { path: "/app/journal/analytics", view: "journalReports" },
  { path: "/app/journal/notes", view: "journalNotes" },
  { path: "/app/journal/calendar", view: "journalDashboard" },
  { path: "/app/journal/dashboard", view: "journalDashboard" },
  { path: "/app/journal", view: "journalDashboard" },
  { path: "/app/reports", view: "reports" },
  { path: "/app/replay", view: "backtest" },
  { path: "/app/live", view: "live" },
  { path: "/app/quant", view: "live" },
  { path: "/app/order-flow", view: "live" },
  { path: "/app", view: "sessions" },
];

function routePrefix(path: string) {
  const parameterIndex = path.indexOf("/:");
  return parameterIndex < 0 ? path : path.slice(0, parameterIndex);
}

export function workspaceViewFromPath(pathname: string): WorkspaceView {
  return WORKSPACE_ROUTE_DEFINITIONS.find(({ path }) => {
    const prefix = routePrefix(path);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  })?.view
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
