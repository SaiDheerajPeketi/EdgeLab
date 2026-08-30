import { Menu, X } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { EdgeLabWordmark as EdgeLabBrandWordmark } from "../brand/EdgeLabBrand";
import { deploymentMode, isBetaMode } from "../../lib/deploymentMode";
import { loadGsap, prefersReducedMotion, type GsapPlugins } from "../../lib/gsap";
import { useBetaProgramStatus } from "../../lib/useBetaProgram";

type NavItem = {
  href: string;
  label: string;
};

type MarketingShellProps = {
  children: ReactNode;
  navItems: NavItem[];
  pageTitle: string;
};

export function buildMarketingNavItems(mode: "home" | "inner" = "home"): NavItem[] {
  const prefix = mode === "home" ? "" : "/";

  return [
    { href: `${prefix}#product`, label: "Product" },
    { href: `${prefix}#how-it-works`, label: "How it works" },
    { href: `${prefix}#pricing`, label: "Pricing" },
  ];
}

function NavAnchor({
  className,
  href,
  label,
  onClick,
}: NavItem & { className?: string; onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void }) {
  if (href.startsWith("#")) {
    return (
      <a className={className} href={href} onClick={onClick}>
        {label}
      </a>
    );
  }

  if (href.startsWith("/")) {
    return (
      <Link className={className} onClick={onClick} to={href}>
        {label}
      </Link>
    );
  }

  return (
    <a className={className} href={href} onClick={onClick}>
      {label}
    </a>
  );
}

export function EdgeLabWordmark({ showTagline = true }: { showTagline?: boolean }) {
  return <EdgeLabBrandWordmark markFrame="bare" showTagline={showTagline} size="md" />;
}

function BetaBanner() {
  if (!isBetaMode()) {
    return null;
  }

  const { loading, program } = useBetaProgramStatus();
  const seatSummary =
    loading || program.seats_remaining == null
      ? "seat sync live"
      : program.seats_remaining > 0
        ? `${program.seats_remaining} open now`
        : "waitlist live";

  return (
    <div className="border-b border-white/10 bg-[#061018] px-4 py-2">
      <div className="mx-auto flex max-w-7xl justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-slate-300">
          <span className="font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            Beta access
          </span>
          <span className="text-slate-600">•</span>
          <span>{seatSummary}</span>
        </div>
      </div>
    </div>
  );
}

