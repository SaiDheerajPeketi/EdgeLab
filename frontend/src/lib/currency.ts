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

  const byCsvPath = findDatasetInstrumentByCsvPath(session.csv_path, datasets.instruments);
  if (byCsvPath) {
    return byCsvPath.currency;
  }

  const byInstrument = findDatasetInstrumentByKey(session.instrument, datasets.instruments);
  if (byInstrument) {
    return byInstrument.currency;
  }

  const bySymbol = findDatasetInstrumentByKey(session.symbol, datasets.instruments);
  return bySymbol?.currency ?? null;
}

function findDatasetInstrumentByCsvPath(
  csvPath: string | null | undefined,
  instruments: DatasetInstrument[],
) {
  const normalizedPath = normalizeDatasetKey(csvPath);
  if (!normalizedPath) {
    return null;
  }
  return (
    instruments.find((instrument) =>
      instrument.timeframes.some((timeframe) => normalizeDatasetKey(timeframe.csv_path) === normalizedPath),
    ) ?? null
  );
}

function findDatasetInstrumentByKey(
  key: string | null | undefined,
  instruments: DatasetInstrument[],
) {
  const normalizedKey = normalizeDatasetKey(key);
  if (!normalizedKey) {
    return null;
  }
  return (
    instruments.find((instrument) =>
      [instrument.id, instrument.symbol]
        .map(normalizeDatasetKey)
        .some((value) => value === normalizedKey),
    ) ?? null
  );
}

function normalizeDatasetKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}
