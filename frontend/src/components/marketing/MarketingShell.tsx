import { ArrowRight, Menu, X } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { EdgeLabWordmark as EdgeLabBrandWordmark } from "../brand/EdgeLabBrand";
import { StudioAttribution } from "../brand/StudioAttribution";
import { isBetaMode, type DeploymentMode } from "../../lib/deploymentMode";
import { loadGsap } from "../../lib/gsap";
import { buildMarketingCta, marketingPresentationFromSearch, marketingPresentationHref } from "../../lib/marketingCta";
import { prefersMarketingReducedMotion, setMarketingMotionChoice, useMarketingReducedMotionPreference } from "../../lib/marketingMotion";
import { useBetaProgramStatus } from "../../lib/useBetaProgram";

type NavItem = {
  href: string;
  label: string;
};

type MarketingShellProps = {
  children: ReactNode;
  navItems: NavItem[];
  pageDescription: string;
  pageTitle: string;
  presentationMode?: DeploymentMode;
};

const MARKETING_EXPLICIT_OWNER_SELECTOR = "[data-marketing-reveal], [data-marketing-flow], [data-flow-row]";
const MARKETING_OWNER_SELECTOR = `${MARKETING_EXPLICIT_OWNER_SELECTOR}, .landing-story [data-scene-content]`;
const MARKETING_FLOW_SELECTOR = `${MARKETING_OWNER_SELECTOR}, .landing-story h2, .landing-story h3, .landing-story p`;

function flowNodes(shell: HTMLElement) {
  // Explicit cards and rows own their text. A scene only owns an undivided group.
  const owners = new Set(Array.from(shell.querySelectorAll<HTMLElement>(MARKETING_OWNER_SELECTOR)).filter((node) =>
    !node.hasAttribute("data-scene-content") || node.matches(MARKETING_EXPLICIT_OWNER_SELECTOR)
      || !node.querySelector(MARKETING_EXPLICIT_OWNER_SELECTOR),
  ));
  return Array.from(shell.querySelectorAll<HTMLElement>(MARKETING_FLOW_SELECTOR)).filter((node) => {
    if (node.hasAttribute("data-scene-content") && !owners.has(node)) return false;
    for (let parent = node.parentElement; parent && parent !== shell; parent = parent.parentElement) {
      if (owners.has(parent) || parent.matches("[data-landing-stage], [data-market-sculpture]")) return false;
    }
    return true;
  });
}

export function buildMarketingNavItems(mode: "home" | "inner" = "home"): NavItem[] {
  const prefix = mode === "home" ? "" : "/";

  return [
    { href: `${prefix}#product`, label: "Product" },
    { href: `${prefix}#how-it-works`, label: "How it works" },
    { href: `${prefix}#evidence`, label: "Evidence" },
    { href: `${prefix}#pricing`, label: "Pricing" },
    { href: `${prefix}#faq`, label: "FAQ" },
  ];
}

