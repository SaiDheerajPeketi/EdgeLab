import { useEffect, useRef, type RefObject } from "react";

export type OverlayDismissReason = "escape" | "outside";

type OverlayElement = HTMLElement | null;

type OverlayStackEntry = {
  blocksModalEscape: boolean;
  id: symbol;
  ownerDocument: Document;
};

const overlayStack: OverlayStackEntry[] = [];

function removeFromStack(id: symbol) {
  let index = -1;
  for (let candidate = overlayStack.length - 1; candidate >= 0; candidate -= 1) {
    if (overlayStack[candidate]?.id === id) {
      index = candidate;
      break;
    }
  }
  if (index >= 0) {
    overlayStack.splice(index, 1);
  }
}

function isTopOverlay(id: symbol, ownerDocument: Document) {
  for (let index = overlayStack.length - 1; index >= 0; index -= 1) {
    const entry = overlayStack[index];
    if (entry?.ownerDocument === ownerDocument) {
      return entry.id === id;
    }
  }
  return false;
}

export function hasActiveOverlay(ownerDocument: Document) {
  return overlayStack.some((entry) => (
    entry.ownerDocument === ownerDocument && entry.blocksModalEscape
  ));
}

function syncOverlayState(ownerDocument: Document) {
  const active = hasActiveOverlay(ownerDocument);
  if (active) {
    ownerDocument.documentElement.dataset.overlayActive = "true";
  } else {
    delete ownerDocument.documentElement.dataset.overlayActive;
  }
  ownerDocument.dispatchEvent(
    new CustomEvent("edgelab:overlay-state", { detail: { active } }),
  );
}

function eventPathContains(event: Event, element: OverlayElement) {
  if (!element) {
    return false;
  }
  if (typeof event.composedPath === "function") {
    return event.composedPath().includes(element);
  }
  return event.target instanceof Node && element.contains(event.target);
}

export function useOverlayDismiss({
  anchorRef,
  blocksModalEscape = true,
  onDismiss,
  open,
  surfaceRef,
}: {
  anchorRef: RefObject<HTMLElement>;
  blocksModalEscape?: boolean;
  onDismiss: (reason: OverlayDismissReason) => void;
  open: boolean;
  surfaceRef: RefObject<HTMLElement>;
}) {
  const idRef = useRef(Symbol("overlay"));
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const id = idRef.current;
    const ownerDocument =
      anchorRef.current?.ownerDocument ??
      surfaceRef.current?.ownerDocument ??
      document;
    overlayStack.push({ blocksModalEscape, id, ownerDocument });
    syncOverlayState(ownerDocument);

    const handlePointerDown = (event: PointerEvent) => {
      if (
        !isTopOverlay(id, ownerDocument) ||
        eventPathContains(event, anchorRef.current) ||
        eventPathContains(event, surfaceRef.current)
      ) {
        return;
      }
      onDismissRef.current("outside");
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (
        !isTopOverlay(id, ownerDocument) ||
        eventPathContains(event, anchorRef.current) ||
        eventPathContains(event, surfaceRef.current)
      ) {
        return;
      }
      onDismissRef.current("outside");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopOverlay(id, ownerDocument)) {
        return;
      }

      // Overlay controls receive the event first. Stopping it at document keeps
      // global chart shortcuts from also responding while a popup is active.
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        onDismissRef.current("escape");
      }
    };

    ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
    ownerDocument.addEventListener("focusin", handleFocusIn, true);
    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
      ownerDocument.removeEventListener("focusin", handleFocusIn, true);
      ownerDocument.removeEventListener("keydown", handleKeyDown);
      removeFromStack(id);
      syncOverlayState(ownerDocument);
    };
  }, [anchorRef, blocksModalEscape, open, surfaceRef]);
}
