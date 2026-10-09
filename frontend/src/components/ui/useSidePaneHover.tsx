import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type PointerEvent, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Pin, X } from "lucide-react";
import { OverlaySurface } from "../overlays/OverlaySurface";

/** Hover previews never change the caller's persisted open/layout preference. */
export function useSidePaneHover({ open, onOpenChange, label, contextKey, width = 392 }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  contextKey: string;
  width?: number;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ key: string; visible: boolean }>({ key: contextKey, visible: false });
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preview = !open && hover.key === contextKey && hover.visible;
  const cancelLeave = () => {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const dismiss = () => {
    cancelLeave();
    setHover({ key: contextKey, visible: false });
  };
  const leave = () => {
    cancelLeave();
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      const surface = surfaceRef.current;
      const focused = surface?.ownerDocument.activeElement;
      if (surface?.matches(":hover") || anchorRef.current?.matches(":hover")
        || (focused instanceof Node && surface?.contains(focused))
        || (focused instanceof Element && focused.closest("[data-overlay-surface]"))) return;
      dismiss();
    }, 180);
  };
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px) and (hover: hover)");
    const changed = () => { if (!media.matches) dismiss(); };
    media.addEventListener("change", changed);
    return () => { cancelLeave(); media.removeEventListener("change", changed); };
  }, [contextKey]);
  useEffect(() => { if (open) dismiss(); }, [open, contextKey]);

  const pin = () => { dismiss(); onOpenChange(true); };
  const close = () => { dismiss(); if (open) onOpenChange(false); };
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    anchorRef.current = event.currentTarget;
    dismiss();
    onOpenChange(!open);
  };
  const triggerProps = {
    "aria-expanded": open || preview,
    "aria-controls": preview ? id : undefined,
    "aria-haspopup": "dialog" as const,
    onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
      if (open || event.pointerType !== "mouse"
        || !window.matchMedia("(min-width: 1024px) and (hover: hover)").matches) return;
      cancelLeave();
      anchorRef.current = event.currentTarget;
      setHover({ key: contextKey, visible: true });
    },
    onPointerLeave: leave,
  };
  const panel = (children: ReactNode) => (
    <SidePaneContent anchorRef={anchorRef} surfaceRef={surfaceRef} id={id} label={label}
      preview={preview} width={width} onDismiss={dismiss} onPin={pin}
      onEnter={cancelLeave} onLeave={leave}>{children}</SidePaneContent>
  );
  return { preview, shown: open || preview, triggerProps, toggle, close, panel };
}

/** Move one portal host between the preview and dock without remounting local drafts. */
function SidePaneContent({ children, anchorRef, surfaceRef, id, label, preview, width,
  onDismiss, onPin, onEnter, onLeave }: {
  children: ReactNode;
  anchorRef: RefObject<HTMLButtonElement>;
  surfaceRef: RefObject<HTMLDivElement>;
  id: string;
  label: string;
  preview: boolean;
  width: number;
  onDismiss: () => void;
  onPin: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [host] = useState(() => document.createElement("div"));
  const slotRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(width);
  useLayoutEffect(() => {
    host.style.display = "contents";
    slotRef.current?.appendChild(host);
    const content = contentRef.current?.firstElementChild;
    const measure = () => {
      const next = content?.getBoundingClientRect().width;
      if (next && Number.isFinite(next)) setMeasuredWidth(next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (content) observer?.observe(content);
    return () => { observer?.disconnect(); host.remove(); };
  }, [host, preview]);
  return <>
    {preview ? (
      <OverlaySurface anchorRef={anchorRef} surfaceRef={surfaceRef} triggerRef={anchorRef}
        align="right" ariaLabel={`${label} preview`} className="z-[var(--layer-popover)] overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ui-floating)] text-[var(--text-primary)] shadow-[var(--elevation-floating)]"
        estimatedHeight={560} gap={0} id={id} onDismiss={onDismiss} open preferredWidth={measuredWidth} role="dialog">
        <div onPointerEnter={onEnter} onPointerLeave={onLeave} data-side-pane-preview={label}>
          <div className="flex min-h-11 items-center justify-end gap-1 border-b border-[var(--ui-border-subtle)] px-2">
            <button type="button" onClick={onPin} className="inline-flex min-h-11 items-center gap-1.5 rounded px-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--ui-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]">
              <Pin aria-hidden="true" size={14} />Keep {label.toLowerCase()} open
            </button>
            <button type="button" aria-label={`Close ${label.toLowerCase()} preview`} onClick={onDismiss} className="grid h-11 w-11 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--ui-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ui-focus)]"><X aria-hidden="true" size={16} /></button>
          </div>
          <div ref={slotRef} style={{ display: "contents" }} />
        </div>
      </OverlaySurface>
    ) : <div ref={slotRef} style={{ display: "contents" }} />}
    {createPortal(<div ref={contentRef} style={{ display: "contents" }} onPointerEnter={onEnter} onPointerLeave={onLeave}>{children}</div>, host)}
  </>;
}
