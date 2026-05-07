import type { BacktestSession, DatasetCatalog, DatasetInstrument } from "./api";

const DEFAULT_CURRENCY = "USD";

export function normalizeCurrencyCode(value: string | null | undefined) {
  const currency = value?.trim().toUpperCase();
  return currency || DEFAULT_CURRENCY;
}

export function currencyForSession(
  session: BacktestSession | null | undefined,
  datasets: DatasetCatalog | null | undefined,
) {
  return normalizeCurrencyCode(
    datasetCurrencyForSession(session, datasets) ?? session?.currency ?? DEFAULT_CURRENCY,
  );
}

export function currencyForSessions(
  sessions: BacktestSession[],
  datasets: DatasetCatalog | null | undefined,
) {
  const currencies = sessions
    .map((session) => currencyForSession(session, datasets))
    .filter(Boolean);
  return currencies[0] ?? DEFAULT_CURRENCY;
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
