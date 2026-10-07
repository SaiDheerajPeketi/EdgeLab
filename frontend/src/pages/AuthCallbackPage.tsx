import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthTransitionScreen } from "../components/auth/AuthTransitionScreen";
import { ApiError, exchangeGoogleAuthCode } from "../lib/api";
import { hasWorkspaceAccess, setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
import {
  buildAuthSignInHref,
  buildPricingHref,
  isBillingAuthDestination,
  safeAuthDestination,
} from "../lib/authJourney";
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
    detail: "Check access and return to your workspace or subscription options.",
    label: "Workspace handoff",
  },
] as const;

type ConsumedGoogleAuthState = ReturnType<typeof consumeGoogleAuthState>;

let cachedStateKey: string | null | undefined;
let cachedAuthState: ConsumedGoogleAuthState = null;
let cachedExchangeKey: string | null = null;
let cachedExchangePromise: ReturnType<typeof exchangeGoogleAuthCode> | null = null;

function consumeGoogleAuthStateOnce(stateKey: string | null) {
  if (stateKey === cachedStateKey) {
    return cachedAuthState;
  }
  cachedStateKey = stateKey;
  cachedAuthState = consumeGoogleAuthState(stateKey);
  cachedExchangeKey = null;
  cachedExchangePromise = null;
  return cachedAuthState;
}

function exchangeGoogleAuthCodeOnce(
  code: string,
  stateKey: string | null,
  redirectUri: string,
) {
  const exchangeKey = `${stateKey ?? "missing"}:${code}`;
  if (exchangeKey === cachedExchangeKey && cachedExchangePromise) {
    return cachedExchangePromise;
  }
  cachedExchangeKey = exchangeKey;
  cachedExchangePromise = exchangeGoogleAuthCode({ code, redirect_uri: redirectUri });
  return cachedExchangePromise;
}

export function AuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const code = searchParams.get("code");
    const providerError = searchParams.get("error");
    const stateKey = searchParams.get("state");
    const authState = consumeGoogleAuthStateOnce(stateKey);
    const fromPath = safeAuthDestination(authState?.fromPath);
    const pricingDestination = authState?.pricingDestination;

    let active = true;
    let handoffFrame = 0;

    if (providerError) {
      navigate(buildAuthSignInHref({ error: providerError, fromPath }), {
        replace: true,
        state: { fromPath, pricingDestination },
      });
      return () => {
        active = false;
      };
    }

    if (!code || !authState) {
      navigate(buildAuthSignInHref({ fromPath, reason: "oauth-state-expired" }), {
        replace: true,
        state: { fromPath, pricingDestination },
      });
      return () => {
        active = false;
      };
    }

    setActiveStep(1);
    exchangeGoogleAuthCodeOnce(code, stateKey, authState.redirectUri)
      .then((response) => {
        if (!active) {
          return;
        }
        const session = toStoredAuthSession(response.session);
        setStoredAuthSession(session);
        setActiveStep(2);
        if (hasWorkspaceAccess(session) || isBillingAuthDestination(fromPath)) {
          handoffFrame = window.requestAnimationFrame(() => {
            navigate(fromPath, { replace: true, state: isBillingAuthDestination(fromPath) && pricingDestination ? { fromPath: pricingDestination } : undefined });
          });
          return;
        }

        if (session.user.deploymentMode !== "beta") {
          navigate(buildPricingHref(fromPath), { replace: true, state: { fromPath } });
          return;
        }

        navigate(buildAuthSignInHref({ fromPath, waitlist: true }), {
          replace: true,
          state: { fromPath, pricingDestination },
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        const message = error instanceof ApiError ? error.message : "beta-auth-error";
        navigate(buildAuthSignInHref({
          error: message,
          fromPath,
          reason: error instanceof ApiError && error.status === 403 ? "access-denied" : null,
        }), {
          replace: true,
          state: { fromPath, pricingDestination },
        });
      });

    return () => {
      active = false;
      if (handoffFrame) {
        window.cancelAnimationFrame(handoffFrame);
      }
    };
  }, [location.search, navigate]);

  return (
    <AuthTransitionScreen
      activeStep={activeStep}
      description="Google has returned control to EdgeLab. Keep this page open while the secure session is restored."
      eyebrow="Secure sign-in"
      panelEyebrow="Authentication path"
      panelTitle="Your destination stays preserved"
      statusLabel={activeStep >= 2 ? "Opening workspace" : "Restoring session"}
      steps={[...CALLBACK_STEPS]}
      title={activeStep >= 2 ? "Access confirmed." : "Restoring your EdgeLab session."}
    />
  );
}