function NavAnchor({
  className,
  href,
  isCurrent,
  label,
  onClick,
}: NavItem & {
  className?: string;
  isCurrent?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  const sharedProps = {
    "aria-current": isCurrent ? ("location" as const) : undefined,
    className,
    onClick,
  };

  if (href.startsWith("#")) {
    return (
      <a href={href} {...sharedProps}>
        {label}
      </a>
    );
  }

  if (href.startsWith("/")) {
    return (
      <Link to={href} {...sharedProps}>
        {label}
      </Link>
    );
  }

  return (
    <a href={href} {...sharedProps}>
      {label}
    </a>
  );
}

export function EdgeLabWordmark({ showTagline = true }: { showTagline?: boolean }) {
  return <EdgeLabBrandWordmark markFrame="bare" showTagline={showTagline} size="md" />;
}

function BetaBanner({ mode }: { mode: DeploymentMode }) {
  const { error, loading, program } = useBetaProgramStatus();

  if (!isBetaMode(mode)) {
    return null;
  }

  const seatSummary =
    loading
      ? "checking availability"
      : error || program.seats_remaining == null
        ? "availability unavailable"
      : program.mode !== "beta"
        ? "access closed"
      : program.seats_remaining > 0
        ? `${program.seats_remaining} open now`
        : "waitlist live";

  return (
    <div className="border-b border-edgelab-border bg-edgelab-surface px-4 py-2">
      <div className="mx-auto flex max-w-7xl justify-center" role="status">
        <div className="inline-flex items-center gap-2 text-[11px] text-edgelab-text-secondary">
          <span className="font-semibold text-cyan-100">Private beta</span>
          <span aria-hidden="true" className="h-px w-3 bg-edgelab-border" />
          <span>{seatSummary}</span>
        </div>
      </div>
    </div>
  );
}

export function MarketingShell({
  children,
  navItems,
  pageDescription,
  pageTitle,
  presentationMode: requestedPresentationMode,
}: MarketingShellProps) {
  const location = useLocation();
  const presentationMode = requestedPresentationMode ?? marketingPresentationFromSearch(location.search);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const reducedMotion = useMarketingReducedMotionPreference();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const mobileMenuRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const { error, loading, program } = useBetaProgramStatus();
  const seatsRemaining = program.seats_remaining;
  const primaryCta = buildMarketingCta({
    mode: isBetaMode(presentationMode) && !loading && !error && program.mode === "beta" ? "beta" : "production",
    search: location.search,
    seatsRemaining: loading ? null : seatsRemaining,
  });

  const closeMobileMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${pageTitle} · EdgeLab`;

    const metaEntries = [
      { key: "name", keyValue: "description", content: pageDescription },
      { key: "property", keyValue: "og:title", content: `${pageTitle} · EdgeLab` },
      { key: "property", keyValue: "og:description", content: pageDescription },
    ];
    const restorations = metaEntries.map(({ content, key, keyValue }) => {
      let element = document.head.querySelector<HTMLMetaElement>(`meta[${key}="${keyValue}"]`);
      const created = !element;
      const previousContent = element?.content ?? "";
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(key, keyValue);
        document.head.append(element);
      }
      element.content = content;
      return { created, element, previousContent };
    });

    return () => {
      document.title = previousTitle;
      restorations.forEach(({ created, element, previousContent }) => {
        if (created) {
          element.remove();
        } else {
          element.content = previousContent;
        }
      });
    };
  }, [pageDescription, pageTitle]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 12);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const trackedSections = navItems.flatMap((item) => {
      const hashIndex = item.href.indexOf("#");
      if (hashIndex === -1) {
        return [];
      }
      const targetPath = item.href.startsWith("/")
        ? item.href.slice(0, hashIndex) || "/"
        : window.location.pathname;
      if (targetPath !== window.location.pathname) {
        return [];
      }
      const node = document.getElementById(item.href.slice(hashIndex + 1));
      return node ? [{ href: item.href, node }] : [];
    });

    if (trackedSections.length === 0) {
      setActiveHref(null);
      return;
    }

    let frame = 0;
    const updateActiveSection = () => {
      frame = 0;
      const marker = (headerRef.current?.offsetHeight ?? 80) + window.innerHeight * 0.2;
      let active = trackedSections[0];
      trackedSections.forEach((section) => {
        if (section.node.getBoundingClientRect().top <= marker) {
          active = section;
        }
      });
      setActiveHref(active.href);
    };
    const scheduleUpdate = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(updateActiveSection);
      }
    };

    updateActiveSection();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("hashchange", scheduleUpdate);
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("hashchange", scheduleUpdate);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [navItems, pageTitle]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pageTitle]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      mobileMenuRef.current?.querySelector<HTMLElement>("a")?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeMobileMenu(true);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMobileMenu, menuOpen]);

  useEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header) {
      return;
    }

    let cancelled = false;
    let context: { revert(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let refreshFrame = 0;
    const flowRegistrations = new Map<HTMLElement, () => void>();
    const restoreRevealNodes = () => {
      const revealNodes = flowNodes(shell);
      const headerNodes = Array.from(header.querySelectorAll<HTMLElement>("[data-shell-motion]"));
      [...headerNodes, ...revealNodes].forEach((node) => {
        node.style.removeProperty("opacity");
        node.style.removeProperty("transform");
        node.style.removeProperty("will-change");
      });
    };

    if (reducedMotion) {
      restoreRevealNodes();
      return;
    }

    void loadGsap({ plugins: ["CustomEase", "ScrollTrigger"] })
      .then(({ gsap, plugins }) => {
        if (cancelled || !shell || !header) {
          return;
        }

        try {
          const revealEase =
            plugins.CustomEase?.create("edgelab-reveal", "0.16,1,0.3,1") ?? "power3.out";
          context = gsap.context(() => {
            const reduceMotion = prefersMarketingReducedMotion();
            const headerNodes = Array.from(
              header.querySelectorAll<HTMLElement>("[data-shell-motion]"),
            );

            if (headerNodes.length > 0) {
              if (reduceMotion) {
                gsap.set(headerNodes, { clearProps: "all" });
              } else {
                gsap.set(headerNodes, {
                  opacity: 0,
                  y: -18,
                  willChange: "transform, opacity",
                });
                gsap.to(headerNodes, {
                  clearProps: "opacity,transform,willChange",
                  duration: 0.72,
                  ease: revealEase,
                  opacity: 1,
                  stagger: 0.08,
                  y: 0,
                });
              }
            }

          }, shell);

          const registerFlow = (node: HTMLElement) => {
            const offsetY = node.matches("[data-marketing-flow], [data-flow-row], [data-scene-content]") ? 56 : 40;
            const authoredDelay = Number(node.dataset.revealDelay ?? 0);
            const delay = Number.isFinite(authoredDelay) ? Math.min(0.4, Math.max(0, authoredDelay)) : 0;
            let animation: { kill(): void } | null = null;
            let trigger: { kill(): void } | null = null;
            let pointerId: number | null = null;
            let pointerFrame = 0;
            let phase: "before" | "inside" | "after" | null = null;
            const bounds = () => {
              // Measure the layout, not the pose being animated across the trigger.
              const transform = getComputedStyle(node).transform;
              const translation = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
              const rect = node.getBoundingClientRect();
              const headerBottom = Math.max(0, headerRef.current?.getBoundingClientRect().bottom ?? 0);
              return {
                // Start after the content enters view, so the reveal is visible.
                start: rect.top + window.scrollY - translation - window.innerHeight * 0.92,
                // Keep the reading area intact; leave only as the final strip
                // approaches the fixed header, rather than after disappearing.
                end: rect.bottom + window.scrollY - translation - headerBottom - Math.min(72, Math.max(32, rect.height * 0.18)),
              };
            };
            const showFocus = () => {
              animation?.kill();
              gsap.set(node, pointerId === null ? { opacity: 1, y: 0 } : { opacity: 1 });
            };
            const enter = (direction: 1 | -1) => {
              phase = "inside";
              animation?.kill();
              if (pointerId !== null) return;
              if (node.contains(document.activeElement)) { showFocus(); return; }
              if (Number(getComputedStyle(node).opacity) < 0.01) gsap.set(node, { y: direction * offsetY });
              animation = gsap.to(node, { opacity: 1, y: 0, delay, duration: 1, ease: revealEase, overwrite: "auto" });
            };
            const leave = (direction: 1 | -1) => {
              phase = direction === 1 ? "after" : "before";
              animation?.kill();
              if (pointerId !== null) return;
              if (node.contains(document.activeElement)) { showFocus(); return; }
              animation = gsap.to(node, { opacity: 0, y: -direction * 40, duration: 0.9, ease: "power2.inOut", overwrite: "auto" });
            };
            const synchronize = () => {
              const range = bounds();
              const next = window.scrollY < range.start ? "before" : window.scrollY > range.end ? "after" : "inside";
              if (next !== phase) {
                if (next === "inside") enter(phase === "after" ? -1 : 1);
                else leave(next === "after" ? 1 : -1);
              }
            };
            const blur = (event: FocusEvent) => {
              if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
              phase = null;
              synchronize();
            };
            const beginPointer = (event: PointerEvent) => {
              if (!event.isPrimary || (pointerId !== null && pointerFrame === 0)) return;
              window.cancelAnimationFrame(pointerFrame);
              pointerFrame = 0;
              pointerId = event.pointerId;
              node.dataset.marketingPointer = "true";
              animation?.kill();
            };
            const releasePointer = () => {
              if (pointerId === null) return;
              window.cancelAnimationFrame(pointerFrame);
              // Keep the hit target stationary through pointerup and its native click.
              pointerFrame = window.requestAnimationFrame(() => {
                pointerFrame = 0;
                pointerId = null;
                delete node.dataset.marketingPointer;
                phase = null;
                synchronize();
              });
            };
            const endPointer = (event: PointerEvent) => {
              if (event.pointerId === pointerId) releasePointer();
            };
            const nodeContext = gsap.context(() => {
              if (!plugins.ScrollTrigger) return;
              gsap.set(node, { opacity: 0, y: offsetY });
              trigger = plugins.ScrollTrigger.create({
                trigger: node,
                start: () => bounds().start,
                end: () => bounds().end,
                onEnter: () => enter(1),
                onLeave: () => leave(1),
                onEnterBack: () => enter(-1),
                onLeaveBack: () => leave(-1),
                onRefresh: synchronize,
              });
              synchronize();
            }, shell);
            node.addEventListener("focusin", showFocus);
            node.addEventListener("focusout", blur);
            node.addEventListener("pointerdown", beginPointer, true);
            window.addEventListener("pointerup", endPointer, true);
            window.addEventListener("pointercancel", endPointer, true);
            window.addEventListener("blur", releasePointer);
            flowRegistrations.set(node, () => {
              animation?.kill();
              trigger?.kill();
              window.cancelAnimationFrame(pointerFrame);
              delete node.dataset.marketingPointer;
              node.removeEventListener("focusin", showFocus);
              node.removeEventListener("focusout", blur);
              node.removeEventListener("pointerdown", beginPointer, true);
              window.removeEventListener("pointerup", endPointer, true);
              window.removeEventListener("pointercancel", endPointer, true);
              window.removeEventListener("blur", releasePointer);
              nodeContext.revert();
            });
          };
          const reconcileFlow = () => {
            const nodes = new Set(flowNodes(shell));
            for (const [node, dispose] of flowRegistrations) {
              if (nodes.has(node)) continue;
              dispose();
              flowRegistrations.delete(node);
            }
            for (const node of nodes) if (!flowRegistrations.has(node)) registerFlow(node);
          };
          const refresh = () => {
            if (cancelled) return;
            window.cancelAnimationFrame(refreshFrame);
            refreshFrame = window.requestAnimationFrame(() => {
              if (cancelled) return;
              reconcileFlow();
              plugins.ScrollTrigger?.refresh();
            });
          };
          reconcileFlow();
          mutationObserver = new MutationObserver(refresh);
          mutationObserver.observe(shell.querySelector("main") ?? shell, { childList: true, subtree: true });
          resizeObserver = new ResizeObserver(refresh);
          const main = shell.querySelector("main");
          if (main) resizeObserver.observe(main);
          plugins.ScrollTrigger?.refresh();
          void document.fonts?.ready.then(refresh);
        } catch (error) {
          flowRegistrations.forEach((dispose) => dispose());
          flowRegistrations.clear();
          restoreRevealNodes();
          console.warn("EdgeLab marketing animations were restored after GSAP setup failed.", error);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        restoreRevealNodes();
        console.warn("EdgeLab marketing animations could not load.", error);
      });

    return () => {
      cancelled = true;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(refreshFrame);
      flowRegistrations.forEach((dispose) => dispose());
      flowRegistrations.clear();
      context?.revert();
    };
  }, [pageTitle, reducedMotion]);

  useEffect(() => {
    const mobileMenu = mobileMenuRef.current;
    if (!menuOpen || !mobileMenu || reducedMotion) {
      return;
    }

    let cancelled = false;
    let animation: { kill(): void } | null = null;

    void loadGsap()
      .then(({ gsap }) => {
        if (cancelled || !mobileMenu) {
          return;
        }
        animation = gsap.fromTo(
          mobileMenu,
          {
            opacity: 0,
            y: -14,
          },
          {
            clearProps: "opacity,transform",
            duration: 0.36,
            ease: "power3.out",
            opacity: 1,
            y: 0,
          },
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      animation?.kill();
    };
  }, [menuOpen, reducedMotion]);

  const handleNavClick = useMemo(
    () => (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = event.currentTarget.getAttribute("href");
      if (!href) {
        return;
      }

      const hashIndex = href.indexOf("#");
      if (hashIndex === -1) {
        return;
      }

      const hash = href.slice(hashIndex);
      if (!hash) {
        return;
      }

      const targetPath = href.startsWith("/")
        ? href.slice(0, hashIndex) || "/"
        : window.location.pathname;
      if (targetPath !== window.location.pathname) {
        return;
      }

      const target = document.querySelector<HTMLElement>(hash);
      if (!target) {
        return;
      }

      event.preventDefault();
      closeMobileMenu(false);
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });

      const headerOffset = headerRef.current?.offsetHeight ?? 88;
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset - 12;
      window.history.replaceState(null, "", hash);

      if (reducedMotion || prefersMarketingReducedMotion()) {
        window.scrollTo({ top, behavior: "auto" });
        return;
      }

      void loadGsap({ plugins: ["CustomEase", "ScrollToPlugin"] })
        .then(({ gsap, plugins }) => {
          const scrollEase =
            plugins.CustomEase?.create("edgelab-nav-scroll", "0.22,1,0.36,1") ??
            "power3.out";
          gsap.killTweensOf(window);
          gsap.to(window, {
            duration: 1,
            ease: scrollEase,
            scrollTo: { y: top },
          });
        })
        .catch(() => {
          window.scrollTo({ top, behavior: "smooth" });
        });
    },
    [closeMobileMenu, reducedMotion],
  );

  const headerClassName = useMemo(
    () =>
      [
        "sticky top-0 z-50 border-b transition-all duration-300",
        scrolled
          ? "border-edgelab-border bg-edgelab-base shadow-panel"
          : "border-transparent bg-edgelab-base",
      ].join(" "),
    [scrolled],
  );

  return (
    <div
      className="marketing-shell relative min-h-screen max-w-[100vw] overflow-x-clip bg-edgelab-base text-edgelab-text-primary"
      data-marketing-motion={reducedMotion ? "reduced" : "full"}
      ref={shellRef}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_8%,rgba(50,211,238,0.1),transparent_25%),linear-gradient(180deg,var(--bg-base)_0%,#07090d_100%)]" />
      </div>

      <div className="relative z-10 max-w-[100vw] overflow-x-clip">
        <a
          className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-el-md bg-edgelab-accent px-4 py-3 text-sm font-semibold text-ink-950 transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-cyan-100 motion-reduce:transition-none"
          href="#main-content"
        >
          Skip to content
        </a>
        <BetaBanner mode={presentationMode} />
        <header className={headerClassName} ref={headerRef}>
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-3 py-4 sm:px-6 lg:px-8">
            <Link aria-label="EdgeLab home" data-shell-motion="wordmark" to={marketingPresentationHref("/", presentationMode)}>
              <EdgeLabWordmark />
            </Link>

            <nav
              aria-label="Primary navigation"
              className="hidden items-center gap-5 text-sm text-edgelab-text-secondary lg:flex"
              data-shell-motion="nav"
            >
              {navItems.map((item) => (
                <NavAnchor
                  key={item.href}
                  className={`border-b py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                    activeHref === item.href
                      ? "border-cyan-300 text-cyan-100"
                      : "border-transparent hover:text-edgelab-text-primary"
                  }`}
                  href={marketingPresentationHref(item.href, presentationMode)}
                  isCurrent={activeHref === item.href}
                  label={item.label}
                  onClick={handleNavClick}
                />
              ))}
            </nav>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3" data-shell-motion="cta">
              <Link
                className="hidden min-h-11 items-center gap-2 rounded-el-md bg-edgelab-accent px-4 py-2 text-sm font-semibold text-ink-950 transition-[background-color,transform] duration-200 ease-el-out hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 motion-reduce:transform-none motion-reduce:transition-none md:inline-flex"
                to={primaryCta.href}
              >
                {primaryCta.label}
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
              <button
                aria-expanded={menuOpen}
                aria-controls="marketing-mobile-menu"
                aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                className="inline-flex h-11 w-11 items-center justify-center rounded-el-md border border-edgelab-border bg-edgelab-surface text-edgelab-text-primary transition-colors hover:border-cyan-300/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 lg:hidden"
                onClick={() => setMenuOpen((current) => !current)}
                ref={menuButtonRef}
                type="button"
              >
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>

          {menuOpen ? (
            <nav
              aria-label="Mobile navigation"
              className="border-t border-edgelab-border bg-edgelab-base px-3 py-4 lg:hidden"
              id="marketing-mobile-menu"
              ref={mobileMenuRef}
            >
              <div className="grid gap-3">
                {navItems.map((item) => (
                  <NavAnchor
                    key={item.href}
                    className={`flex min-h-11 items-center rounded-el-md border px-4 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                      activeHref === item.href
                        ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                        : "border-edgelab-border bg-edgelab-surface text-edgelab-text-primary"
                    }`}
                    href={marketingPresentationHref(item.href, presentationMode)}
                    isCurrent={activeHref === item.href}
                    label={item.label}
                    onClick={handleNavClick}
                  />
                ))}
                <Link
                  className="inline-flex min-h-11 items-center justify-between rounded-el-md bg-edgelab-accent px-4 py-3 text-sm font-semibold text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100"
                  onClick={() => closeMobileMenu(false)}
                  to={primaryCta.href}
                >
                  {primaryCta.label}
                  <ArrowRight aria-hidden="true" size={15} />
                </Link>
              </div>
            </nav>
          ) : null}
        </header>

        <main id="main-content" tabIndex={-1}>{children}</main>

        <footer className="border-t border-edgelab-border bg-edgelab-surface px-3 pb-10 pt-10 sm:px-6 lg:px-8">
          <div
            className="mx-auto grid max-w-7xl gap-10 px-1 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
            data-marketing-reveal="footer"
          >
            <div>
              <EdgeLabWordmark showTagline={false} />
              <p className="mt-4 max-w-md text-sm leading-6 text-edgelab-text-secondary">
                Replay, Journal, and review for traders who want decisions they can inspect.
              </p>
              <p className="mt-5 text-xs text-edgelab-text-secondary">
                Research software only. EdgeLab does not provide financial advice.
              </p>
              <StudioAttribution />
            </div>

            <nav aria-label="Footer navigation" className="grid gap-3 text-sm text-edgelab-text-secondary sm:text-right">
              <div className="flex flex-wrap gap-x-5 gap-y-3 sm:justify-end">
                {navItems.map((item) => (
                  <NavAnchor
                    className="transition-colors hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                    href={marketingPresentationHref(item.href, presentationMode)}
                    key={item.href}
                    label={item.label}
                    onClick={handleNavClick}
                  />
                ))}
              </div>
              <div className="flex items-center gap-4 sm:justify-end">
                <Link className="transition hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" to="/privacy">
                  Privacy
                </Link>
                <Link className="transition hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" to="/terms">
                  Terms
                </Link>
                <a className="transition hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" href="/source/">
                  Source code
                </a>
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 sm:justify-end">
                <input className="h-4 w-4 accent-cyan-200" type="checkbox" checked={reducedMotion} onChange={(event) => setMarketingMotionChoice(event.target.checked ? "reduced" : "full")} />
                Pause animations
              </label>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
