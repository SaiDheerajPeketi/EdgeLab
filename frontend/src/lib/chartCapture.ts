import type { ChartPaneLayoutId } from "./chartLayouts";
import { requireActiveExportSubscription } from "./billing";
import { getStoredAuthSession } from "./authSession";

export type ChartCaptureStatus = "capturing" | "error" | "idle" | "success";

export type ChartCaptureResult = {
  fileName: string;
  height: number;
  pixelRatio: number;
  width: number;
};

type ChartCaptureOptions = {
  capturedAt?: Date;
  layout: ChartPaneLayoutId;
  symbol: string;
  timeframe: string;
};

const TRANSIENT_CAPTURE_SELECTOR = [
  ".chart-context-menu",
  ".chart-object-floating-toolbar",
  ".chart-order-confirm-backdrop",
  ".chart-radial-toolbox",
  "[data-chart-capture-exclude='true']",
].join(",");

export async function captureVisibleChartGridPng(
  target: HTMLElement,
  options: ChartCaptureOptions,
): Promise<ChartCaptureResult> {
  const owner = await requireActiveExportSubscription();
  await document.fonts?.ready.catch(() => undefined);
  const { toPng } = await import("html-to-image");
  const cssWidth = Math.max(
    1,
    Math.ceil(target.scrollWidth || target.getBoundingClientRect().width),
  );
  const cssHeight = Math.max(
    1,
    Math.ceil(target.scrollHeight || target.getBoundingClientRect().height),
  );
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const width = Math.round(cssWidth * pixelRatio);
  const height = Math.round(cssHeight * pixelRatio);
  const fileName = chartCaptureFileName(options);
  const dataUrl = await toPng(target, {
    backgroundColor: "#05070a",
    cacheBust: true,
    filter: (node) =>
      !(node instanceof HTMLElement) || !node.matches(TRANSIENT_CAPTURE_SELECTOR),
    height: cssHeight,
    pixelRatio,
    width: cssWidth,
  });

  await requireActiveExportSubscription(owner);
  const current = getStoredAuthSession();
  if (current?.token !== owner.token || current.user.id !== owner.user.id) throw new DOMException("The account changed before export.", "AbortError");
  const link = document.createElement("a");
  link.download = fileName;
  link.href = dataUrl;
  link.click();

  return { fileName, height, pixelRatio, width };
}

export function chartCaptureFileName({
  capturedAt = new Date(),
  layout,
  symbol,
  timeframe,
}: ChartCaptureOptions) {
  const timestamp = capturedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
  return [
    "edgelab",
    safeFileSegment(symbol),
    safeFileSegment(timeframe),
    safeFileSegment(layout),
    timestamp,
  ].join("-") + ".png";
}

function safeFileSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chart";
}
