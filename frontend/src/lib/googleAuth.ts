import type { BetaAuthConfig } from "./api";

const GOOGLE_AUTH_STATE_KEY = "edgelab.google-auth.state.v1";
const GOOGLE_AUTH_STATE_TTL_MS = 15 * 60 * 1000;

type StoredGoogleAuthState = {
  fromPath: string;
  issuedAt: number;
  redirectUri: string;
  state: string;
};

function randomState() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `oauth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isGoogleAuthConfigured(config: BetaAuthConfig | null | undefined) {
  return Boolean(config?.google_enabled && config.google_client_id?.trim());
}

export function buildGoogleAuthorizeUrl(
  fromPath: string,
  clientId: string,
  configuredRedirectUri?: string | null,
) {
  const redirectUri =
    configuredRedirectUri?.trim() || `${window.location.origin}/auth/callback/google`;
  const state = randomState();
  const payload: StoredGoogleAuthState = {
    fromPath,
    issuedAt: Date.now(),
    redirectUri,
    state,
  };
  storeGoogleAuthState(payload);

  const query = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

export function consumeGoogleAuthState(receivedState: string | null) {
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
      parsed.state !== receivedState ||
      Date.now() - parsed.issuedAt > GOOGLE_AUTH_STATE_TTL_MS
    ) {
      clearGoogleAuthState();
      return null;
    }
    clearGoogleAuthState();
    return parsed;
  } catch {
    clearGoogleAuthState();
    return null;
  }
}

function storeGoogleAuthState(payload: StoredGoogleAuthState) {
  const rawValue = JSON.stringify(payload);
  try {
    window.sessionStorage.setItem(GOOGLE_AUTH_STATE_KEY, rawValue);
  } catch {
    // Keep the OAuth flow usable when sessionStorage is blocked.
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
    value.fromPath.startsWith("/") &&
    typeof value.redirectUri === "string" &&
    value.redirectUri.length > 0 &&
    typeof value.state === "string" &&
    value.state.length > 0 &&
    typeof value.issuedAt === "number" &&
    Number.isFinite(value.issuedAt)
  );
}
