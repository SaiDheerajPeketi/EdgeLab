import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import {
  buildMarketingNavItems,
  MarketingShell,
} from "../components/marketing/MarketingShell";

export function NotFoundPage() {
  return (
    <MarketingShell
      navItems={buildMarketingNavItems("inner")}
      pageDescription="The requested EdgeLab page is unavailable. Return to the public site or review current beta access."
      pageTitle="Page not found"
    >
      <section className="px-3 py-16 sm:px-6 sm:py-24 lg:px-8 lg:py-32">
        <div className="mx-auto grid max-w-6xl border-y border-edgelab-border lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.55fr)]">
          <div className="py-12 lg:pr-16 lg:py-20">
            <div className="flex items-center gap-3 font-data text-xs uppercase tracking-[0.18em] text-amber-100">
              <AlertTriangle aria-hidden="true" size={17} />
              404 / route unavailable
            </div>
            <h1 className="mt-6 max-w-3xl text-balance text-[clamp(3rem,7vw,5.75rem)] font-medium leading-[0.92] tracking-[-0.04em] text-edgelab-text-primary">
              Page not found.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-edgelab-text-secondary sm:text-lg">
              EdgeLab does not have a public route for this address. Nothing in your workspace was
              changed.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-el-md bg-edgelab-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-colors hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100"
                to="/"
              >
                Return to EdgeLab home
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center rounded-el-md border border-edgelab-border bg-edgelab-surface px-5 py-3 text-sm font-medium text-edgelab-text-primary transition-colors hover:border-cyan-300/40 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
                to="/pricing"
              >
                Review beta access
              </Link>
            </div>
          </div>
          <aside className="border-t border-edgelab-border py-10 lg:border-l lg:border-t-0 lg:px-10 lg:py-20">
            <p className="font-data text-xs uppercase tracking-[0.18em] text-cyan-100">
              Safe next step
            </p>
            <h2 className="mt-4 text-xl font-medium tracking-[-0.02em] text-edgelab-text-primary">
              Start from a known route.
            </h2>
            <p className="mt-4 text-sm leading-7 text-edgelab-text-secondary">
              Use the home page for the product overview, or pricing for current beta availability
              and limits. A valid workspace link will ask you to sign in before opening account
              data.
            </p>
          </aside>
        </div>
      </section>
    </MarketingShell>
  );
}
