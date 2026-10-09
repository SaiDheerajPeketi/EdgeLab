import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AuthTransitionScreen } from "../components/auth/AuthTransitionScreen";
import { ApiError, exchangeGoogleAuthCode } from "../lib/api";
import { getStoredAuthSession, hasWorkspaceAccess, setStoredAuthSession, toStoredAuthSession } from "../lib/authSession";
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

const AUTH_STORAGE_KEY = "edgelab.auth.session.v1";
const GOOGLE_AUTH_STATE_TTL_MS = 15 * 60 * 1000;

type CallbackAttempt = {
  search: string;
  state: ConsumedGoogleAuthState;
  owner: string;
  invalidated: boolean;
  handled: boolean;
  cancelled: boolean;
  pending: ReturnType<typeof exchangeGoogleAuthCode> | null;
};

function authIdentity() {
  const session = getStoredAuthSession();
  return session ? JSON.stringify([session.user.id, session.token]) : "";
}

function storedIdentity(raw: string | null) {
  try {
    const session = JSON.parse(raw ?? "null");
    return session ? JSON.stringify([session.user?.id, session.token]) : "";
  } catch {
    return "invalid";
  }
}

export function AuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const attemptRef = useRef<CallbackAttempt | null>(null);
  const searchRef = useRef(location.search);
  searchRef.current = location.search;

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const code = searchParams.get("code");
    const providerError = searchParams.get("error");
    const stateKey = searchParams.get("state");
    let attempt = attemptRef.current;
    if (!attempt || attempt.search !== location.search) {
      if (attempt) attempt.invalidated = true;
      attempt = {
        search: location.search,
        state: consumeGoogleAuthState(stateKey),
        owner: authIdentity(),
        invalidated: false,
        handled: false,
        cancelled: false,
        pending: null,
      };
      attemptRef.current = attempt;
    }
    const ownedAttempt = attempt;
    const authState = attempt.state;
    const fromPath = safeAuthDestination(authState?.fromPath);
    const pricingDestination = authState?.pricingDestination;
    let active = true;
    let handoffFrame = 0;
    let settling = false;

    const currentAttempt = () => active && attemptRef.current === ownedAttempt &&
      searchRef.current === ownedAttempt.search;
    const cancelHandoff = () => {
      if (!currentAttempt() || ownedAttempt.cancelled) return;
      ownedAttempt.cancelled = true;
      if (handoffFrame) window.cancelAnimationFrame(handoffFrame);
      const currentOwner = authIdentity();
      // The new account never inherits the old attempt's destination or share
      // capability. Cancellation has its own current-identity handoff.
      if (currentAttempt() && authIdentity() === currentOwner) {
        navigate(currentOwner ? "/account" : buildAuthSignInHref({ reason: "sign-in-cancelled" }), { replace: true });
      }
    };
    const ownsAttempt = () => {
      if (authIdentity() !== ownedAttempt.owner) ownedAttempt.invalidated = true;
      if (ownedAttempt.invalidated) cancelHandoff();
      return currentAttempt() && !ownedAttempt.invalidated;
    };
    const fresh = () => Boolean(authState && authState.issuedAt <= Date.now() &&
      Date.now() - authState.issuedAt <= GOOGLE_AUTH_STATE_TTL_MS);
    const observeIdentity = () => { ownsAttempt(); };
    const observeStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_STORAGE_KEY && event.key !== null) return;
      // The event's transitions matter even if later writes already restored the
      // original account before this tab receives the storage event.
      if (event.key === null || storedIdentity(event.oldValue) !== storedIdentity(event.newValue)) {
        ownedAttempt.invalidated = true;
      }
      observeIdentity();
    };
    window.addEventListener("edgelab:auth-session-change", observeIdentity);
    window.addEventListener("storage", observeStorage);
    const go = (href: string, state?: Record<string, unknown>) => {
      if (ownsAttempt()) navigate(href, { replace: true, state });
    };
    const expired = () => {
      // Sign-in routes may automatically forward an existing session. Never
      // give that guard an expired destination or share capability.
      if (authIdentity()) go("/account");
      else go(buildAuthSignInHref({ fromPath, reason: "oauth-state-expired" }), { fromPath, pricingDestination });
    };

    if (!ownedAttempt.handled && ownsAttempt()) {
      if (providerError) {
        ownedAttempt.handled = true;
        go(buildAuthSignInHref({ error: providerError, fromPath }), { fromPath, pricingDestination });
      } else if (!code || !authState || !fresh()) {
        ownedAttempt.handled = true;
        expired();
      } else {
        setActiveStep(1);
        // Only pending work survives StrictMode's effect replay. A real remount
        // must consume a new state, and settled responses are never cached.
        ownedAttempt.pending ??= exchangeGoogleAuthCode({ code, redirect_uri: authState.redirectUri });
        ownedAttempt.pending.then((response) => {
          if (!ownsAttempt() || ownedAttempt.handled) return;
          settling = true;
          ownedAttempt.handled = true;
          ownedAttempt.pending = null;
          if (!fresh()) { expired(); return; }
          const session = toStoredAuthSession(response.session);
          // Permit exactly this synchronous write's identity event, then fence
          // every later transition, including token renewal and account ABA.
          const previousOwner = ownedAttempt.owner;
          ownedAttempt.owner = JSON.stringify([session.user.id, session.token]);
          try {
            setStoredAuthSession(session);
          } catch (error) {
            // A blocked storage write leaves the original owner in place. Keep
            // that owner's retry path, without accepting a concurrent change.
            if (!ownedAttempt.invalidated && authIdentity() === previousOwner) ownedAttempt.owner = previousOwner;
            throw error;
          }
          if (!ownsAttempt()) return;
          setActiveStep(2);
          if (hasWorkspaceAccess(session) || isBillingAuthDestination(fromPath)) {
            handoffFrame = window.requestAnimationFrame(() => {
              if (!fresh()) { expired(); return; }
              go(fromPath, isBillingAuthDestination(fromPath) && pricingDestination ? { fromPath: pricingDestination } : undefined);
            });
          } else if (session.user.deploymentMode !== "beta") {
            if (fresh()) go(buildPricingHref(fromPath), { fromPath });
            else expired();
          } else {
            if (fresh()) go(buildAuthSignInHref({ fromPath, waitlist: true }), { fromPath, pricingDestination });
            else expired();
          }
        }).catch((error: unknown) => {
          if (!ownsAttempt() || (ownedAttempt.handled && !settling)) return;
          ownedAttempt.handled = true;
          ownedAttempt.pending = null;
          if (!fresh()) { expired(); return; }
          const message = error instanceof ApiError ? error.message : "beta-auth-error";
          go(buildAuthSignInHref({
            error: message,
            fromPath,
            reason: error instanceof ApiError && error.status === 403 ? "access-denied" : null,
          }), { fromPath, pricingDestination });
        });
      }
    }

    return () => {
      active = false;
      window.removeEventListener("edgelab:auth-session-change", observeIdentity);
      window.removeEventListener("storage", observeStorage);
      if (handoffFrame) window.cancelAnimationFrame(handoffFrame);
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
