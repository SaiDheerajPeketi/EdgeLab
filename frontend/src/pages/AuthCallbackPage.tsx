import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
        navigate(response.session.user.approved ? authState.fromPath : "/auth/signin?waitlist=1", {
          replace: true,
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const message = error instanceof ApiError ? error.message : "beta-auth-error";
        navigate(`/auth/signin?error=${encodeURIComponent(message)}`, { replace: true });
      });

    return () => {
      active = false;
    };
  }, [location.search, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-edgelab-base px-4 text-edgelab-text-primary">
      <div className="w-full max-w-md rounded-[30px] border border-cyan-300/20 bg-white/[0.04] p-8 text-center shadow-glow">
        <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
        <div className="mt-6 text-display text-3xl text-white">Signing you in</div>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Google callback route hitting beta access API now. Workspace or waitlist next.
        </p>
      </div>
    </div>
  );
}
