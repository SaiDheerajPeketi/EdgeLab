import { MIXED_CURRENCY, normalizeCurrencyCode } from "./currency";
import { formatLocaleCurrency, formatLocaleDateTime, formatLocaleNumber } from "./locale";

export function formatPrice(
  value: number | null | undefined,
  options: { precision?: number } = {},
) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  if (options.precision != null && Number.isFinite(options.precision)) {
    const precision = Math.max(0, Math.min(12, Math.round(options.precision)));
    return formatLocaleNumber(value, {
      useGrouping: false,
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }
  return formatLocaleNumber(value, {
    useGrouping: false,
    minimumFractionDigits: 5,
    maximumFractionDigits: 12,
  });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return formatLocaleDateTime(date, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMoney(value: number | null | undefined, currency = "USD") {
  const currencyCode = normalizeCurrencyCode(currency);
  if (currencyCode === MIXED_CURRENCY) {
    return `Mixed ${formatLocaleNumber(value ?? 0, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;
  }
  try {
    return formatLocaleCurrency(value, currencyCode);
  } catch {
    return `${currencyCode} ${formatLocaleNumber(value ?? 0, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })}`;
  }
}

export function formatPercent(value: number | null | undefined) {
  return formatLocaleNumber(value ?? 0, {
    style: "percent",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
}
