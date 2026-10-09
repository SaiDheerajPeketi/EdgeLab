import { ArrowDown, ArrowRight } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { CapabilityStatusRail } from "../components/marketing/CapabilityStatusRail";
import { TrustEvidence } from "../components/marketing/TrustEvidence";
import { MarketSculpture } from "../components/marketing/MarketSculpture";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "../components/marketing/MarketingShell";
import { isBetaMode } from "../lib/deploymentMode";
import { buildMarketingCta, marketingPresentationFromSearch } from "../lib/marketingCta";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

const HeroDemo = lazy(() => import("../components/marketing/HeroDemo").then((module) => ({ default: module.HeroDemo })));
const PricingSection = lazy(() => import("../components/marketing/PricingSection").then((module) => ({ default: module.PricingSection })));
const PricingFaq = lazy(() => import("../components/marketing/PricingSection").then((module) => ({
  default: ({ mode }: { mode: "beta" | "production" }) => <module.FaqAccordion items={module.getPricingFaqItems(mode)} />,
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
  title: string;
};

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    title: "Replay with perspective.",
    body: "Walk price forward with your entries, exits, and position sizes in view.",
  },
  {
    title: "Keep the reason.",
    body: "Attach notes, mistake tags, and playbooks to the trades that matter.",
  },
  {
    title: "See the whole trade.",
    body: "Review the result beside the chart and the decisions that shaped it.",
  },
  {
    title: "Refine your next move.",
    body: "Find patterns in your strategy results and carry them into your playbook.",
  },
];

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
        className="landing-section-title text-white"
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
  const presentationMode = marketingPresentationFromSearch(location.search);
  const betaMode = isBetaMode(presentationMode);
  const { error, loading, program } = useBetaProgramStatus();
  const betaAvailable = !loading && !error && program.mode === "beta";
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const accessLabel =
    error
      ? "Beta access unavailable"
      : !loading && program.mode !== "beta"
        ? "Beta access closed"
        : seatsRemaining == null
          ? "Checking seats"
          : seatsRemaining > 0
            ? `${seatsRemaining} seats open`
            : "Waitlist open";
  const primaryCta = buildMarketingCta({ mode: betaMode && betaAvailable ? "beta" : "production", search: location.search, seatsRemaining });

  return (
    <MarketingShell
      navItems={buildMarketingNavItems("home")}
      pageDescription="Replay price action, record the decision, and review the evidence in one focused trading workspace."
      pageTitle="Trading replay and journal"
      presentationMode={presentationMode}
    >
      <div className="landing-story" data-marketing-variant={presentationMode}>
        <section
          className="relative px-3 pb-20 pt-6 sm:px-6 sm:pb-28 sm:pt-12 lg:px-8 lg:pt-14"
          data-landing-hero
          id="product"
          tabIndex={-1}
        >
          <div className="relative mx-auto max-w-7xl">
            <div className="grid gap-8 sm:gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-x-8 lg:gap-y-10">
              <div className="order-1 min-w-0">
                <h1
                  className="max-w-4xl text-balance text-[clamp(3rem,6.4vw,6rem)] font-medium leading-[1.02] tracking-[-0.03em] text-white"
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
                  Keep price action, notes, and outcomes in one workspace.
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
                    {betaAvailable ? <span className="text-edgelab-text-secondary">
                      {waitlistCount == null ? "Queue syncing" : `${waitlistCount} in queue`}
                    </span> : null}
                </div> : null}
                {betaMode ? <p className="mt-2 hidden text-xs leading-5 text-edgelab-text-secondary sm:block">
                  Private beta · temporary test workspaces
                </p> : null}
              </div>

              <div className="order-2 min-w-0 origin-top scroll-mt-28 lg:order-3 lg:col-span-2" data-landing-stage data-scroll-scene data-marketing-flow id="live-preview" tabIndex={-1}>
                <div className="landing-motion-content" data-scene-content>
                  <Suspense fallback={<div aria-hidden="true" className="min-h-[32rem] rounded-el-lg bg-edgelab-surface" />}><HeroDemo /></Suspense>
                </div>
              </div>
              <div className="order-3 min-w-0 lg:order-2" data-marketing-flow>
                <MarketSculpture />
              </div>
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
                description="From the first setup to the next session, keep your process connected."
                title="Trade. Understand. Refine."
              />
            </div>

            <div className="mt-14 border-t border-edgelab-border">
              {WORKFLOW_STEPS.map((step) => (
                <article
                  className="border-b border-edgelab-border py-10 sm:py-16"
                  data-flow-row
                  key={step.title}
                >
                  <div className="landing-motion-content grid gap-6 md:pr-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16" data-flow-content>
                    <h3 className="max-w-2xl text-3xl font-medium leading-tight tracking-[-0.025em] text-white sm:text-4xl">
                      {step.title}
                    </h3>
                    <p className="max-w-xl self-end text-sm leading-7 text-edgelab-text-secondary sm:text-base sm:leading-8">
                      {step.body}
                    </p>
                  </div>
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
                  betaMode
                    ? "Check beta availability below. Approved beta users can test replay, Journal, analytics, and playbooks."
                    : "The chart, replay, and journal you need to build a repeatable review process. Choose monthly or yearly billing."
                }
                title={betaMode ? "Core workflow. Limited beta." : "Your process, connected."}
              />
              <div className="border-t border-white/10 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" data-marketing-flow>
                <div className="text-xl font-medium text-white">
                  {betaMode ? "Private beta" : "EdgeLab Pro"}
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  {betaMode
                  ? "Beta access requires approval. Pro subscriptions enable data exports."
                    : "One Pro plan. Two billing choices. Provider data and model access remain separate."}
                </p>
              </div>
            </div>

            <div className="mt-14" data-marketing-reveal="pricing-cards" data-reveal-delay="0.08">
              <DeferredMount fallback={<div aria-hidden="true" className="min-h-96 border-y border-edgelab-border" />}>
                <Suspense fallback={<div aria-hidden="true" className="min-h-96 border-y border-edgelab-border" />}><PricingSection mode={presentationMode} showComparison={false} /></Suspense>
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
                <Suspense fallback={<div aria-hidden="true" className="min-h-80 border-y border-edgelab-border" />}><PricingFaq mode={presentationMode} /></Suspense>
              </DeferredMount>
            </div>
          </div>
        </section>

        <section className="px-3 pb-28 pt-8 sm:px-6 sm:pb-32 lg:px-8" data-scroll-scene>
          <div className="landing-motion-content mx-auto grid max-w-7xl gap-8 border-y border-edgelab-border py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end" data-scene-content>
            <div>
              <h2 className="landing-section-title max-w-4xl text-edgelab-text-primary">
                Make every replay leave evidence.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg">
                {betaMode ? "Check current beta availability or explore Pro plans." : "Build a review process that keeps your decisions beside the market context. Explore Pro and choose your billing cadence."}
              </p>
            </div>
            <Link
              className="inline-flex h-12 w-fit items-center gap-2 rounded-el-md bg-edgelab-accent px-5 text-sm font-semibold text-ink-950 transition-[background-color,transform] duration-200 ease-el-out hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 motion-reduce:transform-none motion-reduce:transition-none"
              data-marketing-flow
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
