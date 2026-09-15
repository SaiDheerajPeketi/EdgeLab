export type ChartTradingHoursMode = "regular" | "extended";

export type ChartSessionPhase =
  | "regular"
  | "premarket"
  | "postmarket"
  | "closed";

export type ChartSessionTemplateId =
  | "always-open"
  | "crypto-24x7"
  | "forex-24x5"
  | "us-equity"
  | "cme-futures"
  | "eurex-futures"
  | "nse-equity"
  | "lse-equity"
  | "tse-equity";

export type ChartSessionTemplatePreference = "auto" | ChartSessionTemplateId;

type SessionWindow = {
  days: readonly number[];
  endMinute: number;
  startMinute: number;
};

export type ChartSessionTemplate = {
  exchange: string;
  id: ChartSessionTemplateId;
  label: string;
  postMarket: readonly SessionWindow[];
  preMarket: readonly SessionWindow[];
  regular: readonly SessionWindow[];
  scheduleLabel: string;
  timeZone: string;
  tradingDayRolloverMinute: number;
};

type SessionBar = {
  time: number;
};

const SUNDAY = 0;
const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;
const FRIDAY = 5;
const SATURDAY = 6;
const EVERY_DAY = [SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY];
const WEEKDAYS = [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY];
const MONDAY_TO_THURSDAY = [MONDAY, TUESDAY, WEDNESDAY, THURSDAY];

export const CHART_SESSION_TEMPLATES: readonly ChartSessionTemplate[] = [
  {
    exchange: "Fallback",
    id: "always-open",
    label: "Continuous / unknown",
    postMarket: [],
    preMarket: [],
    regular: [window(EVERY_DAY, 0, 24 * 60)],
    scheduleLabel: "All published bars",
    timeZone: "UTC",
    tradingDayRolloverMinute: 0,
  },
  {
    exchange: "Crypto",
    id: "crypto-24x7",
    label: "Crypto 24×7",
    postMarket: [],
    preMarket: [],
    regular: [window(EVERY_DAY, 0, 24 * 60)],
    scheduleLabel: "24 hours · every day",
    timeZone: "UTC",
    tradingDayRolloverMinute: 0,
  },
  {
    exchange: "Global FX",
    id: "forex-24x5",
    label: "Forex 24×5",
    postMarket: [],
    preMarket: [],
    regular: [
      window([SUNDAY], 17 * 60, 24 * 60),
      window(MONDAY_TO_THURSDAY, 0, 24 * 60),
      window([FRIDAY], 0, 17 * 60),
    ],
    scheduleLabel: "Sun 17:00 – Fri 17:00 New York",
    timeZone: "America/New_York",
    tradingDayRolloverMinute: 17 * 60,
  },
  {
    exchange: "NYSE / Nasdaq",
    id: "us-equity",
    label: "US equities",
    postMarket: [window(WEEKDAYS, 16 * 60, 20 * 60)],
    preMarket: [window(WEEKDAYS, 4 * 60, 9 * 60 + 30)],
    regular: [window(WEEKDAYS, 9 * 60 + 30, 16 * 60)],
    scheduleLabel: "09:30–16:00 New York",
    timeZone: "America/New_York",
    tradingDayRolloverMinute: 0,
  },
  {
    exchange: "CME / CBOT / NYMEX / COMEX",
    id: "cme-futures",
    label: "CME futures",
    postMarket: [window(WEEKDAYS, 15 * 60, 16 * 60)],
    preMarket: [
      window([SUNDAY], 17 * 60, 24 * 60),
      window(WEEKDAYS, 0, 8 * 60 + 30),
      window(MONDAY_TO_THURSDAY, 17 * 60, 24 * 60),
    ],
    regular: [window(WEEKDAYS, 8 * 60 + 30, 15 * 60)],
    scheduleLabel: "08:30–15:00 Chicago · 17:00 overnight open",
    timeZone: "America/Chicago",
    tradingDayRolloverMinute: 17 * 60,
  },
  {
    exchange: "Eurex",
    id: "eurex-futures",
    label: "Eurex futures",
    postMarket: [],
    preMarket: [window(WEEKDAYS, 1 * 60 + 10, 8 * 60)],
    regular: [window(WEEKDAYS, 8 * 60, 22 * 60)],
    scheduleLabel: "08:00–22:00 Frankfurt",
    timeZone: "Europe/Berlin",
    tradingDayRolloverMinute: 0,
  },
  {
    exchange: "NSE",
    id: "nse-equity",
    label: "India equities",
    postMarket: [window(WEEKDAYS, 15 * 60 + 30, 16 * 60)],
    preMarket: [window(WEEKDAYS, 9 * 60, 9 * 60 + 15)],
    regular: [window(WEEKDAYS, 9 * 60 + 15, 15 * 60 + 30)],
    scheduleLabel: "09:15–15:30 Kolkata",
    timeZone: "Asia/Kolkata",
    tradingDayRolloverMinute: 0,
  },
  {
    exchange: "London Stock Exchange",
    id: "lse-equity",
    label: "UK equities",
    postMarket: [window(WEEKDAYS, 16 * 60 + 30, 17 * 60 + 15)],
    preMarket: [window(WEEKDAYS, 5 * 60 + 5, 8 * 60)],
    regular: [window(WEEKDAYS, 8 * 60, 16 * 60 + 30)],
    scheduleLabel: "08:00–16:30 London",
    timeZone: "Europe/London",
    tradingDayRolloverMinute: 0,
  },
  {
    exchange: "Tokyo Stock Exchange",
    id: "tse-equity",
    label: "Japan equities",
    postMarket: [window(WEEKDAYS, 15 * 60 + 30, 17 * 60)],
    preMarket: [window(WEEKDAYS, 8 * 60, 9 * 60)],
    regular: [
      window(WEEKDAYS, 9 * 60, 11 * 60 + 30),
      window(WEEKDAYS, 12 * 60 + 30, 15 * 60 + 30),
    ],
    scheduleLabel: "09:00–11:30 / 12:30–15:30 Tokyo",
    timeZone: "Asia/Tokyo",
    tradingDayRolloverMinute: 0,
  },
] as const;

