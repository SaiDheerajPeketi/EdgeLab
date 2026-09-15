import { ArrowRight, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { HeroDemo } from "../components/marketing/HeroDemo";
import { CapabilityStatusRail } from "../components/marketing/CapabilityStatusRail";
import { TrustEvidence } from "../components/marketing/TrustEvidence";
import {
  FaqAccordion,
  PricingSection,
  pricingFaqItems,
} from "../components/marketing/PricingSection";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "../components/marketing/MarketingShell";
import { deploymentMode, isBetaMode } from "../lib/deploymentMode";
import { loadGsap, prefersReducedMotion } from "../lib/gsap";
import { buildMarketingCta } from "../lib/marketingCta";
import { useReducedMotionPreference } from "../lib/motionPreferences";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

type WorkflowStep = {
  body: string;
  phase: string;
  step: string;
  title: string;
};

type MarketPulse = {
  change: string;
  symbol: string;
  tone: "down" | "up";
  value: string;
};

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: "01",
    phase: "Replay",
    title: "Replay the decision, not just the candle.",
    body: "Walk price forward while entries, exits, sizing, and tempo remain visible in the same market context.",
  },
  {
    step: "02",
    phase: "Journal",
    title: "Capture what you saw while it is still useful.",
    body: "Journal notes, mistake tags, and playbooks stay attached to the exact session behavior that produced them.",
  },
  {
    step: "03",
    phase: "Review",
    title: "Read the outcome beside the original context.",
    body: "Trades, notes, mistake tags, and session metrics keep the review grounded in what actually happened.",
  },
  {
    step: "04",
    phase: "Refine",
    title: "Carry the lesson into the next session.",
    body: "Strategy breakdowns and playbooks turn repeated behavior into a process you can test again.",
  },
];

const MARKET_PULSE: MarketPulse[] = [
  { symbol: "NQ", value: "4301.30", change: "+0.64%", tone: "up" },
  { symbol: "ES", value: "5988.75", change: "+0.28%", tone: "up" },
  { symbol: "CL", value: "79.42", change: "-0.31%", tone: "down" },
  { symbol: "EURUSD", value: "1.0887", change: "+0.12%", tone: "up" },
  { symbol: "AAPL", value: "188.10", change: "-0.44%", tone: "down" },
  { symbol: "BTC", value: "104,221", change: "+1.18%", tone: "up" },
];

function parseMarketValue(value: string) {
  return Number(value.replace(/,/g, ""));
}

function formatMarketValue(symbol: string, value: number) {
  if (symbol === "BTC") {
    return Math.round(value).toLocaleString("en-US");
  }
  if (symbol === "EURUSD") {
    return value.toFixed(4);
  }
  return value.toFixed(2);
}

