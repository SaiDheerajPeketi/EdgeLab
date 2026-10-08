import type { BinanceInstrument } from "./api";
import { pineContextForChart } from "./customIndicators";
import { PineProtocolError, validatePineRequest, type PineContext } from "./pineProtocol";
import { DEFAULT_PINE_INDICATOR_SOURCE } from "./customIndicators";

export function binanceChartSymbolMatches(chartSymbol: string, providerSymbol: string): boolean {
  const chart = chartSymbol.trim().toUpperCase();
  if (chart.includes(":") && !chart.startsWith("BINANCE:")) return false;
  return chart.replace(/^BINANCE:/, "").replaceAll("/", "") === providerSymbol.trim().toUpperCase();
}

/** Only an explicitly owned Binance feed may supply these spot metadata values. */
export function pineContextWithBinanceInstrument(symbol: string, timeframe: string, providerSymbol: string, instrument: BinanceInstrument): PineContext {
  if (!binanceChartSymbolMatches(symbol, providerSymbol) || instrument.symbol !== providerSymbol || instrument.status !== "TRADING" || instrument.asset_class !== "crypto") {
    throw new PineProtocolError("INVALID_CONTEXT", "Instrument details do not match this Binance chart. Reload the chart.");
  }
  const quantities = [instrument.tick_size, instrument.min_quantity, instrument.quantity_step];
  if (!quantities.every(value => typeof value === "number" && Number.isFinite(value) && value >= 1e-10 && value <= 1e9)) {
    throw new PineProtocolError("INVALID_CONTEXT", "Price tick and trade-size details are unavailable for this instrument. Reload the chart before running Pine.");
  }
  const context = { ...pineContextForChart(symbol, timeframe), mintick: instrument.tick_size!, mincontract: instrument.min_quantity!,
    quantityStep: instrument.quantity_step!, pointvalue: 1, currency: instrument.quote_asset, basecurrency: instrument.base_asset };
  return validatePineRequest({ id: "binance-context", action: "prepare", source: DEFAULT_PINE_INDICATOR_SOURCE, context }).context!;
}
