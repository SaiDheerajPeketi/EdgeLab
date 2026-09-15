import { ArrowRight, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router-dom";
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
    features: ["1 account", "3 sessions", "100 trades", "Core stats"],
    monthlyPrice: 0,
    name: "Starter",
  },
  {
    cta: "Start Pro",
    description: "Unlimited replay, analytics, and review flow.",
    features: ["Unlimited accounts", "Unlimited sessions", "Unlimited trades", "All analytics"],
    highlight: "Most Popular",
    monthlyPrice: 29,
    name: "Pro",
  },
  {
    cta: "Contact Us",
    description: "Desk mode with API access, team seats, and priority support.",
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
      "Beta users get full product access while EdgeLab collects feedback on replay, journaling, analytics, and review flow.",
  },
  {
    question: "Can I bring my own CSV data?",
    answer:
      "Yes. EdgeLab supports dataset-root imports plus instrument and timeframe metadata, so beta users can test on their own data.",
  },
  {
    question: "Do I need a credit card?",
    answer:
      "No card is required during private beta. Production billing and trial details will be confirmed before launch.",
  },
  {
    question: "Will beta accounts keep history after launch?",
    answer:
      "No guarantee. Beta data is temporary test data and may be pruned after beta ends, so export anything critical.",
  },
  {
    question: "Does EdgeLab connect to my broker or data provider?",
    answer:
      "The current beta centers on imported datasets. Broker synchronization and broader provider connections remain roadmap work and are not marketed as live integrations.",
  },
  {
    question: "Are Quant, footprint, and TPO available now?",
    answer:
      "Not yet. Quant, footprint, and TPO are planned capabilities. Footprint and auction views require qualified bid/ask market data before they can ship responsibly.",
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
  const [openIndex, setOpenIndex] = useState(-1);
  const idPrefix = useId();

  return (
    <div className="grid gap-3">
      {items.map((item, index) => {
        const isOpen = index === openIndex;

        return (
          <section
            key={item.question}
            className="border-b border-edgelab-border"
          >
            <h3>
              <button
                aria-controls={`${idPrefix}-answer-${index}`}
                aria-expanded={isOpen}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-5 text-left text-base font-medium tracking-[-0.02em] text-edgelab-text-primary transition-colors hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200 sm:text-lg"
                id={`${idPrefix}-question-${index}`}
                onClick={() => setOpenIndex(isOpen ? -1 : index)}
                type="button"
              >
                <span>{item.question}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`shrink-0 text-edgelab-text-secondary transition-transform duration-200 ease-el-out motion-reduce:transition-none ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  size={18}
                />
              </button>
            </h3>
            {isOpen ? (
              <div
                aria-labelledby={`${idPrefix}-question-${index}`}
                className="max-w-3xl pb-6 pr-10 text-sm leading-7 text-edgelab-text-secondary"
                id={`${idPrefix}-answer-${index}`}
                role="region"
              >
                {item.answer}
              </div>
            ) : null}
          </section>
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
    const capacityKnown = !loading && seatsRemaining != null;
    const betaCtaLabel = capacityKnown && seatsRemaining <= 0 ? "Join waitlist" : "Join beta";
    const betaCtaHref = capacityKnown && seatsRemaining <= 0
      ? "/auth/signin?waitlist=1"
      : "/auth/signin";

    return (
      <div className="grid gap-6">
        <div className="rounded-[32px] border border-white/10 bg-[#061018] p-6 shadow-card sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
                Private beta
              </div>
              <div className="mt-3 text-[2.6rem] font-semibold tracking-[-0.06em] text-white">
                Test the core workflow free.
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                Replay, Journal, reports, and playbooks remain open to approved users while
                EdgeLab validates the product. Beta data is temporary test data.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {[
                  "Unlimited sessions and trades",
                  "Full analytics and reports",
                  "Strategy and playbook tracking",
                  "CSV import and persistent storage",
                ].map((feature) => (
                  <div
                    key={feature}
                    className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200"
                  >
                    {feature}
                  </div>
                ))}
              </div>

              <Link
                className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-el-md bg-edgelab-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100"
                to={betaCtaHref}
              >
                {betaCtaLabel}
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
            </div>

            <div className="rounded-[26px] border border-white/10 bg-black/20 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Access
              </div>
              <div className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-white">
                {loading || seatsRemaining == null ? "..." : seatsRemaining}
              </div>
              <div className="mt-1 text-sm text-slate-400">seats open</div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-200 to-amber-300"
                  style={{ width: `${Math.max(fillRatio * 100, 10)}%` }}
                />
              </div>

              <div className="mt-3 text-sm text-slate-300">
                {loading || program.seats_taken == null
                  ? "Syncing seat usage"
                  : `${program.seats_taken}/${program.seats_total} seats claimed`}
              </div>

              <div className="mt-5 grid gap-3">
                <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Waitlist
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {waitlistCount == null ? "Syncing" : `${waitlistCount} queued`}
                  </div>
                </div>
                <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Data
                  </div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    Temporary beta workspace
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-[#071018] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm text-slate-400">Billing cadence</div>
          <div className="mt-1 text-lg font-semibold tracking-[-0.02em] text-white">
            Save 30% with annual billing
          </div>
        </div>
        <div className="inline-flex rounded-full border border-white/10 bg-black/25 p-1 text-sm">
          {(["monthly", "annual"] as const).map((value) => (
            <button
              key={value}
              className={`rounded-full px-4 py-2 transition duration-200 ease-out ${
                frequency === value
                  ? "bg-cyan-300 text-ink-950"
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
              className={`relative overflow-hidden rounded-[30px] border p-6 shadow-panel ${
                plan.highlight
                  ? "border-cyan-300/25 bg-[linear-gradient(160deg,rgba(50,211,238,0.12),rgba(255,255,255,0.03),rgba(245,158,11,0.08))]"
                  : "border-white/10 bg-[#071018]"
              }`}
            >
              {plan.highlight ? (
                <div className="absolute right-4 top-4 rounded-full border border-cyan-300/25 bg-cyan-300/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-50">
                  {plan.highlight}
                </div>
              ) : null}

              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {plan.name}
              </div>
              <div className="mt-4 flex items-end gap-2">
                <div className="text-[3rem] font-semibold tracking-[-0.07em] text-white">
                  ${price}
                </div>
                <div className="pb-2 text-sm text-slate-400">{formatCadence(price, frequency)}</div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">{plan.description}</p>
              <div className="mt-6 grid gap-3">
                {plan.features.map((feature) => (
                  <div
                    key={feature}
                    className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200"
                  >
                    {feature}
                  </div>
                ))}
              </div>
              <button
                className={`mt-6 inline-flex w-full items-center justify-center rounded-full px-4 py-3 text-sm font-semibold transition duration-200 ease-out ${
                  plan.highlight
                    ? "bg-cyan-300 text-ink-950 hover:-translate-y-0.5"
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
        <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[#071018] shadow-panel">
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
