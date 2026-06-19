import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  CandlestickChart,
  ChevronDown,
  DatabaseZap,
  FileSpreadsheet,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
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

type PressurePoint = {
  body: string;
  icon: typeof CandlestickChart;
  label: string;
  title: string;
};

type ProductRail = {
  body: string;
  icon: typeof CandlestickChart;
  points: string[];
  title: string;
};

type BetaLane = {
  body: string;
  label: string;
  note: string;
  title: string;
};

type ProofStep = {
  body: string;
  step: string;
  title: string;
};

const SIGNAL_STRIP = [
  "Google-only beta gate",
  "Waitlist auto-attaches after fill",
  "Replay, journal, analytics in one surface",
  "Bring your own CSV datasets",
  "Beta data pruned after cohort closes",
  "SQLite cohort state persisted in Docker volume",
];

const PRESSURE_POINTS: PressurePoint[] = [
  {
    body: "Most review stacks split replay, notes, and metrics apart. By the time you inspect a trade, context already rotted.",
    icon: CandlestickChart,
    label: "Problem 01",
    title: "Screenshots masquerade as process",
  },
  {
    body: "Spreadsheet handoff breaks causality. You stop studying decision quality and start cleaning exports.",
    icon: FileSpreadsheet,
    label: "Problem 02",
    title: "Evidence gets diluted between tools",
  },
  {
    body: "Pretty dashboards can hide weak execution. Beta exists to force friction into daylight before launch.",
    icon: BarChart3,
    label: "Problem 03",
    title: "Confidence arrives faster than proof",
  },
];

const PRODUCT_RAILS: ProductRail[] = [
  {
    body: "Trade inside replay with pending orders, brackets, pace control, and session context still on-screen.",
    icon: CandlestickChart,
    points: ["Deterministic replay", "Bracket orders", "Decision-by-decision review"],
    title: "Execution Surface",
  },
  {
    body: "Close trade, log why, tag mistake pattern, and keep notebook truth tied to exact session history.",
    icon: BookOpenText,
    points: ["Trade journal", "Mistake tags", "Playbook-linked notes"],
    title: "Review Memory",
  },
  {
    body: "Cross-check curve, expectancy, filters, and grouped outcomes without leaving same research lane.",
    icon: BarChart3,
    points: ["Equity movement", "Filtered review", "Strategy grouping"],
    title: "Analytics Truth",
  },
  {
    body: "Point EdgeLab at dataset roots, map metadata once, then interrogate actual historical structure instead of cherry-picked examples.",
    icon: FileSpreadsheet,
    points: ["Dataset catalog", "Instrument metadata", "Multi-timeframe intake"],
    title: "Data Intake",
  },
];

const BETA_LANES: BetaLane[] = [
  {
    body: "Break replay controls, order handling, chart tooling, and session pacing until there is no ambiguity left in the flow.",
    label: "Lane 01",
    note: "Goal: zero friction between idea and action",
    title: "Replay fidelity",
  },
  {
    body: "Use notes, tags, and playbooks hard enough that bad review habits become visible instead of remaining private folklore.",
    label: "Lane 02",
    note: "Goal: journal with less self-deception",
    title: "Journal honesty",
  },
  {
    body: "Challenge metrics against your own exported evidence so no chart earns trust it did not prove.",
    label: "Lane 03",
    note: "Goal: believable conclusions, not presentation polish",
    title: "Analytics truth",
  },
];

