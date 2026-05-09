import type { BacktestSession, DatasetCatalog, DatasetInstrument, Trade } from "./api";

export const DEFAULT_CURRENCY = "USD";
export const MIXED_CURRENCY = "MIXED";

export function normalizeCurrencyCode(value: string | null | undefined) {
  const currency = value?.trim().toUpperCase();
  return currency || DEFAULT_CURRENCY;
}

export function currencyForSession(
  session: BacktestSession | null | undefined,
  datasets: DatasetCatalog | null | undefined,
) {
  return normalizeCurrencyCode(
    session?.currency ?? datasetCurrencyForSession(session, datasets) ?? DEFAULT_CURRENCY,
  );
}

export function currencyForSessions(
  sessions: BacktestSession[],
  datasets: DatasetCatalog | null | undefined,
) {
  const currencies = new Set(
    sessions
      .map((session) => currencyForSession(session, datasets))
      .filter(Boolean),
  );
  if (currencies.size > 1) {
    return MIXED_CURRENCY;
  }
  return currencies.values().next().value ?? DEFAULT_CURRENCY;
}

export function currencyForTrades(
  trades: Trade[],
  sessionById: Map<number, BacktestSession>,
  datasets: DatasetCatalog | null | undefined,
  fallbackCurrency = DEFAULT_CURRENCY,
) {
  const sessions = Array.from(
    new Map(
      trades
        .map((trade) => sessionById.get(trade.session_id))
        .filter((session): session is BacktestSession => Boolean(session))
        .map((session) => [session.id, session] as const),
    ).values(),
  );
  if (sessions.length === 0) {
    return normalizeCurrencyCode(fallbackCurrency);
  }
  return currencyForSessions(sessions, datasets);
}

function datasetCurrencyForSession(
  session: BacktestSession | null | undefined,
  datasets: DatasetCatalog | null | undefined,
) {
  if (!session || !datasets) {
    return null;
  }
  const instrument = findDatasetInstrument(session, datasets.instruments);
  return instrument?.currency ?? null;
}

function findDatasetInstrument(
  session: BacktestSession,
  instruments: DatasetInstrument[],
) {
  const keys = [session.instrument, session.symbol]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toUpperCase());
  if (keys.length === 0) {
    return null;
  }
  return (
    instruments.find((instrument) =>
      [instrument.id, instrument.symbol, instrument.name]
        .map((value) => value.trim().toUpperCase())
        .some((value) => keys.includes(value)),
    ) ?? null
  );
}
