import { Check, MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MOBILE_PRIMARY_NAVIGATION,
  mobileMoreNavigationSections,
  mobilePrimaryItemIsActive,
  workspaceNavigationItemIsActive,
} from "../lib/workspaceNavigation";
import type { WorkspaceView } from "../lib/workspace";
import { AccountSystemMenu } from "./AccountSystemMenu";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
};

export function WorkspaceMobileNav({ activeView, onNavigate }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const sheetId = useId();
  const sections = useMemo(mobileMoreNavigationSections, []);
  const primaryActive = MOBILE_PRIMARY_NAVIGATION.some((item) =>
    mobilePrimaryItemIsActive(item.matches, activeView),
  );

  function closeMore(restoreFocus = true) {
    setMoreOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => moreTriggerRef.current?.focus());
    }
  }

  function navigate(view: WorkspaceView) {
    setMoreOpen(false);
    onNavigate(view);
    window.requestAnimationFrame(() => {
      document.getElementById("workspace-content")?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => closeRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMore();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) {
        return;
      }
      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    function handleDesktopChange(event: MediaQueryListEvent) {
      if (event.matches) {
        setMoreOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    desktopQuery.addEventListener("change", handleDesktopChange);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      desktopQuery.removeEventListener("change", handleDesktopChange);
    };
  }, [moreOpen]);

  return (
    <>
      <nav
        aria-label="Primary workspace"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-[#080c12]/[0.98] px-[max(0.35rem,env(safe-area-inset-left))] pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-18px_50px_rgba(0,0,0,0.38)] lg:hidden"
      >
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-1">
          {MOBILE_PRIMARY_NAVIGATION.map((item) => {
            const Icon = item.icon;
            const active = mobilePrimaryItemIsActive(item.matches, activeView);
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300/50 ${
                  active
                    ? "bg-cyan-300/[0.11] text-white"
                    : "text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"
                }`}
                key={item.destination}
                onClick={() => onNavigate(item.destination)}
                type="button"
              >
                {active ? (
                  <span aria-hidden="true" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-cyan-300" />
                ) : null}
                <Icon aria-hidden="true" size={19} strokeWidth={active ? 2.4 : 2} />
                <span className={active ? "font-bold" : undefined}>{item.label}</span>
                {active ? <span className="sr-only">Current page</span> : null}
              </button>
            );
          })}
          <button
            aria-controls={sheetId}
            aria-current={!primaryActive ? "page" : undefined}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300/50 ${
              !primaryActive
                ? "bg-cyan-300/[0.11] text-white"
                : "text-slate-500 hover:bg-white/[0.05] hover:text-slate-200"
            }`}
            onClick={() => setMoreOpen(true)}
            ref={moreTriggerRef}
            type="button"
          >
            {!primaryActive ? (
              <span aria-hidden="true" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-cyan-300" />
            ) : null}
            <MoreHorizontal aria-hidden="true" size={20} strokeWidth={!primaryActive ? 2.4 : 2} />
            <span className={!primaryActive ? "font-bold" : undefined}>More</span>
            {!primaryActive ? <span className="sr-only">Current section</span> : null}
          </button>
        </div>
      </nav>

      {moreOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 px-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] backdrop-blur-[2px] lg:hidden"
              onPointerDown={(event) => {
                if (event.currentTarget === event.target) {
                  closeMore();
                }
              }}
            >
              <div
                aria-labelledby={titleId}
                aria-modal="true"
                className="max-h-[min(86dvh,760px)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-2xl border border-b-0 border-white/10 bg-[#0a0f16] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-28px_90px_rgba(0,0,0,0.62)]"
                id={sheetId}
                ref={sheetRef}
                role="dialog"
              >
                <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600" />
                <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-[#0a0f16]/95 py-2 backdrop-blur">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white" id={titleId}>More tools</h2>
                    <p className="mt-0.5 text-sm text-slate-400">Every workspace is one tap away.</p>
                  </div>
                  <button
                    aria-label="Close more tools"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/50"
                    onClick={() => closeMore()}
                    ref={closeRef}
                    type="button"
                  >
                    <X aria-hidden="true" size={20} />
                  </button>
                </div>

                <div className="mt-3 grid gap-6 sm:grid-cols-2">
                  {sections.map((section) => (
                    <section key={section.label}>
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        {section.label}
                      </h3>
                      <div className="grid gap-1">
                        {section.entries.map((item) => {
                          const Icon = item.icon;
                          const active = workspaceNavigationItemIsActive(item.id, activeView);
                          return (
                            <button
                              aria-current={active ? "page" : undefined}
                              className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300/50 ${
                                active
                                  ? "bg-cyan-300/[0.1] text-white ring-1 ring-inset ring-cyan-300/25"
                                  : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                              }`}
                              key={item.id}
                              onClick={() => navigate(item.id)}
                              type="button"
                            >
                              <Icon aria-hidden="true" className="shrink-0" size={18} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold">{item.label}</span>
                                <span className="block truncate text-xs text-slate-500">{item.description}</span>
                              </span>
                              {active ? <Check aria-hidden="true" className="shrink-0 text-cyan-200" size={17} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>

                <div className="mt-6">
                  <AccountSystemMenu
                    onNavigate={navigate}
                    onRequestClose={() => closeMore(false)}
                    presentation="inline"
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
