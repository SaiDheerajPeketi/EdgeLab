import { ArrowRight } from "lucide-react";
import { lazy, Suspense } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MarketingShell } from "../marketing/MarketingShell";
import { buildMarketingCta } from "../../lib/marketingCta";
import { isBetaMode } from "../../lib/deploymentMode";
import { useBetaProgramStatus } from "../../lib/useBetaProgram";

const PricingPage = lazy(() => import("../../pages/PricingPage").then((module) => ({ default: module.PricingPage })));
const AuthSignInRoute = lazy(() => import("../../routes/AuthSignInRoute").then((module) => ({ default: module.AuthSignInRoute })));
const AuthCallbackPage = lazy(() => import("../../pages/AuthCallbackPage").then((module) => ({ default: module.AuthCallbackPage })));
const PrivacyPage = lazy(() => import("../../pages/LegalPages").then((module) => ({ default: module.PrivacyPage })));
const TermsPage = lazy(() => import("../../pages/LegalPages").then((module) => ({ default: module.TermsPage })));
const NotFoundPage = lazy(() => import("../../pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));

// Keep account, checkout, legal text, and OAuth behavior on their canonical pages.
// Only the landing presentation is simplified; it never loads the 3D scene.
export function CompatibilityPublicRoutes() {
  return <Suspense fallback={<p className="min-h-screen bg-edgelab-base p-6 text-edgelab-text-secondary" role="status">Opening EdgeLab…</p>}><Routes>
    <Route element={<PublicHome />} path="/" />
    <Route element={<Navigate replace to="/" />} path="/index.html" />
    <Route element={<PricingPage />} path="/pricing" />
    <Route element={<AuthSignInRoute />} path="/auth/signin" />
    <Route element={<AuthCallbackPage />} path="/auth/callback/google" />
    <Route element={<PrivacyPage />} path="/privacy" />
    <Route element={<TermsPage />} path="/terms" />
    <Route element={<Navigate replace to="/app" />} path="/workspace" />
    <Route element={<NotFoundPage />} path="*" />
  </Routes></Suspense>;
}

const navItems = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/auth/signin", label: "Sign in" },
];
const workflow = [
  { title: "Replay", detail: "Move through market history one candle at a time. Keep your entry and exit decisions in context." },
  { title: "Journal", detail: "Record trades, add notes, and capture the reasoning behind each decision." },
  { title: "Review", detail: "Inspect performance and revisit your notes to understand how you traded." },
];
const actionClass = "inline-flex min-h-11 items-center justify-center gap-3 rounded-el-md bg-edgelab-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100";

function PublicHome() {
  const location = useLocation();
  const { loading, program } = useBetaProgramStatus();
  const cta = buildMarketingCta({ search: location.search, seatsRemaining: loading ? null : program.seats_remaining });
  const betaMode = isBetaMode();
  return <MarketingShell navItems={navItems} pageDescription="Replay markets, journal your trades, and review your decisions in EdgeLab." pageTitle="Replay, journal, review">
    <section className="scroll-mt-28 px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-24 lg:px-8" id="product" tabIndex={-1}>
      <div className="mx-auto max-w-7xl" data-marketing-flow="intro">
        <h1 className="max-w-5xl text-balance text-[clamp(3.25rem,8vw,6rem)] font-medium leading-[0.98] tracking-[-0.04em]">Make every trade<br /><span className="text-cyan-200">worth reviewing.</span></h1>
        <div className="mt-8 flex max-w-5xl flex-col gap-7 sm:flex-row sm:items-end sm:justify-between sm:gap-12">
          <p className="max-w-xl text-lg leading-8 text-edgelab-text-secondary">Replay the market. Record your reasoning. Return to your decisions with the context that matters.</p>
          <Link className={`${actionClass} shrink-0 self-start`} to={cta.href}>{cta.label}<ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
      </div>
    </section>
    <section className="scroll-mt-28 border-y border-edgelab-border bg-edgelab-surface px-4 py-12 sm:px-6 sm:py-16 lg:px-8" id="how-it-works" tabIndex={-1}>
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-3 md:gap-12">
        {workflow.map((item) => <div data-marketing-flow={item.title} key={item.title}><h2 className="text-3xl font-medium tracking-[-0.025em] sm:text-4xl">{item.title}</h2><p className="mt-4 max-w-sm text-sm leading-7 text-edgelab-text-secondary">{item.detail}</p></div>)}
      </div>
    </section>
    <section className="scroll-mt-28 px-4 py-16 sm:px-6 sm:py-24 lg:px-8" id="evidence" tabIndex={-1}>
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-2 md:gap-16" data-marketing-flow="records">
        <h2 className="max-w-lg text-balance text-4xl font-medium leading-tight tracking-[-0.03em] sm:text-5xl">Your trades.<br />Your reasoning.<br />One place to review.</h2>
        <div className="max-w-xl self-center"><p className="text-lg leading-8 text-edgelab-text-secondary">Keep chart context, trade records, and session notes together. Review the details behind your results, alongside the numbers.</p><p className="mt-5 text-sm leading-7 text-edgelab-text-secondary">EdgeLab is research software. Charts and analysis do not guarantee trading results.</p></div>
      </div>
    </section>
    <section className="scroll-mt-28 border-t border-edgelab-border px-4 py-12 sm:px-6 sm:py-16 lg:px-8" id="pricing" tabIndex={-1}>
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between" data-marketing-flow="access">
        <div className="max-w-xl"><h2 className="text-3xl font-medium tracking-[-0.025em]">{betaMode ? "Explore the private beta." : "Choose your workspace access."}</h2><p className="mt-4 text-sm leading-7 text-edgelab-text-secondary">{betaMode ? "Beta workspace access requires approval. Optional Pro subscriptions enable data exports." : "View current monthly and yearly prices, renewal terms, and checkout availability before subscribing."}</p></div>
        <Link className={actionClass} to="/pricing">View pricing and access<ArrowRight aria-hidden="true" size={16} /></Link>
      </div>
    </section>
    <section className="scroll-mt-28 border-t border-edgelab-border px-4 py-12 sm:px-6 sm:py-16 lg:px-8" id="faq" tabIndex={-1}>
      <div className="mx-auto max-w-7xl" data-marketing-flow="exports"><h2 className="text-2xl font-medium tracking-[-0.02em]">Can I export my records?</h2><p className="mt-4 max-w-2xl text-sm leading-7 text-edgelab-text-secondary">Data exports require a verified live active subscription, including during the beta. Review access and billing details on the pricing page.</p></div>
    </section>
  </MarketingShell>;
}