const TEMPLATE_BY_ID = new Map(
  CHART_SESSION_TEMPLATES.map((template) => [template.id, template]),
);

const FX_CURRENCIES = new Set([
  "AUD",
  "CAD",
  "CHF",
  "CNH",
  "EUR",
  "GBP",
  "HKD",
  "JPY",
  "MXN",
  "NOK",
  "NZD",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);

const CRYPTO_BASES = new Set([
  "ADA",
  "AVAX",
  "BNB",
  "BTC",
  "DOGE",
  "DOT",
  "ETH",
  "LINK",
  "LTC",
  "MATIC",
  "SOL",
  "TON",
  "TRX",
  "UNI",
  "XRP",
]);

const FUTURES_ROOTS = new Set([
  "6A",
  "6B",
  "6C",
  "6E",
  "6J",
  "6N",
  "6S",
  "CL",
  "ES",
  "GC",
  "HE",
  "HG",
  "LE",
  "M2K",
  "MCL",
  "MES",
  "MGC",
  "MNQ",
  "MYM",
  "NG",
  "NQ",
  "RTY",
  "SI",
  "UB",
  "YM",
  "ZB",
  "ZC",
  "ZF",
  "ZL",
  "ZN",
  "ZS",
  "ZW",
]);

const EUREX_ROOTS = new Set(["DAX", "FDAX", "FDXM", "FESX", "FGBL", "FGBM"]);
const US_EQUITY_PREFIXES = ["AMEX:", "ARCA:", "NASDAQ:", "NYSE:", "NYSEARCA:"];

const sessionPartsFormatters = new Map<string, Intl.DateTimeFormat>();

export function sanitizeTradingHoursMode(value: unknown): ChartTradingHoursMode {
  return value === "regular" ? "regular" : "extended";
}

export function sanitizeSessionTemplatePreference(
  value: unknown,
): ChartSessionTemplatePreference {
  return value === "auto" || TEMPLATE_BY_ID.has(value as ChartSessionTemplateId)
    ? (value as ChartSessionTemplatePreference)
    : "auto";
}

export function getChartSessionTemplate(
  id: ChartSessionTemplateId,
): ChartSessionTemplate {
  return TEMPLATE_BY_ID.get(id) ?? TEMPLATE_BY_ID.get("always-open")!;
}

export function resolveChartSessionTemplate(
  symbol: string | null | undefined,
  preference: ChartSessionTemplatePreference = "auto",
): ChartSessionTemplate {
  if (preference !== "auto") {
    return getChartSessionTemplate(preference);
  }

  const raw = (symbol ?? "").trim().toUpperCase();
  const core = raw.split(":").at(-1)?.replace(/[^A-Z0-9!.]/g, "") ?? "";
  const provider = raw.includes(":") ? raw.slice(0, raw.lastIndexOf(":")) : "";
  const futuresRoot = normalizeFuturesRoot(core);

  if (/BINANCE|BYBIT|COINBASE|KRAKEN|CRYPTO/.test(provider) || isCryptoSymbol(core)) {
    return getChartSessionTemplate("crypto-24x7");
  }
  if (/CME|CBOT|NYMEX|COMEX/.test(provider) || FUTURES_ROOTS.has(futuresRoot)) {
    return getChartSessionTemplate("cme-futures");
  }
  if (/EUREX/.test(provider) || EUREX_ROOTS.has(futuresRoot)) {
    return getChartSessionTemplate("eurex-futures");
  }
  if (/NSE|BSE/.test(provider) || /^(BANKNIFTY|FINNIFTY|NIFTY)/.test(core)) {
    return getChartSessionTemplate("nse-equity");
  }
  if (/LSE|LON/.test(provider) || /\.L$/.test(raw)) {
    return getChartSessionTemplate("lse-equity");
  }
  if (/TSE|TYO|JPX/.test(provider) || /\.T$/.test(raw)) {
    return getChartSessionTemplate("tse-equity");
  }
  if (/FOREX|FX|OANDA|DUKASCOPY/.test(provider) || isForexPair(core)) {
    return getChartSessionTemplate("forex-24x5");
  }
  if (US_EQUITY_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
    return getChartSessionTemplate("us-equity");
  }
  if (!provider && /^[A-Z][A-Z0-9.]{0,5}$/.test(raw)) {
    return getChartSessionTemplate("us-equity");
  }

  return getChartSessionTemplate("always-open");
}

export function sessionPhaseAt(
  value: Date | number | string,
  template: ChartSessionTemplate,
): ChartSessionPhase {
  const parts = zonedSessionParts(value, template.timeZone);
  if (!parts) {
    return "regular";
  }
  const minute = parts.hour * 60 + parts.minute;
  if (matchesWindow(parts.weekday, minute, template.regular)) {
    return "regular";
  }
  if (matchesWindow(parts.weekday, minute, template.preMarket)) {
    return "premarket";
  }
  if (matchesWindow(parts.weekday, minute, template.postMarket)) {
    return "postmarket";
  }
  return "closed";
}

export function filterBarsForTradingSession<T extends SessionBar>(
  bars: readonly T[],
  mode: ChartTradingHoursMode,
  template: ChartSessionTemplate,
): T[] {
  if (mode === "extended") {
    return [...bars];
  }
  return bars.filter((bar) => sessionPhaseAt(bar.time, template) === "regular");
}

export function sessionTradingDayKey(
  value: Date | number | string,
  template: ChartSessionTemplate,
): string | null {
  const parts = zonedSessionParts(value, template.timeZone);
  if (!parts) {
    return null;
  }
  const minute = parts.hour * 60 + parts.minute;
  if (
    template.tradingDayRolloverMinute > 0 &&
    minute >= template.tradingDayRolloverMinute
  ) {
    const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    return dateKey(
      nextDay.getUTCFullYear(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCDate(),
    );
  }
  return dateKey(parts.year, parts.month, parts.day);
}

export function chartSessionPhaseLabel(phase: ChartSessionPhase): string {
  return {
    closed: "Closed",
    postmarket: "Post-market",
    premarket: "Pre-market",
    regular: "Regular",
  }[phase];
}

function window(
  days: readonly number[],
  startMinute: number,
  endMinute: number,
): SessionWindow {
  return { days, endMinute, startMinute };
}

function matchesWindow(
  weekday: number,
  minute: number,
  windows: readonly SessionWindow[],
) {
  return windows.some(
    (candidate) =>
      candidate.days.includes(weekday) &&
      minute >= candidate.startMinute &&
      minute < candidate.endMinute,
  );
}

function normalizeFuturesRoot(symbol: string) {
  return symbol
    .replace(/1!$/, "")
    .replace(/[FGHJKMNQUVXZ]\d{1,4}$/, "");
}

function isCryptoSymbol(symbol: string) {
  if (CRYPTO_BASES.has(symbol)) {
    return true;
  }
  const quote = ["USDT", "USDC", "USD", "BTC", "ETH"].find((candidate) =>
    symbol.endsWith(candidate),
  );
  const base = quote ? symbol.slice(0, -quote.length) : symbol;
  return CRYPTO_BASES.has(base) && (Boolean(quote) || symbol.length <= 5);
}

function isForexPair(symbol: string) {
  if (symbol.length !== 6) {
    return false;
  }
  return FX_CURRENCIES.has(symbol.slice(0, 3)) && FX_CURRENCIES.has(symbol.slice(3));
}

function zonedSessionParts(
  value: Date | number | string,
  timeZone: string,
): {
  day: number;
  hour: number;
  minute: number;
  month: number;
  weekday: number;
  year: number;
} | null {
  const date = sessionDate(value);
  if (!date) {
    return null;
  }
  let formatter = sessionPartsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      weekday: "short",
      year: "numeric",
    });
    sessionPartsFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday,
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return weekday >= 0 && [year, month, day, hour, minute].every(Number.isFinite)
    ? { day, hour, minute, month, weekday, year }
    : null;
}

function sessionDate(value: Date | number | string): Date | null {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "number"
        ? new Date(Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value)
        : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateKey(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
