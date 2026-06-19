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
      <div className="relative grid w-full max-w-4xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(50,211,238,0.14),rgba(255,255,255,0.03))] p-8 shadow-glow">
          <EdgeLabWordmark />
          <div className="mt-10 max-w-xl">
            <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/70">
              Secure callback
            </div>
            <div className="text-display mt-4 text-5xl text-white">Signing you in</div>
            <p className="mt-5 text-lg leading-8 text-slate-300">
              Verifying Google access, restoring session, and preparing workspace.
            </p>
          </div>
        </div>
        <div className="rounded-[34px] border border-white/10 bg-white/[0.04] p-8 text-center shadow-card backdrop-blur-xl">
          <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
          <div className="mt-6 text-display text-3xl text-white">Almost there</div>
          <p className="mt-3 text-sm leading-7 text-slate-400">
            Approved accounts open app. Waitlist accounts return here with next step.
          </p>
          <div className="mt-8 rounded-[22px] border border-white/10 bg-black/25 px-4 py-4 text-left text-sm leading-7 text-slate-300">
            One identity. One workspace. One clean handoff.
          </div>
        </div>
      </div>
    </div>
  );
}
