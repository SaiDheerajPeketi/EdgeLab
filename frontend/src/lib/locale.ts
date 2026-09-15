export type LocaleFormatOptions = {
  locale?: string | string[];
};

export function interfaceLocale(locale?: string | string[]) {
  if (locale) return locale;
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  return undefined;
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
