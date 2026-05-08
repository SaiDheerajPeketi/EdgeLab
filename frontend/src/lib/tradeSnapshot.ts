import type { Candle, Trade } from "./api";
import { getBars } from "./api";
import { formatPrice } from "./format";

type SnapshotBar = Candle & { offset: number };
type SnapshotLevel = {
  color: string;
  dashed?: boolean;
  label: string;
  price: number;
};

const SNAPSHOT_WIDTH = 980;
const SNAPSHOT_HEIGHT = 430;
const PLOT = {
  left: 58,
  right: 72,
  top: 62,
  bottom: 44,
};
const GENERATED_SNAPSHOT_PREFIX = "data:image/svg+xml;charset=utf-8,";
const SNAPSHOT_VERSION = "2";

export async function createTradeSnapshotDataUrl(trade: Trade, currency = "USD") {
  const window = tradeSnapshotWindow(trade);
  const response = await getBars(window.offset, window.limit, trade.session_id);
  const bars = response.bars.map((bar, index) => ({
    ...bar,
    offset: response.offset + index,
  }));
  return buildTradeSnapshotDataUrl(trade, bars, currency);
}

export function shouldRegenerateTradeSnapshotForCurrency(
  url: string | null | undefined,
  currency: string,
) {
  if (!url?.startsWith(GENERATED_SNAPSHOT_PREFIX)) {
    return false;
  }
  try {
    const svg = decodeURIComponent(url.slice(GENERATED_SNAPSHOT_PREFIX.length));
    const existingVersion = svg.match(/\sdata-snapshot-version="([^"]+)"/)?.[1];
    if (existingVersion !== SNAPSHOT_VERSION) {
      return true;
    }
    const existingCurrency = svg.match(/\sdata-currency="([^"]+)"/)?.[1];
    if (existingCurrency) {
      return existingCurrency !== currency;
    }
  } catch {
    return currency !== "USD";
  }
  return currency !== "USD";
}

export async function copyTradeSnapshotToClipboard(url: string) {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error("Image clipboard is not available");
  }
  const blob = url.startsWith(GENERATED_SNAPSHOT_PREFIX)
    ? await snapshotDataUrlToPngBlob(url)
    : await fetch(url).then((response) => response.blob());
  const type = blob.type || "image/png";
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}

function tradeSnapshotWindow(trade: Trade) {
  const entryOffset = trade.entry_offset;
  const exitOffset = trade.exit_offset ?? trade.entry_offset;
  const span = Math.max(1, exitOffset - entryOffset);
  const context = clamp(Math.round(span * 0.25), 20, 140);
  const offset = Math.max(0, entryOffset - context);
  const endOffset = exitOffset + (trade.exit_offset == null ? 0 : context);
  return {
    limit: Math.min(5000, Math.max(1, endOffset - offset + 1)),
    offset,
  };
}

