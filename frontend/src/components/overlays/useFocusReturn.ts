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
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen || open) {
      return;
    }

    const ownerDocument = triggerRef.current?.ownerDocument ?? document;
    const frame = window.requestAnimationFrame(() => {
      const trigger = triggerRef.current;
      const activeElement = ownerDocument.activeElement;
      const focusStayedInOverlay =
        activeElement === ownerDocument.body ||
        activeElement === ownerDocument.documentElement ||
        (activeElement instanceof Node && surfaceRef.current?.contains(activeElement));

      if (trigger?.isConnected && focusStayedInOverlay) {
        trigger.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, surfaceRef, triggerRef]);
}
