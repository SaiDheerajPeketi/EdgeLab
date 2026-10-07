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

const pricingNavItems = buildMarketingNavItems("inner").map((item) => ({
  ...item,
  href: ["/#evidence", "/#pricing", "/#faq"].includes(item.href)
    ? item.href.slice(1)
    : item.href,
}));

export function PricingPage() {
  const betaMode = isBetaMode(deploymentMode);

  return (
    <MarketingShell
      navItems={pricingNavItems}
      pageDescription={betaMode ? "EdgeLab beta access and optional Pro subscriptions, with clear billing and provider requirements." : "EdgeLab Pro monthly and yearly subscriptions for charting, replay, journaling, and trade review."}
      pageTitle="Pricing and access"
    >
      <section className="px-3 pb-16 pt-14 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8 lg:pb-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 border-b border-edgelab-border pb-12 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-end lg:gap-16">
            <div className="min-w-0 max-w-4xl">
              <h1 className="text-balance text-[clamp(2.5rem,7vw,5.75rem)] font-medium leading-[0.96] tracking-[-0.04em] text-edgelab-text-primary">
                {betaMode ? "Current access, without fine print." : "One workspace. Every decision."}
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-edgelab-text-secondary">
                {betaMode
                  ? "The private beta workspace is free for approved users. Optional Pro subscriptions enable data exports; beta workspace access still requires approval."
                  : "Chart, replay, journal, and review in one connected workspace. Choose monthly or yearly billing, with the current price and renewal terms visible before checkout."}
              </p>
            </div>
            <dl className="border-y border-edgelab-border text-sm">
              <div className="flex justify-between gap-6 border-b border-edgelab-border py-4">
                <dt className="text-edgelab-text-secondary">Access</dt>
                <dd className="font-medium text-edgelab-text-primary">
                  {betaMode ? "Free beta workspace" : "EdgeLab Pro"}
                </dd>
              </div>
              <div className="flex justify-between gap-6 py-4">
                <dt className="text-edgelab-text-secondary">Billing</dt>
                <dd className="font-medium text-edgelab-text-primary">{betaMode ? "Optional Pro" : "Monthly or yearly"}</dd>
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
            <h2 className="text-balance text-[clamp(2.5rem,5vw,4.6rem)] font-medium leading-[0.96] tracking-[-0.04em] text-edgelab-text-primary">
              Details before access.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-edgelab-text-secondary">
              {betaMode ? "Beta access, optional subscriptions, and data handling in plain language." : "What your plan includes, how billing works, and where provider access begins."}
            </p>
          </div>
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>
    </MarketingShell>
  );
}
