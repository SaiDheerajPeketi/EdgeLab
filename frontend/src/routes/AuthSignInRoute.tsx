import { useSyncExternalStore } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AuthSignInPage } from "../pages/AuthSignInPage";
import { authDestinationFromLocation, isBillingAuthDestination } from "../lib/authJourney";
import { isPersonalMode } from "../lib/deploymentMode";
import { getStoredAuthSession, hasWorkspaceAccess, subscribeAuthSession } from "../lib/authSession";

// Both public renderers use the same identity and return-destination checks.
export function AuthSignInRoute() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, getStoredAuthSession);
  const location = useLocation();
  const requested = authDestinationFromLocation(location);
  const destination = isPersonalMode() && requested.startsWith("/pricing") ? "/app" : requested;
  const billingDestination = isBillingAuthDestination(destination);
  if (session && (billingDestination && !isPersonalMode() ? session.user.provider === "google" : hasWorkspaceAccess(session))) {
    return <Navigate replace state={location.state} to={destination} />;
  }
  return <AuthSignInPage />;
}
