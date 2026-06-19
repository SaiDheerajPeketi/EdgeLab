import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { type DeploymentMode, isBetaMode } from "../../lib/deploymentMode";
import { useBetaProgramStatus } from "../../lib/useBetaProgram";

export type PricingFrequency = "monthly" | "annual";

type PricingSectionProps = {
  frequency?: PricingFrequency;
  mode: DeploymentMode;
  onFrequencyChange?: (next: PricingFrequency) => void;
  showComparison?: boolean;
};

type PricingPlan = {
  cta: string;
  description: string;
  features: string[];
  highlight?: string;
  monthlyPrice: number;
  name: string;
};

type FaqItem = {
  answer: string;
  question: string;
};

const PRODUCTION_PLANS: PricingPlan[] = [
  {
    cta: "Get Started",
    description: "Solo traders validating first repeatable process.",
    features: ["1 account", "3 sessions", "100 trades", "Basic stats"],
    monthlyPrice: 0,
    name: "Starter",
  },
  {
    cta: "Start Pro →",
    description: "Unlimited sessions, reports, analytics, strategy tracking.",
    features: ["Unlimited accounts", "Unlimited sessions", "Unlimited trades", "All analytics"],
    highlight: "Most Popular",
    monthlyPrice: 29,
    name: "Pro",
  },
  {
    cta: "Contact Us",
    description: "Desk mode with API access, priority support, team seats.",
    features: ["Everything in Pro", "Priority support", "Team access (3)", "API access"],
    monthlyPrice: 59,
    name: "Trader+",
  },
];

const COMPARISON_ROWS = [
  { feature: "Replay sessions", starter: "3", pro: "Unlimited", traderPlus: "Unlimited" },
  { feature: "Trade journal", starter: "Basic", pro: "Advanced", traderPlus: "Advanced" },
  { feature: "Analytics", starter: "Core", pro: "Full suite", traderPlus: "Full suite" },
  { feature: "Strategy library", starter: "1", pro: "Unlimited", traderPlus: "Unlimited" },
  { feature: "API access", starter: "—", pro: "—", traderPlus: "Included" },
];

export const pricingFaqItems: FaqItem[] = [
  {
    question: "What happens during beta?",
    answer:
      "Beta users get full product access while EdgeLab hardens replay, journaling, analytics, auth, and billing edges. Feedback loop stays direct and fast.",
  },
  {
    question: "Can I bring my own CSV data?",
    answer:
      "Yes. EdgeLab already supports dataset-root imports plus instrument/timeframe metadata. Landing flow points users into that existing replay stack.",
  },
  {
    question: "Do I need a credit card?",
    answer:
      "No card for beta. Production plans keep a 14-day trial and monthly or annual billing cadence.",
  },
  {
    question: "Will beta accounts keep history after launch?",
    answer:
      "No guarantee. Beta data is temporary test data and will be pruned after beta ends, so keep anything important in your own export too.",
  },
];

function priceForFrequency(monthlyPrice: number, frequency: PricingFrequency) {
  if (frequency === "monthly") {
    return monthlyPrice;
  }

  return Math.round(monthlyPrice * 12 * 0.7);
}

