import { apiRequest, type Candle } from "./api";

export type MarketInstrument = {
  id: number;
  canonical_symbol: string;
  display_name: string;
  asset_class: string;
  instrument_type: string;
  exchange: string | null;
  currency: string;
  timezone: string;
  tick_size: number | string;
  active: boolean;
  identifiers: Array<{ provider: string; provider_symbol: string }>;
};

export type OrderBookLevel = { side: "BID" | "ASK"; price: number | string; size: number | string; order_count: number };
export type OrderBookSnapshot = {
  instrument_id: number;
  contract_id: number | null;
  provider: string | null;
  sequence: number | null;
  captured_at: string | null;
  status: "AVAILABLE" | "STALE" | "INCOMPLETE" | "UNAVAILABLE" | "ENTITLEMENT_REQUIRED";
  aggregation_tick_size: number | string;
  levels: OrderBookLevel[];
  message: string | null;
};

export type MarketAlertType = "PRICE_ABOVE" | "PRICE_BELOW" | "PRICE_CROSSES_ABOVE" | "PRICE_CROSSES_BELOW" | "VOLUME_ABOVE" | "DELTA_ABOVE" | "DELTA_BELOW" | "PROVIDER_STALE" | "SEQUENCE_GAP";
export type MarketAlertRule = {
  id: number;
  instrument_id: number | null;
  name: string;
  alert_type: MarketAlertType;
  condition: Record<string, unknown>;
  enabled: boolean;
  cooldown_seconds: number;
  last_value: number | string | null;
  last_evaluated_at: string | null;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
};
export type MarketAlertEvent = {
  id: number;
  rule_id: number;
  instrument_id: number | null;
  observed_at: string;
  observed_value: number | string | null;
  message: string;
  payload: Record<string, unknown>;
  acknowledged_at: string | null;
  created_at: string;
};

type NormalizedCandle = {
  start_at: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
};

export type MarketSubscription = { subscription_id: string; pane_id: string; instrument_id: number; channels: string[]; queued_events: number; dropped_events: number };

export function listMarketInstruments(search = "") {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  return apiRequest<MarketInstrument[]>(`/market-data/instruments${query.toString() ? `?${query.toString()}` : ""}`);
}

export async function resolveMarketInstrument(symbol: string) {
  const normalized = normalizeMarketSymbol(symbol);
  const instruments = await listMarketInstruments(symbol);
  return instruments.find((instrument) => instrumentSymbols(instrument).some((candidate) => normalizeMarketSymbol(candidate) === normalized)) ?? null;
}

export function getOrderBook(instrumentId: number, options: { aggregationTicks?: number; depth?: number; provider?: string | null } = {}) {
  const query = new URLSearchParams({ aggregation_ticks: String(options.aggregationTicks ?? 1), depth: String(options.depth ?? 20) });
  if (options.provider) query.set("provider", options.provider);
  return apiRequest<OrderBookSnapshot>(`/market-data/instruments/${instrumentId}/order-book?${query.toString()}`);
}

export function listMarketAlerts() { return apiRequest<MarketAlertRule[]>("/market-data/alerts"); }
export function createMarketAlert(payload: { instrument_id?: number | null; name: string; alert_type: MarketAlertType; threshold?: number | null; provider?: string | null; cooldown_seconds?: number }) { return apiRequest<MarketAlertRule>("/market-data/alerts", { method: "POST", body: JSON.stringify(payload) }); }
export function deleteMarketAlert(ruleId: number) { return apiRequest<{ ok: boolean }>(`/market-data/alerts/${ruleId}`, { method: "DELETE" }); }
export function listMarketAlertEvents(acknowledged?: boolean) { const query = acknowledged == null ? "" : `?acknowledged=${acknowledged ? "true" : "false"}`; return apiRequest<MarketAlertEvent[]>(`/market-data/alert-events${query}`); }
export function acknowledgeMarketAlertEvent(eventId: number) { return apiRequest<MarketAlertEvent>(`/market-data/alert-events/${eventId}/acknowledge`, { method: "POST" }); }

export function createMarketSubscription(payload: { pane_id: string; instrument_id: number; channels: Array<"CANDLES" | "TRADES" | "DEPTH" | "FOOTPRINT" | "DIAGNOSTICS"> }) { return apiRequest<MarketSubscription>("/market-data/subscriptions", { method: "POST", body: JSON.stringify(payload) }); }
export function deleteMarketSubscription(subscriptionId: string) { return apiRequest<{ ok: boolean }>(`/market-data/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" }); }

export async function loadNormalizedCandles(instrumentId: number, intervalSeconds: number, options: { from?: Date; to?: Date; limit?: number } = {}) {
  const to = options.to ?? new Date();
  const from = options.from ?? new Date(to.getTime() - intervalSeconds * 1000 * Math.min(options.limit ?? 500, 5000));
  const query = new URLSearchParams({ from_at: from.toISOString(), to_at: to.toISOString(), interval_seconds: String(intervalSeconds), limit: String(options.limit ?? 500) });
  const rows = await apiRequest<NormalizedCandle[]>(`/market-data/instruments/${instrumentId}/candles?${query.toString()}`);
  return rows.map<Candle>((row) => ({ time: Math.floor(Date.parse(row.start_at) / 1000), timestamp: row.start_at, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume), ema_20: null, ema_50: null, rsi_14: null }));
}

export function normalizeMarketSymbol(value: string) { return value.toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function instrumentSymbols(instrument: MarketInstrument) { return [instrument.canonical_symbol, instrument.display_name, ...instrument.identifiers.map((identifier) => identifier.provider_symbol)]; }
