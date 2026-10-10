import type { BacktestSession } from "./api";
import type { AuthSession } from "./authSession";
import type { ChartDrawing } from "./charting";
import { ownPaneDrawings } from "./paneDrawingOwnership";

// The disposable preview is a distinct local origin and seeded account. A query
// flag alone must never turn a normal account's Live workspace into demo data.
export function isLocalDemoSession(user: AuthSession["user"] | null | undefined) {
  if (!import.meta.env.DEV || typeof window === "undefined"
    || !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
    || user?.deploymentMode !== "beta" || user.email !== "developer@localhost.edgelab" || user.name !== "Demo data") return false;
  try { return new URLSearchParams(window.location.search).get("preview") === "demo" || window.sessionStorage.getItem("edgelab.demo-preview") === "1"; }
  catch { return new URLSearchParams(window.location.search).get("preview") === "demo"; }
}

export function localDemoReplaySessions(sessions: readonly BacktestSession[]) {
  return sessions.filter(session => session.name.startsWith("Demo · ") && session.replay_ready);
}

export function bindLocalDemoPanes<T extends { symbol: string; drawings: ChartDrawing[]; drawingMarket?: string; drawingsByMarket: Record<string, ChartDrawing[]> }>(panes: readonly T[], sourceSymbol: string): T[] {
  const market = sourceSymbol.trim().toUpperCase();
  return panes.map(pane => {
    // Legacy drawings belong to the saved symbol, not to the newly chosen
    // synthetic source. Keep them recoverable without moving their price levels.
    const original = ownPaneDrawings(pane, pane.drawingMarket || pane.symbol.trim().toUpperCase() || market);
    const owned = ownPaneDrawings(original, market);
    return pane.symbol === sourceSymbol && owned === pane ? pane : { ...owned, symbol: sourceSymbol };
  });
}
