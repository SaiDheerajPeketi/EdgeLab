export type ChartViewportSize = {
  height: number;
  width: number;
};

type ResizeRegistration = {
  callback: (size: ChartViewportSize) => void;
  lastHeight: number;
  lastWidth: number;
};

const registrations = new Map<Element, ResizeRegistration>();
const pendingSizes = new Map<Element, ChartViewportSize>();
let observer: ResizeObserver | null = null;
let scheduledFrame: number | null = null;
let windowFallbackActive = false;

/**
 * Shares one ResizeObserver across every mounted chart pane and batches all
 * chart.resize calls into one animation frame. Dense 4x4 grids therefore do
 * not create sixteen independent observers or resize bursts.
 */
export function observeSharedChartSize(
  element: HTMLElement,
  callback: (size: ChartViewportSize) => void,
) {
  const registration: ResizeRegistration = {
    callback,
    lastHeight: -1,
    lastWidth: -1,
  };
  registrations.set(element, registration);

  const sharedObserver = ensureObserver();
  if (sharedObserver) {
    sharedObserver.observe(element);
  } else {
    ensureWindowFallback();
  }
  enqueueSize(element, measureElement(element));

  return () => {
    if (registrations.get(element) !== registration) return;
    observer?.unobserve(element);
    registrations.delete(element);
    pendingSizes.delete(element);
    releaseCoordinatorWhenIdle();
  };
}

function ensureObserver() {
  if (observer || typeof ResizeObserver === "undefined") return observer;
  observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLElement)) continue;
      enqueueSize(entry.target, {
        height: normalizeDimension(entry.contentRect.height),
        width: normalizeDimension(entry.contentRect.width),
      });
    }
  });
  return observer;
}

function ensureWindowFallback() {
  if (windowFallbackActive || typeof window === "undefined") return;
  window.addEventListener("resize", measureAll);
  windowFallbackActive = true;
}

function measureAll() {
  registrations.forEach((_registration, element) => {
    if (element instanceof HTMLElement) enqueueSize(element, measureElement(element));
  });
}

function measureElement(element: HTMLElement): ChartViewportSize {
  return {
    height: normalizeDimension(element.clientHeight),
    width: normalizeDimension(element.clientWidth),
  };
}

function normalizeDimension(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function enqueueSize(element: Element, size: ChartViewportSize) {
  if (!registrations.has(element)) return;
  pendingSizes.set(element, size);
  if (scheduledFrame != null) return;
  scheduledFrame = requestAnimationFrame(flushSizes);
}

function flushSizes() {
  scheduledFrame = null;
  const batch = Array.from(pendingSizes);
  pendingSizes.clear();
  for (const [element, size] of batch) {
    const registration = registrations.get(element);
    if (
      !registration ||
      size.width <= 0 ||
      size.height <= 0 ||
      (registration.lastWidth === size.width && registration.lastHeight === size.height)
    ) continue;
    registration.lastWidth = size.width;
    registration.lastHeight = size.height;
    registration.callback(size);
  }
}

function releaseCoordinatorWhenIdle() {
  if (registrations.size > 0) return;
  observer?.disconnect();
  observer = null;
  if (windowFallbackActive && typeof window !== "undefined") {
    window.removeEventListener("resize", measureAll);
    windowFallbackActive = false;
  }
  if (scheduledFrame != null) {
    cancelAnimationFrame(scheduledFrame);
    scheduledFrame = null;
  }
}
