import { ShieldCheck } from "lucide-react";
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

type MarketPulse = {
  change: string;
  symbol: string;
  tone: "down" | "up";
  value: string;
};

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

const MARKET_PULSE: MarketPulse[] = [
  { symbol: "NQ", value: "4301.30", change: "+0.64%", tone: "up" },
  { symbol: "ES", value: "5988.75", change: "+0.28%", tone: "up" },
  { symbol: "CL", value: "79.42", change: "-0.31%", tone: "down" },
  { symbol: "EURUSD", value: "1.0887", change: "+0.12%", tone: "up" },
  { symbol: "AAPL", value: "188.10", change: "-0.44%", tone: "down" },
  { symbol: "BTC", value: "104,221", change: "+1.18%", tone: "up" },
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

function MarketTape() {
  const items = [...MARKET_PULSE, ...MARKET_PULSE];

  return (
    <div className="overflow-hidden rounded-full border border-white/10 bg-[#071018] shadow-panel">
      <div className="edgelab-marquee flex w-max items-center gap-3 px-4 py-3">
        {items.map((item, index) => (
          <div
            key={`${item.symbol}-${index}`}
            className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm"
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

export function LandingPage() {
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
                <span aria-label="Engineered." className="edgelab-typeword text-cyan-300">
                  <span className="edgelab-typeword-inner">Engineered.</span>
                </span>
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Replay price action, capture decisions, and review outcomes from one trading
                surface built to tighten process instead of adding more tabs.
              </p>

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

          <div className="mt-8">
            <MarketTape />
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
    </MarketingShell>
  );
}
