import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  useOverlayDismiss,
  type OverlayDismissReason,
} from "./useOverlayDismiss";
import { useFocusReturn } from "./useFocusReturn";

type OverlayAlignment = "left" | "right";
type OverlayPlacement = "above" | "below";

type RectLike = Pick<DOMRect, "bottom" | "left" | "right" | "top" | "width">;

type Viewport = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type OverlayGeometry = {
  left: number;
  maxHeight: number;
  placement: OverlayPlacement;
  top: number;
  width: number;
};

type OverlaySurfaceProps = {
  align?: OverlayAlignment;
  anchorRef: RefObject<HTMLElement>;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children: ReactNode;
  className: string;
  estimatedHeight?: number;
  gap?: number;
  id?: string;
  minWidth?: number;
  onDismiss: (reason: OverlayDismissReason) => void;
  onKeyDown?: HTMLAttributes<HTMLDivElement>["onKeyDown"];
  open: boolean;
  portal?: boolean;
  preferredWidth?: number;
  role?: HTMLAttributes<HTMLDivElement>["role"];
  surfaceRef: RefObject<HTMLDivElement>;
  triggerRef?: RefObject<HTMLElement>;
};

const VIEWPORT_MARGIN = 8;

export function OverlaySurface({
  align = "left",
  anchorRef,
  ariaDescribedBy,
  ariaLabel,
  ariaLabelledBy,
  children,
  className,
  estimatedHeight = 320,
  gap = 8,
  id,
  minWidth = 0,
  onDismiss,
  onKeyDown,
  open,
  portal = true,
  preferredWidth,
  role,
  surfaceRef,
  triggerRef,
}: OverlaySurfaceProps) {
  const [geometry, setGeometry] = useState<OverlayGeometry | null>(null);

  useOverlayDismiss({ anchorRef, onDismiss, open, surfaceRef });
  useFocusReturn({ open, surfaceRef, triggerRef: triggerRef ?? anchorRef });

  useLayoutEffect(() => {
    if (!open) {
      setGeometry(null);
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    const ownerWindow = anchor.ownerDocument.defaultView ?? window;

    const syncPosition = () => {
      const nextAnchor = anchorRef.current;
      if (!nextAnchor) {
        return;
      }
      const viewport = currentViewport(ownerWindow);
      const measuredHeight =
        surfaceRef.current?.getBoundingClientRect().height || estimatedHeight;
      setGeometry(
        computeOverlayGeometry({
          align,
          anchor: nextAnchor.getBoundingClientRect(),
          gap,
          measuredHeight,
          minWidth,
          preferredWidth,
          viewport,
        }),
      );
    };

    syncPosition();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncPosition);
    if (surfaceRef.current) {
      resizeObserver?.observe(surfaceRef.current);
    }
    ownerWindow.addEventListener("resize", syncPosition);
    ownerWindow.addEventListener("scroll", syncPosition, true);
    ownerWindow.visualViewport?.addEventListener("resize", syncPosition);
    ownerWindow.visualViewport?.addEventListener("scroll", syncPosition);
    return () => {
      resizeObserver?.disconnect();
      ownerWindow.removeEventListener("resize", syncPosition);
      ownerWindow.removeEventListener("scroll", syncPosition, true);
      ownerWindow.visualViewport?.removeEventListener("resize", syncPosition);
      ownerWindow.visualViewport?.removeEventListener("scroll", syncPosition);
    };
  }, [
    align,
    anchorRef,
    estimatedHeight,
    gap,
    minWidth,
    open,
    preferredWidth,
    surfaceRef,
  ]);

  if (!open) {
    return null;
  }

  const style: CSSProperties = portal
    ? {
        left: geometry?.left ?? 0,
        maxHeight: geometry?.maxHeight,
        overflowY: "auto",
        overscrollBehavior: "contain",
        position: "fixed",
        top: geometry?.top ?? 0,
        visibility: geometry ? "visible" : "hidden",
        width: geometry?.width,
      }
    : {
        bottom: geometry?.placement === "above" ? `calc(100% + ${gap}px)` : undefined,
        maxHeight: geometry?.maxHeight,
        maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
        overflowY: "auto",
        overscrollBehavior: "contain",
        top: geometry?.placement === "above" ? "auto" : undefined,
      };

  const surface = (
    <div
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`${className} motion-reduce:transition-none`}
      data-overlay-placement={geometry?.placement}
      data-overlay-surface="true"
      id={id}
      onKeyDown={onKeyDown}
      ref={surfaceRef}
      role={role}
      style={style}
    >
      {children}
    </div>
  );

  if (!portal) {
    return surface;
  }
  const portalHost = currentPortalHost(anchorRef.current?.ownerDocument);
  return portalHost ? createPortal(surface, portalHost) : null;
}

export function computeOverlayGeometry({
  align,
  anchor,
  gap,
  measuredHeight,
  minWidth,
  preferredWidth,
  viewport,
}: {
  align: OverlayAlignment;
  anchor: RectLike;
  gap: number;
  measuredHeight: number;
  minWidth: number;
  preferredWidth?: number;
  viewport: Viewport;
}): OverlayGeometry {
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_MARGIN * 2);
  const desiredWidth = Math.max(anchor.width, preferredWidth ?? 0, minWidth);
  const width = Math.min(desiredWidth, availableWidth);
  const desiredLeft = align === "right" ? anchor.right - width : anchor.left;
  const left = clamp(
    desiredLeft,
    viewport.left + VIEWPORT_MARGIN,
    Math.max(viewport.left + VIEWPORT_MARGIN, viewportRight - width - VIEWPORT_MARGIN),
  );
  const spaceBelow = Math.max(
    0,
    viewportBottom - anchor.bottom - gap - VIEWPORT_MARGIN,
  );
  const spaceAbove = Math.max(
    0,
    anchor.top - viewport.top - gap - VIEWPORT_MARGIN,
  );
  const placement: OverlayPlacement =
    measuredHeight <= spaceBelow || spaceBelow >= spaceAbove ? "below" : "above";
  const maxHeight = placement === "below" ? spaceBelow : spaceAbove;
  const renderedHeight = Math.min(measuredHeight, maxHeight);
  const desiredTop =
    placement === "below" ? anchor.bottom + gap : anchor.top - gap - renderedHeight;
  const top = clamp(
    desiredTop,
    viewport.top + VIEWPORT_MARGIN,
    Math.max(
      viewport.top + VIEWPORT_MARGIN,
      viewportBottom - renderedHeight - VIEWPORT_MARGIN,
    ),
  );

  return { left, maxHeight, placement, top, width };
}

function currentViewport(ownerWindow: Window): Viewport {
  const visualViewport = ownerWindow.visualViewport;
  return {
    height: visualViewport?.height ?? ownerWindow.innerHeight,
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
    width: visualViewport?.width ?? ownerWindow.innerWidth,
  };
}

function currentPortalHost(ownerDocument = document) {
  return ownerDocument.fullscreenElement ?? ownerDocument.body;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