function formatMarketChange(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function MarketTape() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState(MARKET_PULSE);
  const [isActive, setIsActive] = useState(true);
  const reducedMotion = useReducedMotionPreference();

  useEffect(() => {
    if (!isActive || reducedMotion) {
      return;
    }

    const timer = window.setInterval(() => {
      setItems((current) =>
        current.map((item, index) => {
          const baseValue = parseMarketValue(MARKET_PULSE[index]?.value ?? item.value);
          const nextValue = baseValue * (1 + Math.sin(Date.now() / 1400 + index * 1.7) * 0.0009);
          const baseChange = Number((MARKET_PULSE[index]?.change ?? item.change).replace("%", ""));
          const nextChange = baseChange + Math.sin(Date.now() / 1900 + index * 1.3) * 0.18;

          return {
            ...item,
            value: formatMarketValue(item.symbol, nextValue),
            change: formatMarketChange(nextChange),
            tone: nextChange >= 0 ? "up" : "down",
          };
        }),
      );
    }, 1600);

    return () => window.clearInterval(timer);
  }, [isActive, reducedMotion]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsActive(entry?.isIntersecting ?? true),
      { rootMargin: "120px 0px" },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const loopItems = [...items, ...items];

  return (
    <div
      aria-label="Illustrative market feed"
      className="relative grid h-[58px] w-full max-w-full grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded-xl bg-[#080d12] shadow-panel ring-1 ring-inset ring-white/10"
      ref={rootRef}
      role="region"
    >
      <div className="relative z-10 hidden items-center border-r border-white/10 bg-[#080d12] px-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 sm:flex">
        Demo feed
      </div>
      <div className="relative min-w-0 overflow-hidden">
        <div
          className={`edgelab-marquee absolute inset-y-0 left-0 flex w-max items-center ${
            isActive && !reducedMotion ? "edgelab-marquee-active" : "edgelab-marquee-paused"
          }`}
        >
          {loopItems.map((item, index) => (
            <div
              aria-hidden={index >= items.length ? "true" : undefined}
              className="inline-grid h-full grid-cols-[auto_auto_auto] items-center gap-3 border-r border-white/[0.07] px-5 text-xs"
              key={`${item.symbol}-${index}`}
            >
              <span className="font-semibold text-slate-200">{item.symbol}</span>
              <span className="font-data text-slate-100">{item.value}</span>
              <span className={item.tone === "up" ? "text-emerald-300" : "text-rose-300"}>
                {item.change}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="max-w-4xl">
      <h2
        className="text-balance text-[clamp(2.6rem,6vw,5.6rem)] font-medium leading-[0.92] tracking-[-0.04em] text-white"
        data-marketing-reveal={`${title}-title`}
        data-split-text="lines"
      >
        {title}
      </h2>
      <p
        className="mt-6 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg sm:leading-8"
        data-marketing-reveal={`${title}-body`}
      >
        {description}
      </p>
    </div>
  );
}

export function LandingPage() {
  const location = useLocation();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotionPreference();
  const { loading, program } = useBetaProgramStatus();
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const accessLabel =
    seatsRemaining == null
      ? "Checking seats"
      : seatsRemaining > 0
        ? `${seatsRemaining} seats open`
        : "Waitlist open";
  const primaryCta = buildMarketingCta({ search: location.search, seatsRemaining });

  useEffect(() => {
    const page = pageRef.current;
    if (!page || reducedMotion || prefersReducedMotion()) {
      return;
    }

    let cancelled = false;
    let context: { revert(): void } | null = null;

    void loadGsap({ plugins: ["ScrollTrigger"] })
      .then(({ gsap, plugins }) => {
        if (cancelled || !page || !plugins.ScrollTrigger) {
          return;
        }

        context = gsap.context(() => {
          gsap.to("[data-landing-stage]", {
            ease: "none",
            scrollTrigger: {
              end: "bottom top",
              scrub: 0.65,
              start: "top 78%",
              trigger: "[data-landing-stage]",
            },
            yPercent: -4,
          });

          const rows = Array.from(page.querySelectorAll<HTMLElement>("[data-flow-row]"));
          rows.forEach((row, index) => {
            gsap.fromTo(
              row,
              { x: index % 2 === 0 ? 18 : -18 },
              {
                clearProps: "transform",
                duration: 0.9,
                ease: "power3.out",
                scrollTrigger: {
                  once: true,
                  start: "top 82%",
                  trigger: row,
                },
                x: 0,
              },
            );
          });
        }, page);

        plugins.ScrollTrigger.refresh();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      context?.revert();
    };
  }, [reducedMotion]);

  return (
    <MarketingShell
      navItems={buildMarketingNavItems("home")}
      pageDescription="Replay price action, record the decision, and review the evidence in one focused trading workspace."
      pageTitle="Trading replay and journal"
    >
      <div ref={pageRef}>
        <section
          className="relative px-3 pb-24 pt-12 sm:px-6 sm:pb-28 sm:pt-16 lg:px-8 lg:pb-32 lg:pt-20"
          data-landing-hero
          id="product"
          tabIndex={-1}
        >
          <div className="relative mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)] lg:items-end lg:gap-20">
              <div>
                <h1
                  className="max-w-5xl text-balance text-[clamp(3.25rem,9.2vw,6rem)] font-medium leading-[0.84] tracking-[-0.04em] text-white"
                  data-marketing-reveal="title"
                  data-motion="reveal"
                  data-reveal-delay="0.03"
                  data-split-text="lines"
                >
                  Replay the market. Preserve the decision.
                </h1>
                <p
                  className="mt-8 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl sm:leading-9"
                  data-marketing-reveal="lede"
                  data-motion="reveal"
                  data-reveal-delay="0.08"
                >
                  EdgeLab keeps chart replay, Journal context, and performance review in one
                  focused workspace—so every conclusion can be traced back to the trade.
                </p>
                <div
                  className="mt-8 flex flex-wrap items-center gap-3"
                  data-marketing-reveal="hero-actions"
                  data-motion="reveal"
                  data-reveal-delay="0.12"
                >
                  <Link
                    className="inline-flex h-12 items-center gap-2 rounded-el-md bg-edgelab-accent px-5 text-sm font-semibold text-ink-950 transition-[background-color,transform] duration-200 ease-el-out hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 motion-reduce:transform-none motion-reduce:transition-none"
                    to={primaryCta.href}
                  >
                    {primaryCta.label}
                    <ArrowRight aria-hidden="true" size={16} />
                  </Link>
                  <a
                    className="inline-flex h-12 items-center rounded-el-md border border-edgelab-border bg-edgelab-surface px-5 text-sm font-medium text-edgelab-text-primary transition-colors hover:border-cyan-300/40 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                    href="#how-it-works"
                  >
                    See the workflow
                  </a>
                </div>
              </div>

              <aside
                aria-label="Product workflow and beta status"
                className="border-y border-edgelab-border py-6 lg:border-y-0 lg:border-l lg:py-1 lg:pl-8"
              >
                <ol className="grid gap-5">
                  {["Replay market context", "Record the decision", "Review the evidence"].map(
                    (label) => (
                      <li className="flex items-center gap-3 text-sm text-edgelab-text-secondary" key={label}>
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-300/12 text-cyan-200">
                          <Check aria-hidden="true" size={14} strokeWidth={2.4} />
                        </span>
                        {label}
                      </li>
                    ),
                  )}
                </ol>
                <div className="mt-6 border-t border-edgelab-border pt-5" role="status">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong className="text-lg font-medium text-edgelab-text-primary">
                      {loading ? "Checking beta access…" : accessLabel}
                    </strong>
                    <span className="text-xs text-edgelab-text-secondary">
                      {waitlistCount == null ? "Queue syncing" : `${waitlistCount} in queue`}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-edgelab-text-secondary">
                    Private beta workspaces are temporary test environments.
                  </p>
                </div>
              </aside>
            </div>

            <div className="mt-12" data-marketing-reveal="market-tape" data-motion="reveal" data-reveal-delay="0.16">
              <MarketTape />
            </div>

            <div className="mt-7 origin-top lg:mt-10" data-landing-stage>
              <HeroDemo />
              <p className="mt-3 text-xs leading-5 text-edgelab-text-secondary">
                Interactive product preview using illustrative market data.
              </p>
            </div>
          </div>
        </section>

        <section
          className="border-y border-edgelab-border bg-edgelab-surface px-3 py-24 sm:px-6 sm:py-32 lg:px-8"
          id="how-it-works"
          tabIndex={-1}
        >
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[minmax(220px,0.62fr)_minmax(0,1.38fr)] lg:gap-20">
            <div className="lg:sticky lg:top-32 lg:self-start">
              <SectionHeading
                description="Price action, decisions, and review move as one system instead of three disconnected tools."
                title="One continuous loop."
              />
            </div>

            <div className="border-t border-edgelab-border">
              {WORKFLOW_STEPS.map((step) => (
                <article
                  className="grid gap-5 border-b border-edgelab-border py-10 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-8 sm:py-14"
                  data-flow-row
                  key={step.step}
                >
                  <div className="flex items-center gap-3 self-start font-data text-xs text-edgelab-text-secondary">
                    <span className="text-cyan-200">{step.step}</span>
                    <span>{step.phase}</span>
                  </div>
                  <div>
                    <h3 className="max-w-2xl text-2xl font-medium leading-tight tracking-[-0.025em] text-white sm:text-3xl">
                      {step.title}
                    </h3>
                    <p className="mt-4 max-w-xl text-sm leading-7 text-edgelab-text-secondary sm:text-base sm:leading-8">
                      {step.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <CapabilityStatusRail />

        <TrustEvidence />

        <section
          className="border-y border-edgelab-border bg-edgelab-surface px-3 py-24 sm:px-6 sm:py-32 lg:px-8"
          id="pricing"
          tabIndex={-1}
        >
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
              <SectionHeading
                description={
                  isBetaMode(deploymentMode)
                    ? "Approved users can test the current replay, Journal, analytics, and playbook workflow free during private beta. The queue opens automatically when seats fill."
                    : "Choose a cadence that fits your review cycle, from solo validation to a growing desk."
                }
                title={isBetaMode(deploymentMode) ? "Core workflow. Limited beta." : "Plans that scale with the process."}
              />
              <div className="border-t border-white/10 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Current mode</div>
                <div className="mt-3 text-xl font-medium text-white">
                  {isBetaMode(deploymentMode) ? "Private beta" : "Production pricing"}
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  {isBetaMode(deploymentMode)
                    ? "Billing stays off during the private beta track."
                    : "Annual billing discounts and plan gating are available below."}
                </p>
              </div>
            </div>

            <div className="mt-14" data-marketing-reveal="pricing-cards" data-reveal-delay="0.08">
              <PricingSection
                mode={deploymentMode}
                showComparison
              />
            </div>
          </div>
        </section>

        <section className="px-3 py-24 sm:px-6 sm:py-32 lg:px-8" id="faq" tabIndex={-1}>
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[minmax(0,0.76fr)_minmax(0,1.24fr)] lg:gap-20">
            <SectionHeading
              description="Straight answers on access, imports, billing timing, and the beta data lifecycle."
              title="Before you enter."
            />
            <div data-marketing-reveal="faq-list" data-reveal-delay="0.06">
              <FaqAccordion items={pricingFaqItems} />
            </div>
          </div>
        </section>

        <section className="px-3 pb-28 pt-8 sm:px-6 sm:pb-32 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 border-y border-edgelab-border py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <h2 className="max-w-4xl text-balance text-[clamp(2.5rem,6vw,5rem)] font-medium leading-[0.94] tracking-[-0.04em] text-edgelab-text-primary">
                Make every replay leave evidence.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg">
                Enter the current beta when a seat is open, or reserve a place in the queue when it is full.
              </p>
            </div>
            <Link
              className="inline-flex h-12 w-fit items-center gap-2 rounded-el-md bg-edgelab-accent px-5 text-sm font-semibold text-ink-950 transition-[background-color,transform] duration-200 ease-el-out hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 motion-reduce:transform-none motion-reduce:transition-none"
              to={primaryCta.href}
            >
              {primaryCta.label}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
