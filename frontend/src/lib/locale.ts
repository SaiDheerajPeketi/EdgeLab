export type LocaleFormatOptions = {
  locale?: string | string[];
};

export function interfaceLocale(locale?: string | string[]) {
  const requested = locale
    ?? (typeof document !== "undefined" ? document.documentElement.lang : undefined);
  if (!requested) return undefined;

  const candidates = Array.isArray(requested) ? requested : [requested];
  const canonical = candidates.flatMap((candidate) => {
    if (typeof candidate !== "string" || !candidate.trim()) return [];
    try {
      return Intl.getCanonicalLocales(candidate.trim());
    } catch {
      return [];
    }
  });
  return canonical.length ? canonical : undefined;
}

export function formatLocaleNumber(
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = {},
  locale?: string | string[],
) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(interfaceLocale(locale), options).format(value);
}

export function formatLocaleCurrency(
  value: number | null | undefined,
  currency: string,
  options: Intl.NumberFormatOptions = {},
  locale?: string | string[],
) {
  const safeValue = value != null && Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(interfaceLocale(locale), {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      ...options,
    }).format(safeValue);
  } catch {
    return `${currency} ${formatLocaleNumber(safeValue, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
      ...options,
    }, locale)}`;
  }
}

export function formatLocaleDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {},
  locale?: string | string[],
) {
  if (value == null || value === "") return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(interfaceLocale(locale), options).format(date);
}

export function formatMetricPercent(value: number, locale?: string | string[]) {
  return formatLocaleNumber(value, {
    style: "percent",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }, locale);
}

export function formatMetricRatio(
  value: number | null | undefined,
  locale?: string | string[],
) {
  if (value == null) return "—";
  return formatLocaleNumber(value, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }, locale);
}
