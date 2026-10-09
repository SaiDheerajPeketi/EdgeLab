import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { deploymentMode, type DeploymentMode, isBetaMode } from "../../lib/deploymentMode";
import { buildMarketingCta } from "../../lib/marketingCta";
import { useBetaProgramStatus } from "../../lib/useBetaProgram";
import { ProPricing } from "./ProPricing";

type PricingSectionProps = {
  mode: DeploymentMode;
  showComparison?: boolean;
};

type FaqItem = {
  answer: string;
  question: string;
};

const INCLUDED_BETA_WORKFLOW = [
  "Manual bar replay and simulated order management",
  "Journal records, reports, and playbook review",
  "Backtest CSV import with preview and row reporting",
  "JSON data exports with an active paid subscription",
] as const;

const ACCESS_COMPARISON = [
  { area: "Price", beta: "Free workspace for approved beta users", production: "EdgeLab Pro, with current prices below" },
  { area: "Billing frequency", beta: "No card required for beta workspace access", production: "Monthly or yearly subscription" },
  { area: "Replay and review", beta: "Replay, Journal, reports, and playbooks", production: "The connected chart, replay, and review workspace" },
  { area: "Market data", beta: "Imported datasets", production: "Imported datasets; provider licences remain separate" },
  { area: "Data exports", beta: "Active paid subscription required", production: "JSON, CSV, and chart-image exports with an active paid subscription" },
] as const;

const betaFaqItems: FaqItem[] = [
  {
    question: "What happens during beta?",
    answer:
      "Approved users can practice replay, journal trades, review reports, and build playbooks in the beta workspace.",
  },
  {
    question: "Can I bring my own CSV data?",
    answer:
      "Yes. EdgeLab supports imported datasets with instrument and timeframe metadata, plus a separate backtest trade importer with preview, column mapping, and skipped-row reporting.",
  },
  {
    question: "Do I need a credit card?",
    answer:
      "No card is required for the approved beta workspace. Optional Pro subscriptions use Stripe checkout; an active paid subscription is required for data exports, including during beta.",
  },
  {
    question: "Will beta accounts keep history after launch?",
    answer:
      "There is no retention guarantee for beta data. Treat it as test material and separately retain important records. JSON exports require an active paid subscription; large market-data files are not included.",
  },
  {
    question: "Does EdgeLab connect to my broker or data provider?",
    answer:
      "Imported datasets work without a broker connection. Live connections depend on a supported adapter, configured credentials, and provider permissions. The workspace shows connection availability and errors.",
  },
  {
    question: "Can I use my own indicators?",
    answer:
      "Yes. Choose from the indicator library or run supported Pine scripts with custom inputs on loaded chart data. The script editor shows supported outputs and any limitations for your script.",
  },
];

const publicFaqItems: FaqItem[] = [
  { question: "What is included in Pro?", answer: "Pro connects charting, manual replay and simulated orders, journaling, reports, playbooks, backtest trade imports, and supported Pine scripts with custom inputs." },
  { question: "How does billing work?", answer: "Choose a monthly or yearly Pro subscription. The current price and renewal cadence are shown before you continue to Stripe checkout. There is no free trial. Access starts after EdgeLab verifies an active paid subscription; a checkout return page alone does not activate a plan." },
  { question: "Can I change or cancel my subscription?", answer: "Open Account and choose Manage billing to use Stripe’s customer portal. When cancellation is scheduled for the end of a billing period, access continues until that period ends. Signing out does not cancel a subscription." },
  { question: "Can I bring my own CSV data?", answer: "Yes. Import market datasets with instrument and timeframe metadata, or import backtest trades with preview, column mapping, and skipped-row reporting. Market-data rights and provider licences remain your responsibility." },
  { question: "Can I export my data?", answer: "An active paid subscription enables application-data JSON, trade CSV, and chart-image exports. Large market-data files are not included in the JSON bundle. Keep separate copies of important records; exports are unavailable after paid access ends." },
  { question: "Does Pro include live data and AI?", answer: "Pro includes the software workspace. Live feeds, broker connections, and AI services use your own accounts and may charge separately. Order-flow views use individual trade data; candle-only imports support candle charts." },
];

export function getPricingFaqItems(mode: DeploymentMode): FaqItem[] {
  return isBetaMode(mode) ? betaFaqItems : publicFaqItems;
}

export const pricingFaqItems = getPricingFaqItems(deploymentMode);

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
  mode,
  showComparison = true,
}: PricingSectionProps) {
  return isBetaMode(mode) ? <BetaPricingSection showComparison={showComparison} /> : <ProPricing />;
}

