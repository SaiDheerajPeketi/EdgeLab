import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  CandlestickChart,
  ChevronDown,
  FileSpreadsheet,
  FlaskConical,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HeroDemo } from "../components/marketing/HeroDemo";
import {
  FaqAccordion,
  PricingSection,
  pricingFaqItems,
} from "../components/marketing/PricingSection";
import { MarketingShell } from "../components/marketing/MarketingShell";
import { deploymentMode } from "../lib/deploymentMode";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

type FeatureCard = {
  description: string;
  icon: typeof CandlestickChart;
  label: string;
  stats: string;
};

type DeepFeature = {
  accent: string;
  body: string;
  bullets: string[];
  title: string;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    description: "Replay any market second by second with deterministic execution.",
    icon: CandlestickChart,
    label: "Replay Engine",
    stats: "50 candle live demo",
  },
  {
    description: "Auto-log entries, exits, R-multiple, notes, mistakes, emotion.",
    icon: BookOpenText,
    label: "Trade Journal",
    stats: "Journal every close",
  },
  {
    description: "Equity curve, day/time reports, distribution views, strategy splits.",
    icon: BarChart3,
    label: "Analytics",
    stats: "50+ metrics tracked",
  },
  {
    description: "Package repeatable setups, tag sessions, validate edge before risk.",
    icon: FlaskConical,
    label: "Strategy Validation",
    stats: "Playbook ready",
  },
  {
    description: "Dataset-root imports, multi-timeframe catalog, live dataset refresh.",
    icon: FileSpreadsheet,
    label: "CSV Intake",
    stats: "Any OHLCV source",
  },
  {
    description: "Workspace tuned for focused review, not noisy dashboard theater.",
    icon: Layers3,
    label: "Trader Workflow",
    stats: "Research-first UI",
  },
];

const DEEP_FEATURES: DeepFeature[] = [
  {
    accent: "Replay any market like it is happening now.",
    body:
      "Step candle by candle, speed up, pause, bracket orders, move breakeven, inspect exact trade context. Same workspace, no mode switch.",
    bullets: ["Session builder with dataset/timeframe control", "Order ticket, pending orders, execution tape", "Chart tools, indicators, multi-pane layouts"],
    title: "Chart Replay Engine",
  },
  {
    accent: "Every closed trade becomes research fuel.",
    body:
      "EdgeLab stores notes, mistake tags, emotional state, strategy tag, and P&L context so review turns into pattern discovery.",
    bullets: ["Journal modal on close", "Trade detail drawer for replay review", "Playbook-aware trade tagging"],
    title: "Auto-Journal",
  },
  {
    accent: "Analytics that tell you what is working and what is killing edge.",
    body:
      "Day breakdowns, session curves, outcome filters, strategy grouping, equity movement, and replay-linked trade drilldown already sit inside workspace.",
    bullets: ["Equity curve + session metrics", "Filtered trade review", "Reports panel and results panel"],
    title: "Analytics That Matter",
  },
  {
    accent: "Stop guessing if strategy works.",
    body:
      "Build repeatable setups, run against real historical data, track which playbook survives drawdown, then refine rules with evidence.",
    bullets: ["Playbook board and saved strategies", "Dataset-root catalog for many instruments", "Backtest state preserved across sessions"],
    title: "Strategy Validation",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Upload your CSV",
    body: "Import any OHLCV data, map instrument metadata, choose timeframe, lock replay window.",
  },
  {
    step: "02",
    title: "Replay & trade",
    body: "Place simulated trades candle by candle with bracket control, sizing, and order amendments.",
  },
  {
    step: "03",
    title: "Analyse & improve",
    body: "Review P&L, R-multiple, calendar, notes, and strategy outcomes until pattern is obvious.",
  },
];

const TESTIMONIALS = [
  {
    quote:
      "EdgeLab showed best trades hit Tuesdays between 9 and 11. That pattern paid for weeks of random screen time.",
    role: "Forex beta trader",
  },
  {
    quote:
      "Replay engine feels like decision practice, not spreadsheet theater. Mistakes become visible fast.",
    role: "Futures replay user",
  },
  {
    quote:
      "Strategy tags plus trade notes made review honest. Hard to hide bad process when data lined up this clean.",
    role: "Crypto systematic trader",
  },
];

function useCountUp(target: number) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return undefined;
    }

    let animationFrame = 0;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          return;
        }

        const startedAt = performance.now();
        const duration = 1200;

        const animate = (now: number) => {
          const progress = Math.min((now - startedAt) / duration, 1);
          setValue(Math.round(target * progress));
          if (progress < 1) {
            animationFrame = window.requestAnimationFrame(animate);
          }
        };

        animationFrame = window.requestAnimationFrame(animate);
        observer.disconnect();
      },
      { threshold: 0.4 },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [target]);

  return { ref, value };
}

