import { ShieldCheck } from "lucide-react";
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
import { loadGsap, prefersReducedMotion, type GsapInstance } from "../lib/gsap";
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
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="max-w-3xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
        {eyebrow}
      </div>
      <h2
        className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-[3.6rem]"
        data-marketing-reveal={`${title}-title`}
        data-split-text="lines"
      >
        {title}
      </h2>
      <p className="mt-4 text-base leading-8 text-slate-400" data-marketing-reveal={`${title}-body`}>
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
  const [isActive, setIsActive] = useState(() => !prefersReducedMotion());
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
    if (!root || prefersReducedMotion()) {
      return;
    }

    let cancelled = false;
    let trigger: { kill(): void } | null = null;

    void loadGsap({ plugins: ["ScrollTrigger"] })
      .then(({ plugins }) => {
        if (cancelled) {
          return;
        }
        trigger = plugins.ScrollTrigger?.create({
          end: "bottom top",
          onEnter: () => setIsActive(true),
          onEnterBack: () => setIsActive(true),
          onLeave: () => setIsActive(false),
          onLeaveBack: () => setIsActive(false),
          start: "top bottom",
          trigger: root,
        }) ?? null;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      trigger?.kill();
    };
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || prefersReducedMotion() || !isActive) {
      return;
    }

    let cancelled = false;
    let animation: { kill(): void } | null = null;

    void loadGsap()
      .then(({ gsap }) => {
        if (cancelled || !track) {
          return;
        }
        animation = gsap.to(track, {
          duration: 26,
          ease: "none",
          repeat: -1,
          xPercent: -50,
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      animation?.kill();
    };
  }, [isActive]);

  const loopItems = [...items, ...items];

  return (
    <div
      className="relative h-[64px] w-full max-w-full overflow-hidden rounded-full border border-white/10 bg-[#071018] shadow-panel"
      ref={rootRef}
    >
      <div
        className="edgelab-marquee absolute inset-y-0 left-0 flex w-max items-center gap-3 px-4"
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
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [isWordComplete, setIsWordComplete] = useState(false);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) {
      return;
    }

    inner.textContent = HERO_TYPEWORD;
    if (prefersReducedMotion()) {
      setIsWordComplete(true);
      return;
    }

    let cancelled = false;
    let timeline: ReturnType<GsapInstance["timeline"]> | null = null;

    void loadGsap()
      .then(({ gsap }) => {
        if (cancelled || !inner) {
          return;
        }

        const state = { visibleLength: 0 };
        const renderWord = () => {
          inner.textContent = HERO_TYPEWORD.slice(0, Math.round(state.visibleLength)) || "\u00a0";
        };

        renderWord();
        timeline = gsap.timeline({
          repeat: -1,
          repeatDelay: 0.42,
        });
        timeline
          .to(state, {
            duration: 1.05,
            ease: `steps(${HERO_TYPEWORD.length})`,
            onComplete: () => setIsWordComplete(true),
            onStart: () => setIsWordComplete(false),
            onUpdate: renderWord,
            visibleLength: HERO_TYPEWORD.length,
          })
          .to({}, { duration: 1.15 })
          .to(state, {
            duration: 0.52,
            ease: `steps(${HERO_TYPEWORD.length})`,
            onStart: () => setIsWordComplete(false),
            onUpdate: renderWord,
            visibleLength: 0,
          });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      timeline?.kill();
    };
  }, []);

  return (
    <span
      aria-label={HERO_TYPEWORD}
      className={`edgelab-typeword mt-1 block min-w-0 sm:mt-0 sm:inline-flex sm:min-w-[11.2ch] ${
        isWordComplete ? "text-cyan-300" : "text-cyan-300/55"
      }`}
    >
      <span aria-hidden="true" className="edgelab-typeword-inner" ref={innerRef} />
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
              <div
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-50"
                data-marketing-reveal="badge"
              >
                <ShieldCheck size={14} />
                EdgeLab beta
              </div>

              <h1
                className="mt-4 max-w-4xl text-[clamp(2.15rem,12.2vw,4.4rem)] font-semibold leading-[0.94] tracking-[-0.08em] text-white sm:mt-5 sm:text-[clamp(2.75rem,8vw,6.3rem)] sm:leading-[0.88]"
                data-marketing-reveal="title"
                data-reveal-delay="0.04"
              >
                Your Edge <AnimatedTypeWord />
              </h1>

              <p
                className="mt-5 max-w-2xl text-lg leading-8 text-slate-300"
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
                    <div className="text-[1.45rem] font-semibold tracking-[-0.04em] text-white">
                      {step.title}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-400">{step.body}</p>
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
            <div className="max-w-4xl" data-marketing-reveal="pricing-hero">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
                Pricing
              </div>
              <h2
                className="mt-4 text-[clamp(3rem,6vw,5rem)] font-semibold leading-[0.9] tracking-[-0.07em] text-white"
                data-marketing-reveal="pricing-title"
                data-split-text="lines"
              >
                {isBetaMode(deploymentMode)
                  ? "Private beta access, limited seats."
                  : "Clear plans for replay, review, and growth."}
              </h2>
              <p
                className="mt-5 max-w-2xl text-lg leading-8 text-slate-300"
                data-marketing-reveal="pricing-copy"
              >
                {isBetaMode(deploymentMode)
                  ? "Current phase stays simple: free access for approved beta users, waitlist once seats fill."
                  : "Choose cadence, compare plans, and see what scales from solo validation to desk-grade review."}
              </p>
            </div>

            <div
              className="rounded-[28px] border border-white/10 bg-[#061018] p-5 shadow-panel"
              data-marketing-reveal="pricing-mode"
              data-reveal-delay="0.06"
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Current mode
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
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
          <div className="max-w-5xl" data-marketing-reveal="proof-intro">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
              Included now
            </div>
            <h2
              className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-[3.2rem]"
              data-marketing-reveal="proof-title"
              data-split-text="lines"
            >
              Product first. Pricing second.
            </h2>
            <p className="mt-4 max-w-4xl text-base leading-8 text-slate-400" data-marketing-reveal="proof-copy">
              EdgeLab already ships replay, journal review, analytics, and strategy memory inside
              the same workspace.
            </p>
          </div>

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
                    <div className="text-[1.45rem] font-semibold tracking-[-0.04em] text-white">
                      {item.title}
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-400">{item.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
          <div data-marketing-reveal="faq-intro">
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
              FAQ
            </div>
            <h2
              className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-[3.2rem]"
              data-marketing-reveal="faq-title"
              data-split-text="lines"
            >
              What beta users should expect.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-400" data-marketing-reveal="faq-copy">
              Short answers on beta access, imports, billing timing, and data lifecycle.
            </p>
          </div>
          <div data-marketing-reveal="faq-list" data-reveal-delay="0.08">
            <FaqAccordion items={pricingFaqItems} />
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
