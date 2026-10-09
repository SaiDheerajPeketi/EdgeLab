import { getStoredAuthSession } from "./authSession";
import type { PineInputDefinition, PineInputValue } from "./pineProtocol";

export type PineChartInputPick = {
  symbol: string;
  timeframe: string;
  definitions: PineInputDefinition[];
  inputs: Record<string, PineInputValue>;
  anchorIds: string[];
};
type Values = Record<string, PineInputValue>;
type Endpoint = {
  symbol: string;
  timeframe: string;
  owner: string;
  pick: (request: PineChartInputPick, signal: AbortSignal) => Promise<Values | null>;
};
const endpoints = new Set<Endpoint>();
export function pineInputPickerOwner() {
  const session = getStoredAuthSession();
  return JSON.stringify([session?.user.id ?? null, session?.token ?? null]);
}

/** Only the active chart registers. No saved values cross this transient bridge. */
export function registerPineChartInputPicker(endpoint: Endpoint) {
  endpoints.add(endpoint);
  return () => { endpoints.delete(endpoint); };
}

export async function pickPineChartInputs(request: PineChartInputPick, signal: AbortSignal): Promise<Values | null> {
  if (signal.aborted) return null;
  const owner = pineInputPickerOwner();
  const matches = [...endpoints].filter(item => item.owner === owner
    && item.symbol === request.symbol && item.timeframe === request.timeframe);
  if (matches.length !== 1) throw new Error("Choose the matching active chart before picking inputs.");
  const endpoint = matches[0];
  const values = await endpoint.pick(request, signal);
  return !signal.aborted && endpoints.has(endpoint) && owner === pineInputPickerOwner() ? values : null;
}
