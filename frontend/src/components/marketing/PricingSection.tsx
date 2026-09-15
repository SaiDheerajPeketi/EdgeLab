import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { type DeploymentMode, isBetaMode } from "../../lib/deploymentMode";
import { buildMarketingCta } from "../../lib/marketingCta";
import { useBetaProgramStatus } from "../../lib/useBetaProgram";

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
  "Authenticated JSON export for EdgeLab app data",
] as const;

const ACCESS_COMPARISON = [
  { area: "Price", beta: "Free for approved beta users", production: "Not published" },
  { area: "Billing frequency", beta: "No billing or credit card", production: "Monthly and annual options not confirmed" },
  { area: "Replay and review", beta: "Current replay, Journal, reports, and playbooks", production: "Packaging and limits not confirmed" },
  { area: "Market data", beta: "Imported datasets", production: "Provider entitlements not announced" },
  { area: "Broker sync and AI", beta: "Not included in the current beta", production: "No launch commitment published" },
] as const;

export const pricingFaqItems: FaqItem[] = [
  {
    question: "What happens during beta?",
    answer:
      "Approved users can use the capabilities present in the current beta build while EdgeLab validates replay, journaling, analytics, and review. Planned features are not included simply because they appear on the roadmap.",
  },
  {
    question: "Can I bring my own CSV data?",
    answer:
      "Yes. EdgeLab supports imported datasets with instrument and timeframe metadata, plus a separate backtest trade importer with preview, column mapping, and skipped-row reporting.",
  },
  {
    question: "Do I need a credit card?",
    answer:
      "No. The private beta is free and does not collect a card. Production prices, trials, billing frequency, and renewal terms will be published before any paid plan is offered.",
  },
  {
    question: "Will beta accounts keep history after launch?",
    answer:
      "There is no retention guarantee for beta data. Treat it as test material and use the authenticated JSON export for anything important; large market-data files are not included in that bundle.",
  },
  {
    question: "Does EdgeLab connect to my broker or data provider?",
    answer:
      "The current beta centers on imported datasets. Live broker synchronization and broader provider connections are not represented as available integrations.",
  },
  {
    question: "Are Quant, footprint, and TPO available now?",
    answer:
      "No. Quant/AI, footprint, and TPO remain planned work. Footprint and auction views also require qualified bid/ask market data before they can be offered responsibly.",
  },
];

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
  const location = useLocation();
  const { loading, program } = useBetaProgramStatus();

  if (isBetaMode(mode)) {
    const seatsTaken = program.seats_taken ?? 0;
    const seatsRemaining = program.seats_remaining;
    const waitlistCount = program.waitlist_count;
    const fillRatio = Math.min(1, seatsTaken / Math.max(program.seats_total, 1));
    const capacityKnown = !loading && seatsRemaining != null;
    const betaCta = buildMarketingCta({
      search: location.search,
      seatsRemaining: capacityKnown ? seatsRemaining : null,
    });

    return (
      <div className="grid gap-10">
        <div className="rounded-el-xl border border-white/10 bg-[#061018] p-6 shadow-card sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/60">
                Private beta
              </div>
              <div className="mt-3 text-[2.6rem] font-semibold tracking-[-0.06em] text-white">
                Test the core workflow free.
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                Approved users can use the verified beta workflow without billing. Future plans
                are not inferred from roadmap features, and beta data remains temporary.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {INCLUDED_BETA_WORKFLOW.map((feature) => (
                  <div
                    key={feature}
                    className="flex items-start gap-2 border-t border-white/10 px-1 py-3 text-sm leading-6 text-slate-200"
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

            <div className="rounded-el-lg border border-white/10 bg-black/20 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Access
              </div>
              <div className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-white">
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
      </div>
    );
  }

  const launchCta = buildMarketingCta({
    forceWaitlist: true,
    search: location.search,
    seatsRemaining: null,
  });

  return (
    <div className="grid gap-10">
      <div className="grid border-y border-edgelab-border lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <section className="py-8 lg:pr-12">
          <h3 className="max-w-2xl text-3xl font-medium leading-tight tracking-[-0.03em] text-edgelab-text-primary sm:text-4xl">
            Launch pricing is not published yet.
          </h3>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-edgelab-text-secondary sm:text-base">
            EdgeLab has not opened paid plans. Prices, trials, renewal terms, limits, and
            provider entitlements will be published together before checkout exists.
          </p>
          <Link
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-el-md bg-edgelab-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-[background-color,transform] duration-200 ease-el-out hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 motion-reduce:transform-none motion-reduce:transition-none sm:w-auto"
            to={launchCta.href}
          >
            {launchCta.label}
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </section>
        <aside className="border-t border-edgelab-border py-8 lg:border-l lg:border-t-0 lg:pl-10">
          <h3 className="text-lg font-medium text-edgelab-text-primary">Billing boundary</h3>
          <dl className="mt-5 border-y border-edgelab-border text-sm">
            <div className="flex justify-between gap-6 border-b border-edgelab-border py-4">
              <dt className="text-edgelab-text-secondary">Price</dt>
              <dd className="text-right font-medium text-edgelab-text-primary">Not published</dd>
            </div>
            <div className="flex justify-between gap-6 border-b border-edgelab-border py-4">
              <dt className="text-edgelab-text-secondary">Cadence</dt>
              <dd className="text-right font-medium text-edgelab-text-primary">Not confirmed</dd>
            </div>
            <div className="flex justify-between gap-6 py-4">
              <dt className="text-edgelab-text-secondary">Card required</dt>
              <dd className="text-right font-medium text-edgelab-text-primary">No</dd>
            </div>
          </dl>
        </aside>
      </div>

      {showComparison ? <AccessComparison /> : null}
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
        Unknown launch details stay marked as unknown instead of becoming a sales promise.
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
          <caption className="sr-only">Private beta and future production access comparison</caption>
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
