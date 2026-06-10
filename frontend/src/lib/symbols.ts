const MARKET_SYMBOLS: Record<string, { badge: string; label: string }> = {
  NIFTY50: { badge: "NSE", label: "NSE:NIFTY" },
};

const PAIR_CODES = new Set([
  "AUD",
  "CAD",
  "CHF",
  "EUR",
  "GBP",
  "JPY",
  "NZD",
  "USD",
  "XAG",
  "XAU",
]);

export function formatMarketSymbol(symbol: string | null | undefined) {
  const normalized = normalizeSymbol(symbol);
  return MARKET_SYMBOLS[normalized]?.label ?? formatPairSymbol(normalized);
}

export function symbolBadge(symbol: string | null | undefined) {
  const normalized = normalizeSymbol(symbol);
  return MARKET_SYMBOLS[normalized]?.badge ?? splitPairSymbol(normalized)?.base ?? normalized.slice(0, 3);
}

function normalizeSymbol(symbol: string | null | undefined) {
  return (symbol || "EURUSD").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function formatPairSymbol(symbol: string) {
  const pair = splitPairSymbol(symbol);
  return pair ? `${pair.base}/${pair.quote}` : symbol;
}

function splitPairSymbol(symbol: string) {
  if (symbol.length !== 6) {
    return null;
  }
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  return PAIR_CODES.has(base) && PAIR_CODES.has(quote) ? { base, quote } : null;
}
