import { AlertCircle, ArrowRight, Check, Chrome } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthJourneyShell } from "../components/auth/AuthJourneyShell";
import { isBetaMode, deploymentMode } from "../lib/deploymentMode";
import { buildGoogleAuthorizeUrl, isGoogleAuthConfigured } from "../lib/googleAuth";
import { requestDevAuthBypass } from "../lib/api";
import { setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
import { authDestinationFromLocation, authJourneyIssue } from "../lib/authJourney";
import { useBetaAuthConfig } from "../lib/useBetaAuthConfig";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

export function AuthSignInPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const fromPath = useMemo(
    () => authDestinationFromLocation(location),
    [location.search, location.state],
  );
  const issue = authJourneyIssue(searchParams);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { loading, program } = useBetaProgramStatus();
  const { config, error: authConfigError, loading: authConfigLoading } = useBetaAuthConfig();
  const waitlistMode = searchParams.get("waitlist") === "1";
  const googleReady = isGoogleAuthConfigured(config);
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const effectiveWaitlistMode =
    waitlistMode ||
    issue?.kind === "denied" ||
    (!loading && seatsRemaining != null && seatsRemaining <= 0);
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
      : "Use Google to enter the private beta. EdgeLab returns you to the workspace you originally requested.");

  const handleGoogleSignIn = () => {
    if (!googleReady || !config.google_client_id) {
      setErrorMessage("Google sign-in is unavailable right now. Try again shortly.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    window.location.replace(
      buildGoogleAuthorizeUrl(
        fromPath,
        config.google_client_id,
        config.google_redirect_uri,
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
            Current beta access
          </h2>
          <dl className="mt-6 border-y border-edgelab-border">
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
            <div className="flex items-center justify-between gap-4 border-b border-edgelab-border py-4">
              <dt className="text-sm text-edgelab-text-secondary">Sign-in</dt>
              <dd className="text-right text-sm font-medium text-edgelab-text-primary">
                Google OAuth
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-edgelab-border py-4">
              <dt className="text-sm text-edgelab-text-secondary">Billing</dt>
              <dd className="text-right text-sm font-medium text-edgelab-text-primary">
                No card during beta
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <dt className="text-sm text-edgelab-text-secondary">Environment</dt>
              <dd className="text-right text-sm font-medium text-edgelab-text-primary">
                {isBetaMode(deploymentMode) ? "Private beta" : "Live access"}
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex items-start gap-3 text-sm leading-6 text-edgelab-text-secondary">
            <Check aria-hidden="true" className="mt-0.5 shrink-0 text-cyan-300" size={16} />
            Beta workspaces contain temporary test data. Export anything important.
          </div>
        </div>
      }
      statusLabel={effectiveWaitlistMode ? "Waitlist access" : "Secure beta access"}
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
          After Google confirms your account, EdgeLab returns you to the approved page you
          requested. Campaign context included by an EdgeLab marketing link stays in that return
          path.
        </p>

        {config.dev_auth_bypass_enabled === true ? (
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
