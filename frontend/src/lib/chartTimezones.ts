export const DEFAULT_CHART_TIME_ZONE = "UTC" as const;

export const CHART_TIMEZONES = [
  { id: "UTC", label: "UTC", region: "Universal", searchTerms: ["gmt", "zulu", "coordinated universal time"] },
  { id: "America/New_York", label: "New York", region: "Americas", searchTerms: ["eastern", "est", "edt", "nyse"] },
  { id: "America/Chicago", label: "Chicago", region: "Americas", searchTerms: ["central", "cst", "cdt", "cme"] },
  { id: "America/Denver", label: "Denver", region: "Americas", searchTerms: ["mountain", "mst", "mdt"] },
  { id: "America/Los_Angeles", label: "Los Angeles", region: "Americas", searchTerms: ["pacific", "pst", "pdt"] },
  { id: "America/Toronto", label: "Toronto", region: "Americas", searchTerms: ["canada", "eastern"] },
  { id: "America/Vancouver", label: "Vancouver", region: "Americas", searchTerms: ["canada", "pacific"] },
  { id: "America/Mexico_City", label: "Mexico City", region: "Americas", searchTerms: ["mexico", "central"] },
  { id: "America/Sao_Paulo", label: "São Paulo", region: "Americas", searchTerms: ["brazil", "bovespa", "brasilia"] },
  { id: "America/Argentina/Buenos_Aires", label: "Buenos Aires", region: "Americas", searchTerms: ["argentina"] },
  { id: "Pacific/Honolulu", label: "Honolulu", region: "Americas", searchTerms: ["hawaii", "hst"] },
  { id: "Europe/London", label: "London", region: "Europe", searchTerms: ["uk", "gmt", "bst"] },
  { id: "Europe/Dublin", label: "Dublin", region: "Europe", searchTerms: ["ireland", "gmt"] },
  { id: "Europe/Lisbon", label: "Lisbon", region: "Europe", searchTerms: ["portugal", "wet"] },
  { id: "Europe/Paris", label: "Paris", region: "Europe", searchTerms: ["france", "cet", "cest"] },
  { id: "Europe/Berlin", label: "Berlin", region: "Europe", searchTerms: ["germany", "cet", "cest"] },
  { id: "Europe/Zurich", label: "Zurich", region: "Europe", searchTerms: ["switzerland", "six", "cet"] },
  { id: "Europe/Madrid", label: "Madrid", region: "Europe", searchTerms: ["spain", "cet"] },
  { id: "Europe/Rome", label: "Rome", region: "Europe", searchTerms: ["italy", "cet"] },
  { id: "Europe/Warsaw", label: "Warsaw", region: "Europe", searchTerms: ["poland", "cet"] },
  { id: "Europe/Athens", label: "Athens", region: "Europe", searchTerms: ["greece", "eet"] },
  { id: "Europe/Istanbul", label: "Istanbul", region: "Europe", searchTerms: ["turkey", "trt"] },
  { id: "Europe/Moscow", label: "Moscow", region: "Europe", searchTerms: ["russia", "msk"] },
  { id: "Africa/Cairo", label: "Cairo", region: "Africa", searchTerms: ["egypt", "eet"] },
  { id: "Africa/Johannesburg", label: "Johannesburg", region: "Africa", searchTerms: ["south africa", "sast"] },
  { id: "Africa/Lagos", label: "Lagos", region: "Africa", searchTerms: ["nigeria", "wat"] },
  { id: "Asia/Dubai", label: "Dubai", region: "Asia", searchTerms: ["uae", "gulf", "gst"] },
  { id: "Asia/Kolkata", label: "India (Kolkata)", region: "Asia", searchTerms: ["india", "mumbai", "delhi", "ist", "utc 5 30"] },
  { id: "Asia/Bangkok", label: "Bangkok", region: "Asia", searchTerms: ["thailand", "ict"] },
  { id: "Asia/Jakarta", label: "Jakarta", region: "Asia", searchTerms: ["indonesia", "wib"] },
  { id: "Asia/Singapore", label: "Singapore", region: "Asia", searchTerms: ["sgt", "sgx"] },
  { id: "Asia/Hong_Kong", label: "Hong Kong", region: "Asia", searchTerms: ["hkt", "hkex"] },
  { id: "Asia/Shanghai", label: "Shanghai", region: "Asia", searchTerms: ["china", "cst", "sse"] },
  { id: "Asia/Tokyo", label: "Tokyo", region: "Asia", searchTerms: ["japan", "jst", "tse"] },
  { id: "Asia/Seoul", label: "Seoul", region: "Asia", searchTerms: ["korea", "kst"] },
  { id: "Australia/Perth", label: "Perth", region: "Oceania", searchTerms: ["western australia", "awst"] },
  { id: "Australia/Sydney", label: "Sydney", region: "Oceania", searchTerms: ["australia", "aest", "aedt", "asx"] },
  { id: "Australia/Melbourne", label: "Melbourne", region: "Oceania", searchTerms: ["australia", "aest", "aedt"] },
  { id: "Pacific/Auckland", label: "Auckland", region: "Oceania", searchTerms: ["new zealand", "nzst", "nzdt"] },
] as const;

export type ChartTimeZone = (typeof CHART_TIMEZONES)[number]["id"];
export type ChartDateFormat = "dd MMM yy" | "MMM dd yyyy" | "yyyy-MM-dd";
export type ChartHoursFormat = "12-hour" | "24-hour";
export type ChartTickGranularity =
  | "day"
  | "month"
  | "time"
  | "time-with-seconds"
  | "year";

