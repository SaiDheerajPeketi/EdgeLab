import { MIXED_CURRENCY, normalizeCurrencyCode } from "./currency";

export function formatPrice(
  value: number | null | undefined,
  options: { precision?: number } = {},
) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  if (options.precision != null && Number.isFinite(options.precision)) {
    const precision = Math.max(0, Math.min(12, Math.round(options.precision)));
    return new Intl.NumberFormat("en-US", {
      useGrouping: false,
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    useGrouping: false,
    minimumFractionDigits: 5,
    maximumFractionDigits: 12,
  }).format(value);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString([], {
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
    return `Mixed ${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value ?? 0)}`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(value ?? 0);
  } catch {
    return `${currencyCode} ${new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value ?? 0)}`;
  }
}

export function formatPercent(value: number | null | undefined) {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}