function formatCadence(price: number, frequency: PricingFrequency) {
  if (price === 0) {
    return "/mo";
  }

  return frequency === "monthly" ? "/mo" : "/yr";
}

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="grid gap-3">
      {items.map((item, index) => {
        const isOpen = index === openIndex;

        return (
          <div
            key={item.question}
            className="overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.03]"
          >
            <button
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              onClick={() => setOpenIndex(isOpen ? -1 : index)}
              type="button"
            >
              <span className="text-base font-semibold text-white">{item.question}</span>
              <ChevronDown
                className={`shrink-0 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`}
                size={18}
              />
            </button>
            {isOpen ? (
              <div className="border-t border-white/10 px-5 py-4 text-sm leading-7 text-slate-400">
                {item.answer}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function PricingSection({
  frequency = "monthly",
  mode,
  onFrequencyChange,
  showComparison = true,
}: PricingSectionProps) {
  const { loading, program } = useBetaProgramStatus();

  if (isBetaMode(mode)) {
    const seatsTaken = program.seats_taken ?? 0;
    const seatsRemaining = program.seats_remaining;
    const waitlistCount = program.waitlist_count;
    const fillRatio = Math.min(1, seatsTaken / Math.max(program.seats_total, 1));

    return (
      <div className="grid gap-6">
        <div className="rounded-[30px] border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(50,211,238,0.18),rgba(255,255,255,0.035))] p-6 shadow-card">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/70">
                Beta Access
              </div>
              <div className="mt-2 text-display text-4xl text-white">Free during beta</div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                Full backtesting engine, unlimited sessions, strategy management,
                analytics, reports, journal, CSV import. Limited-seat cohort while
                replay polish, auth, and billing move from beta track to production.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  "Full backtesting engine",
                  "Unlimited sessions & trades",
                  "All analytics & reports",
                  "Strategy management",
                  "Trade journal & notebook",
                  "CSV import for any instrument",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200"
                  >
                    {feature}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/25 p-5">
              <div className="text-sm text-slate-400">Seats remaining</div>
              <div className="mt-2 text-display text-5xl text-cyan-100">
                {loading || seatsRemaining == null ? "..." : seatsRemaining}
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-teal-200"
                  style={{ width: `${Math.max(fillRatio * 100, 12)}%` }}
                />
              </div>
              <div className="mt-3 text-sm text-slate-300">
                {loading || program.seats_taken == null
                  ? "Pulling live cohort count"
                  : `${program.seats_taken}/${program.seats_total} seats claimed`}
              </div>
              <div className="mt-6 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                Waitlist auto-opens at capacity. Beta data will be pruned after beta ends. Current waitlist: {waitlistCount == null ? "syncing" : waitlistCount}.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm text-slate-400">Billing cadence</div>
          <div className="mt-1 text-lg font-semibold text-white">
            Save 30% with annual billing
          </div>
        </div>
        <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1 text-sm">
          {(["monthly", "annual"] as const).map((value) => (
            <button
              key={value}
              className={`rounded-full px-4 py-2 transition ${
                frequency === value
                  ? "bg-cyan-300 text-slate-950"
                  : "text-slate-300 hover:text-white"
              }`}
              onClick={() => onFrequencyChange?.(value)}
              type="button"
            >
              {value === "monthly" ? "Monthly" : "Annual"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {PRODUCTION_PLANS.map((plan) => {
          const price = priceForFrequency(plan.monthlyPrice, frequency);

          return (
            <div
              key={plan.name}
              className={`relative overflow-hidden rounded-[28px] border p-6 shadow-card ${
                plan.highlight
                  ? "border-cyan-300/30 bg-[linear-gradient(180deg,rgba(50,211,238,0.18),rgba(255,255,255,0.05))]"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              {plan.highlight ? (
                <div className="absolute right-4 top-4 rounded-full bg-cyan-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-950">
                  {plan.highlight}
                </div>
              ) : null}

              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
                {plan.name}
              </div>
              <div className="mt-4 flex items-end gap-2">
                <div className="text-display text-5xl text-white">${price}</div>
                <div className="pb-1 text-sm text-slate-400">{formatCadence(price, frequency)}</div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">{plan.description}</p>
              <div className="mt-6 grid gap-3">
                {plan.features.map((feature) => (
                  <div
                    key={feature}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200"
                  >
                    {feature}
                  </div>
                ))}
              </div>
              <button
                className={`mt-6 inline-flex w-full items-center justify-center rounded-full px-4 py-3 text-sm font-semibold transition ${
                  plan.highlight
                    ? "bg-cyan-300 text-slate-950 hover:-translate-y-0.5"
                    : "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-cyan-300/30 hover:text-cyan-100"
                }`}
                type="button"
              >
                {plan.cta}
              </button>
            </div>
          );
        })}
      </div>

      {showComparison ? (
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-[minmax(180px,1.4fr)_1fr_1fr_1fr] border-b border-white/10 px-5 py-4 text-sm font-semibold text-slate-300">
            <div>Feature</div>
            <div>Starter</div>
            <div>Pro</div>
            <div>Trader+</div>
          </div>
          {COMPARISON_ROWS.map((row) => (
            <div
              key={row.feature}
              className="grid grid-cols-[minmax(180px,1.4fr)_1fr_1fr_1fr] border-b border-white/5 px-5 py-4 text-sm text-slate-300 last:border-b-0"
            >
              <div className="text-slate-100">{row.feature}</div>
              <div>{row.starter}</div>
              <div>{row.pro}</div>
              <div>{row.traderPlus}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
