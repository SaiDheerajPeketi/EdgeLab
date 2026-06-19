import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  CandlestickChart,
  ChevronDown,
  FileSpreadsheet,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

type LabPillar = {
  body: string;
  icon: typeof CandlestickChart;
  points: string[];
  proof: string;
  title: string;
};

type BetaTrack = {
  focus: string;
  label: string;
  proof: string;
};

const LAB_PILLARS: LabPillar[] = [
  {
    body: "Run full-session replays without leaving the research surface. Order entry, pending orders, execution tape, chart tools, and replay controls stay in one loop.",
    icon: CandlestickChart,
    points: ["Deterministic replay", "Bracket orders", "Multi-pane chart review"],
    proof: "Replay stack already live",
    title: "Replay Engine",
  },
  {
    body: "Close trade, capture notes, tag mistakes, attach strategy context, and turn a session into something you can audit next week without lying to yourself.",
    icon: BookOpenText,
    points: ["Trade journal", "Mistake tags", "Playbook-linked review"],
    proof: "Journal on every close",
    title: "Trade Memory",
  },
  {
    body: "Session curves, filtered review, result panels, and playbook splits show whether edge is real or only feels real after a lucky week.",
    icon: BarChart3,
    points: ["Equity movement", "Outcome filters", "Strategy grouping"],
    proof: "Evidence-first analytics",
    title: "Analytics Truth",
  },
  {
    body: "Dataset-root imports let testers bring their own market structure into lab, then validate setups against actual historical behavior instead of screenshots and hindsight.",
    icon: FileSpreadsheet,
    points: ["CSV intake", "Instrument metadata", "Multi-timeframe catalog"],
    proof: "Any OHLCV source",
    title: "Data Intake",
  },
];

const BETA_TRACKS: BetaTrack[] = [
  {
    focus: "Hammer session creation, replay controls, order flow, and trade inspection until friction becomes obvious.",
    label: "Track 01 · Replay fidelity",
    proof: "Goal: zero confusion between idea and execution",
  },
  {
    focus: "Push journal, notebook, and playbook flows hard enough that weak review habits surface fast.",
    label: "Track 02 · Journal honesty",
    proof: "Goal: no hidden process debt",
  },
  {
    focus: "Cross-check metrics, filtered review, and reports against your own expectations and exported data.",
    label: "Track 03 · Analytics truth",
    proof: "Goal: believable conclusions, not pretty charts",
  },
];

