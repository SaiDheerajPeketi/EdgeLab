import { useEffect, useRef, useState } from "react";
import { HeroDemo } from "../components/marketing/HeroDemo";
import {
  FaqAccordion,
  PricingSection,
  pricingFaqItems,
  type PricingFrequency,
} from "../components/marketing/PricingSection";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "../components/marketing/MarketingShell";
import { deploymentMode, isBetaMode } from "../lib/deploymentMode";
import { prefersReducedMotion } from "../lib/gsap";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

type WorkflowStep = {
  body: string;
  step: string;
  title: string;
};

type MarketPulse = {
  change: string;
  symbol: string;
  tone: "down" | "up";
  value: string;
};

const HERO_TYPEWORD = "Engineered.";
const SECTION_EYEBROW_CLASS = "text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/60";
const SECTION_TITLE_CLASS =
  "mt-4 text-[clamp(2.5rem,5.2vw,4.4rem)] font-semibold leading-[0.92] tracking-[-0.065em] text-white";
const SECTION_COPY_CLASS = "mt-4 text-base leading-8 text-slate-400";
const FEATURE_CARD_TITLE_CLASS = "text-[1.5rem] font-semibold tracking-[-0.04em] text-white";
const FEATURE_CARD_COPY_CLASS = "mt-3 text-sm leading-7 text-slate-400";

const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    step: "01",
    title: "Replay with context",
    body: "Walk price action first. Entries, exits, and tempo stay visible while the session unfolds.",
  },
  {
    step: "02",
    title: "Review in place",
    body: "Journal notes, mistake tags, and session outcomes stay attached to exact market behavior.",
  },
  {
    step: "03",
    title: "Refine from proof",
    body: "Metrics and playbooks pressure-test process only after replay and review already agree.",
  },
];

