import type { ReactNode } from "react";
import { MarketingShell } from "../components/marketing/MarketingShell";

function LegalSection({
  title,
  body,
}: {
  body: string;
  title: string;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-card">
      <h2 className="text-2xl font-semibold text-white">{title}</h2>
      <p className="mt-4 text-sm leading-7 text-slate-300">{body}</p>
    </section>
  );
}

function LegalPageFrame({
  eyebrow,
  title,
  description,
  children,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <MarketingShell
      navItems={[
        { href: "/#proof", label: "Proof" },
        { href: "/pricing", label: "Pricing" },
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
      pageTitle={title.toLowerCase()}
    >
      <section className="px-4 pb-24 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="mx-auto max-w-5xl">
          <div className="max-w-3xl">
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">
              {eyebrow}
            </div>
            <h1 className="text-display mt-4 text-5xl text-white sm:text-6xl">{title}</h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">{description}</p>
          </div>

          <div className="mt-12 grid gap-4">{children}</div>
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
      title="Privacy Policy"
    >
      <LegalSection
        title="Identity data"
        body="EdgeLab stores Google account basics needed for beta access, including name, email, provider, sign-in timestamps, and beta enrollment state. This data is used to authenticate users, manage beta seats, and contact cohort members about beta access."
      />
      <LegalSection
        title="Workspace data"
        body="Beta workspace data may include replay sessions, notes, trades, analytics context, playbooks, and app storage records. During beta this data is considered test material, not permanent archival storage."
      />
      <LegalSection
        title="Retention"
        body="Beta data may be pruned after beta ends. Export anything important before beta closes. Operational logs and deployment records may be retained longer for security and support reasons."
      />
      <LegalSection
        title="Infrastructure"
        body="Application runs through Docker-based deployment. Runtime data persists in Docker-backed storage for continuity across rebuilds, but that persistence does not override beta pruning policy."
      />
    </LegalPageFrame>
  );
}

export function TermsPage() {
  return (
    <LegalPageFrame
      description="Current beta participation terms while EdgeLab hardens auth, workflow, and deployment."
      eyebrow="Legal"
      title="Terms of Use"
    >
      <LegalSection
        title="Beta status"
        body="EdgeLab beta is pre-production software. Features, access rules, and data handling may change without notice while product is being validated."
      />
      <LegalSection
        title="No financial advice"
        body="EdgeLab provides research and journaling software only. It does not provide investment, trading, tax, or legal advice."
      />
      <LegalSection
        title="Account access"
        body="Beta access may be limited by cohort size, waitlist state, or abuse controls. Access may be suspended if service integrity, security, or rollout stability requires it."
      />
      <LegalSection
        title="Data expectations"
        body="Do not treat beta workspace storage as permanent recordkeeping. Users are responsible for exporting or retaining any information they consider important before beta ends."
      />
    </LegalPageFrame>
  );
}
