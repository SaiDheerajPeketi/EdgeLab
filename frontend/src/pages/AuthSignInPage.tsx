import { ArrowRight, Chrome, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  EdgeLabWordmark,
} from "../components/marketing/MarketingShell";
import { isBetaMode, deploymentMode } from "../lib/deploymentMode";
import { buildGoogleAuthorizeUrl, isGoogleAuthConfigured } from "../lib/googleAuth";
import { useBetaAuthConfig } from "../lib/useBetaAuthConfig";
import { useBetaProgramStatus } from "../lib/useBetaProgram";

function friendlyAuthError(error: string | null) {
  if (!error) {
    return null;
  }

  const normalized = error.toLowerCase();

  if (normalized.includes("state")) {
    return "Your sign-in expired. Start again from this page.";
  }

  if (normalized.includes("access_denied")) {
    return "Google sign-in was cancelled before EdgeLab could finish.";
  }

  return "Google sign-in could not complete. Try again in a moment.";
}

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
  const [errorMessage, setErrorMessage] = useState<string | null>(
    friendlyAuthError(searchParams.get("error")),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { loading, program } = useBetaProgramStatus();
  const { config, loading: authConfigLoading } = useBetaAuthConfig();
  const waitlistMode = searchParams.get("waitlist") === "1";
  const googleReady = isGoogleAuthConfigured(config);
  const seatsRemaining = program.seats_remaining;
  const waitlistCount = program.waitlist_count;
  const betaStatusLabel =
    loading || seatsRemaining == null
      ? "Checking seats"
      : seatsRemaining > 0
        ? `${seatsRemaining} seats open`
        : "Waitlist open";

  const handleGoogleSignIn = () => {
    if (!googleReady || !config.google_client_id) {
      setErrorMessage("Google sign-in is unavailable right now. Try again shortly.");
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
    <div className="relative min-h-screen overflow-hidden bg-edgelab-base text-edgelab-text-primary">
      <div className="pointer-events-none absolute inset-0">
        <div className="edgelab-mesh absolute inset-x-[-10%] top-[-18rem] h-[40rem] opacity-70" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(50,211,238,0.14),transparent_34%),linear-gradient(180deg,#07090d_0%,#090b0f_42%,#05070a_100%)]" />
        <div className="edgelab-grid absolute inset-0 opacity-35" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-10 pt-7 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <EdgeLabWordmark showTagline={false} />
          <div className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-slate-300">
            {betaStatusLabel}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-8 sm:py-10">
          <div className="w-full max-w-3xl rounded-[38px] border border-white/10 bg-[#061018]/94 p-8 shadow-card backdrop-blur-xl sm:p-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-50">
              <ShieldCheck size={14} />
              Secure beta access
            </div>

            <div className="mt-7 max-w-2xl">
              <h1 className="text-[clamp(2.3rem,7vw,4.25rem)] font-semibold leading-[0.98] tracking-[-0.06em] text-white">
                {waitlistMode ? "Join EdgeLab waitlist." : "Enter EdgeLab through Google."}
              </h1>
              <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
                One Google sign-in. Approved beta users open workspace. Full seats move straight
                into queue.
              </p>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Access
                </div>
                <div className="mt-3 text-lg font-semibold text-white">{betaStatusLabel}</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Queue
                </div>
                <div className="mt-3 text-lg font-semibold text-white">
                  {waitlistCount == null ? "Syncing" : `${waitlistCount} queued`}
                </div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Mode
                </div>
                <div className="mt-3 text-lg font-semibold text-white">
                  {isBetaMode(deploymentMode) ? "Private beta" : "Live access"}
                </div>
              </div>
            </div>

            <div className="mt-7 max-w-xl">
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3.5 text-sm font-semibold text-slate-950 transition duration-200 ease-out hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60 motion-reduce:transition-none sm:w-auto sm:min-w-[18rem]"
                disabled={isSubmitting || authConfigLoading || !googleReady}
                onClick={handleGoogleSignIn}
                type="button"
              >
                <Chrome size={16} />
                {isSubmitting
                  ? "Redirecting to Google..."
                  : waitlistMode
                    ? "Join waitlist with Google"
                    : "Continue with Google"}
                <ArrowRight size={14} />
              </button>
            </div>

            {waitlistMode ? (
              <div className="mt-5 rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-7 text-slate-300">
                Beta seats full now. Google still reserves queue position. Current queue:{" "}
                {waitlistCount == null ? "syncing" : waitlistCount}.
              </div>
            ) : null}

            {errorMessage ? (
              <div className="mt-5 rounded-[22px] border border-rose-300/20 bg-rose-300/10 px-4 py-4 text-sm leading-7 text-rose-100">
                {errorMessage}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
