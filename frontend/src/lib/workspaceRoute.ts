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
  { path: "/app/journal/calendar", view: "journalDayView" },
  { path: "/app/journal/dashboard", view: "journalDashboard" },
  { path: "/app/journal", view: "journalDashboard" },
  { path: "/app/journal/sessions", view: "journalSessions" },
  { path: "/app/journal/strategies", view: "journalStrategies" },
  { path: "/app/journal/playbooks", view: "journalPlaybooks" },
  { path: "/app/journal/finance", view: "financeTracker" },
  { path: "/app/results/overview", view: "dashboard" },
  { path: "/app/results/calendar", view: "dayView" },
  { path: "/app/results/trades", view: "tradeView" },
  { path: "/app/results/notes", view: "notebook" },
  { path: "/app/accounts", view: "accounts" },
  { path: "/app/strategies", view: "strategies" },
  { path: "/app/playbooks", view: "playbooks" },
  { path: "/app/replay-settings", view: "settings" },
  { path: "/app/position-size", view: "positionSizeCalculator" },
  { path: "/app/economic-calendar", view: "economicCalendar" },
  { path: "/app/feedback", view: "feedback" },
  { path: "/app/reports", view: "reports" },
  { path: "/app/replay", view: "backtest" },
  { path: "/app/live", view: "live" },
  { path: "/app/quant", view: "live" },
  { path: "/app/order-flow", view: "orderFlow" },
  { path: "/app", view: "sessions" },
];

function routePrefix(path: string) {
  const parameterIndex = path.indexOf("/:");
  return parameterIndex < 0 ? path : path.slice(0, parameterIndex);
}

export function workspaceViewFromPath(pathname: string): WorkspaceView {
  return [...WORKSPACE_ROUTE_DEFINITIONS]
    .sort((a, b) => routePrefix(b.path).length - routePrefix(a.path).length)
    .find(({ path }) => {
    const prefix = routePrefix(path);
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  })?.view
    ?? "sessions";
}

export function workspacePathForView(view: WorkspaceView): string {
  if (view === "live") return "/app/live";
  if (view === "orderFlow") return "/app/order-flow";
  if (view === "backtest") return "/app/replay";
  if (view === "globalSettings") return "/app/settings/global";
  if (view === "journalAccounts") return "/app/journal/accounts";
  if (view === "journalTrades" || view === "journal") return "/app/journal/trades";
  if (view === "journalReports") return "/app/journal/analytics";
  if (view === "journalNotes") return "/app/journal/notes";
  if (view === "journalDayView") return "/app/journal/calendar";
  if (view === "journalSettings") return "/app/journal/settings";
  const paths: Partial<Record<WorkspaceView, string>> = {
    journalDashboard: "/app/journal/dashboard", journalSessions: "/app/journal/sessions",
    journalStrategies: "/app/journal/strategies", journalPlaybooks: "/app/journal/playbooks",
    financeTracker: "/app/journal/finance", dashboard: "/app/results/overview",
    dayView: "/app/results/calendar", tradeView: "/app/results/trades", notebook: "/app/results/notes",
    accounts: "/app/accounts", strategies: "/app/strategies", playbooks: "/app/playbooks",
    settings: "/app/replay-settings", positionSizeCalculator: "/app/position-size",
    economicCalendar: "/app/economic-calendar", feedback: "/app/feedback", reports: "/app/reports",
  };
  if (paths[view]) return paths[view]!;
  return "/app";
}

export function pushWorkspaceRoute(view: WorkspaceView) {
  if (typeof window === "undefined") return;
  const path = workspacePathForView(view);
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Keep selected entities when a command or account shortcut opens its destination. */
export function workspaceHrefForView(view: WorkspaceView, hash = "") {
  const prefixes: Partial<Record<WorkspaceView, readonly string[]>> = {
    globalSettings: ["#settings/"], journalAccounts: ["#journal/accounts"],
    journalTrades: ["#journal/trades"], journal: ["#journal/trades"],
    journalNotes: ["#journal/notes", "#journal/calendar"],
  };
  const keepHash = prefixes[view]?.some(prefix => hash.startsWith(prefix)
    && (prefix.endsWith("/") || hash.length === prefix.length || hash[prefix.length] === "?"));
  return workspacePathForView(view) + (keepHash ? hash : "");
}
