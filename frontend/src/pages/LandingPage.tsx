import { ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HeroDemo } from "../components/marketing/HeroDemo";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "../components/marketing/MarketingShell";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

type WorkflowStep = {
  body: string;
  step: string;
  title: string;
};

const ENGINEERED_WORD = "Engineered.";

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
      <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-[3.6rem]">
        {title}
      </h2>
      <p className="mt-4 text-base leading-8 text-slate-400">{description}</p>
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

export function LandingPage() {
  const { loading, program } = useBetaProgramStatus();
  const [typedWord, setTypedWord] = useState(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return ENGINEERED_WORD;
    }

    return "E";
  });
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const primaryLabel =
    !loading && seatsRemaining != null && seatsRemaining <= 0 ? "Join Waitlist" : "Join Beta";
  const primaryHref =
    !loading && seatsRemaining != null && seatsRemaining <= 0
      ? "/auth/signin?waitlist=1"
      : "/auth/signin";
  const accessLabel =
    seatsRemaining == null
      ? "Checking seats"
      : seatsRemaining > 0
        ? `${seatsRemaining} seats open`
        : "Waitlist open";

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !window.matchMedia ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTypedWord(ENGINEERED_WORD);
      return;
    }

    setTypedWord("E");
    let index = 1;

    const timer = window.setInterval(() => {
      index += 1;
      setTypedWord(ENGINEERED_WORD.slice(0, index));
      if (index >= ENGINEERED_WORD.length) {
        window.clearInterval(timer);
      }
    }, 90);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <MarketingShell navItems={buildMarketingNavItems("home")} pageTitle="landing">
      <section className="px-4 pb-20 pt-12 sm:px-6 lg:px-8 lg:pb-24 lg:pt-16">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-50">
                <ShieldCheck size={14} />
                EdgeLab beta
              </div>

              <h1 className="mt-6 max-w-4xl text-[clamp(3.35rem,7vw,6.3rem)] font-semibold leading-[0.88] tracking-[-0.08em] text-white">
                Your Edge{" "}
                <span
                  aria-label="Engineered."
                  className="edgelab-typeword text-cyan-300"
                  data-complete="Engineered."
                >
                  {typedWord}
                </span>
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Replay price action, capture decisions, and review outcomes from one trading
                surface built to tighten process instead of adding more tabs.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none"
                  to={primaryHref}
                >
                  {primaryLabel}
                  <ArrowRight size={16} />
                </Link>
                <a
                  className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-slate-100 transition duration-200 ease-out hover:border-cyan-300/25 hover:text-cyan-100 motion-reduce:transition-none"
                  href="#how-it-works"
                >
                  See workflow
                </a>
              </div>

              <div className="mt-8 text-sm leading-7 text-slate-400">
                Seat count updates live. Beta workspaces stay temporary during the test track.
              </div>
            </div>

            <div className="grid gap-3">
              <StatusCard
                hint="Current private beta access"
                label="Access"
                value={loading ? "..." : accessLabel}
              />
              <StatusCard
                hint="Queue opens automatically once seats fill"
                label="Waitlist"
                value={waitlistCount == null ? "..." : String(waitlistCount)}
              />
              <StatusCard
                hint="Approved users enter workspace. Full seats roll into queue."
                label="Entry"
                value="Google"
              />
            </div>
          </div>

          <div id="product" className="mt-10 lg:mt-12">
            <HeroDemo />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-4 py-20 sm:px-6 lg:px-8">
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
                className={`rounded-[28px] border px-6 py-6 shadow-panel ${
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

      <section id="join-beta" className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[34px] border border-white/10 bg-[#060c12] p-8 shadow-card">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
                Beta track
              </div>
              <h2 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.06em] text-white sm:text-[3.2rem]">
                Simple entry. Honest expectations.
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-400">
                One Google sign-in handles approved beta access or waitlist placement. Workspace
                data stays temporary during the test track.
              </p>
            </div>

            <div className="grid gap-3">
              <StatusCard
                hint={
                  waitlistCount == null
                    ? "Waitlist count syncing."
                    : `${waitlistCount} traders queued if seats close.`
                }
                label="Right now"
                value={accessLabel}
              />

              <Link
                className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition duration-200 ease-out hover:-translate-y-0.5 motion-reduce:transition-none"
                to={primaryHref}
              >
                {primaryLabel}
                <ArrowRight size={16} />
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-slate-100 transition duration-200 ease-out hover:border-cyan-300/25 hover:text-cyan-100 motion-reduce:transition-none"
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
