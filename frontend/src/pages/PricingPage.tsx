import { useState } from "react";
import {
  FaqAccordion,
  PricingSection,
  pricingFaqItems,
  type PricingFrequency,
} from "../components/marketing/PricingSection";
import { buildMarketingNavItems, MarketingShell } from "../components/marketing/MarketingShell";
import { deploymentMode, isBetaMode } from "../lib/deploymentMode";

export function PricingPage() {
  const [frequency, setFrequency] = useState<PricingFrequency>("monthly");

  return (
    <MarketingShell
      navItems={buildMarketingNavItems("inner")}
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
              Beta page tracks seats, waitlist pressure, and temporary-data policy.
              Production flips into Starter, Pro, and Trader+ with annual savings later.
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

      <section id="proof" className="px-4 pb-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">Proof</div>
            <h2 className="text-display mt-4 text-4xl text-white">Pricing does not hide product proof.</h2>
            <p className="mt-4 text-base leading-8 text-slate-400">
              Replay, journaling, analytics, and strategy review are already in product. Pricing page
              should show what beta users are evaluating, not interrupt it.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {[
              {
                title: "Replay stack",
                body: "Candle-by-candle execution, order management, pending orders, and review flow already run inside protected workspace.",
              },
              {
                title: "Research memory",
                body: "Trade notes, playbooks, mistake tags, and filtered review convert sessions into repeatable evidence.",
              },
              {
                title: "Runtime persistence",
                body: "Beta user and workspace records persist through Docker-backed API storage instead of disappearing on routine rebuilds.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-card"
              >
                <div className="text-2xl font-semibold text-white">{item.title}</div>
                <p className="mt-4 text-sm leading-7 text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">FAQ</div>
            <h2 className="text-display mt-4 text-4xl text-white">Still not sure?</h2>
            <p className="mt-4 text-base leading-8 text-slate-400">
              EdgeLab still moving from beta entry to full auth and billing. These answers
              explain current rollout posture and what beta testers should expect.
            </p>
          </div>
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>
    </MarketingShell>
  );
}
