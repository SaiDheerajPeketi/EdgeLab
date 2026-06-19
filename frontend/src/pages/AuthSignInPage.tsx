import { ArrowRight, Chrome, DatabaseZap, LockKeyhole, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { EdgeLabWordmark, MarketingShell } from "../components/marketing/MarketingShell";
import { isBetaMode, deploymentMode } from "../lib/deploymentMode";
import { buildGoogleAuthorizeUrl, isGoogleAuthConfigured } from "../lib/googleAuth";
import { useBetaAuthConfig } from "../lib/useBetaAuthConfig";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

function useFromPath() {
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const fromState =
    typeof location.state === "object" &&
    location.state &&
    "fromPath" in location.state &&
    typeof location.state.fromPath === "string"
      ? location.state.fromPath
      : null;

  if (fromState?.startsWith("/")) {
    return fromState;
  }

  const fromQuery = searchParams.get("from");
  return fromQuery?.startsWith("/") ? fromQuery : "/app";
}

export function AuthSignInPage() {
  const fromPath = useFromPath();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [errorMessage, setErrorMessage] = useState<string | null>(searchParams.get("error"));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { loading, program } = useBetaProgramStatus();
  const { config, error: authConfigError, loading: authConfigLoading } = useBetaAuthConfig();
  const waitlistMode = searchParams.get("waitlist") === "1";
  const googleReady = isGoogleAuthConfigured(config);
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;

  const handleGoogleSignIn = () => {
    if (!googleReady || !config.google_client_id) {
      setErrorMessage(authConfigError || "Google OAuth unavailable. Add GOOGLE_CLIENT_SECRETS_FILE on backend.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    window.location.href = buildGoogleAuthorizeUrl(
      fromPath,
      config.google_client_id,
      config.google_redirect_uri,
    );
  };

  return (
    <MarketingShell
      navItems={[
        { href: "/#proof", label: "Proof" },
        { href: "/#surface", label: "Surface" },
        { href: "/pricing", label: "Pricing" },
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ]}
      pageTitle="auth"
    >
      <section className="px-4 pb-24 pt-14 sm:px-6 lg:px-8 lg:pt-20">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,460px)]">
          <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(50,211,238,0.18),rgba(255,255,255,0.035))] p-8 shadow-card">
            <EdgeLabWordmark />
            <div className="mt-10 max-w-2xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-100/65">
                Secure access
              </div>
              <h1 className="text-display mt-4 text-5xl text-white">
                Sign in once. Enter EdgeLab fast.
              </h1>
              <p className="mt-5 text-lg leading-8 text-slate-200">
                Google sign-in unlocks EdgeLab beta. If seats are full, same path places you in
                waitlist. Beta data stays temporary and may be pruned after program ends.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: Sparkles,
                  label: "Availability",
                  value: loading || seatsRemaining == null ? "syncing" : `${seatsRemaining} left`,
                },
                { icon: LockKeyhole, label: "Access", value: "Google" },
                { icon: DatabaseZap, label: "Beta data", value: "Temporary" },
              ].map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.label}
                    className="rounded-[24px] border border-white/10 bg-black/20 p-4"
                  >
                    <Icon className="text-cyan-100" size={18} />
                    <div className="mt-4 font-data text-lg text-white">{item.value}</div>
                    <div className="mt-1 text-sm text-slate-400">{item.label}</div>
                  </div>
                );
              })}
            </div>

            {isBetaMode(deploymentMode) ? (
              <div className="mt-8 rounded-[26px] border border-amber-300/20 bg-amber-300/10 p-5 text-sm leading-7 text-amber-100">
                Beta live. {program.seats_taken == null ? "Cohort syncing." : `${program.seats_taken}/${program.seats_total} seats claimed.`}
                {seatsRemaining == null || seatsRemaining > 0
                  ? " Seats open now."
                  : ` Seats full. Waitlist live for ${waitlistCount ?? 0} traders.`} Google handles both.
              </div>
            ) : null}
          </div>

          <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8 shadow-card backdrop-blur-xl">
            <div className="text-sm text-slate-400">Access EdgeLab</div>
            <div className="mt-2 text-3xl font-semibold text-white">
              {waitlistMode ? "Beta full. Join waitlist." : "Continue with Google"}
            </div>

            <div className="mt-6 grid gap-4">
              <div className="rounded-[24px] border border-white/10 bg-black/25 p-5 text-sm leading-7 text-slate-300">
                <div className="flex items-center gap-2 text-slate-100">
                  <Chrome size={15} />
                  One clean sign-in
                </div>
                <div className="mt-2">
                  Use Google once. Approved traders go straight into workspace. If beta is full, same
                  sign-in drops into waitlist.
                </div>
              </div>

              <button
                className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                disabled={isSubmitting || authConfigLoading || !googleReady}
                onClick={handleGoogleSignIn}
                type="button"
              >
                <Chrome size={16} />
                {isSubmitting
                  ? "Redirecting to Google..."
                  : waitlistMode
                    ? "Continue to Google waitlist"
                    : "Continue with Google"}
                <ArrowRight size={14} />
              </button>
            </div>

            {waitlistMode ? (
              <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 px-4 py-4 text-sm leading-7 text-amber-100">
                Beta seats full. Google sign-in still works. Queue: {waitlistCount == null ? "syncing" : waitlistCount}.
              </div>
            ) : null}

            <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 px-4 py-4 text-sm leading-7 text-amber-100">
              Export anything critical. Beta data may be pruned after program ends.
            </div>

            {errorMessage ? (
              <div className="mt-5 rounded-[22px] border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm leading-7 text-rose-100">
                {errorMessage}
              </div>
            ) : null}

            <p className="mt-6 text-sm leading-7 text-slate-400">
              Need more context? Jump back to{" "}
              <Link className="ml-1 text-cyan-100" to="/">
                landing page
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
