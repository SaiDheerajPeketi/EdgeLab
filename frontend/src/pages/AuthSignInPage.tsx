import { AlertCircle, ArrowRight, Check, Chrome } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthJourneyShell } from "../components/auth/AuthJourneyShell";
import { buildGoogleAuthorizeUrl, isGoogleAuthConfigured } from "../lib/googleAuth";
import { requestDevAuthBypass } from "../lib/api";
import { getStoredAuthSession, setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
import { authDestinationFromLocation, authJourneyIssue } from "../lib/authJourney";
import { useBetaAuthConfig } from "../lib/useBetaAuthConfig";
import { useBetaProgramStatus } from "../lib/useBetaProgram";
import { beginBetterAuthSignIn } from "../lib/betterAuthClient";

export function AuthSignInPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const fromPath = useMemo(
    () => authDestinationFromLocation(location),
    [location.search, location.state],
  );
  const pricingDestination = typeof location.state === "object" && location.state !== null && "pricingDestination" in location.state && typeof location.state.pricingDestination === "string" ? location.state.pricingDestination : undefined;
  const issue = authJourneyIssue(searchParams);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const signInOwner = useRef({ active: true, generation: 0 });
  useEffect(() => {
    const owner = signInOwner.current;
    owner.active = true;
    const retire = () => { owner.generation += 1; };
    const clear = (event: StorageEvent) => {
      if (event.key === null) { retire(); return; }
      if (event.key === "edgelab.auth.session.v1") {
        const identity = (raw: string | null) => {
          try { const value = JSON.parse(raw ?? "null"); return value ? JSON.stringify([value.user?.id, value.token]) : ""; }
          catch { return "invalid"; }
        };
        if (identity(event.oldValue) !== identity(event.newValue)) retire();
      }
    };
    window.addEventListener("edgelab:auth-session-change", retire);
    window.addEventListener("storage", clear);
    return () => { owner.active = false; retire(); window.removeEventListener("edgelab:auth-session-change", retire); window.removeEventListener("storage", clear); };
  }, []);
  const { loading, program } = useBetaProgramStatus();
  const { config, error: authConfigError, loading: authConfigLoading } = useBetaAuthConfig();
  const waitlistMode = searchParams.get("waitlist") === "1";
  const betaMode = config.deployment_mode === "beta";
  const googleReady = isGoogleAuthConfigured(config);
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const effectiveWaitlistMode =
    betaMode && (waitlistMode ||
    issue?.kind === "denied" ||
    (!loading && seatsRemaining != null && seatsRemaining <= 0));
  const betaStatusLabel =
    loading || seatsRemaining == null
      ? "Checking seats"
      : seatsRemaining > 0
        ? `${seatsRemaining} seats open`
        : "Waitlist open";
  const title = issue?.title ?? (effectiveWaitlistMode ? "Reserve your beta place." : "Continue to EdgeLab.");
  const description =
    issue?.description ??
    (effectiveWaitlistMode
      ? "Sign in with Google to reserve your place. EdgeLab will open the workspace automatically after approval."
      : betaMode ? "Use Google to enter the private beta. EdgeLab returns you to the workspace you originally requested." : "Sign in with Google to manage your account. An active subscription unlocks your workspace and data exports.");

  const handleGoogleSignIn = async () => {
    if (!googleReady) {
      setErrorMessage("Google sign-in is unavailable right now. Try again shortly.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    if (config.auth_provider === "better-auth") {
      const generation = signInOwner.current.generation;
      const identity = getStoredAuthSession();
      const owns = () => signInOwner.current.active && signInOwner.current.generation === generation && getStoredAuthSession()?.token === identity?.token;
      try { await beginBetterAuthSignIn(fromPath, pricingDestination, owns); }
      catch { if (owns()) { setErrorMessage("Google sign-in is unavailable right now. Try again shortly."); setIsSubmitting(false); } }
      return;
    }
    if (!config.google_client_id) {
      setErrorMessage("Google sign-in is unavailable right now. Try again shortly.");
      setIsSubmitting(false);
      return;
    }
    window.location.replace(
      buildGoogleAuthorizeUrl(
        fromPath,
        config.google_client_id,
        config.google_redirect_uri,
        pricingDestination,
      ),
    );
  };

  const handleDevSignIn = async () => {
    if (!authConfigLoading && !config?.dev_auth_bypass_enabled) {
      setErrorMessage("Local development sign-in is unavailable.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await requestDevAuthBypass();
      setStoredAuthSession(toStoredAuthSession(response.session));
      navigate(fromPath, { replace: true });
    } catch {
      setErrorMessage("Local development sign-in is unavailable for this origin.");
      setIsSubmitting(false);
    }
  };

  return (
    <AuthJourneyShell
      description={description}
      rail={
        <div aria-live="polite">
          <h2 className="text-xl font-medium tracking-[-0.02em] text-edgelab-text-primary">
            {betaMode ? "Current beta access" : "Your access"}
          </h2>
          {betaMode ? <dl className="mt-5 border-y border-edgelab-border">
            <div className="flex items-center justify-between gap-4 border-b border-edgelab-border py-4">
              <dt className="text-sm text-edgelab-text-secondary">Seats</dt>
              <dd className="text-right text-sm font-medium text-edgelab-text-primary">{betaStatusLabel}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-edgelab-border py-4">
              <dt className="text-sm text-edgelab-text-secondary">Waitlist</dt>
              <dd className="text-right text-sm font-medium text-edgelab-text-primary">
                {waitlistCount == null ? "Checking…" : `${waitlistCount} queued`}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <dt className="text-sm text-edgelab-text-secondary">Billing</dt>
              <dd className="text-right text-sm font-medium text-edgelab-text-primary">
                No card during beta
              </dd>
            </div>
          </dl> : <dl className="mt-5 divide-y divide-edgelab-border border-y border-edgelab-border">
            <div className="py-4"><dt className="text-sm text-edgelab-text-secondary">Account</dt><dd className="mt-1 text-sm font-medium">Verified Google sign-in</dd></div>
            <div className="py-4"><dt className="text-sm text-edgelab-text-secondary">Workspace and exports</dt><dd className="mt-1 text-sm font-medium">Active paid subscription</dd></div>
            <div className="py-4"><dt className="text-sm text-edgelab-text-secondary">Subscription</dt><dd className="mt-1 text-sm font-medium">Monthly or yearly</dd></div>
          </dl>}
          <div className="mt-6 flex items-start gap-3 text-sm leading-6 text-edgelab-text-secondary">
            <Check aria-hidden="true" className="mt-0.5 shrink-0 text-cyan-300" size={16} />
            {betaMode ? "Beta workspaces contain temporary test data. Data exports require an active paid subscription." : "Manage your billing and sign out from your account, even when your subscription is inactive."}
          </div>
        </div>
      }
      statusLabel={effectiveWaitlistMode ? "Waitlist access" : betaMode ? "Secure beta access" : "Secure sign-in"}
      statusTone={issue ? "warning" : "accent"}
      title={title}
    >
      {issue || errorMessage ? (
        <div
          aria-live="assertive"
          className="flex max-w-2xl items-start gap-3 rounded-el-md bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100"
          role="alert"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={17} />
          <span>{errorMessage ?? "You can safely try the sign-in again below."}</span>
        </div>
      ) : null}

      <div className="mt-5 max-w-xl">
        <button
          aria-busy={isSubmitting}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-el-md bg-edgelab-accent px-5 py-3 text-sm font-semibold text-ink-950 transition-[background-color,transform] duration-200 ease-el-out hover:-translate-y-0.5 hover:bg-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-100 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none sm:w-auto sm:min-w-[18rem]"
          disabled={isSubmitting || authConfigLoading || !googleReady}
          onClick={handleGoogleSignIn}
          type="button"
        >
          <Chrome aria-hidden="true" size={16} />
          {isSubmitting
            ? "Opening Google…"
            : authConfigLoading
              ? "Checking Google sign-in…"
              : effectiveWaitlistMode
                ? "Join waitlist with Google"
                : "Continue with Google"}
          <ArrowRight aria-hidden="true" size={15} />
        </button>

        {!authConfigLoading && (!googleReady || authConfigError) ? (
          <p className="mt-3 text-sm leading-6 text-amber-100" role="status">
            Google sign-in is unavailable right now. Try again shortly.
          </p>
        ) : null}

        <p className="mt-4 max-w-md text-xs leading-5 text-edgelab-text-secondary">
          {betaMode ? "After Google confirms your account, EdgeLab returns you to the page you requested when access is available." : "After Google confirms your account, choose a subscription or return to your existing workspace."}
        </p>

        {betaMode && config.dev_auth_bypass_enabled === true ? (
          <button
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-el-md bg-edgelab-surface-2 px-5 py-3 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:opacity-60 sm:w-auto sm:min-w-[18rem]"
            disabled={isSubmitting || authConfigLoading}
            onClick={handleDevSignIn}
            type="button"
          >
            Local development sign-in
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        ) : null}
      </div>
    </AuthJourneyShell>
  );
}
