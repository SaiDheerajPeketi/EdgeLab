import { ArrowLeft, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { EdgeLabWordmark } from "../marketing/MarketingShell";

type AuthJourneyTone = "accent" | "neutral" | "warning";

type AuthJourneyShellProps = {
  children: ReactNode;
  description: string;
  rail?: ReactNode;
  statusLabel: string;
  statusTone?: AuthJourneyTone;
  title: string;
};

const STATUS_STYLES: Record<AuthJourneyTone, string> = {
  accent: "bg-cyan-300/12 text-cyan-100",
  neutral: "bg-edgelab-surface-2 text-edgelab-text-secondary",
  warning: "bg-amber-300/12 text-amber-100",
};

export function AuthJourneyShell({
  children,
  description,
  rail,
  statusLabel,
  statusTone = "neutral",
  title,
}: AuthJourneyShellProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} · EdgeLab`;
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-edgelab-base text-edgelab-text-primary">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_12%,rgba(50,211,238,0.12),transparent_27%),linear-gradient(180deg,var(--bg-base)_0%,#07090d_100%)]"
      />

      <div className="relative mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link aria-label="EdgeLab home" className="rounded-el-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" to="/">
            <EdgeLabWordmark showTagline={false} />
          </Link>
          <Link
            className="inline-flex min-h-11 items-center gap-2 rounded-el-md px-3 text-sm text-edgelab-text-secondary transition-colors hover:bg-edgelab-surface hover:text-edgelab-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200"
            to="/"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            <span className="hidden sm:inline">Back to product</span>
            <span className="sm:hidden">Back</span>
          </Link>
        </header>

        <main className="flex flex-1 items-center py-10 sm:py-14">
          <div className="w-full border-y border-edgelab-border bg-edgelab-surface shadow-panel">
            <div className={`grid ${rail ? "lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]" : ""}`}>
              <section className="px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
                <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${STATUS_STYLES[statusTone]}`}>
                  <ShieldCheck aria-hidden="true" size={14} />
                  {statusLabel}
                </div>
                <h1
                  className="mt-6 max-w-3xl text-balance text-[clamp(2.4rem,7vw,4.75rem)] font-medium leading-[0.95] tracking-[-0.04em] text-edgelab-text-primary outline-none"
                  ref={headingRef}
                  tabIndex={-1}
                >
                  {title}
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-edgelab-text-secondary sm:text-lg sm:leading-8">
                  {description}
                </p>
                <div className="mt-8">{children}</div>
              </section>

              {rail ? (
                <aside className="border-t border-edgelab-border bg-edgelab-base px-5 py-8 sm:px-8 lg:border-l lg:border-t-0 lg:px-8 lg:py-12">
                  {rail}
                </aside>
              ) : null}
            </div>
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-edgelab-border pt-5 text-xs text-edgelab-text-secondary">
          <span>Research and journaling software. Not financial advice.</span>
          <nav aria-label="Legal" className="flex items-center gap-4">
            <Link className="hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" to="/privacy">Privacy</Link>
            <Link className="hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" to="/terms">Terms</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
