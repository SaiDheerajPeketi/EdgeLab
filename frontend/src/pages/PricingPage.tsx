import { TrustEvidence } from "../components/marketing/TrustEvidence";
import {
  FaqAccordion,
  PricingSection,
  pricingFaqItems,
} from "../components/marketing/PricingSection";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "../components/marketing/MarketingShell";
import { deploymentMode, isBetaMode } from "../lib/deploymentMode";

export function PricingPage() {
  const betaMode = isBetaMode(deploymentMode);

  return (
    <MarketingShell
      navItems={buildMarketingNavItems("inner")}
      pageDescription="Current EdgeLab beta access, included workflow, known limits, and the launch pricing details that remain unpublished."
      pageTitle="Pricing and access"
    >
      <section className="px-3 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8 lg:pb-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 border-b border-edgelab-border pb-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end lg:gap-16">
            <div className="max-w-4xl">
              <p className="font-data text-xs uppercase tracking-[0.18em] text-cyan-100">
                Pricing &amp; access
              </p>
              <h1 className="mt-5 text-balance text-[clamp(3rem,7vw,5.75rem)] font-medium leading-[0.92] tracking-[-0.04em] text-edgelab-text-primary">
                Current access, without fine print.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-edgelab-text-secondary">
                {betaMode
                  ? "The private beta is free for approved users. This page separates what is included now from launch details EdgeLab has not announced."
                  : "Paid checkout is not open. EdgeLab will publish price, billing cadence, limits, and provider entitlements together before asking for a card."}
              </p>
            </div>
            <dl className="border-y border-edgelab-border text-sm">
              <div className="flex justify-between gap-6 border-b border-edgelab-border py-4">
                <dt className="text-edgelab-text-secondary">Current price</dt>
                <dd className="font-medium text-edgelab-text-primary">
                  {betaMode ? "Free beta" : "Not published"}
                </dd>
              </div>
              <div className="flex justify-between gap-6 py-4">
                <dt className="text-edgelab-text-secondary">Credit card</dt>
                <dd className="font-medium text-edgelab-text-primary">Not required</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="scroll-mt-28 px-3 pb-24 sm:px-6 sm:pb-32 lg:px-8" id="pricing" tabIndex={-1}>
        <div className="mx-auto max-w-7xl">
          <PricingSection mode={deploymentMode} showComparison />
        </div>
      </section>

      <TrustEvidence />

      <section className="scroll-mt-28 px-3 py-24 sm:px-6 sm:py-32 lg:px-8" id="faq" tabIndex={-1}>
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(260px,0.45fr)_minmax(0,1fr)] lg:gap-20">
          <div>
            <p className="font-data text-xs uppercase tracking-[0.18em] text-cyan-100">FAQ</p>
            <h2 className="mt-4 text-balance text-[clamp(2.5rem,5vw,4.6rem)] font-medium leading-[0.94] tracking-[-0.04em] text-edgelab-text-primary">
              Details before access.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-edgelab-text-secondary">
              Beta capability, billing, retention, and provider boundaries in plain language.
            </p>
          </div>
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>
    </MarketingShell>
  );
}