function StatCard({ label, suffix, target }: { label: string; suffix: string; target: number }) {
  const { ref, value } = useCountUp(target);

  return (
    <div ref={ref} className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5 shadow-card">
      <div className="text-display text-4xl text-cyan-100">
        {value}
        {suffix}
      </div>
      <div className="mt-2 text-sm text-slate-400">{label}</div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="max-w-3xl">
      <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">{eyebrow}</div>
      <h2 className="text-display mt-4 text-4xl text-white sm:text-5xl">{title}</h2>
      <p className="mt-4 text-base leading-8 text-slate-400">{description}</p>
    </div>
  );
}

function FloatingMetric({
  delay,
  text,
  top,
  left,
}: {
  delay: string;
  left: string;
  text: string;
  top: string;
}) {
  return (
    <div
      className="edgelab-float-metric pointer-events-none absolute rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-slate-300"
      style={
        {
          "--metric-delay": delay,
          left,
          top,
        } as CSSProperties
      }
    >
      {text}
    </div>
  );
}

export function LandingPage() {
  const { program } = useBetaProgramStatus();
  const tickerItems = useMemo(
    () => [
      "Forex",
      "Futures",
      "Crypto",
      "Stocks",
      "Prop Firms",
      "91 trades backtested",
      "$2,313 simulated gains",
      "50% win rate tracked",
    ],
    [],
  );

  return (
    <MarketingShell
      navItems={[
        { href: "#features", label: "Features" },
        { href: "#proof", label: "Proof" },
        { href: "/pricing", label: "Pricing" },
        { href: "#faq", label: "Docs" },
        { href: "#beta", label: "Beta" },
      ]}
      pageTitle="landing"
    >
      <section className="relative overflow-hidden px-4 pb-20 pt-12 sm:px-6 lg:px-8 lg:pb-28 lg:pt-16">
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="relative">
            <FloatingMetric delay="0s" left="2%" text="+$284" top="8%" />
            <FloatingMetric delay="1.8s" left="52%" text="R: 2.3" top="14%" />
            <FloatingMetric delay="3.2s" left="18%" text="- $47" top="60%" />

            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-100">
              <ShieldCheck size={14} />
              Now in beta · Limited seats
            </div>

            <h1 className="text-display mt-6 max-w-4xl text-5xl text-white sm:text-6xl lg:text-7xl">
              {["Your edge,", "engineered."].map((word, index) => (
                <span
                  key={word}
                  className="edgelab-word-reveal mr-4 inline-block"
                  style={{ animationDelay: `${index * 140}ms` }}
                >
                  {word}
                </span>
              ))}
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Backtest. Journal. Prove strategy works. EdgeLab turns replay, review,
              and analytics into one precision workflow for traders who want evidence.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition hover:-translate-y-0.5"
                to="/auth/signin"
              >
                {program.seats_remaining > 0 ? "Get Early Access — Free Beta" : "Join Beta Waitlist"}
                <ArrowRight size={16} />
              </Link>
              <a
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/30 hover:text-cyan-100"
                href="#demo"
              >
                Watch Demo
              </a>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { label: "Avg replay session", value: "91 trades" },
                { label: "Strategy review", value: "50+ metrics" },
                {
                  label: deploymentMode === "beta" ? "Beta seats" : "Mode",
                  value:
                    deploymentMode === "beta"
                      ? `${program.seats_remaining} left / ${program.waitlist_count} waitlist`
                      : "Production ready",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 shadow-card"
                >
                  <div className="font-data text-xl text-white">{item.value}</div>
                  <div className="mt-1 text-sm text-slate-400">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div id="demo" className="edgelab-stage-enter">
            <HeroDemo />
          </div>
        </div>

        <div className="mt-12 flex justify-center">
          <a
            aria-label="Scroll to features"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
            href="#features"
          >
            <ChevronDown className="animate-bounce" size={18} />
          </a>
        </div>
      </section>

      <section className="border-y border-white/10 bg-black/20 py-5">
        <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-hidden px-4 sm:px-6 lg:px-8">
          <div className="shrink-0 text-sm text-slate-400">Trusted across</div>
          <div className="relative w-full overflow-hidden">
            <div className="edgelab-marquee flex min-w-max items-center gap-3">
              {[...tickerItems, ...tickerItems].map((item, index) => (
                <div
                  key={`${item}:${index}`}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Landing page mirrors actual product posture: dark, sharp, data-first. Cards stay live-looking, not brochure-flat."
            eyebrow="Feature Grid"
            title="Research workflow built for traders who audit themselves."
          />

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {FEATURE_CARDS.map((feature, index) => {
              const Icon = feature.icon;
              const isWide = index % 3 === 0;

              return (
                <a
                  key={feature.label}
                  className={`group rounded-[30px] border border-white/10 bg-white/[0.03] p-5 shadow-card transition duration-300 hover:-translate-y-1 hover:border-cyan-300/30 hover:shadow-glow ${
                    isWide ? "lg:col-span-2" : ""
                  }`}
                  href={`#${feature.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                      <Icon size={22} />
                    </div>
                    <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                      {feature.stats}
                    </div>
                  </div>
                  <div className="mt-8">
                    <div className="text-2xl font-semibold text-white">{feature.label}</div>
                    <p className="mt-3 max-w-xl text-sm leading-7 text-slate-400">
                      {feature.description}
                    </p>
                  </div>
                  <div className="mt-8 flex items-center gap-2 text-sm text-cyan-100">
                    Learn more <ArrowRight size={14} className="transition group-hover:translate-x-1" />
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8">
          {DEEP_FEATURES.map((feature, index) => (
            <div
              key={feature.title}
              id={feature.title.toLowerCase().replace(/\s+/g, "-")}
              className={`grid gap-6 rounded-[32px] border border-white/10 bg-white/[0.03] p-6 shadow-card lg:grid-cols-2 lg:items-center ${
                index % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""
              }`}
            >
              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(50,211,238,0.14),rgba(255,255,255,0.03))] p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  {feature.bullets.map((bullet, bulletIndex) => (
                    <div
                      key={bullet}
                      className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-200"
                    >
                      <div className="font-data text-cyan-100">0{bulletIndex + 1}</div>
                      <div className="mt-2 leading-7">{bullet}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[0.26em] text-cyan-100/65">
                  {feature.title}
                </div>
                <h3 className="text-display mt-4 text-4xl text-white">{feature.accent}</h3>
                <p className="mt-4 text-base leading-8 text-slate-400">{feature.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="proof" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Short path from raw data to hard feedback loop."
            eyebrow="How It Works"
            title="Upload. Replay. Improve."
          />

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {HOW_IT_WORKS.map((step) => (
              <div
                key={step.step}
                className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-card"
              >
                <div className="font-data text-sm text-cyan-100">{step.step}</div>
                <div className="mt-3 text-2xl font-semibold text-white">{step.title}</div>
                <p className="mt-3 text-sm leading-7 text-slate-400">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-16 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Beta testers" suffix="+" target={500} />
            <StatCard label="Trades per session" suffix="" target={91} />
            <StatCard label="Avg R-multiple tracked" suffix="x" target={2} />
            <StatCard label="Indicators supported" suffix="+" target={50} />
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Placeholder quotes for beta-launch layout. Replace with real voices once cohort lands."
            eyebrow="Testimonials"
            title="Feedback from traders who want evidence, not stories."
          />

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {TESTIMONIALS.map((item) => (
              <div
                key={item.quote}
                className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-card"
              >
                <p className="text-base leading-8 text-slate-200">
                  {/* TODO: replace with real beta tester quotes */}
                  “{item.quote}”
                </p>
                <div className="mt-6 text-sm text-cyan-100">{item.role}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="beta" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Single beta card now. Production pricing gate already staged behind deployment mode switch."
            eyebrow="Pricing Gate"
            title={
              deploymentMode === "beta"
                ? "Beta access stays wide open until seats run out."
                : "Pricing scales from first edge to full desk workflow."
            }
          />
          <div className="mt-10">
            <PricingSection mode={deploymentMode} showComparison={false} />
          </div>
        </div>
      </section>

      <section id="faq" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <SectionHeading
            description="Landing answers current product position, beta mode, data flow, and rollout intent."
            eyebrow="FAQ"
            title="Questions traders ask before trusting research stack."
          />
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[36px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(50,211,238,0.18),rgba(255,255,255,0.045))] p-8 shadow-glow">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/70">
                Final CTA
              </div>
              <div className="text-display mt-4 text-4xl text-white sm:text-5xl">
                Your edge deserves proof, not hope.
              </div>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-200">
                Start in beta, run replay sessions, journal trades, audit strategy, and
                ship fewer delusions into live market hours.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950"
                to="/auth/signin"
              >
                Get Early Access <ArrowRight size={16} />
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-full border border-white/10 px-6 py-3 text-sm font-semibold text-slate-100"
                to="/pricing"
              >
                View Pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
