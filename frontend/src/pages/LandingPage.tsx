import { ArrowDown, ArrowRight } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CapabilityStatusRail } from "../components/marketing/CapabilityStatusRail";
import { TrustEvidence } from "../components/marketing/TrustEvidence";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "../components/marketing/MarketingShell";
import { deploymentMode, isBetaMode } from "../lib/deploymentMode";
import { loadGsap, prefersReducedMotion } from "../lib/gsap";
import { buildMarketingCta } from "../lib/marketingCta";
import { useReducedMotionPreference } from "../lib/motionPreferences";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

const HeroDemo = lazy(() => import("../components/marketing/HeroDemo").then((module) => ({ default: module.HeroDemo })));
const MarketSculpture = lazy(() => import("../components/marketing/MarketSculpture").then((module) => ({ default: module.MarketSculpture })));
const PricingSection = lazy(() => import("../components/marketing/PricingSection").then((module) => ({ default: module.PricingSection })));
const PricingFaq = lazy(() => import("../components/marketing/PricingSection").then((module) => ({
  default: () => <module.FaqAccordion items={module.pricingFaqItems} />,
})));

function DeferredMount({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || !hostRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setReady(true);
      observer.disconnect();
    }, { rootMargin: "400px 0px" });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [ready]);

  return <div ref={hostRef}>{ready ? children : fallback}</div>;
}