export function MarketingShell({ children, navItems, pageTitle }: MarketingShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const { loading, program } = useBetaProgramStatus();
  const seatsRemaining = program.seats_remaining;
  const primaryCtaLabel =
    !loading && seatsRemaining != null && seatsRemaining <= 0 ? "Join Waitlist" : "Join Beta";
  const primaryCtaHref =
    !loading && seatsRemaining != null && seatsRemaining <= 0
      ? "/auth/signin?waitlist=1"
      : "/auth/signin";

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 12);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pageTitle]);

  useEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header) {
      return;
    }

    let cancelled = false;
    let context: { revert(): void } | null = null;
    const splitInstances: Array<{ revert(): void }> = [];
    const scrollTriggers: Array<{ kill(): void }> = [];
    const restoreRevealNodes = () => {
      const revealNodes = Array.from(
        shell.querySelectorAll<HTMLElement>("[data-marketing-reveal][data-motion='reveal']"),
      );
      const headerNodes = Array.from(header.querySelectorAll<HTMLElement>("[data-shell-motion]"));
      [...headerNodes, ...revealNodes].forEach((node) => {
        node.style.removeProperty("opacity");
        node.style.removeProperty("transform");
        node.style.removeProperty("will-change");
      });
      splitInstances.splice(0).forEach((instance) => instance.revert());
    };

    void loadGsap({ plugins: ["CustomEase", "ScrollTrigger", "SplitText"] })
      .then(({ gsap, plugins }) => {
        if (cancelled || !shell || !header) {
          return;
        }

        try {
          context = gsap.context(() => {
            const reduceMotion = prefersReducedMotion();
            const revealEase =
              plugins.CustomEase?.create("edgelab-reveal", "0.16,1,0.3,1") ?? "power3.out";
            const headerNodes = Array.from(
              header.querySelectorAll<HTMLElement>("[data-shell-motion]"),
            );
            const revealNodes = Array.from(
              shell.querySelectorAll<HTMLElement>("[data-marketing-reveal][data-motion='reveal']"),
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

            if (revealNodes.length > 0) {
              if (reduceMotion) {
                gsap.set(revealNodes, { clearProps: "all" });
              } else {
                revealNodes.forEach((node) => {
                  const splitResult = resolveSplitTargets(node, plugins.SplitText);
                  const targets = splitResult?.targets ?? [node];
                  const offsetY = node.dataset.splitText ? 44 : 24;
                  const stagger = node.dataset.splitText === "chars" ? 0.014 : 0.08;
                  if (splitResult) {
                    splitInstances.push(splitResult.instance);
                  }
                  gsap.set(targets, {
                    opacity: 0,
                    y: offsetY,
                    willChange: "transform, opacity",
                  });

                  if (plugins.ScrollTrigger) {
                    scrollTriggers.push(
                      plugins.ScrollTrigger.create({
                        once: true,
                        onEnter: () => {
                          const delay = Number(node.dataset.revealDelay ?? "0");
                          gsap.to(targets, {
                            clearProps: "opacity,transform,willChange",
                            delay,
                            duration: 0.82,
                            ease: revealEase,
                            opacity: 1,
                            stagger,
                            y: 0,
                          });
                        },
                        start: "top 86%",
                        trigger: node,
                      }),
                    );
                    return;
                  }

                  gsap.to(targets, {
                    clearProps: "opacity,transform,willChange",
                    duration: 0.82,
                    ease: revealEase,
                    opacity: 1,
                    stagger,
                    y: 0,
                  });
                });
              }
            }

          }, shell);

          plugins.ScrollTrigger?.refresh();
          void document.fonts?.ready.then(() => plugins.ScrollTrigger?.refresh());
        } catch (error) {
          restoreRevealNodes();
          console.warn("EdgeLab marketing animations were restored after GSAP setup failed.", error);
        }
      })
      .catch((error) => {
        restoreRevealNodes();
        console.warn("EdgeLab marketing animations could not load.", error);
      });

    return () => {
      cancelled = true;
      scrollTriggers.forEach((trigger) => trigger.kill());
      splitInstances.forEach((instance) => instance.revert());
      context?.revert();
    };
  }, [pageTitle]);

  useEffect(() => {
    const mobileMenu = mobileMenuRef.current;
    if (!menuOpen || !mobileMenu || prefersReducedMotion()) {
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
  }, [menuOpen]);

  const handleNavClick = useMemo(
    () => (event: ReactMouseEvent<HTMLAnchorElement>) => {
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
      setMenuOpen(false);

      const headerOffset = headerRef.current?.offsetHeight ?? 88;
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset - 12;
      window.history.replaceState(null, "", hash);

      if (prefersReducedMotion()) {
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
    [],
  );

  const headerClassName = useMemo(
    () =>
      [
        "sticky top-0 z-50 border-b transition-all duration-300",
        scrolled
          ? "border-white/10 bg-[#07090dcc] shadow-[0_18px_45px_rgba(0,0,0,0.28)] backdrop-blur-xl"
          : "border-transparent bg-[#07090d80] backdrop-blur-md",
      ].join(" "),
    [scrolled],
  );

  return (
    <div
      className="relative min-h-screen max-w-[100vw] overflow-x-clip bg-edgelab-base text-edgelab-text-primary"
      ref={shellRef}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#07090d_0%,#090b0f_46%,#05070a_100%)]" />
        <div className="absolute left-1/2 top-0 h-px w-[min(80vw,980px)] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
      </div>

      <div className="relative z-10 max-w-[100vw] overflow-x-clip">
        <BetaBanner />
        <header className={headerClassName} ref={headerRef}>
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-3 py-4 sm:px-6 lg:px-8">
            <Link aria-label="EdgeLab home" data-shell-motion="wordmark" to="/">
              <EdgeLabWordmark />
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex" data-shell-motion="nav">
              {navItems.map((item) => (
                <NavAnchor
                  key={item.href}
                  className="transition hover:text-cyan-100"
                  href={item.href}
                  label={item.label}
                  onClick={handleNavClick}
                />
              ))}
            </nav>

            <div className="hidden items-center gap-3 md:flex" data-shell-motion="cta">
              <Link
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#031114] transition-colors duration-200 hover:bg-cyan-200"
                to={primaryCtaHref}
              >
                {primaryCtaLabel}
                <span aria-hidden="true">→</span>
              </Link>
            </div>

            <button
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-100 md:hidden"
              data-shell-motion="menu"
              onClick={() => setMenuOpen((current) => !current)}
              type="button"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>

          {menuOpen ? (
            <div
              className="border-t border-white/10 bg-[#05070af2] px-3 py-4 backdrop-blur-xl md:hidden"
              ref={mobileMenuRef}
            >
              <div className="grid gap-3">
                {navItems.map((item) => (
                  <NavAnchor
                    key={item.href}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-100"
                    href={item.href}
                    label={item.label}
                    onClick={handleNavClick}
                  />
                ))}
                <Link
                  className="rounded-lg bg-cyan-300 px-4 py-3 text-sm font-semibold text-[#031114]"
                  to={primaryCtaHref}
                >
                  {primaryCtaLabel} →
                </Link>
              </div>
            </div>
          ) : null}
        </header>

        <main>{children}</main>

        <footer className="px-3 pb-10 pt-6 sm:px-6 lg:px-8">
          <div
            className="mx-auto max-w-7xl border-t border-white/10 px-1 py-8"
            data-marketing-reveal="footer"
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <EdgeLabWordmark showTagline={false} />

              <div className="flex items-center gap-4 text-sm text-slate-400">
                <Link className="transition hover:text-cyan-100" to="/privacy">
                  Privacy
                </Link>
                <Link className="transition hover:text-cyan-100" to="/terms">
                  Terms
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function resolveSplitTargets(
  node: HTMLElement,
  splitTextPlugin?: GsapPlugins["SplitText"],
) {
  const splitMode = node.dataset.splitText;
  if (!splitMode || !splitTextPlugin) {
    return null;
  }

  const split = splitTextPlugin.create(node, {
    linesClass: "edgelab-split-line",
    type: splitMode,
    wordsClass: "edgelab-split-word",
  });

  const targets =
    splitMode === "chars"
      ? split.chars ?? []
      : splitMode === "words"
        ? split.words ?? []
        : split.lines ?? split.words ?? [];

  if (targets.length === 0) {
    split.revert();
    return null;
  }

  return {
    instance: split,
    targets,
  };
}