function buildTradeSnapshotDataUrl(trade: Trade, rawBars: SnapshotBar[], currency: string) {
  const bars = downsampleBars(rawBars, 360);
  const markers = [
    trade.entry_price,
    trade.exit_price,
    trade.stop_loss,
    trade.take_profit,
  ].filter((value): value is number => value != null && Number.isFinite(value));
  const minPrice = Math.min(...rawBars.map((bar) => bar.low), ...markers);
  const maxPrice = Math.max(...rawBars.map((bar) => bar.high), ...markers);
  const pricePadding = Math.max((maxPrice - minPrice) * 0.08, 0.00001);
  const low = minPrice - pricePadding;
  const high = maxPrice + pricePadding;
  const startOffset = rawBars[0]?.offset ?? trade.entry_offset;
  const endOffset = rawBars[rawBars.length - 1]?.offset ?? trade.exit_offset ?? trade.entry_offset;
  const plotWidth = SNAPSHOT_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = SNAPSHOT_HEIGHT - PLOT.top - PLOT.bottom;
  const candleWidth = clamp((plotWidth / Math.max(bars.length, 1)) * 0.62, 2, 8);

  const xForOffset = (offset: number) =>
    PLOT.left + ((offset - startOffset) / Math.max(endOffset - startOffset, 1)) * plotWidth;
  const yForPrice = (price: number) =>
    PLOT.top + ((high - price) / Math.max(high - low, 0.00001)) * plotHeight;

  const gridLines = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    const y = PLOT.top + ratio * plotHeight;
    const price = high - ratio * (high - low);
    return `
      <line x1="${PLOT.left}" x2="${SNAPSHOT_WIDTH - PLOT.right}" y1="${y}" y2="${y}" stroke="rgba(148,163,184,0.14)" />
      <text x="${SNAPSHOT_WIDTH - PLOT.right - 8}" y="${y + 4}" fill="#64748b" font-family="Inter, Arial, sans-serif" font-size="10" text-anchor="end">${escapeXml(formatSnapshotAxisPrice(price))}</text>
    `;
  }).join("");

  const candles = bars
    .map((bar) => {
      const x = xForOffset(bar.offset);
      const openY = yForPrice(bar.open);
      const closeY = yForPrice(bar.close);
      const highY = yForPrice(bar.high);
      const lowY = yForPrice(bar.low);
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
      const bullish = bar.close >= bar.open;
      const fill = bullish ? "#22c55e" : "#ef4444";
      const wick = bullish ? "#86efac" : "#fca5a5";
      return `
        <line x1="${x}" x2="${x}" y1="${highY}" y2="${lowY}" stroke="${wick}" stroke-width="1.2" opacity="0.92" />
        <rect x="${x - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" rx="1.4" fill="${fill}" opacity="0.9" />
      `;
    })
    .join("");

  const entryX = xForOffset(trade.entry_offset);
  const exitX = trade.exit_offset == null ? null : xForOffset(trade.exit_offset);
  const entryColor = trade.side === "LONG" ? "#22c55e" : "#ef4444";
  const exitColor = "#38bdf8";
  const pnlColor = trade.realized_pnl >= 0 ? "#22c55e" : "#ef4444";

  const levels = priceLevels(
    [
      { color: entryColor, label: "Entry", price: trade.entry_price },
      trade.exit_price == null ? null : { color: exitColor, label: "Exit", price: trade.exit_price },
      trade.stop_loss == null ? null : { color: "#fb7185", dashed: true, label: "SL", price: trade.stop_loss },
      trade.take_profit == null ? null : { color: "#4ade80", dashed: true, label: "TP", price: trade.take_profit },
    ].filter((level): level is SnapshotLevel => level != null),
    yForPrice,
  );

  const verticals = `
    <line x1="${entryX}" x2="${entryX}" y1="${PLOT.top}" y2="${SNAPSHOT_HEIGHT - PLOT.bottom}" stroke="${entryColor}" stroke-width="1.4" stroke-dasharray="5 5" />
    <circle cx="${entryX}" cy="${yForPrice(trade.entry_price)}" r="5" fill="${entryColor}" stroke="#020617" stroke-width="2" />
    ${
      exitX == null || trade.exit_price == null
        ? ""
        : `<line x1="${exitX}" x2="${exitX}" y1="${PLOT.top}" y2="${SNAPSHOT_HEIGHT - PLOT.bottom}" stroke="${exitColor}" stroke-width="1.4" stroke-dasharray="5 5" />
           <circle cx="${exitX}" cy="${yForPrice(trade.exit_price)}" r="5" fill="${exitColor}" stroke="#020617" stroke-width="2" />`
    }
  `;

  const dateLabel = [
    formatDateTime(trade.entry_time),
    trade.exit_time ? formatDateTime(trade.exit_time) : "Open",
  ].join(" to ");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${SNAPSHOT_WIDTH}" height="${SNAPSHOT_HEIGHT}" viewBox="0 0 ${SNAPSHOT_WIDTH} ${SNAPSHOT_HEIGHT}" data-currency="${escapeXml(currency)}" data-snapshot-version="${SNAPSHOT_VERSION}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#0b1220" />
          <stop offset="1" stop-color="#05070a" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)" />
      <rect x="${PLOT.left}" y="${PLOT.top}" width="${plotWidth}" height="${plotHeight}" fill="#070b10" stroke="rgba(255,255,255,0.1)" rx="6" />
      <text x="${PLOT.left}" y="28" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700">Trade #${trade.id} ${escapeXml(trade.side)}</text>
      <text x="${PLOT.left}" y="48" fill="#94a3b8" font-family="Inter, Arial, sans-serif" font-size="12">${escapeXml(dateLabel)}</text>
      <text x="${SNAPSHOT_WIDTH - PLOT.right}" y="28" fill="${pnlColor}" font-family="Inter, Arial, sans-serif" font-size="16" font-weight="700" text-anchor="end">${escapeXml(formatMoney(trade.realized_pnl, currency))}</text>
      <text x="${SNAPSHOT_WIDTH - PLOT.right}" y="48" fill="#94a3b8" font-family="Inter, Arial, sans-serif" font-size="12" text-anchor="end">R ${escapeXml(trade.r_multiple?.toFixed(2) ?? "-")}</text>
      ${gridLines}
      ${candles}
      ${levels}
      ${verticals}
      <text x="${entryX + 8}" y="${Math.max(PLOT.top + 16, yForPrice(trade.entry_price) - 9)}" fill="${entryColor}" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="700">Entry</text>
      ${
        exitX == null || trade.exit_price == null
          ? ""
          : `<text x="${exitX + 8}" y="${Math.max(PLOT.top + 16, yForPrice(trade.exit_price) - 9)}" fill="${exitColor}" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="700">Exit</text>`
      }
    </svg>
  `;

  return `${GENERATED_SNAPSHOT_PREFIX}${encodeURIComponent(svg)}`;
}

function priceLevels(levels: SnapshotLevel[], yForPrice: (price: number) => number) {
  const labelGap = 24;
  const minLabelY = PLOT.top + 12;
  const maxLabelY = SNAPSHOT_HEIGHT - PLOT.bottom - 12;
  const positioned = levels
    .map((level, index) => ({
      ...level,
      index,
      labelY: clamp(yForPrice(level.price), minLabelY, maxLabelY),
      y: yForPrice(level.price),
    }))
    .sort((a, b) => a.labelY - b.labelY);

  for (let index = 1; index < positioned.length; index += 1) {
    positioned[index].labelY = Math.max(positioned[index].labelY, positioned[index - 1].labelY + labelGap);
  }
  for (let index = positioned.length - 2; index >= 0; index -= 1) {
    positioned[index].labelY = Math.min(positioned[index].labelY, positioned[index + 1].labelY - labelGap);
  }

  return positioned
    .sort((a, b) => a.index - b.index)
    .map(({ color, dashed, label, labelY, y }) => {
      const badgeX = SNAPSHOT_WIDTH - PLOT.right + 8;
      const badgeY = clamp(labelY, minLabelY, maxLabelY) - 10;
      const connector =
        Math.abs(labelY - y) > 4
          ? `<line x1="${SNAPSHOT_WIDTH - PLOT.right + 3}" x2="${badgeX + 3}" y1="${y}" y2="${labelY}" stroke="${color}" stroke-width="0.9" opacity="0.45" />`
          : "";
      return `
        <line x1="${PLOT.left}" x2="${SNAPSHOT_WIDTH - PLOT.right}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="1.2" ${dashed ? 'stroke-dasharray="8 6"' : ""} opacity="0.82" />
        ${connector}
        <rect x="${badgeX}" y="${badgeY}" width="58" height="20" rx="4" fill="${color}" opacity="0.18" />
        <text x="${badgeX + 6}" y="${badgeY + 14}" fill="${color}" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700">${label}</text>
      `;
    })
    .join("");
}

function downsampleBars(bars: SnapshotBar[], maxBars: number): SnapshotBar[] {
  if (bars.length <= maxBars) {
    return bars;
  }
  const chunkSize = Math.ceil(bars.length / maxBars);
  const sampled: SnapshotBar[] = [];
  for (let index = 0; index < bars.length; index += chunkSize) {
    const chunk = bars.slice(index, index + chunkSize);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    sampled.push({
      ...last,
      close: last.close,
      high: Math.max(...chunk.map((bar) => bar.high)),
      low: Math.min(...chunk.map((bar) => bar.low)),
      offset: Math.round((first.offset + last.offset) / 2),
      open: first.open,
      time: first.time,
      timestamp: first.timestamp,
      volume: chunk.reduce((sum, bar) => sum + bar.volume, 0),
    });
  }
  return sampled;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      currency,
      maximumFractionDigits: 2,
      style: "currency",
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatSnapshotAxisPrice(value: number) {
  if (Math.abs(value) >= 100) {
    return value.toFixed(2);
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(4);
  }
  return value.toFixed(6);
}

function snapshotDataUrlToPngBlob(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Canvas is not available"));
      return;
    }
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || SNAPSHOT_WIDTH;
      canvas.height = image.naturalHeight || SNAPSHOT_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas context is not available"));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Snapshot could not be converted"));
        }
      }, "image/png");
    };
    image.onerror = () => reject(new Error("Snapshot image could not be loaded"));
    image.src = url;
  });
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
