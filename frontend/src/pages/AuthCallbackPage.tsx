import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthTransitionScreen } from "../components/auth/AuthTransitionScreen";
import { ApiError, exchangeGoogleAuthCode } from "../lib/api";
import { setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
import { consumeGoogleAuthState } from "../lib/googleAuth";

const CALLBACK_STEPS = [
  {
    detail: "Validate the signed Google return and confirm the redirect target.",
    label: "Secure callback",
  },
  {
    detail: "Exchange the auth code and rehydrate the EdgeLab session.",
    label: "Session restore",
  },
  {
    detail: "Route approved access straight back into the workspace.",
    label: "Workspace handoff",
  },
] as const;

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
    <AuthTransitionScreen
      activeStep={1}
      description="Validating Google access, restoring your session, and handing you back into the trading workspace."
      eyebrow="Secure callback"
      panelEyebrow="Auth path"
      panelTitle="Session restore in progress"
      statusLabel="Google OAuth"
      steps={[...CALLBACK_STEPS]}
      title="Restoring your EdgeLab session."
    />
  );
}
