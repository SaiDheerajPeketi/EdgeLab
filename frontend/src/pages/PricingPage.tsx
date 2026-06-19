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
    <MarketingShell navItems={buildMarketingNavItems("inner")} pageTitle="pricing">
      <section className="px-4 pb-14 pt-14 sm:px-6 lg:px-8 lg:pb-20 lg:pt-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
            <div className="max-w-4xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
                Pricing
              </div>
              <h1 className="mt-4 text-[clamp(3rem,6vw,5rem)] font-semibold leading-[0.9] tracking-[-0.07em] text-white">
                {isBetaMode(deploymentMode)
                  ? "Private beta access, limited seats."
                  : "Clear plans for replay, review, and growth."}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
                {isBetaMode(deploymentMode)
                  ? "Current phase stays simple: free access for approved beta users, waitlist once seats fill."
                  : "Choose cadence, compare plans, and see what scales from solo validation to desk-grade review."}
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#061018] p-5 shadow-panel">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Current mode
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">
                {isBetaMode(deploymentMode) ? "Private beta" : "Production pricing"}
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                {isBetaMode(deploymentMode)
                  ? "Billing stays off during the private beta track."
                  : "Annual billing discounts and full plan gating are ready here."}
              </p>
            </div>
          </div>

          <div className="mt-10">
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
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
              Included now
            </div>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-[3.2rem]">
              Product first. Pricing second.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-400">
              EdgeLab already ships replay, journal review, analytics, and strategy memory inside
              same workspace.
            </p>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {[
              {
                title: "Replay stack",
                body: "Candle replay, order flow, and chart context stay in same surface.",
              },
              {
                title: "Journal memory",
                body: "Notes, mistake tags, and playbooks stay attached to session truth.",
              },
              {
                title: "Persistent beta",
                body: "Docker-backed storage keeps beta users and workspace records across rebuilds.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-[26px] border border-white/10 bg-[#071018] p-6 shadow-panel"
              >
                <div className="text-[1.45rem] font-semibold tracking-[-0.04em] text-white">
                  {item.title}
                </div>
                <p className="mt-4 text-sm leading-7 text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 pb-24 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-100/65">
              FAQ
            </div>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-white sm:text-[3.2rem]">
              What beta users should expect.
            </h2>
            <p className="mt-4 text-base leading-8 text-slate-400">
              Short answers on beta access, imports, billing timing, and data lifecycle.
            </p>
          </div>
          <FaqAccordion items={pricingFaqItems} />
        </div>
      </section>
    </MarketingShell>
  );
}
