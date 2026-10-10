import type { BetaAuthConfig } from "./api";
import { isWorkspaceAuthDestination, safeAuthDestination } from "./authJourney";

const GOOGLE_AUTH_STATE_KEY = "edgelab.google-auth.state.v1";
const GOOGLE_AUTH_STATE_TTL_MS = 15 * 60 * 1000;

type StoredGoogleAuthState = {
  fromPath: string;
  pricingDestination?: string;
  issuedAt: number;
  redirectUri: string;
  state: string;
  authOwner?: string;
};


function randomState() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `oauth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isGoogleAuthConfigured(config: BetaAuthConfig | null | undefined) {
  return Boolean(config?.google_enabled && (config.auth_provider === "better-auth" || config.google_client_id?.trim()));
}

export function buildGoogleAuthorizeUrl(
  fromPath: string,
  clientId: string,
  configuredRedirectUri?: string | null,
  pricingDestination?: string | null,
) {
  const redirectUri =
    configuredRedirectUri?.trim() || `${window.location.origin}/auth/callback/google`;
  const state = storeGoogleAuthAttempt(fromPath, redirectUri, pricingDestination);
  const query = new URLSearchParams({
    client_id: clientId.trim(), redirect_uri: redirectUri,
    response_type: "code", scope: "openid email profile", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

export function storeGoogleAuthAttempt(fromPath: string, redirectUri: string, pricingDestination?: string | null, authOwner?: string) {
  const state = randomState();
  const payload: StoredGoogleAuthState = {
    fromPath: safeAuthDestination(fromPath),
    issuedAt: Date.now(),
    redirectUri,
    state,
  };
  if (authOwner !== undefined) payload.authOwner = authOwner;
  if (pricingDestination && pricingDestination.length <= 2048) {
    const safe = safeAuthDestination(pricingDestination);
    if (isWorkspaceAuthDestination(pricingDestination)) payload.pricingDestination = safe;
  }
  storeGoogleAuthState(payload);

  return state;
}

export function ownsGoogleAuthAttempt(state: string, authOwner: string) {
  try {
    const value = JSON.parse(readGoogleAuthState() ?? "null");
    return isStoredGoogleAuthState(value) && value.state === state && value.authOwner === authOwner &&
      value.issuedAt <= Date.now() && Date.now() - value.issuedAt <= GOOGLE_AUTH_STATE_TTL_MS;
  } catch { return false; }
}

export function consumeGoogleAuthState(receivedState: string | null, authOwner?: string) {
  const rawValue = readGoogleAuthState();
  if (!rawValue) {
    clearGoogleAuthState();
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredGoogleAuthState;
    if (
      !isStoredGoogleAuthState(parsed) ||
      !receivedState ||
      parsed.state !== receivedState || (parsed.authOwner !== undefined && parsed.authOwner !== authOwner) ||
      Date.now() - parsed.issuedAt > GOOGLE_AUTH_STATE_TTL_MS || parsed.issuedAt > Date.now()
    ) {
      clearGoogleAuthState();
      return null;
    }
    const sanitizedFromPath = safeAuthDestination(parsed.fromPath);
    if (sanitizedFromPath !== parsed.fromPath) {
      clearGoogleAuthState();
      return null;
    }
    if (parsed.pricingDestination !== undefined && !isWorkspaceAuthDestination(parsed.pricingDestination)) {
      clearGoogleAuthState();
      return null;
    }
    clearGoogleAuthState();
    return { ...parsed, fromPath: sanitizedFromPath };
  } catch {
    clearGoogleAuthState();
    return null;
  }
}

function storeGoogleAuthState(payload: StoredGoogleAuthState) {
  const rawValue = JSON.stringify(payload);
  const containsShareCapability = payload.fromPath.startsWith("/shared#") || payload.pricingDestination?.startsWith("/shared#");
  try {
    window.sessionStorage.setItem(GOOGLE_AUTH_STATE_KEY, rawValue);
  } catch {
    // Keep the OAuth flow usable when sessionStorage is blocked.
  }
  if (containsShareCapability) {
    try {
      window.localStorage.removeItem(GOOGLE_AUTH_STATE_KEY);
    } catch {
      // A share capability must never fall back to durable storage.
    }
    return;
  }
  try {
    window.localStorage.setItem(GOOGLE_AUTH_STATE_KEY, rawValue);
  } catch {
    // localStorage is a resilience layer; sessionStorage remains the primary path.
  }
}

function readGoogleAuthState() {
  try {
    const sessionValue = window.sessionStorage.getItem(GOOGLE_AUTH_STATE_KEY);
    if (sessionValue) {
      return sessionValue;
    }
  } catch {
    // Fall through to localStorage.
  }
  try {
    return window.localStorage.getItem(GOOGLE_AUTH_STATE_KEY);
  } catch {
    return null;
  }
}

function clearGoogleAuthState() {
  try {
    window.sessionStorage.removeItem(GOOGLE_AUTH_STATE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
  try {
    window.localStorage.removeItem(GOOGLE_AUTH_STATE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function isStoredGoogleAuthState(value: StoredGoogleAuthState) {
  return (
    typeof value?.fromPath === "string" &&
    (value.authOwner === undefined || (typeof value.authOwner === "string" && value.authOwner.length <= 8192)) &&
    value.fromPath.startsWith("/") &&
    (value.pricingDestination === undefined || (typeof value.pricingDestination === "string" && value.pricingDestination.length <= 2048)) &&
    typeof value.redirectUri === "string" &&
    value.redirectUri.length > 0 &&
    typeof value.state === "string" &&
    value.state.length > 0 &&
    typeof value.issuedAt === "number" &&
    Number.isFinite(value.issuedAt)
  );
}
