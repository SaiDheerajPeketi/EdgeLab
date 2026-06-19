import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { EdgeLabWordmark } from "../components/marketing/MarketingShell";
import { ApiError, exchangeGoogleAuthCode } from "../lib/api";
import { setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
import { consumeGoogleAuthState } from "../lib/googleAuth";

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
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
          <div className="mt-6 inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/70">
            Secure callback
          </div>
          <div className="text-display mt-5 text-4xl text-white sm:text-5xl">Signing you in</div>
          <p className="mt-4 text-base leading-8 text-slate-300">
            Checking Google access, restoring your session, and opening the workspace.
          </p>
          <div className="mt-8 rounded-[22px] border border-white/10 bg-black/20 px-4 py-4 text-sm leading-7 text-slate-300">
            Approved beta users enter EdgeLab next. Waitlist accounts come back here with the next step.
          </div>
        </div>
      </div>
    </div>
  );
}
