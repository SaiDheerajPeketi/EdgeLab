import { Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deploymentMode, isBetaMode } from "../../lib/deploymentMode";
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
    { href: `${prefix}#product`, label: "Overview" },
    { href: `${prefix}#how-it-works`, label: "Workflow" },
    { href: "/pricing", label: "Pricing" },
  ];
}

function NavAnchor({ className, href, label }: NavItem & { className?: string }) {
  if (href.startsWith("#")) {
    return (
      <a className={className} href={href}>
        {label}
      </a>
    );
  }

  if (href.startsWith("/")) {
    return (
      <Link className={className} to={href}>
        {label}
      </Link>
    );
  }

  return (
    <a className={className} href={href}>
      {label}
    </a>
  );
}

export function EdgeLabWordmark() {
  return (
    <div className="flex items-center gap-3 text-slate-50">
      <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-300/15 bg-white/[0.03] shadow-[0_16px_32px_rgba(0,0,0,0.22)]">
        <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="edgelab-logo-gradient" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#8bf5ff" />
              <stop offset="100%" stopColor="#32d3ee" />
            </linearGradient>
          </defs>
          <path
            d="M18 49h28l-6-13 9-16h-9l-6 11-5-11h-9l9 18-11 11h0Z"
            fill="none"
            stroke="url(#edgelab-logo-gradient)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
          />
          <path
            d="M29 17h7l3 6"
            fill="none"
            stroke="#f6c26b"
            strokeLinecap="round"
            strokeWidth="3.4"
          />
        </svg>
      </div>
      <div>
        <div className="text-lg font-semibold tracking-[-0.05em] text-white">EdgeLab</div>
        <div className="max-w-[15rem] text-[10px] uppercase leading-[1.45] tracking-[0.28em] text-cyan-100/55">
          Your Edge Engineered
        </div>
      </div>
    </div>
  );
}

function BetaBanner() {
  if (!isBetaMode()) {
    return null;
  }

  const { loading, program } = useBetaProgramStatus();
  const seatSummary =
    loading || program.seats_remaining == null
      ? "seat sync in progress"
      : `${program.seats_remaining} seats open`;

  return (
    <div className="border-b border-white/10 bg-[#061018] px-4 py-2 text-center text-xs text-slate-300">
      <span className="font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
        Private beta
      </span>{" "}
      live. {seatSummary}. Beta data may be pruned after program ends.
    </div>
  );
}

export function MarketingShell({ children, navItems, pageTitle }: MarketingShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
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
    <div className="relative min-h-screen overflow-hidden bg-edgelab-base text-edgelab-text-primary">
      <div className="pointer-events-none absolute inset-0">
        <div className="edgelab-mesh absolute inset-x-[-10%] top-[-22rem] h-[44rem] opacity-50" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(50,211,238,0.10),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(245,158,11,0.06),transparent_20%),linear-gradient(180deg,#07090d_0%,#090b0f_42%,#05070a_100%)]" />
        <div className="edgelab-grid absolute inset-0 opacity-25" />
      </div>

      <div className="relative z-10">
        <BetaBanner />
        <header className={headerClassName}>
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <Link aria-label="EdgeLab home" to="/">
              <EdgeLabWordmark />
            </Link>

            <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
              {navItems.map((item) => (
                <NavAnchor
                  key={item.href}
                  className="transition hover:text-cyan-100"
                  href={item.href}
                  label={item.label}
                />
              ))}
            </nav>

            <div className="hidden items-center gap-3 md:flex">
              <Link
                className="inline-flex items-center gap-2 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow transition duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none"
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
              onClick={() => setMenuOpen((current) => !current)}
              type="button"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>

          {menuOpen ? (
            <div className="border-t border-white/10 bg-[#05070af2] px-4 py-4 backdrop-blur-xl md:hidden">
              <div className="grid gap-3">
                {navItems.map((item) => (
                  <NavAnchor
                    key={item.href}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-100"
                    href={item.href}
                    label={item.label}
                  />
                ))}
                <Link
                  className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950"
                  to={primaryCtaHref}
                >
                  {primaryCtaLabel} →
                </Link>
              </div>
            </div>
          ) : null}
        </header>

        <main>{children}</main>

        <footer className="border-t border-white/10 bg-black/20 px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <EdgeLabWordmark />
              <p className="mt-4 text-sm leading-7 text-slate-400">
                Replay, journal, and review from one focused trading surface.
              </p>
            </div>
            <div className="grid gap-3 text-sm text-slate-400">
              <a className="transition hover:text-cyan-100" href="/#product">
                Overview
              </a>
              <a className="transition hover:text-cyan-100" href="/#how-it-works">
                Workflow
              </a>
              <Link className="transition hover:text-cyan-100" to="/pricing">
                Pricing
              </Link>
              <Link className="transition hover:text-cyan-100" to={primaryCtaHref}>
                {primaryCtaLabel}
              </Link>
              <Link className="transition hover:text-cyan-100" to="/privacy">
                Privacy
              </Link>
              <Link className="transition hover:text-cyan-100" to="/terms">
                Terms
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