const PROOF_STEPS: ProofStep[] = [
  {
    body: "Bring market data in, map symbol metadata, choose exact replay window, and keep raw evidence close.",
    step: "01",
    title: "Load market context",
  },
  {
    body: "Trade candle by candle, adjust orders, pause when conviction slips, and capture reasoning before memory edits it.",
    step: "02",
    title: "Stress-test execution",
  },
  {
    body: "Review results, tag mistakes, split by strategy, and keep only lessons that survive inspection.",
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
        const duration = 1100;

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
      { threshold: 0.3 },
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

function LiveStat({
  hint,
  label,
  target,
}: {
  hint: string;
  label: string;
  target: number;
}) {
  const { ref, value } = useCountUp(target);

  return (
    <div
      ref={ref}
      className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 shadow-card"
    >
      <div className="font-data text-4xl text-cyan-100">{value}</div>
      <div className="mt-2 text-sm text-slate-300">{label}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{hint}</div>
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
      <h2 className="text-display mt-4 text-3xl text-white sm:text-[3.35rem]">{title}</h2>
      <p className="mt-4 text-base leading-8 text-slate-400">{description}</p>
    </div>
  );
}

function SignalStrip() {
  const items = [...SIGNAL_STRIP, ...SIGNAL_STRIP];

  return (
    <div className="mt-10 overflow-hidden rounded-full border border-white/10 bg-white/[0.03] p-2 shadow-card">
      <div className="edgelab-marquee flex min-w-max gap-3 pr-3">
        {items.map((item, index) => (
          <div
            key={`${item}-${index}`}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-4 py-2 text-xs uppercase tracking-[0.22em] text-slate-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LandingPage() {
  const { loading, program } = useBetaProgramStatus();
  const seatsTaken = program.seats_taken ?? 0;
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const fillRatio = Math.min(1, seatsTaken / Math.max(program.seats_total, 1));

  return (
    <MarketingShell
      navItems={[
        { href: "#manifesto", label: "Manifesto" },
        { href: "#surface", label: "Surface" },
        { href: "#proof", label: "Proof" },
        { href: "/pricing", label: "Pricing" },
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
      pageTitle="landing"
    >
      <section className="relative overflow-hidden px-4 pb-18 pt-12 sm:px-6 lg:px-8 lg:pb-24 lg:pt-16">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.14fr)_minmax(360px,0.86fr)]">
            <div className="relative">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-cyan-100">
                <ShieldCheck size={14} />
                Beta control room live now
              </div>

              <h1 className="text-display mt-6 max-w-4xl text-5xl text-white sm:text-6xl lg:text-[5.4rem]">
                Interrogate trade decisions before memory edits story.
              </h1>

              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
                EdgeLab keeps replay, journal, playbook context, and analytics on same surface.
                Beta is not broad access. It is focused cohort for traders willing to pressure-test
                workflow hard enough that weak assumptions crack early.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition hover:-translate-y-0.5"
                  to="/auth/signin"
                >
                  {seatsRemaining == null || seatsRemaining > 0 ? "Enter beta through Google" : "Join waitlist through Google"}
                  <ArrowRight size={16} />
                </Link>
                <a
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/30 hover:text-cyan-100"
                  href="#surface"
                >
                  See research surface
                </a>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-5 shadow-card">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Seats open</div>
                  <div className="mt-3 font-data text-3xl text-white">
                    {loading || seatsRemaining == null ? "..." : seatsRemaining}
                  </div>
                  <div className="mt-2 text-sm text-slate-400">Live cohort capacity right now</div>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-5 shadow-card">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Queue size</div>
                  <div className="mt-3 font-data text-3xl text-white">
                    {waitlistCount == null ? "..." : waitlistCount}
                  </div>
                  <div className="mt-2 text-sm text-slate-400">Waitlist attached after seat fill</div>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-5 shadow-card">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Beta rule</div>
                  <div className="mt-3 font-data text-3xl text-white">Pruned</div>
                  <div className="mt-2 text-sm text-slate-400">Export anything you need to keep</div>
                </div>
              </div>

              <div className="mt-8 rounded-[30px] border border-amber-300/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(255,255,255,0.04))] p-5 text-sm leading-7 text-amber-100 shadow-card">
                Beta contract: Google OAuth gates every signup, waitlist uses same identity path,
                and cohort data can be pruned when beta closes. This phase is for workflow truth,
                not durable record keeping.
              </div>
            </div>

            <div className="grid gap-4">
              <div className="overflow-hidden rounded-[34px] border border-cyan-300/20 bg-[linear-gradient(160deg,rgba(50,211,238,0.18),rgba(255,255,255,0.03)_45%,rgba(245,158,11,0.08))] p-6 shadow-glow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/75">
                      Cohort board
                    </div>
                    <div className="mt-2 text-3xl font-semibold text-white">
                      Pressure-test replay, review, and analytics before launch polish lies for us.
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-200">
                    Beta track
                  </div>
                </div>

                <div className="mt-8 rounded-[26px] border border-white/10 bg-black/25 p-5">
                  <div className="flex items-center justify-between gap-3 text-sm text-slate-300">
                    <span>Seat pressure</span>
                    <span>
                      {loading || program.seats_taken == null
                        ? "pulling live count"
                        : `${program.seats_taken}/${program.seats_total} claimed`}
                    </span>
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-200 to-amber-200"
                      style={{ width: `${Math.max(fillRatio * 100, 8)}%` }}
                    />
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {[
                      "Google-only gate",
                      "Waitlist auto-enables",
                      "Beta data not permanent",
                    ].map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-100"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  {BETA_LANES.map((lane, index) => (
                    <div
                      key={lane.label}
                      className={`rounded-[24px] border px-5 py-4 ${
                        index === 0
                          ? "border-white/15 bg-black/22"
                          : "border-white/10 bg-black/16"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/70">
                          {lane.label}
                        </div>
                        <div className="text-xs text-slate-400">{lane.note}</div>
                      </div>
                      <div className="mt-2 text-xl font-semibold text-white">{lane.title}</div>
                      <p className="mt-2 text-sm leading-7 text-slate-300">{lane.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    body: "All cohort entries flow through same Google identity now.",
                    icon: LockKeyhole,
                    title: "Auth locked",
                  },
                  {
                    body: "Beta user/session state lives in persistent `api-data` volume.",
                    icon: DatabaseZap,
                    title: "State persists",
                  },
                  {
                    body: "Product access is free during beta while feedback loop stays direct.",
                    icon: Sparkles,
                    title: "No paid noise",
                  },
                ].map((card) => {
                  const Icon = card.icon;

                  return (
                    <div
                      key={card.title}
                      className="rounded-[24px] border border-white/10 bg-white/[0.03] p-5 shadow-card"
                    >
                      <Icon className="text-cyan-100" size={18} />
                      <div className="mt-4 text-lg font-semibold text-white">{card.title}</div>
                      <p className="mt-2 text-sm leading-7 text-slate-400">{card.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <SignalStrip />

          <div className="mt-12 flex justify-center">
            <a
              aria-label="Scroll to manifesto"
              className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
              href="#manifesto"
            >
              <ChevronDown className="animate-bounce" size={18} />
            </a>
          </div>
        </div>
      </section>

      <section id="manifesto" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Beta page should tell truth plainly: this is a research desk for traders who want workflow evidence, not another funnel dressed like conviction."
            eyebrow="Manifesto"
            title="What EdgeLab refuses to outsource."
          />

          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {PRESSURE_POINTS.map((point, index) => {
              const Icon = point.icon;

              return (
                <div
                  key={point.title}
                  className={`rounded-[32px] border p-6 shadow-card ${
                    index === 0
                      ? "border-cyan-300/25 bg-[linear-gradient(160deg,rgba(50,211,238,0.16),rgba(255,255,255,0.04))]"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                      <Icon size={22} />
                    </div>
                    <div className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                      {point.label}
                    </div>
                  </div>

                  <div className="mt-8 text-3xl font-semibold text-white">{point.title}</div>
                  <p className="mt-4 text-sm leading-7 text-slate-300">{point.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="surface" className="px-4 py-20 sm:px-6 lg:px-8">
        <div id="features" />
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Research surface should feel like one desk, not five apps pretending to collaborate. EdgeLab keeps execution, notes, and evidence close together."
            eyebrow="Research Surface"
            title="One surface for replay, notes, and proof."
          />

          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
            <div className="grid gap-4">
              {PRODUCT_RAILS.map((rail, index) => {
                const Icon = rail.icon;

                return (
                  <div
                    key={rail.title}
                    className={`rounded-[28px] border p-5 shadow-card ${
                      index === 0
                        ? "border-cyan-300/20 bg-[linear-gradient(160deg,rgba(50,211,238,0.14),rgba(255,255,255,0.035))]"
                        : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                        <Icon size={21} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[1.85rem] font-semibold text-white">{rail.title}</div>
                        <p className="mt-3 text-sm leading-7 text-slate-300">{rail.body}</p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {rail.points.map((point) => (
                            <div
                              key={point}
                              className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-xs uppercase tracking-[0.16em] text-slate-300"
                            >
                              {point}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="edgelab-stage-enter rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5 shadow-glow">
              <div className="flex flex-col gap-3 rounded-[24px] border border-white/10 bg-black/18 px-5 py-4 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/75">
                    Live surface preview
                  </div>
                  <div className="mt-1 text-base text-white">
                    Replay, order flow, and review context stay on one screen.
                  </div>
                </div>
                <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                  Product, not mockup theater
                </div>
              </div>
              <div className="mt-5">
                <HeroDemo />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="proof" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Proof is not testimonial wallpaper. Proof is whether workflow lets traders move from replay to review without losing context or inventing confidence."
            eyebrow="Proof Loop"
            title="Evidence path beta users should follow."
          />

          <div className="mt-12 grid gap-4 lg:grid-cols-[minmax(0,0.98fr)_minmax(320px,0.62fr)]">
            <div className="grid gap-4">
              {PROOF_STEPS.map((step, index) => (
                <div
                  key={step.step}
                  className={`rounded-[30px] border p-6 shadow-card ${
                    index === 1
                      ? "border-cyan-300/20 bg-[linear-gradient(160deg,rgba(50,211,238,0.14),rgba(255,255,255,0.035))]"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start gap-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/20 font-data text-lg text-cyan-100">
                      {step.step}
                    </div>
                    <div>
                      <div className="text-2xl font-semibold text-white">{step.title}</div>
                      <p className="mt-3 text-sm leading-7 text-slate-300">{step.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-4">
              <div className="rounded-[30px] border border-white/10 bg-white/[0.03] p-6 shadow-card">
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  Beta telemetry
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">
                  Cohort data should inform launch, not survive forever.
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-400">
                  Approved users, waitlist positions, and beta sessions persist between Docker rebuilds
                  through `api-data`. Beta policy still prunes workspace records after phase ends.
                </p>
              </div>
              <div className="rounded-[30px] border border-amber-300/20 bg-amber-300/10 p-6 shadow-card">
                <div className="text-[11px] uppercase tracking-[0.22em] text-amber-100/80">
                  Data policy
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">
                  Export what matters before beta closes.
                </div>
                <p className="mt-4 text-sm leading-7 text-amber-100">
                  EdgeLab beta data can be pruned once cohort finishes. Temporary by design. Honest by
                  design too.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <LiveStat hint="live cap" label="Beta seats" target={program.seats_total} />
            <LiveStat hint="live claim" label="Seats claimed" target={program.seats_taken ?? 0} />
            <LiveStat hint="overflow" label="Waitlist traders" target={program.waitlist_count ?? 0} />
            <LiveStat hint="focus lanes" label="Beta tracks" target={BETA_LANES.length} />
          </div>
        </div>
      </section>

      <section id="beta" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="Single beta plan now. Launch pricing can wait until workflow survives trader abuse."
            eyebrow="Access"
            title="Join beta now, or land in waitlist through same Google path."
          />
          <div className="mt-10">
            <PricingSection mode={deploymentMode} showComparison={false} />
          </div>
        </div>
      </section>

      <section id="faq" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]">
          <SectionHeading
            description="Questions here match actual beta behavior: Google-only auth, waitlist overflow, persistent cohort state, and temporary beta data."
            eyebrow="FAQ"
            title="Before you enter beta."
          />
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[38px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(50,211,238,0.18),rgba(255,255,255,0.04)_45%,rgba(245,158,11,0.12))] p-8 shadow-glow">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/75">
                Final call
              </div>
              <div className="text-display mt-4 max-w-4xl text-4xl text-white sm:text-5xl">
                Bring discipline. Break workflow. Leave cleaner evidence behind than you arrived with.
              </div>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-100/88">
                Enter beta if you want one desk for replay, journaling, and analytics truth. Join
                waitlist if seats are full. Export anything critical because beta data is temporary by
                policy.
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
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-slate-100"
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