function BetaPricingSection({ showComparison }: { showComparison: boolean }) {
  const location = useLocation();
  const { loading, program } = useBetaProgramStatus();

  const seatsTaken = program.seats_taken ?? 0;
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const fillRatio = Math.min(1, seatsTaken / Math.max(program.seats_total, 1));
  const capacityKnown = !loading && seatsRemaining != null;
  const betaCta = buildMarketingCta({
    mode: "beta",
    search: location.search,
    seatsRemaining: capacityKnown ? seatsRemaining : null,
  });

  return (
    <div className="grid gap-10">
      <div className="rounded-el-xl border border-white/10 bg-[#061018] p-6 shadow-card sm:p-7">
        <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <h3 className="max-w-2xl text-balance text-[clamp(1.75rem,4vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.04em] text-white">
              Test the core workflow free.
            </h3>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
              Approved users can use the core beta workflow without billing.
              Beta data remains temporary; data exports require an active paid subscription.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {INCLUDED_BETA_WORKFLOW.map((feature) => (
                <div
                  key={feature}
                  className="flex min-w-0 items-start gap-2 border-t border-white/10 px-1 py-3 text-sm leading-6 text-slate-200"
                >
                  <Check aria-hidden="true" className="mt-1 shrink-0 text-cyan-200" size={15} />
                  {feature}
                </div>
              ))}
            </div>

            <Link
              className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-el-md bg-edgelab-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100"
              to={betaCta.href}
            >
              {betaCta.label}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
          </div>

          <div className="min-w-0 rounded-el-lg border border-white/10 bg-black/20 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Access
            </div>
            <div className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white">
              {loading || seatsRemaining == null ? "..." : seatsRemaining}
            </div>
            <div className="mt-1 text-sm text-slate-400">seats open</div>

            <div
              aria-label="Beta seat capacity"
              aria-valuemax={program.seats_total}
              aria-valuemin={0}
              aria-valuenow={capacityKnown ? seatsTaken : undefined}
              className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"
              role="progressbar"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-200 to-amber-300"
                style={{ width: `${capacityKnown ? fillRatio * 100 : 0}%` }}
              />
            </div>

            <div className="mt-3 text-sm text-slate-300">
              {loading || program.seats_taken == null
                ? "Syncing seat usage"
                : `${program.seats_taken}/${program.seats_total} seats claimed`}
            </div>

            <div className="mt-5 grid gap-3">
              <div className="rounded-el-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Waitlist
                </div>
                <div className="mt-2 text-lg font-semibold text-white">
                  {waitlistCount == null ? "Syncing" : `${waitlistCount} queued`}
                </div>
              </div>
              <div className="rounded-el-lg border border-white/10 bg-white/[0.03] px-4 py-3">
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
      {showComparison ? <AccessComparison /> : null}
      <ProPricing betaMode />
    </div>
  );
}

function AccessComparison() {
  return (
    <div>
      <h3 className="text-2xl font-medium tracking-[-0.025em] text-edgelab-text-primary">
        Access terms, side by side
      </h3>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-edgelab-text-secondary">
        The optional beta workspace stays free. Pro adds subscription access and paid exports.
      </p>
      <dl className="mt-7 divide-y divide-edgelab-border border-y border-edgelab-border sm:hidden" data-access-comparison-mobile>
        {ACCESS_COMPARISON.map((row) => (
          <div className="py-5" key={row.area}>
            <dt className="font-medium text-edgelab-text-primary">{row.area}</dt>
            <dd className="mt-4 text-sm leading-6 text-edgelab-text-secondary"><span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Private beta</span>{row.beta}</dd>
            <dd className="mt-4 text-sm leading-6 text-edgelab-text-secondary"><span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Production</span>{row.production}</dd>
          </div>
        ))}
      </dl>
      <div
        aria-label="Scrollable access comparison"
        className="-mx-3 mt-7 hidden overflow-x-auto px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:block sm:mx-0 sm:px-0"
        tabIndex={0}
      >
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <caption className="sr-only">Private beta and Pro subscription access comparison</caption>
          <thead>
            <tr className="border-y border-edgelab-border text-edgelab-text-secondary">
              <th className="w-1/4 px-4 py-4 font-medium" scope="col">Area</th>
              <th className="w-[37.5%] px-4 py-4 font-medium text-edgelab-text-primary" scope="col">Private beta</th>
              <th className="w-[37.5%] px-4 py-4 font-medium text-edgelab-text-primary" scope="col">Production</th>
            </tr>
          </thead>
          <tbody>
            {ACCESS_COMPARISON.map((row) => (
              <tr className="border-b border-edgelab-border align-top" key={row.area}>
                <th className="px-4 py-5 font-medium text-edgelab-text-primary" scope="row">{row.area}</th>
                <td className="px-4 py-5 leading-6 text-edgelab-text-secondary">{row.beta}</td>
                <td className="px-4 py-5 leading-6 text-edgelab-text-secondary">{row.production}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
