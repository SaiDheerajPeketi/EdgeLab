import type { ChartTimeframe } from "./charting";

export type PaneSubscriptionDescriptor = {
  id: string;
  symbol: string;
  timeframe: ChartTimeframe;
  fromAt?: string;
  toAt?: string;
};

export function paneSubscriptionKey(pane: PaneSubscriptionDescriptor) {
  return `${pane.symbol.trim().toUpperCase()}:${pane.timeframe}:${pane.fromAt ?? ""}:${pane.toAt ?? ""}`;
}

export function planPaneSubscriptions(panes: PaneSubscriptionDescriptor[]) {
  const grouped = new Map<string, PaneSubscriptionDescriptor[]>();
  panes.slice(0, 16).forEach((pane) => {
    const key = paneSubscriptionKey(pane);
    grouped.set(key, [...(grouped.get(key) ?? []), { ...pane }]);
  });
  return [...grouped.entries()].map(([key, members]) => ({ key, leader: members[0], paneIds: members.map((pane) => pane.id) }));
}
