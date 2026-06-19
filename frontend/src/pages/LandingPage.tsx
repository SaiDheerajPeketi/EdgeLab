import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  CandlestickChart,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { HeroDemo } from "../components/marketing/HeroDemo";
import { MarketingShell } from "../components/marketing/MarketingShell";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

type Feature = {
  body: string;
  icon: typeof CandlestickChart;
  title: string;
};

type FlowStep = {
  body: string;
  step: string;
  title: string;
};

const FEATURES: Feature[] = [
  {
    body: "Replay, execution context, journal notes, and analytics live in one lane instead of five disconnected tools.",
    icon: CandlestickChart,
    title: "One focused desk",
  },
  {
    body: "Actual app widgets on this page mirror how EdgeLab tracks curve, tape, and playbooks inside workspace.",
    icon: BarChart3,
    title: "Real product surface",
  },
  {
    body: "Google sign-in keeps beta identity clean while feedback stays direct and fast.",
    icon: LockKeyhole,
    title: "Clean beta access",
  },
];

const FLOW_STEPS: FlowStep[] = [
  {
    step: "01",
    title: "Replay with intent",
    body: "Walk candle by candle, place trades, and keep timing decisions in full context.",
  },
  {
    step: "02",
    title: "Review without drift",
    body: "Tag mistakes, capture notes, and keep every lesson tied to actual executions.",
  },
  {
    step: "03",
    title: "Refine with proof",
    body: "Let metrics, curve, and playbook outcomes pressure-test your edge before confidence grows.",
  },
];

function SectionHeading({
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
      <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/65">{eyebrow}</div>
      <h2 className="text-display mt-4 text-3xl text-white sm:text-[3.25rem]">{title}</h2>
      <p className="mt-4 text-base leading-8 text-slate-400">{description}</p>
    </div>
  );
}

function StatPill({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] px-5 py-5 shadow-card">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-3 font-data text-3xl text-white">{value}</div>
      <div className="mt-2 text-sm text-slate-400">{hint}</div>
    </div>
  );
}

export function LandingPage() {
  const { loading, program } = useBetaProgramStatus();
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const accessLabel =
    seatsRemaining == null
      ? "Syncing access"
      : seatsRemaining > 0
        ? `${seatsRemaining} seats open`
        : "Beta full, waitlist open";

  return (
    <MarketingShell
      navItems={[
        { href: "#surface", label: "Surface" },
        { href: "#flow", label: "Flow" },
        { href: "#access", label: "Access" },
        { href: "/pricing", label: "Pricing" },
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
      pageTitle="landing"
    >
      <section className="relative overflow-hidden px-4 pb-20 pt-12 sm:px-6 lg:px-8 lg:pb-24 lg:pt-16">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.24em] text-cyan-100">
                <ShieldCheck size={14} />
                Find your edge
              </div>

              <h1 className="text-display mt-6 max-w-4xl text-5xl text-white sm:text-6xl lg:text-[5.2rem]">
                One trading surface for replay, review, and proof.
              </h1>

              <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
                EdgeLab keeps execution context, journal memory, and analytics truth together.
                Fewer tabs. Less drift. Better feedback on what actually sharpens your process.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition hover:-translate-y-0.5"
                  to="/auth/signin"
                >
                  {seatsRemaining == null || seatsRemaining > 0 ? "Enter EdgeLab" : "Join waitlist"}
                  <ArrowRight size={16} />
                </Link>
                <a
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-300/30 hover:text-cyan-100"
                  href="#surface"
                >
                  See live surface
                </a>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <StatPill
                  hint="Current beta availability"
                  label="Access"
                  value={loading ? "..." : accessLabel}
                />
                <StatPill
                  hint="Auto-opens when beta fills"
                  label="Waitlist"
                  value={waitlistCount == null ? "..." : String(waitlistCount)}
                />
                <StatPill
                  hint="Export what matters"
                  label="Data"
                  value="Temporary"
                />
              </div>
            </div>

            <div className="grid gap-4">
              {FEATURES.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={feature.title}
                    className={`rounded-[30px] border p-6 shadow-card ${
                      index === 0
                        ? "border-cyan-300/20 bg-[linear-gradient(160deg,rgba(50,211,238,0.16),rgba(255,255,255,0.035))]"
                        : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                        <Icon size={22} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-2xl font-semibold text-white">{feature.title}</div>
                        <p className="mt-3 text-sm leading-7 text-slate-300">{feature.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="surface" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            description="This preview uses actual EdgeLab workspace widgets. Metrics, curve, execution tape, and playbook board stay connected because product should feel coherent before marketing ever talks."
            eyebrow="Surface"
            title="Live preview built from real app components."
          />

          <div className="mt-10">
            <HeroDemo />
          </div>
        </div>
      </section>

      <section id="flow" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <SectionHeading
            description="EdgeLab should reduce distance between trade action and trade truth. These are the only steps that matter."
            eyebrow="Flow"
            title="Replay. Review. Refine."
          />

          <div className="grid gap-4">
            {FLOW_STEPS.map((step, index) => (
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
        </div>
      </section>

      <section id="access" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[38px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(50,211,238,0.16),rgba(255,255,255,0.04)_45%,rgba(245,158,11,0.10))] p-8 shadow-glow">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/75">
                Access
              </div>
              <div className="text-display mt-4 max-w-4xl text-4xl text-white sm:text-5xl">
                Google sign-in for beta. Waitlist when seats close.
              </div>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-100/88">
                Keep beta entry simple, keep identity consistent, and keep expectations honest.
                Beta data is temporary and may be pruned after program ends.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {[
                  {
                    icon: LockKeyhole,
                    title: "OAuth only",
                    body: "One sign-in path for approved users and waitlist.",
                  },
                  {
                    icon: Sparkles,
                    title: "Direct feedback",
                    body: "Beta stays focused while workflow edges get cleaned up.",
                  },
                  {
                    icon: BookOpenText,
                    title: "Export critical data",
                    body: "Treat beta workspace as temporary, not long-term storage.",
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.title}
                      className="rounded-[24px] border border-white/10 bg-black/20 p-5"
                    >
                      <Icon className="text-cyan-100" size={18} />
                      <div className="mt-4 text-lg font-semibold text-white">{item.title}</div>
                      <p className="mt-2 text-sm leading-7 text-slate-200/85">{item.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3">
              <div className="rounded-[28px] border border-white/10 bg-black/24 p-5 shadow-card">
                <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-100/70">
                  Right now
                </div>
                <div className="mt-3 text-3xl font-semibold text-white">{accessLabel}</div>
                <div className="mt-3 text-sm leading-7 text-slate-300">
                  {waitlistCount == null
                    ? "Waitlist count syncing."
                    : `${waitlistCount} traders already queued if capacity closes.`}
                </div>
              </div>

              <Link
                className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950"
                to="/auth/signin"
              >
                {seatsRemaining == null || seatsRemaining > 0 ? "Enter EdgeLab" : "Join waitlist"}
                <ArrowRight size={16} />
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-slate-100"
                to="/pricing"
              >
                Review pricing
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
