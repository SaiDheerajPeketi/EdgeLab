import type { BetaAuthConfig } from "./api";

const GOOGLE_AUTH_STATE_KEY = "edgelab.google-auth.state.v1";

type StoredGoogleAuthState = {
  fromPath: string;
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

export function buildGoogleAuthorizeUrl(fromPath: string, clientId: string) {
  const redirectUri = `${window.location.origin}/auth/callback/google`;
  const state = randomState();
  const payload: StoredGoogleAuthState = {
    fromPath,
    redirectUri,
    state,
  };
  window.sessionStorage.setItem(GOOGLE_AUTH_STATE_KEY, JSON.stringify(payload));

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
  const rawValue = window.sessionStorage.getItem(GOOGLE_AUTH_STATE_KEY);
  window.sessionStorage.removeItem(GOOGLE_AUTH_STATE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as StoredGoogleAuthState;
    if (!receivedState || parsed.state !== receivedState) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
