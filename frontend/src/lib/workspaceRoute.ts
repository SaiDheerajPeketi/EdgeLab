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
