import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildMarketingNavItems, MarketingShell } from "../components/marketing/MarketingShell";

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
              {eyebrow} · Current private-beta policy. Product access and data handling may change before launch.
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
      description="Current beta privacy stance for sign-in, product telemetry, exports, and temporary workspace storage."
      eyebrow="Legal"
      kind="privacy"
      title="Privacy Policy"
    >
      <LegalSection
        title="Sign-in and identity"
        body="Google handles Google-account credentials. EdgeLab receives and stores the account basics needed for beta access, including name, email, provider, sign-in timestamps, and beta enrollment state. EdgeLab uses that information to authenticate users, manage beta seats, and contact cohort members about access."
      />
      <LegalSection
        title="Workspace data"
        body="Beta workspace data may include replay sessions, notes, trades, analytics context, playbooks, and app storage records. During beta this data is considered test material, not permanent archival storage."
      />
      <LegalSection
        title="Export and retention"
        body="Users with an active paid subscription can export EdgeLab application data as JSON. Large market-data files are not included in that bundle. Beta data may be pruned after beta ends; separately retain important records if exports are unavailable. Operational logs may be retained longer for security and support."
      />
      <LegalSection
        title="Access boundary"
        body="Workspace requests require a valid EdgeLab session, and saved application records are scoped to the authenticated account. A signed-in session should be treated as access to that account's beta workspace and should not be shared."
      />
    </LegalPageFrame>
  );
}

export function TermsPage() {
  return (
    <LegalPageFrame
      description="Current beta participation terms while EdgeLab hardens auth, workflow, and deployment."
      eyebrow="Legal"
      kind="terms"
      title="Terms of Use"
    >
      <LegalSection
        title="Beta status"
        body="EdgeLab beta is pre-production software. Features, access rules, and data handling may change without notice while product is being validated."
      />
      <LegalSection
        title="No financial advice"
        body="EdgeLab provides simulated replay, research, and journaling software only. It does not place live trades or provide investment, trading, tax, or legal advice. You remain responsible for every trading and risk decision."
      />
      <LegalSection
        title="Account access"
        body="Beta access may be limited by cohort size, waitlist state, or abuse controls. Access may be suspended if service integrity, security, or rollout stability requires it."
      />
      <LegalSection
        title="Data expectations"
        body="Do not treat beta workspace storage as permanent recordkeeping. Users are responsible for separately retaining important information before beta ends. Application-data exports require an active paid subscription, including during beta. Large market-data files are not part of the export."
      />
      <LegalSection
        title="Providers and planned features"
        body="The current beta centers on imported datasets. Live broker synchronization, Quant/AI, footprint, TPO, production pricing, and related provider entitlements are not promised by these terms and remain unavailable or unannounced until EdgeLab publishes otherwise."
      />
    </LegalPageFrame>
  );
}
