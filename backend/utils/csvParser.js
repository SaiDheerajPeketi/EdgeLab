import fs from "node:fs";
import readline from "node:readline";

const REQUIRED_HEADERS = ["Timestamp", "Open", "High", "Low", "Close", "Volume"];

export async function streamCsvCandles(filePath, onBatch, options = {}) {
  const batchSize = options.batchSize ?? 5000;
  const stats = {
    candle_count: 0,
    first_timestamp: null,
    last_timestamp: null,
    timeframe_detected: null,
    sample: [],
    diffs: [],
  };
  let previousTimestamp = null;
  let batch = [];

  function flush() {
    if (batch.length === 0) return;
    onBatch(batch);
    batch = [];
  }

  const reader = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  let headers = null;
  for await (const line of reader) {
    const cleanLine = line.replace(/^\uFEFF/, "").trim();
    if (!cleanLine) continue;

    if (!headers) {
      headers = parseCsvLine(cleanLine).map((header) => header.trim());
      const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
      if (missing.length > 0) {
        throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
      }
      continue;
    }

    const values = parseCsvLine(cleanLine);
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const candle = normalizeCandle(record);
    if (!candle) continue;

    if (stats.first_timestamp === null) {
      stats.first_timestamp = candle.timestamp;
    }
    stats.last_timestamp = candle.timestamp;
    stats.candle_count += 1;

    if (previousTimestamp !== null && candle.timestamp > previousTimestamp) {
      stats.diffs.push(candle.timestamp - previousTimestamp);
      if (stats.diffs.length > 10000) {
        stats.diffs.shift();
      }
    }
    previousTimestamp = candle.timestamp;

    if (stats.sample.length < 20) {
      stats.sample.push(candle);
    }

    batch.push(candle);
    if (batch.length >= batchSize) {
      flush();
    }
  }

  flush();
  if (!headers) {
    throw new Error("CSV did not include a valid header row.");
  }
  stats.timeframe_detected = detectTimeframe(stats.diffs);

  return stats;
}

export function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

export function normalizeCandle(record) {
  const timestamp = parseTimestamp(record.Timestamp);
  const open = Number(record.Open);
  const high = Number(record.High);
  const low = Number(record.Low);
  const close = Number(record.Close);
  const volume = Number(record.Volume ?? 0);

  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume)
  ) {
    return null;
  }

  return { timestamp, open, high, low, close, volume };
}

export function parseTimestamp(value) {
  if (typeof value !== "string") return Number.NaN;
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function detectTimeframe(diffs) {
  const positiveDiffs = diffs.filter((diff) => diff > 0).sort((a, b) => a - b);
  if (positiveDiffs.length === 0) return "unknown";

  const median = positiveDiffs[Math.floor(positiveDiffs.length / 2)];
  const known = [
    ["1m", 60_000],
    ["5m", 5 * 60_000],
    ["15m", 15 * 60_000],
    ["30m", 30 * 60_000],
    ["1h", 60 * 60_000],
    ["4h", 4 * 60 * 60_000],
    ["1D", 24 * 60 * 60_000],
  ];

  const nearest = known.reduce(
    (best, current) => {
      const distance = Math.abs(current[1] - median);
      return distance < best.distance ? { label: current[0], distance } : best;
    },
    { label: "custom", distance: Number.POSITIVE_INFINITY },
  );

  return nearest.distance <= median * 0.15 ? nearest.label : `${Math.round(median / 1000)}s`;
}
