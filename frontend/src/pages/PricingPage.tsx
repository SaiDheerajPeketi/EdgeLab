import { useState } from "react";
import {
  FaqAccordion,
  PricingSection,
  pricingFaqItems,
  type PricingFrequency,
} from "../components/marketing/PricingSection";
import { MarketingShell } from "../components/marketing/MarketingShell";
import { deploymentMode, isBetaMode } from "../lib/deploymentMode";

export function PricingPage() {
  const [frequency, setFrequency] = useState<PricingFrequency>("monthly");

  return (
    <MarketingShell
      navItems={[
        { href: "/#features", label: "Features" },
        { href: "/pricing", label: "Pricing" },
        { href: "/#faq", label: "Docs" },
        { href: "/#beta", label: "Beta" },
      ]}
      pageTitle="pricing"
    >
      <section className="px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pb-24 lg:pt-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">
              Pricing
            </div>
            <h1 className="text-display mt-4 text-5xl text-white sm:text-6xl">
              {isBetaMode(deploymentMode)
                ? "Beta cohort first. Billing gate staged next."
                : "Plans that scale from solo validation to desk-grade review."}
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Deployment mode controls pricing output. Beta shows free access and seat
              pressure. Production flips into Starter, Pro, and Trader+ with annual savings.
            </p>
          </div>

          <div className="mt-12">
            <PricingSection
              frequency={frequency}
              mode={deploymentMode}
              onFrequencyChange={setFrequency}
              showComparison
            />
          </div>
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">FAQ</div>
            <h2 className="text-display mt-4 text-4xl text-white">Still not sure?</h2>
            <p className="mt-4 text-base leading-8 text-slate-400">
              EdgeLab still moving from staged beta entry to full auth and billing. These answers
              explain current rollout posture.
            </p>
          </div>
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>
    </MarketingShell>
  );
}
