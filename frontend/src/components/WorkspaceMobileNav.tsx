import { Check, MoreHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MOBILE_PRIMARY_NAVIGATION,
  mobileMoreNavigationSections,
  mobilePrimaryItemIsActive,
  workspaceNavigationItemIsActive,
} from "../lib/workspaceNavigation";
import type { WorkspaceView } from "../lib/workspace";
import { AccountSystemMenu } from "./AccountSystemMenu";
import { Drawer, IconButton } from "./ui/Primitives";

type Props = {
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
};

export function WorkspaceMobileNav({ activeView, onNavigate }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
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
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    function handleDesktopChange(event: MediaQueryListEvent) {
      if (event.matches) {
        setMoreOpen(false);
      }
    }

    desktopQuery.addEventListener("change", handleDesktopChange);
    return () => {
      desktopQuery.removeEventListener("change", handleDesktopChange);
    };
  }, [moreOpen]);

  return (
    <>
      <nav
        aria-label="Primary workspace"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--ui-divider)] bg-[var(--ui-navigation-mobile)] ps-[max(0.35rem,env(safe-area-inset-left))] pe-[max(0.35rem,env(safe-area-inset-right))] pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[var(--elevation-floating)] lg:hidden"
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
                    ? "bg-[var(--ui-navigation-active)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--ui-navigation-hover)] hover:text-[var(--text-primary)]"
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
            aria-current={!primaryActive ? "page" : undefined}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300/50 ${
              !primaryActive
                ? "bg-[var(--ui-navigation-active)] text-[var(--text-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--ui-navigation-hover)] hover:text-[var(--text-primary)]"
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

      <Drawer open={moreOpen} onClose={() => closeMore()} placement="bottom" label="More workspace tools" initialFocusRef={closeRef} className="max-w-2xl border border-b-0 border-[var(--ui-border-subtle)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
                <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600" />
                <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-[var(--ui-modal)] py-2">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white">More tools</h2>
                    <p className="mt-0.5 text-sm text-slate-400">Every workspace is one tap away.</p>
                  </div>
                  <IconButton
                    icon={X}
                    label="Close more tools"
                    onClick={() => closeMore()}
                    ref={closeRef}
                  />
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
      </Drawer>
    </>
  );
}
