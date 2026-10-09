import { useLayoutEffect, useState, type RefObject } from "react";

/** Size the price plot, leaving study panes in normal document flow below it. */
export function useChartViewportHeight(frameRef: RefObject<HTMLDivElement | null>) {
  const [singlePane, setSinglePane] = useState(false);
  useLayoutEffect(() => {
    const nextSinglePane = Boolean(frameRef.current?.closest(".chart-pane-layout-single"));
    if (nextSinglePane !== singlePane) setSinglePane(nextSinglePane);
    updateHeight(frameRef.current);
  });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let scheduled: number | null = null;
    const schedule = () => {
      if (scheduled !== null) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = null;
        updateHeight(frame);
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    // Ancestors include the header and preceding replay/toolbar controls. Their
    // sizes change when tools open, notices expand, or a narrow layout wraps.
    for (let element = frame.parentElement; element; element = element.parentElement) {
      observer?.observe(element);
      if (element.tagName === "MAIN" || element.classList.contains("chart-fullscreen-shell")) break;
    }
    const navigation = document.querySelector<HTMLElement>('nav[aria-label="Primary workspace"]');
    if (navigation) observer?.observe(navigation);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      if (scheduled !== null) cancelAnimationFrame(scheduled);
      frame.style.removeProperty("--chart-price-height");
      frame.closest<HTMLElement>(".chart-stage")?.style.removeProperty("--chart-price-height");
    };
  }, [frameRef]);
  return singlePane;
}

function updateHeight(frame: HTMLDivElement | null) {
  if (!frame?.closest(".chart-pane-layout-single")) return;
  const fullscreen = frame.closest<HTMLElement>(".chart-fullscreen-shell");
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const navigation = fullscreen ? null : document.querySelector<HTMLElement>('nav[aria-label="Primary workspace"]');
  const navRect = navigation?.getBoundingClientRect();
  const fixedNavigation = navigation && getComputedStyle(navigation).position === "fixed" && navRect && navRect.height > 0;
  const bottom = fixedNavigation ? Math.min(viewportHeight, navRect.top) : viewportHeight;
  // Adding the scroll offset keeps the height stable while visiting studies.
  const top = frame.getBoundingClientRect().top + (fullscreen ? fullscreen.scrollTop : window.scrollY);
  const height = `${Math.round(Math.min(860, Math.max(160, bottom - top - 8)))}px`;
  if (frame.style.getPropertyValue("--chart-price-height") !== height) {
    frame.style.setProperty("--chart-price-height", height);
    frame.closest<HTMLElement>(".chart-stage")?.style.setProperty("--chart-price-height", height);
  }
}
