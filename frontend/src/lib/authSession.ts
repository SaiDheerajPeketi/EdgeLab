import type { BetaAuthSession } from "./api";

export type AuthSession = {
  createdAt: string;
  expiresAt: string;
  token: string;
  user: {
    approved: boolean;
    betaPosition: number | null;
    email: string;
    id: number;
    isBetaUser: true;
    name: string;
    plan: "beta";
    provider: "email" | "google";
  };
};

const AUTH_STORAGE_KEY = "edgelab.auth.session.v1";
const listeners = new Set<() => void>();

function isBrowser() {
  return typeof window !== "undefined";
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function safeParse(rawValue: string | null): AuthSession | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as AuthSession;
    if (!parsed?.user?.email || !parsed.expiresAt || !parsed.token) {
      return null;
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getStoredAuthSession(): AuthSession | null {
  if (!isBrowser()) {
    return null;
  }

  const session = safeParse(window.localStorage.getItem(AUTH_STORAGE_KEY));
  if (!session && window.localStorage.getItem(AUTH_STORAGE_KEY)) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  }
  return session;
}

export function setStoredAuthSession(session: AuthSession | null) {
  if (!isBrowser()) {
    return;
  }

  if (!session) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } else {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  }
  notifyListeners();
}

export function clearStoredAuthSession() {
  setStoredAuthSession(null);
}

export function toStoredAuthSession(session: BetaAuthSession): AuthSession {
  return {
    createdAt: session.created_at,
    expiresAt: session.expires_at,
    token: session.token,
    user: {
      approved: session.user.approved,
      betaPosition: session.user.beta_position,
      email: session.user.email,
      id: session.user.id,
      isBetaUser: true,
      name: session.user.name,
      plan: "beta",
      provider: session.user.provider,
    },
  };
}

export function subscribeAuthSession(listener: () => void) {
  listeners.add(listener);

  if (!isBrowser()) {
    return () => listeners.delete(listener);
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_STORAGE_KEY) {
      notifyListeners();
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function initialsForName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
