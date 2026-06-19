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
  return searchParams.get("from") || "/app";
}

export function AuthSignInPage() {
  const location = useLocation();
  const fromPath = useFromPath();
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
    window.location.href = buildGoogleAuthorizeUrl(fromPath, config.google_client_id);
  };

  return (
    <MarketingShell
      navItems={[
        { href: "/#proof", label: "Proof" },
        { href: "/#features", label: "Features" },
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
                Beta Access
              </div>
              <h1 className="text-display mt-4 text-5xl text-white">
                Enter beta through Google. Waitlist follows same gate.
              </h1>
              <p className="mt-5 text-lg leading-8 text-slate-200">
                Beta access is OAuth-only now. If seats are full, same Google sign-in drops you into
                waitlist. Beta data stays temporary and can be pruned when beta closes.
              </p>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                {
                  icon: Sparkles,
                  label: "Beta seats",
                  value: loading || seatsRemaining == null ? "syncing" : `${seatsRemaining} left`,
                },
                { icon: LockKeyhole, label: "Auth gate", value: "Google OAuth" },
                { icon: DatabaseZap, label: "Data retention", value: "Pruned after beta" },
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
                Beta gate live. {program.seats_taken == null ? "Live cohort syncing." : `${program.seats_taken}/${program.seats_total} seats claimed.`}
                {seatsRemaining == null || seatsRemaining > 0
                  ? " Seats open now."
                  : ` Seats full. Waitlist collecting ${waitlistCount ?? 0} traders.`} Google sign-in handles both.
              </div>
            ) : null}
          </div>

          <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8 shadow-card backdrop-blur-xl">
            <div className="text-sm text-slate-400">Access EdgeLab beta</div>
            <div className="mt-2 text-3xl font-semibold text-white">
              {waitlistMode ? "Beta full. Join waitlist with Google." : "Continue with Google"}
            </div>

            <div className="mt-6 grid gap-4">
              <div className="rounded-[24px] border border-white/10 bg-black/25 p-5 text-sm leading-7 text-slate-300">
                <div className="flex items-center gap-2 text-slate-100">
                  <Chrome size={15} />
                  OAuth-only beta gate
                </div>
                <div className="mt-2">
                  Every beta seat and waitlist signup now runs through Google. Manual email access is
                  closed so cohort identity stays consistent between builds.
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[20px] border border-white/10 bg-black/25 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Redirect</div>
                  <div className="mt-2 font-data text-sm text-white">{fromPath}</div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-black/25 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Scope</div>
                  <div className="mt-2 font-data text-sm text-white">openid email profile</div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-black/25 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Fallback</div>
                  <div className="mt-2 font-data text-sm text-white">
                    {config.manual_access_enabled ? "Manual open" : "Manual closed"}
                  </div>
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
                Beta seats full. Google sign-in still works. Current queue: {waitlistCount == null ? "syncing" : waitlistCount} traders.
              </div>
            ) : null}

            <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 px-4 py-4 text-sm leading-7 text-amber-100">
              Beta rule: export anything critical. Workspace data can be pruned once beta closes.
            </div>

            {errorMessage ? (
              <div className="mt-5 rounded-[22px] border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm leading-7 text-rose-100">
                {errorMessage}
              </div>
            ) : null}

            <p className="mt-6 text-sm leading-7 text-slate-400">
              Need access?{" "}
              {seatsRemaining == null || seatsRemaining > 0 ? "Use Google entry now," : "Use Google waitlist now,"}{" "}
              or jump back to{" "}
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
