import { useEffect, useRef, type RefObject } from "react";

export function useFocusReturn({
  open,
  surfaceRef,
  triggerRef,
}: {
  open: boolean;
  surfaceRef: RefObject<HTMLElement>;
  triggerRef: RefObject<HTMLElement>;
}) {
  const restoreFrameRef = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    const ownerDocument = triggerRef.current?.ownerDocument ?? document;
    const ownerWindow = ownerDocument.defaultView ?? window;
    const previousFocus = ownerDocument.activeElement instanceof HTMLElement
      ? ownerDocument.activeElement
      : null;

    ownerWindow.cancelAnimationFrame(restoreFrameRef.current);
    return () => {
      const surface = surfaceRef.current;
      restoreFrameRef.current = ownerWindow.requestAnimationFrame(() => {
        const activeElement = ownerDocument.activeElement;
        const focusStayedInOverlay =
          activeElement === ownerDocument.body ||
          activeElement === ownerDocument.documentElement ||
          (activeElement instanceof Node && surface?.contains(activeElement));
        if (!focusStayedInOverlay) {
          return;
        }

        const trigger = triggerRef.current;
        const target = trigger?.isConnected && trigger.tabIndex >= 0
          ? trigger
          : previousFocus?.isConnected && previousFocus.tabIndex >= 0
            ? previousFocus
            : null;
        target?.focus({ preventScroll: true });
      });
    };
  }, [open, surfaceRef, triggerRef]);
}
