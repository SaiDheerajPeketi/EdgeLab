const TV_SYMBOLS: Record<string, { badge: string; label: string }> = {
  EURUSD: { badge: "FX", label: "OANDA:EURUSD" },
  NIFTY50: { badge: "NSE", label: "NSE:NIFTY" },
  XAUUSD: { badge: "XAU", label: "OANDA:XAUUSD" },
};

export function formatTradingViewSymbol(symbol: string | null | undefined) {
  const normalized = normalizeSymbol(symbol);
  return TV_SYMBOLS[normalized]?.label ?? normalized;
}

export function symbolBadge(symbol: string | null | undefined) {
  const normalized = normalizeSymbol(symbol);
  return TV_SYMBOLS[normalized]?.badge ?? normalized.slice(0, 3);
}

function normalizeSymbol(symbol: string | null | undefined) {
  return (symbol || "EURUSD").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}
