import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EdgeLabWordmark } from "../components/marketing/MarketingShell";
import { ApiError, exchangeGoogleAuthCode } from "../lib/api";
import { setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
import { consumeGoogleAuthState } from "../lib/googleAuth";

function CallbackSpinner() {
  return (
    <div className="relative mx-auto flex h-28 w-28 items-center justify-center">
      <div className="absolute inset-0 rounded-full border border-cyan-300/15 bg-cyan-300/[0.04]" />
      <div className="absolute inset-[8px] rounded-full border border-cyan-300/15 border-t-cyan-300 animate-spin" />
      <div className="absolute inset-[20px] rounded-full border border-white/10 bg-[#07141c] shadow-[0_22px_44px_rgba(0,0,0,0.34)]" />
      <svg aria-hidden="true" className="relative h-9 w-9" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="edgelab-callback-gradient" x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#8bf5ff" />
            <stop offset="100%" stopColor="#32d3ee" />
          </linearGradient>
        </defs>
        <path
          d="M18 49h28l-6-13 9-16h-9l-6 11-5-11h-9l9 18-11 11h0Z"
          fill="none"
          stroke="url(#edgelab-callback-gradient)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        <path
          d="M29 17h7l3 6"
          fill="none"
          stroke="#f6c26b"
          strokeLinecap="round"
          strokeWidth="3.4"
        />
      </svg>
    </div>
  );
}

export function AuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const code = searchParams.get("code");
    const authState = consumeGoogleAuthState(searchParams.get("state"));

    let active = true;

    if (!code || !authState) {
      navigate("/auth/signin?error=google-oauth-state", { replace: true });
      return () => {
        active = false;
      };
    }

    exchangeGoogleAuthCode({
      code,
      redirect_uri: authState.redirectUri,
    })
      .then((response) => {
        if (!active) {
          return;
        }
        setStoredAuthSession(toStoredAuthSession(response.session));
        if (response.session.user.approved) {
          navigate(authState.fromPath, { replace: true });
          return;
        }

        navigate("/auth/signin?waitlist=1", {
          replace: true,
          state: { fromPath: authState.fromPath },
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const message = error instanceof ApiError ? error.message : "beta-auth-error";
        navigate(`/auth/signin?error=${encodeURIComponent(message)}`, {
          replace: true,
          state: { fromPath: authState.fromPath },
        });
      });

    return () => {
      active = false;
    };
  }, [location.search, navigate]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-edgelab-base px-4 text-edgelab-text-primary">
      <div className="pointer-events-none absolute inset-0">
        <div className="edgelab-mesh absolute inset-x-[-10%] top-[-18rem] h-[38rem] opacity-70" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(50,211,238,0.12),transparent_35%),linear-gradient(180deg,#07090d_0%,#090b0f_42%,#05070a_100%)]" />
        <div className="edgelab-grid absolute inset-0 opacity-35" />
      </div>
      <div className="relative w-full max-w-xl rounded-[34px] border border-white/10 bg-[#061018]/94 p-8 shadow-card backdrop-blur-xl sm:p-10">
        <EdgeLabWordmark showTagline={false} />

        <div className="mt-10 text-center">
          <CallbackSpinner />
          <div className="mt-6 inline-flex items-center rounded-full border border-cyan-300/15 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/75">
            Google callback live
          </div>
          <div className="mt-5 text-[clamp(2.9rem,7vw,4.8rem)] font-semibold leading-[0.9] tracking-[-0.08em] text-white">
            Opening EdgeLab.
          </div>
          <p className="mt-4 text-base leading-8 text-slate-300">
            Validating access, restoring session, and routing you into workspace.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4 text-left">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Step</div>
              <div className="mt-3 text-lg font-semibold text-white">Exchange</div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4 text-left">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">State</div>
              <div className="mt-3 text-lg font-semibold text-white">Secure</div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4 text-left">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Route</div>
              <div className="mt-3 text-lg font-semibold text-white">Workspace</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