const PROOF_STEPS: WorkflowStep[] = [
  {
    step: "01",
    title: "Replay stack",
    body: "Candle replay, order flow, and chart context stay in the same surface.",
  },
  {
    step: "02",
    title: "Journal memory",
    body: "Notes, mistake tags, and playbooks stay attached to session truth.",
  },
  {
    step: "03",
    title: "Private beta",
    body: "Approved users get full product access while feedback shapes replay, journaling, analytics, and review flow.",
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

function SectionIntro({
  className = "",
  description,
  eyebrow,
  revealKey,
  title,
}: {
  className?: string;
  description: string;
  eyebrow: string;
  revealKey?: string;
  title: string;
}) {
  const keyBase = revealKey ?? title;

  return (
    <div className={className || "max-w-3xl"}>
      <div className={SECTION_EYEBROW_CLASS}>
        {eyebrow}
      </div>
      <h2
        className={SECTION_TITLE_CLASS}
        data-marketing-reveal={`${keyBase}-title`}
        data-split-text="lines"
      >
        {title}
      </h2>
      <p className={SECTION_COPY_CLASS} data-marketing-reveal={`${keyBase}-body`}>
        {description}
      </p>
    </div>
  );
}

function StatusCard({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-[#071018] px-5 py-5 shadow-panel">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-3 text-[1.65rem] font-semibold tracking-[-0.04em] text-white">
        {value}
      </div>
      <div className="mt-2 text-sm leading-7 text-slate-400">{hint}</div>
    </div>
  );
}

function MarketTape() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [items, setItems] = useState(MARKET_PULSE);
  const [isActive, setIsActive] = useState(true);
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const timer = window.setInterval(() => {
      setItems((current) =>
        current.map((item, index) => {
          const baseValue = parseMarketValue(MARKET_PULSE[index]?.value ?? item.value);
          const nextValue = baseValue * (1 + (Math.sin(Date.now() / 1400 + index * 1.7) * 0.0009));
          const baseChange = Number((MARKET_PULSE[index]?.change ?? item.change).replace("%", ""));
          const drift = Math.sin(Date.now() / 1900 + index * 1.3) * 0.18;
          const nextChange = baseChange + drift;

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
  }, [isActive]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      setIsActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsActive(entry?.isIntersecting ?? true),
      { rootMargin: "120px 0px" },
    );
    observer.observe(root);

    return () => {
      observer.disconnect();
    };
  }, []);

  const loopItems = [...items, ...items];

  return (
    <div
      className="relative h-[64px] w-full max-w-full overflow-hidden rounded-full border border-white/10 bg-[#071018] shadow-panel"
      ref={rootRef}
    >
      <div
        className={`edgelab-marquee absolute inset-y-0 left-0 flex w-max items-center gap-3 px-4 ${
          isActive ? "edgelab-marquee-active" : "edgelab-marquee-paused"
        }`}
        ref={trackRef}
      >
        {loopItems.map((item, index) => (
          <div
            key={`${item.symbol}-${index}`}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 text-sm sm:gap-3 sm:px-4"
          >
            <span className="font-data text-slate-100">{item.symbol}</span>
            <span className="font-data text-white">{item.value}</span>
            <span className={item.tone === "up" ? "text-emerald-300" : "text-rose-300"}>
              {item.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnimatedTypeWord() {
  const [visibleLength, setVisibleLength] = useState(0);
  const [isWordComplete, setIsWordComplete] = useState(false);

  useEffect(() => {
    let phase: "typing" | "hold" | "deleting" = "typing";
    let holdTicks = 0;
    let nextLength = 0;

    const timer = window.setInterval(() => {
      if (phase === "typing") {
        nextLength += 1;
        setVisibleLength(nextLength);
        setIsWordComplete(nextLength >= HERO_TYPEWORD.length);
        if (nextLength >= HERO_TYPEWORD.length) {
          phase = "hold";
        }
        return;
      }

      if (phase === "hold") {
        holdTicks += 1;
        if (holdTicks >= 9) {
          holdTicks = 0;
          phase = "deleting";
        }
        return;
      }

      nextLength -= 1;
      setVisibleLength(Math.max(0, nextLength));
      setIsWordComplete(false);
      if (nextLength <= 0) {
        phase = "typing";
      }
    }, 115);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span
      aria-label={HERO_TYPEWORD}
      className={`edgelab-typeword mt-1 block min-w-0 sm:mt-0 sm:inline-flex sm:min-w-[11.2ch] ${
        isWordComplete ? "text-cyan-300" : "text-cyan-300/55"
      }`}
    >
      <span aria-hidden="true" className="edgelab-typeword-inner">
        {HERO_TYPEWORD.slice(0, visibleLength) || "\u00a0"}
      </span>
      <span aria-hidden="true" className="edgelab-typeword-caret" />
    </span>
  );
}

export function LandingPage() {
  const [frequency, setFrequency] = useState<PricingFrequency>("monthly");
  const { loading, program } = useBetaProgramStatus();
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const accessLabel =
    seatsRemaining == null
      ? "Checking seats"
      : seatsRemaining > 0
        ? `${seatsRemaining} seats open`
        : "Waitlist open";

  return (
    <MarketingShell navItems={buildMarketingNavItems("home")} pageTitle="landing">
      <section className="px-3 pb-18 pt-6 sm:px-6 sm:pb-20 sm:pt-7 lg:px-8 lg:pb-24 lg:pt-9">
        <div className="mx-auto max-w-7xl min-w-0">
          <div className="grid min-w-0 gap-7 lg:gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-10">
            <div className="max-w-4xl">
              <h1
                className="max-w-4xl text-[clamp(2.15rem,12.2vw,4.4rem)] font-semibold leading-[0.94] tracking-[-0.08em] text-white sm:text-[clamp(2.75rem,8vw,6.3rem)] sm:leading-[0.88]"
                data-marketing-reveal="title"
                data-reveal-delay="0.04"
              >
                Your Edge <AnimatedTypeWord />
              </h1>

              <p
                className="mt-5 max-w-2xl text-[1.05rem] leading-8 text-slate-300"
                data-marketing-reveal="lede"
                data-reveal-delay="0.08"
              >
                Replay price action, capture decisions, and review outcomes from one trading
                surface built to tighten process instead of adding more tabs.
              </p>

              <div
                className="mt-6 text-sm leading-7 text-slate-400"
                data-marketing-reveal="meta"
                data-reveal-delay="0.12"
              >
                Seat count updates live. Beta workspaces stay temporary during the test track.
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div data-marketing-reveal="card-access" data-reveal-delay="0.1">
                <StatusCard
                  hint="Current private beta access"
                  label="Access"
                  value={loading ? "..." : accessLabel}
                />
              </div>
              <div data-marketing-reveal="card-waitlist" data-reveal-delay="0.14">
                <StatusCard
                  hint="Queue opens automatically once seats fill"
                  label="Waitlist"
                  value={waitlistCount == null ? "..." : String(waitlistCount)}
                />
              </div>
              <div data-marketing-reveal="card-entry" data-reveal-delay="0.18">
                <StatusCard
                  hint="Approved users enter workspace. Full seats roll into queue."
                  label="Entry"
                  value="Google"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 sm:mt-7" data-marketing-reveal="tape" data-reveal-delay="0.16">
            <MarketTape />
          </div>

          <div
            className="mt-8 lg:mt-10"
            data-marketing-reveal="demo"
            data-reveal-delay="0.2"
            id="product"
          >
            <HeroDemo />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-3 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionIntro
            description="EdgeLab is meant to shorten distance between what price did, what you did, and what that means for next session."
            eyebrow="Workflow"
            title="One loop. No drift."
          />

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {WORKFLOW_STEPS.map((step, index) => (
              <div
                key={step.step}
                data-marketing-reveal={`workflow-${step.step}`}
                data-reveal-delay={String(index * 0.06)}
                className={`rounded-[28px] border px-6 py-6 shadow-panel transition duration-200 ease-out hover:-translate-y-1 motion-reduce:transition-none ${
                  index === 1
                    ? "border-cyan-300/20 bg-[linear-gradient(160deg,rgba(50,211,238,0.12),rgba(255,255,255,0.03))]"
                    : "border-white/10 bg-[#071018]"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/20 font-mono text-sm text-cyan-100">
                    {step.step}
                  </div>
                  <div>
                    <div className={FEATURE_CARD_TITLE_CLASS}>
                      {step.title}
                    </div>
                    <p className={FEATURE_CARD_COPY_CLASS}>{step.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section id="pricing" className="px-4 pb-14 pt-14 sm:px-6 lg:px-8 lg:pb-20 lg:pt-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
            <SectionIntro
              className="max-w-4xl"
              description={
                isBetaMode(deploymentMode)
                  ? "Current phase stays simple: free access for approved beta users, waitlist once seats fill."
                  : "Choose cadence, compare plans, and see what scales from solo validation to desk-grade review."
              }
              eyebrow="Pricing"
              revealKey="pricing"
              title={
                isBetaMode(deploymentMode)
                  ? "Private beta access, limited seats."
                  : "Clear plans for replay, review, and growth."
              }
            />

            <div
              className="rounded-[28px] border border-white/10 bg-[#061018] p-5 shadow-panel"
              data-marketing-reveal="pricing-mode"
              data-reveal-delay="0.06"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Current mode
              </div>
              <div className="mt-3 text-[1.6rem] font-semibold tracking-[-0.04em] text-white">
                {isBetaMode(deploymentMode) ? "Private beta" : "Production pricing"}
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                {isBetaMode(deploymentMode)
                  ? "Billing stays off during the private beta track."
                  : "Annual billing discounts and full plan gating are ready here."}
              </p>
            </div>
          </div>

          <div className="mt-10" data-marketing-reveal="pricing-cards" data-reveal-delay="0.1">
            <PricingSection
              frequency={frequency}
              mode={deploymentMode}
              onFrequencyChange={setFrequency}
              showComparison
            />
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionIntro
            className="max-w-5xl"
            description="EdgeLab already ships replay, journal review, analytics, and strategy memory inside the same workspace."
            eyebrow="Included now"
            revealKey="proof"
            title="Product first. Pricing second."
          />

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {PROOF_STEPS.map((item, index) => (
              <div
                key={item.title}
                data-marketing-reveal={`proof-${item.title}`}
                data-reveal-delay={String(index * 0.06)}
                className={`rounded-[28px] border px-6 py-6 shadow-panel transition duration-200 ease-out hover:-translate-y-1 motion-reduce:transition-none ${
                  index === 1
                    ? "border-cyan-300/20 bg-[linear-gradient(160deg,rgba(50,211,238,0.12),rgba(255,255,255,0.03))]"
                    : "border-white/10 bg-[#071018]"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/20 font-mono text-sm text-cyan-100">
                    {item.step}
                  </div>
                  <div>
                    <div className={FEATURE_CARD_TITLE_CLASS}>
                      {item.title}
                    </div>
                    <p className={FEATURE_CARD_COPY_CLASS}>{item.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
          <SectionIntro
            description="Short answers on beta access, imports, billing timing, and data lifecycle."
            eyebrow="FAQ"
            revealKey="faq"
            title="What beta users should expect."
          />
          <div data-marketing-reveal="faq-list" data-reveal-delay="0.08">
            <FaqAccordion items={pricingFaqItems} />
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
