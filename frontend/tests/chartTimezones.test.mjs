import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_TIMEZONES,
  DEFAULT_CHART_TIME_ZONE,
  formatChartAxisTick,
  formatChartDateTime,
  isValidIanaTimeZone,
  sanitizeChartTimeZone,
  searchChartTimeZones,
} from "../src/lib/chartTimezones.ts";

const baseSettings = {
  dateFormat: "yyyy-MM-dd",
  dayOfWeekLabels: false,
  timeHoursFormat: "24-hour",
  timeZone: "UTC",
};

test("the curated catalog contains only valid IANA zones", () => {
  assert.ok(CHART_TIMEZONES.length >= 30);
  for (const timeZone of CHART_TIMEZONES) {
    assert.equal(isValidIanaTimeZone(timeZone.id), true, timeZone.id);
  }
});

test("invalid and missing saved zones fall back to UTC", () => {
  assert.equal(sanitizeChartTimeZone(undefined), DEFAULT_CHART_TIME_ZONE);
  assert.equal(sanitizeChartTimeZone("Mars/Olympus_Mons"), DEFAULT_CHART_TIME_ZONE);
  assert.equal(sanitizeChartTimeZone(" america/new_york "), "America/New_York");
});

test("zone search matches city, IANA id, region, and common abbreviation", () => {
  assert.equal(searchChartTimeZones("New York")[0]?.id, "America/New_York");
  assert.equal(searchChartTimeZones("America Los Angeles")[0]?.id, "America/Los_Angeles");
  assert.equal(searchChartTimeZones("India IST")[0]?.id, "Asia/Kolkata");
  assert.deepEqual(searchChartTimeZones("EST").map((zone) => zone.id), ["America/New_York"]);
});

test("New York spring DST skips from 01:30 to 03:30", () => {
  const settings = { ...baseSettings, timeZone: "America/New_York" };
  assert.equal(formatChartDateTime("2024-03-10T06:30:00Z", settings), "2024-03-10 01:30");
  assert.equal(formatChartDateTime("2024-03-10T07:30:00Z", settings), "2024-03-10 03:30");
});

test("New York fall DST repeats 01:30 for distinct epochs", () => {
  const settings = { ...baseSettings, timeZone: "America/New_York" };
  assert.equal(formatChartDateTime("2024-11-03T05:30:00Z", settings), "2024-11-03 01:30");
  assert.equal(formatChartDateTime("2024-11-03T06:30:00Z", settings), "2024-11-03 01:30");
});

test("12-hour labels and zoned date rollovers are stable", () => {
  assert.equal(
    formatChartDateTime("2024-01-01T00:05:00Z", {
      ...baseSettings,
      timeHoursFormat: "12-hour",
    }),
    "2024-01-01 12:05 AM",
  );
  assert.equal(
    formatChartDateTime("2024-01-01T23:30:00Z", {
      ...baseSettings,
      timeZone: "Asia/Tokyo",
    }),
    "2024-01-02 08:30",
  );
});

test("axis labels honor the selected zone and configured date shape", () => {
  assert.equal(
    formatChartAxisTick("2024-01-01T00:30:00Z", "day", {
      ...baseSettings,
      dateFormat: "dd MMM yy",
      dayOfWeekLabels: true,
      timeZone: "America/Los_Angeles",
    }),
    "Sun 31 Dec",
  );
  assert.equal(
    formatChartAxisTick("2024-01-01T13:05:09Z", "time-with-seconds", {
      ...baseSettings,
      timeHoursFormat: "12-hour",
    }),
    "01:05:09 PM",
  );
});

test("formatting does not mutate candle epochs or ordering", () => {
  const timestamps = [
    "2024-03-10T06:59:00Z",
    "2024-03-10T07:00:00Z",
    "2024-03-10T07:01:00Z",
  ];
  const epochs = timestamps.map(Date.parse);
  timestamps.forEach((timestamp) =>
    formatChartDateTime(timestamp, { ...baseSettings, timeZone: "America/New_York" }),
  );
  assert.deepEqual(timestamps.map(Date.parse), epochs);
  assert.deepEqual([...epochs].sort((left, right) => left - right), epochs);
});