type WorkflowStep = {
  body: string;
  phase: string;
  step: string;
  title: string;
  scenario?: "replay" | "review" | "results";
  action?: string;
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
    scenario: "replay",
    action: "Try it: step through the candles and inspect where the entry meets the price path.",
  },
  {
    step: "02",
    phase: "Journal",
    title: "Capture what you saw while it is still useful.",
    body: "Journal notes, mistake tags, and playbooks stay attached to the exact session behavior that produced them.",
    scenario: "review",
    action: "Try it: select a trade to read its decision notes and execution details together.",
  },
  {
    step: "03",
    phase: "Review",
    title: "Read the outcome beside the original context.",
    body: "Trades, notes, mistake tags, and session metrics keep the review grounded in what actually happened.",
    scenario: "results",
    action: "Explore the example breakdown, then return to the trade that produced it.",
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
  const betaMode = isBetaMode(deploymentMode);
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
    let resizeObserver: ResizeObserver | null = null;
    let refreshFrame = 0;

    void loadGsap({ plugins: ["ScrollTrigger"] })
      .then(({ gsap, plugins }) => {
        if (cancelled || !page || !plugins.ScrollTrigger) {
          return;
        }

        context = gsap.context(() => {
          page.querySelectorAll<HTMLElement>("[data-scroll-scene]").forEach((scene) => {
            const content = scene.querySelector<HTMLElement>("[data-scene-content]");
            if (!content) return;
            gsap.timeline({
              scrollTrigger: {
                trigger: scene,
                start: "top bottom",
                end: "bottom top",
                scrub: 0.45,
                invalidateOnRefresh: true,
              },
            })
              .fromTo(content,
                { y: 40, opacity: 0.55, scale: 0.985 },
                { y: 0, opacity: 1, scale: 1, duration: 0.14, ease: "power3.out" })
              .to(content, { y: 0, opacity: 1, scale: 1, duration: 0.72, ease: "none" })
              .to(content, { y: -32, opacity: 0.45, scale: 0.985, duration: 0.14, ease: "power2.in" });
          });

          page.querySelectorAll<HTMLElement>("[data-flow-row]").forEach((row, index) => {
            const content = row.querySelector<HTMLElement>("[data-flow-content]");
            if (!content) return;
            gsap.fromTo(content, { x: 32 + index * 8 }, {
              x: -12,
              ease: "none",
              scrollTrigger: { trigger: row, start: "top bottom", end: "bottom top", scrub: 0.6 },
            });
          });
        }, page);

        const refresh = () => {
          window.cancelAnimationFrame(refreshFrame);
          refreshFrame = window.requestAnimationFrame(() => {
            if (!cancelled) plugins.ScrollTrigger?.refresh();
          });
        };
        resizeObserver = new ResizeObserver(refresh);
        resizeObserver.observe(page);
        void document.fonts.ready.then(refresh);
        plugins.ScrollTrigger.refresh();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(refreshFrame);
      resizeObserver?.disconnect();
      context?.revert();
    };
  }, [reducedMotion]);

  return (
    <MarketingShell
      navItems={buildMarketingNavItems("home")}
      pageDescription="Replay price action, record the decision, and review the evidence in one focused trading workspace."
      pageTitle="Trading replay and journal"
    >
      <div className="landing-story" ref={pageRef}>
        <section
          className="relative px-3 pb-20 pt-6 sm:px-6 sm:pb-28 sm:pt-12 lg:px-8 lg:pt-14"
          data-landing-hero
          id="product"
          tabIndex={-1}
        >
          <div className="relative mx-auto max-w-7xl">
            <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-center lg:gap-x-12 lg:gap-y-8">
              <div className="order-1 min-w-0">
                <h1
                  className="max-w-4xl text-balance text-[clamp(2.65rem,5.5vw,4.7rem)] font-medium leading-[0.96] tracking-[-0.04em] text-white"
                  data-marketing-reveal="title"
                  data-motion="reveal"
                  data-reveal-delay="0.03"
                  data-split-text="lines"
                >
                  Replay the market. Preserve the decision.
                </h1>
                <p
                  className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8"
                  data-marketing-reveal="lede"
                  data-motion="reveal"
                  data-reveal-delay="0.08"
                >
                  Replay the market, capture your decisions, and review every trade in one
                  connected workspace.
                </p>
                <div
                  className="mt-5 flex flex-wrap items-center gap-3 lg:justify-start"
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
                    className="inline-flex h-12 items-center gap-2 px-3 text-sm font-medium text-edgelab-text-primary underline-offset-4 transition-colors hover:text-cyan-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                    href="#live-preview"
                  >
                    Explore the product
                    <ArrowDown aria-hidden="true" size={16} />
                  </a>
                </div>
                {betaMode ? <div className="mt-4 hidden flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-5 sm:flex" role="status">
                    <strong className="font-medium text-cyan-100">
                      {loading ? "Checking beta access…" : accessLabel}
                    </strong>
                    <span className="text-edgelab-text-secondary">
                      {waitlistCount == null ? "Queue syncing" : `${waitlistCount} in queue`}
                    </span>
                </div> : <p className="mt-4 text-sm leading-6 text-edgelab-text-secondary">Monthly or yearly Pro subscriptions. Your chart, replay, and journal stay connected.</p>}
                {betaMode ? <p className="mt-2 hidden text-xs leading-5 text-edgelab-text-secondary sm:block">
                  Private beta · temporary test workspaces
                </p> : null}
              </div>

              <div className="order-2 min-w-0 origin-top scroll-mt-28 lg:order-3 lg:col-span-2" data-landing-stage data-scroll-scene id="live-preview" tabIndex={-1}>
                <div className="landing-motion-content" data-scene-content>
                  <Suspense fallback={<div aria-hidden="true" className="min-h-[32rem] rounded-el-lg bg-edgelab-surface" />}><HeroDemo /></Suspense>
                  <p className="mt-3 text-xs leading-5 text-edgelab-text-secondary">
                    Interactive product preview using illustrative market data.
                    {betaMode ? <span className="sm:hidden"> Private beta workspaces contain temporary test data.</span> : null}
                  </p>
                </div>
              </div>
              <div className="order-3 min-w-0 lg:order-2">
                <Suspense fallback={<div className="flex min-h-80 items-center border-y border-cyan-300/15 px-6 text-sm text-slate-300">A market. A decision. A trace. Preparing the 3D example…</div>}><MarketSculpture /></Suspense>
              </div>
            </div>

            <div className="mt-7">
              <MarketTape />
            </div>
          </div>
        </section>

        <section
          className="border-y border-edgelab-border bg-edgelab-surface px-3 py-24 sm:px-6 sm:py-32 lg:px-8"
          id="how-it-works"
          data-scroll-scene
          tabIndex={-1}
        >
          <div className="mx-auto max-w-7xl">
            <div className="landing-motion-content max-w-4xl" data-scene-content>
              <SectionHeading
                description="Price action, decisions, and review move as one system instead of three disconnected tools."
                title="One continuous loop."
              />
            </div>

            <div className="mt-14 border-t border-edgelab-border">
              {WORKFLOW_STEPS.map((step) => (
                <article
                  className="border-b border-edgelab-border py-10 sm:py-16"
                  data-flow-row
                  key={step.step}
                >
                  <div className="landing-motion-content grid gap-6 md:pr-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16" data-flow-content>
                    <h3 className="max-w-2xl text-3xl font-medium leading-tight tracking-[-0.025em] text-white sm:text-4xl">
                      {step.title}
                    </h3>
                    <p className="max-w-xl self-end text-sm leading-7 text-edgelab-text-secondary sm:text-base sm:leading-8">
                      {step.body}
                    </p>
                  </div>
                  {step.scenario ? <div className="mt-8 min-w-0" data-workflow-demo={step.scenario}>
                    <DeferredMount fallback={<div className="min-h-96 border-y border-white/10 bg-[#050a10]" role="status" aria-label={`${step.phase} interactive example loading`} />}>
                      <Suspense fallback={<div className="min-h-96 bg-[#050a10]" role="status" aria-label={`${step.phase} interactive example loading`} />}>
                        <HeroDemo initialScenarioId={step.scenario} initialAutoplayActive={false} />
                      </Suspense>
                    </DeferredMount>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-cyan-100">{step.action}</p>
                  </div> : <a className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm text-cyan-100 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" href="#live-preview">Return to the working example <ArrowRight size={15} aria-hidden="true" /></a>}
                </article>
              ))}
            </div>
          </div>
        </section>

        <div data-scroll-scene>
          <div className="landing-motion-content" data-scene-content><CapabilityStatusRail /></div>
        </div>

        <div data-scroll-scene>
          <div className="landing-motion-content" data-scene-content><TrustEvidence /></div>
        </div>

        <section
          className="border-y border-edgelab-border bg-edgelab-surface px-3 py-24 sm:px-6 sm:py-32 lg:px-8"
          id="pricing"
          data-scroll-scene
          tabIndex={-1}
        >
          <div className="landing-motion-content mx-auto max-w-7xl" data-scene-content>
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
              <SectionHeading
                description={
                  isBetaMode(deploymentMode)
                    ? "Approved users can test the current replay, Journal, analytics, and playbook workflow free during private beta. The queue opens automatically when seats fill."
                    : "The chart, replay, and journal you need to build a repeatable review process. Choose monthly or yearly billing."
                }
                title={betaMode ? "Core workflow. Limited beta." : "Your process, connected."}
              />
              <div className="border-t border-white/10 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <div className="text-xl font-medium text-white">
                  {isBetaMode(deploymentMode) ? "Private beta" : "Production pricing"}
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  {isBetaMode(deploymentMode)
                    ? "The approved beta workspace is free. Pro subscriptions enable paid data exports."
                    : "One Pro plan. Two billing choices. Provider data and model access remain separate."}
                </p>
              </div>
            </div>

            <div className="mt-14" data-marketing-reveal="pricing-cards" data-reveal-delay="0.08">
              <DeferredMount fallback={<div aria-hidden="true" className="min-h-96 border-y border-edgelab-border" />}>
                <Suspense fallback={<div aria-hidden="true" className="min-h-96 border-y border-edgelab-border" />}><PricingSection mode={deploymentMode} showComparison /></Suspense>
              </DeferredMount>
            </div>
          </div>
        </section>

        <section className="px-3 py-24 sm:px-6 sm:py-32 lg:px-8" id="faq" tabIndex={-1} data-scroll-scene>
          <div className="landing-motion-content mx-auto grid max-w-7xl gap-14 lg:grid-cols-[minmax(0,0.76fr)_minmax(0,1.24fr)] lg:gap-20" data-scene-content>
            <SectionHeading
              description={betaMode ? "Straight answers on beta access, imports, subscriptions, and data handling." : "Straight answers on subscriptions, imports, exports, and provider access."}
              title="Before you enter."
            />
            <div data-marketing-reveal="faq-list" data-reveal-delay="0.06">
              <DeferredMount fallback={<div aria-hidden="true" className="min-h-80 border-y border-edgelab-border" />}>
                <Suspense fallback={<div aria-hidden="true" className="min-h-80 border-y border-edgelab-border" />}><PricingFaq /></Suspense>
              </DeferredMount>
            </div>
          </div>
        </section>

        <section className="px-3 pb-28 pt-8 sm:px-6 sm:pb-32 lg:px-8" data-scroll-scene>
          <div className="landing-motion-content mx-auto grid max-w-7xl gap-8 border-y border-edgelab-border py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" data-scene-content>
            <div>
              <h2 className="max-w-4xl text-balance text-[clamp(2.5rem,6vw,5rem)] font-medium leading-[0.94] tracking-[-0.04em] text-edgelab-text-primary">
                Make every replay leave evidence.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg">
                {betaMode ? "Enter the beta when a seat is open, or reserve a place in the queue when it is full." : "Build a review process that keeps your decisions beside the market context. Explore Pro and choose your billing cadence."}
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