export type ChartTimeFormatSettings = {
  dateFormat: ChartDateFormat;
  dayOfWeekLabels: boolean;
  timeHoursFormat: ChartHoursFormat;
  timeZone: ChartTimeZone;
};

const TIME_ZONE_BY_ID = new Map(
  CHART_TIMEZONES.map((timeZone) => [timeZone.id.toLowerCase(), timeZone]),
);
const MONTH_NUMBER_BY_LABEL = new Map(
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map(
    (month, index) => [month, String(index + 1).padStart(2, "0")],
  ),
);
const PARTS_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeChartTimeZone(value: unknown): ChartTimeZone {
  if (typeof value !== "string") {
    return DEFAULT_CHART_TIME_ZONE;
  }
  const candidate = TIME_ZONE_BY_ID.get(value.trim().toLowerCase());
  return candidate?.id ?? DEFAULT_CHART_TIME_ZONE;
}

export function getChartTimeZoneLabel(value: unknown) {
  const timeZone = sanitizeChartTimeZone(value);
  return CHART_TIMEZONES.find((candidate) => candidate.id === timeZone)?.label ?? "UTC";
}

export function searchChartTimeZones(query: string) {
  const terms = normalizeSearch(query).split(" ").filter(Boolean);
  return CHART_TIMEZONES.filter((timeZone) => {
    const searchText = normalizeSearch(
      [timeZone.id, timeZone.label, timeZone.region, ...timeZone.searchTerms].join(" "),
    );
    const searchTokens = searchText.split(" ");
    return terms.every((term) =>
      term.length <= 3
        ? searchTokens.some((token) => token === term)
        : searchText.includes(term),
    );
  });
}

export function formatChartDateTime(
  timestamp: Date | number | string,
  settings: ChartTimeFormatSettings,
) {
  const date = toDate(timestamp);
  if (!date) {
    return "Invalid time";
  }
  const parts = zonedParts(date, settings);
  const dateLabel = formatDateParts(parts, settings.dateFormat);
  const weekday = settings.dayOfWeekLabels ? `${parts.weekday} ` : "";
  return `${weekday}${dateLabel} ${formatTimeParts(parts, settings.timeHoursFormat, false)}`;
}

export function formatChartAxisTick(
  timestamp: Date | number | string,
  granularity: ChartTickGranularity,
  settings: ChartTimeFormatSettings,
) {
  const date = toDate(timestamp);
  if (!date) {
    return null;
  }
  const parts = zonedParts(date, settings);
  if (granularity === "year") {
    return parts.year;
  }
  if (granularity === "month") {
    return parts.month;
  }
  if (granularity === "day") {
    const dayLabel =
      settings.dateFormat === "yyyy-MM-dd"
        ? `${parts.monthNumber}-${parts.day}`
        : settings.dateFormat === "MMM dd yyyy"
          ? `${parts.month} ${parts.day}`
          : `${parts.day} ${parts.month}`;
    return settings.dayOfWeekLabels ? `${parts.weekday} ${dayLabel}` : dayLabel;
  }
  return formatTimeParts(
    parts,
    settings.timeHoursFormat,
    granularity === "time-with-seconds",
  );
}

type ZonedParts = {
  day: string;
  dayPeriod: string;
  hour: string;
  minute: string;
  month: string;
  monthNumber: string;
  second: string;
  weekday: string;
  year: string;
};

function zonedParts(date: Date, settings: ChartTimeFormatSettings): ZonedParts {
  const timeZone = sanitizeChartTimeZone(settings.timeZone);
  const hourCycle = settings.timeHoursFormat === "12-hour" ? "h12" : "h23";
  const cacheKey = `${timeZone}:${hourCycle}`;
  let formatter = PARTS_FORMATTER_CACHE.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle,
      minute: "2-digit",
      month: "short",
      second: "2-digit",
      timeZone,
      weekday: "short",
      year: "numeric",
    });
    PARTS_FORMATTER_CACHE.set(cacheKey, formatter);
  }
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const month = values.get("month") ?? "Jan";
  return {
    day: values.get("day") ?? "01",
    dayPeriod: values.get("dayPeriod") ?? "",
    hour: values.get("hour") ?? "00",
    minute: values.get("minute") ?? "00",
    month,
    monthNumber: MONTH_NUMBER_BY_LABEL.get(month) ?? "01",
    second: values.get("second") ?? "00",
    weekday: values.get("weekday") ?? "",
    year: values.get("year") ?? "1970",
  };
}

function formatDateParts(parts: ZonedParts, format: ChartDateFormat) {
  if (format === "yyyy-MM-dd") {
    return `${parts.year}-${parts.monthNumber}-${parts.day}`;
  }
  if (format === "MMM dd yyyy") {
    return `${parts.month} ${parts.day} ${parts.year}`;
  }
  return `${parts.day} ${parts.month} '${parts.year.slice(-2)}`;
}

function formatTimeParts(
  parts: ZonedParts,
  hoursFormat: ChartHoursFormat,
  includeSeconds: boolean,
) {
  const seconds = includeSeconds ? `:${parts.second}` : "";
  const dayPeriod = hoursFormat === "12-hour" && parts.dayPeriod
    ? ` ${parts.dayPeriod}`
    : "";
  return `${parts.hour}:${parts.minute}${seconds}${dayPeriod}`;
}

function toDate(timestamp: Date | number | string) {
  if (timestamp instanceof Date) {
    return Number.isFinite(timestamp.getTime()) ? timestamp : null;
  }
  if (typeof timestamp === "number") {
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const raw = timestamp.trim();
  if (!raw) {
    return null;
  }
  const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const date = new Date(hasExplicitZone ? raw : `${raw}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
