import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildMarketingNavItems, MarketingShell } from "../components/marketing/MarketingShell";
import { isBetaMode } from "../lib/deploymentMode";

function LegalSection({
  title,
  body,
}: {
  body: string;
  title: string;
}) {
  return (
    <section className="border-t border-edgelab-border py-8 first:border-t-0 first:pt-0">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-edgelab-text-primary">{title}</h2>
      <p className="mt-4 max-w-3xl text-base leading-8 text-edgelab-text-secondary">{body}</p>
    </section>
  );
}

function LegalPageFrame({
  eyebrow,
  kind,
  title,
  description,
  children,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  kind: "privacy" | "terms";
  title: string;
}) {
  return (
    <MarketingShell
      navItems={buildMarketingNavItems("inner")}
      pageDescription={description}
      pageTitle={title.toLowerCase()}
    >
      <section className="px-4 pb-24 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="mx-auto max-w-5xl">
          <nav aria-label="Legal documents" className="mb-10 flex gap-2">
            {[
              { href: "/privacy", label: "Privacy", value: "privacy" },
              { href: "/terms", label: "Terms", value: "terms" },
            ].map((item) => (
              <Link
                aria-current={kind === item.value ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-el-md border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                  kind === item.value
                    ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                    : "border-edgelab-border bg-edgelab-surface text-edgelab-text-secondary hover:border-cyan-300/30 hover:text-edgelab-text-primary"
                }`}
                key={item.href}
                to={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="grid gap-8 border-b border-edgelab-border pb-12 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
            <div className="max-w-3xl">
              <h1 className="text-balance text-[clamp(3rem,7vw,5.75rem)] font-medium leading-[0.92] tracking-[-0.04em] text-edgelab-text-primary">{title}</h1>
              <p className="mt-6 text-lg leading-8 text-edgelab-text-secondary">{description}</p>
            </div>
            <p className="text-sm leading-7 text-edgelab-text-secondary lg:border-l lg:border-edgelab-border lg:pl-6">
              {eyebrow} · {isBetaMode() ? "Private beta workspace and optional Pro subscriptions." : "EdgeLab software, account access, and recurring subscriptions."}
            </p>
          </div>

          <article className="mt-12 max-w-4xl">{children}</article>
        </div>
      </section>
    </MarketingShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalPageFrame
      description="How EdgeLab handles account identity, workspace records, subscription information, and data exports."
      eyebrow="Legal"
      kind="privacy"
      title="Privacy Policy"
    >
      <LegalSection
        title="Sign-in and identity"
        body="Google handles Google-account credentials. EdgeLab stores the verified provider identity, name, email, and sign-in/session information needed to authenticate your account. Beta enrollment state is also stored when the optional beta program is enabled. Account identity and paid access are verified separately."
      />
      <LegalSection
        title="Workspace data"
        body="Workspace records may include replay sessions, notes, trades, analytics context, playbooks, and application settings. Saved application records belong to the authenticated account. Beta records remain test material; EdgeLab should not be your only archive of important trading information."
      />
      <LegalSection
        title="Subscription information"
        body="Stripe processes hosted checkout and billing management. EdgeLab stores the provider customer and subscription identifiers, billing cadence, subscription status, and verification information needed to manage access. Workspace data imports and exports exclude these billing records. EdgeLab does not collect card details in its own checkout form."
      />
      <LegalSection
        title="Export and retention"
        body="Users with an active paid subscription can export EdgeLab application data as JSON. Large market-data files are not included in that bundle. Beta data may be pruned after beta ends; separately retain important records if exports are unavailable. Operational logs may be retained longer for security and support."
      />
      <LegalSection
        title="Access boundary"
        body="A valid session verifies account identity. Production workspace access also requires an active paid subscription; the optional beta workspace requires approval. Data exports require a verified live active subscription in either mode. Sessions should not be shared."
      />
    </LegalPageFrame>
  );
}

export function TermsPage() {
  return (
    <LegalPageFrame
      description="Terms for EdgeLab’s chart, replay, and review software, recurring subscriptions, and provider integrations."
      eyebrow="Legal"
      kind="terms"
      title="Terms of Use"
    >
      <LegalSection
        title="Software access"
        body="EdgeLab Pro provides access to its chart, replay, journal, and review workspace after an active paid subscription is verified. The optional private beta is a separate, capped approval program. Native Pine execution remains experimental; compatible script behaviour must be checked before relying on its output."
      />
      <LegalSection
        title="No financial advice"
        body="EdgeLab provides simulated replay, research, and journaling software only. It does not place live trades or provide investment, trading, tax, or legal advice. You remain responsible for every trading and risk decision."
      />
      <LegalSection
        title="Account access"
        body="Production access requires verified Google identity and an active paid subscription. Beta workspace access may be limited by cohort size and waitlist state. Account billing management and sign-out remain available without paid workspace access. Access may be suspended to protect account security or service integrity."
      />
      <LegalSection
        title="Billing and cancellation"
        body="Pro subscriptions renew at the monthly or yearly cadence selected in checkout, with no free trial. The current price and currency are displayed before purchase; review the final amount in Stripe before confirming. Manage an existing subscription through Account and Stripe’s customer portal. A cancellation scheduled for the end of the billing period retains access until that period ends. Signing out does not cancel billing."
      />
      <LegalSection
        title="Data expectations"
        body="Do not treat beta workspace storage as permanent recordkeeping. Users are responsible for separately retaining important information before beta ends. Application-data exports require an active paid subscription, including during beta. Large market-data files are not part of the export."
      />
      <LegalSection
        title="Providers and planned features"
        body="The subscription covers EdgeLab software. Imported datasets require appropriate usage rights. Live data, broker synchronization, and Quant/AI depend on supported adapters, configured credentials, permissions, and any provider charges. Footprint and TPO require qualified trade-level data. A roadmap entry does not promise an available feature or included provider entitlement."
      />
    </LegalPageFrame>
  );
}
