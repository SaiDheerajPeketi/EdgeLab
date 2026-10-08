/** Identity of the chart inputs that produced a runtime result. */
export type ChartRuntimeOwner = {
  bars: readonly unknown[];
  indicators: readonly unknown[];
  mode: "historical" | "live";
  symbol: string;
  timeframe: string;
  contextKey: string;
  metadataKey?: string;
  feed?: object;
  feedEpoch?: number;
  userId?: number;
  token?: string;
};

export function chartRuntimeOwnerMatches(owner: ChartRuntimeOwner | null, current: ChartRuntimeOwner): boolean {
  return owner !== null && owner.bars === current.bars && owner.indicators === current.indicators
    && owner.mode === current.mode && owner.symbol === current.symbol && owner.timeframe === current.timeframe
    && owner.contextKey === current.contextKey && owner.metadataKey === current.metadataKey
    && owner.feed === current.feed && owner.feedEpoch === current.feedEpoch
    && owner.userId === current.userId && owner.token === current.token;
}