const WORKFLOW_STEPS = [
  {
    body: "Bring market data in, map symbol metadata, set replay window, and choose exact timeframe you want to interrogate.",
    step: "01",
    title: "Load market evidence",
  },
  {
    body: "Trade candle by candle, pause, speed up, move stops, capture context, and keep execution decisions tied to the same screen.",
    step: "02",
    title: "Stress-test decision quality",
  },
  {
    body: "Review session outcomes, journal each close, group by strategy, then iterate until process survives scrutiny.",
    step: "03",
    title: "Tighten edge with proof",
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
      { threshold: 0.35 },
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
    <div
      ref={ref}
      className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 shadow-card"
    >
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

export function LandingPage() {
  const { loading, program } = useBetaProgramStatus();
  const seatsTaken = program.seats_taken ?? 0;
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const betaFillRatio = Math.min(1, seatsTaken / Math.max(program.seats_total, 1));

  return (
    <MarketingShell
      navItems={[
        { href: "#track", label: "Beta Track" },
        { href: "#features", label: "Product" },
        { href: "#proof", label: "Proof" },
        { href: "/pricing", label: "Pricing" },
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
      pageTitle="landing"
    >
      <section className="relative overflow-hidden px-4 pb-20 pt-12 sm:px-6 lg:px-8 lg:pb-28 lg:pt-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.88fr)]">
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-100">
              <ShieldCheck size={14} />
              Beta live now · waitlist on overflow
            </div>

            <h1 className="text-display mt-6 max-w-4xl text-5xl text-white sm:text-6xl lg:text-7xl">
              Replay market decisions until your process stops lying to you.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              EdgeLab puts replay, journal, strategy review, and analytics in one research surface.
              Beta right now is for traders willing to pressure-test workflow, not browse another shiny landing page.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition hover:-translate-y-0.5"
                to="/auth/signin"
              >
                {seatsRemaining == null || seatsRemaining > 0 ? "Enter beta track" : "Join beta waitlist"}
                <ArrowRight size={16} />
              </Link>
              <a
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/30 hover:text-cyan-100"
                href="#track"
              >
                See test focus
              </a>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 shadow-card">
                <div className="font-data text-xl text-white">
                  {loading || seatsRemaining == null ? "..." : seatsRemaining}
                </div>
                <div className="mt-1 text-sm text-slate-400">Seats open right now</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 shadow-card">
                <div className="font-data text-xl text-white">
                  {waitlistCount == null ? "..." : waitlistCount}
                </div>
                <div className="mt-1 text-sm text-slate-400">Waitlist traders queued</div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 shadow-card">
                <div className="font-data text-xl text-white">Pruned</div>
                <div className="mt-1 text-sm text-slate-400">Beta data after close</div>
              </div>
            </div>

            <div className="mt-8 rounded-[28px] border border-amber-300/20 bg-amber-300/10 px-5 py-5 text-sm leading-7 text-amber-100">
              Beta rules: email access path is primary, Google auth comes later, and workspace data
              can be pruned once beta ends. If you need a durable record, export it.
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/70">
                    Beta mission board
                  </div>
                  <div className="mt-2 text-3xl font-semibold text-white">
                    Current cohort: replay, journal, analytics.
                  </div>
                </div>
                <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                  Cohort active
                </div>
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-[24px] border border-white/10 bg-black/25 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
                    <span>Seat pressure</span>
                    <span>
                      {loading || program.seats_taken == null
                        ? "pulling live count"
                        : `${program.seats_taken}/${program.seats_total} claimed`}
                    </span>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-200 to-emerald-200"
                      style={{ width: `${Math.max(betaFillRatio * 100, 10)}%` }}
                    />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      "Stress replay flow",
                      "Capture honest notes",
                      "Verify metrics against exports",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-sm text-slate-200"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-300/10 p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/75">
                    Before you enter
                  </div>
                  <div className="mt-4 grid gap-3 text-sm leading-7 text-slate-100">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      Waitlist auto-enables when seats fill.
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      Google auth is staged, not mainline.
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      Beta data is temporary by policy.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div id="demo" className="edgelab-stage-enter">
              <HeroDemo />
            </div>
          </div>
        </div>

        <div className="mt-12 flex justify-center">
          <a
            aria-label="Scroll to beta track"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
            href="#track"
          >
            <ChevronDown className="animate-bounce" size={18} />
          </a>
        </div>
      </section>

      <section id="track" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <SectionHeading
            description="This beta is not generic early access. It is a guided test track for traders who will deliberately break workflow and tell us where confidence leaks."
            eyebrow="Beta Track"
            title="What testers should pressure-test first."
          />

          <div className="grid gap-4">
            {BETA_TRACKS.map((track, index) => (
              <div
                key={track.label}
                className={`rounded-[28px] border p-6 shadow-card ${
                  index === 0
                    ? "border-cyan-300/20 bg-[linear-gradient(135deg,rgba(50,211,238,0.16),rgba(255,255,255,0.035))]"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/70">
                  {track.label}
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">{track.proof}</div>
                <p className="mt-4 text-sm leading-7 text-slate-300">{track.focus}</p>
              </div>
            ))}

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-[28px] border border-amber-300/20 bg-amber-300/10 p-6 shadow-card">
                <div className="text-[11px] uppercase tracking-[0.24em] text-amber-100/80">
                  Data policy
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">
                  Beta data will be pruned after beta ends.
                </div>
                <p className="mt-4 text-sm leading-7 text-amber-100">
                  Treat beta workspace history as disposable test material. If you need to keep
                  anything important, export it before beta closes.
                </p>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-card">
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                  Access path
                </div>
                <div className="mt-3 text-2xl font-semibold text-white">
                  Email first. Waitlist second. OAuth later.
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  Current path is intentionally simple so cohort feedback lands on core workflow
                  instead of auth edge cases.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="EdgeLab is already opinionated about how traders should test ideas: same screen, same context, same evidence loop."
            eyebrow="Inside Product"
            title="Four surfaces that matter during beta."
          />

          <div className="mt-12 grid gap-4 lg:grid-cols-2">
            {LAB_PILLARS.map((pillar, index) => {
              const Icon = pillar.icon;

              return (
                <div
                  key={pillar.title}
                  className={`rounded-[32px] border p-6 shadow-card ${
                    index === 0
                      ? "border-cyan-300/20 bg-[linear-gradient(135deg,rgba(50,211,238,0.16),rgba(255,255,255,0.035))]"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                      <Icon size={22} />
                    </div>
                    <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                      {pillar.proof}
                    </div>
                  </div>

                  <div className="mt-8 text-3xl font-semibold text-white">{pillar.title}</div>
                  <p className="mt-4 text-sm leading-7 text-slate-300">{pillar.body}</p>

                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    {pillar.points.map((point) => (
                      <div
                        key={point}
                        className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200"
                      >
                        {point}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="proof" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Short path. No mode theater. No spreadsheet detour. No fake testimonial wall."
            eyebrow="Proof"
            title="Load evidence, trade it, interrogate yourself."
          />

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {WORKFLOW_STEPS.map((step) => (
              <div
                key={step.step}
                className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-card"
              >
                <div className="font-data text-sm text-cyan-100">{step.step}</div>
                <div className="mt-3 text-2xl font-semibold text-white">{step.title}</div>
                <p className="mt-4 text-sm leading-7 text-slate-400">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Beta seats" suffix="" target={program.seats_total} />
            <StatCard label="Seats already claimed" suffix="" target={program.seats_taken ?? 0} />
            <StatCard label="Waitlist traders" suffix="" target={program.waitlist_count ?? 0} />
            <StatCard label="Core beta tracks" suffix="" target={BETA_TRACKS.length} />
          </div>
        </div>
      </section>

      <section id="beta" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Single beta plan now. Production pricing comes later after this cohort finishes beating on workflow."
            eyebrow="Access"
            title="Join beta now or roll into waitlist when seats close."
          />
          <div className="mt-10">
            <PricingSection mode={deploymentMode} showComparison={false} />
          </div>
        </div>
      </section>

      <section id="faq" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]">
          <SectionHeading
            description="Questions here align with current beta reality, not future marketing promises."
            eyebrow="FAQ"
            title="What traders need to know before joining."
          />
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[36px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(50,211,238,0.18),rgba(255,255,255,0.045))] p-8 shadow-glow">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/70">
                Final call
              </div>
              <div className="text-display mt-4 text-4xl text-white sm:text-5xl">
                Bring discipline. Break workflow. Help harden product.
              </div>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-200">
                Enter beta if you want one surface for replay, journaling, and evidence review.
                Join waitlist if seats are gone. Export anything critical because beta data is not forever.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950"
                to="/auth/signin"
              >
                {seatsRemaining == null || seatsRemaining > 0 ? "Enter beta" : "Join waitlist"}
                <ArrowRight size={16} />
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-full border border-white/10 px-6 py-3 text-sm font-semibold text-slate-100"
                to="/pricing"
              >
                Review access
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
