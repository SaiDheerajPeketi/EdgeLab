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
    deploymentMode: "beta" | "production";
    workspaceAccess: boolean;
    accessExpiresAt: string | null;
    isBetaUser: boolean;
    name: string;
    plan: "beta" | "pro" | "none";
    provider: "email" | "google";
  };
};

const AUTH_STORAGE_KEY = "edgelab.auth.session.v1";
const listeners = new Set<() => void>();
let accessExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let cachedRawSession: string | null = null;
let cachedSession: AuthSession | null = null;

type AuthSessionUpdateOptions = {
  notify?: boolean;
};

function isBrowser() {
  return typeof window !== "undefined";
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function notifyAuthIdentityChange() {
  if (isBrowser()) window.dispatchEvent(new Event("edgelab:auth-session-change"));
}

function identityKey(session: AuthSession | null) {
  return session ? `${session.user.id}:${session.token}` : "";
}

function scheduleAccessExpiry() {
  if (accessExpiryTimer) clearTimeout(accessExpiryTimer);
  accessExpiryTimer = null;
  if (!listeners.size) return;
  const session = getStoredAuthSession();
  const deadline = session && session.user.workspaceAccess === true
    ? Math.min(Date.parse(session.expiresAt), Date.parse(session.user.accessExpiresAt ?? "")) : NaN;
  if (!Number.isFinite(deadline)) return;
  accessExpiryTimer = setTimeout(() => {
    accessExpiryTimer = null;
    const current = getStoredAuthSession();
    if (current && !hasWorkspaceAccess(current)) {
      setStoredAuthSession({ ...current, user: { ...current.user, workspaceAccess: false } });
    } else {
      notifyListeners();
      scheduleAccessExpiry();
    }
  }, Math.max(0, Math.min(2_147_483_647, deadline - Date.now())));
}

function safeParse(rawValue: string | null): AuthSession | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as AuthSession;
    if (typeof parsed?.user?.email !== "string" || !parsed.user.email || !Number.isSafeInteger(parsed.user.id) || parsed.user.id <= 0 ||
        typeof parsed.expiresAt !== "string" || typeof parsed.token !== "string" || !parsed.token.trim()) {
      return null;
    }
    if (!(Date.parse(parsed.expiresAt) > Date.now())) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function resetCachedSession() {
  cachedRawSession = null;
  cachedSession = null;
}

function setCachedSession(rawValue: string | null, session: AuthSession | null) {
  cachedRawSession = rawValue;
  cachedSession = session;
}

export function getStoredAuthSession(): AuthSession | null {
  if (!isBrowser()) {
    return null;
  }

  const rawValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (rawValue === cachedRawSession) {
    if (cachedSession && new Date(cachedSession.expiresAt).getTime() <= Date.now()) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      resetCachedSession();
      return null;
    }
    return cachedSession;
  }

  const session = safeParse(rawValue);
  if (!session && rawValue) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    resetCachedSession();
    return null;
  }
  setCachedSession(rawValue, session);
  return session;
}

export function setStoredAuthSession(
  session: AuthSession | null,
  options: AuthSessionUpdateOptions = {},
) {
  if (!isBrowser()) {
    return;
  }

  const previousIdentity = identityKey(getStoredAuthSession());

  if (!session) {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    resetCachedSession();
  } else {
    const rawValue = JSON.stringify(session);
    window.localStorage.setItem(AUTH_STORAGE_KEY, rawValue);
    setCachedSession(rawValue, session);
  }
  if (options.notify !== false) {
    notifyListeners();
  }
  if (previousIdentity !== identityKey(session)) notifyAuthIdentityChange();
  scheduleAccessExpiry();
}

export function clearStoredAuthSession(options: AuthSessionUpdateOptions = {}) {
  setStoredAuthSession(null, options);
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
      deploymentMode: session.user.deployment_mode,
      workspaceAccess: session.user.workspace_access === true,
      accessExpiresAt: session.user.access_expires_at,
      isBetaUser: session.user.is_beta_user === true,
      name: session.user.name,
      plan: session.user.plan,
      provider: session.user.provider,
    },
  };
}

export function hasWorkspaceAccess(session: AuthSession | null, now = Date.now()) {
  if (!session || session.user.workspaceAccess !== true ||
      !(Date.parse(session.expiresAt) > now) ||
      !(Date.parse(session.user.accessExpiresAt ?? "") > now)) return false;
  return session.user.deploymentMode === "beta"
    ? session.user.approved === true && session.user.isBetaUser === true && session.user.plan === "beta"
    : session.user.deploymentMode === "production" && session.user.isBetaUser === false && session.user.plan === "pro";
}

export function subscribeAuthSession(listener: () => void) {
  listeners.add(listener);
  scheduleAccessExpiry();

  if (!isBrowser()) {
    return () => listeners.delete(listener);
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_STORAGE_KEY) {
      notifyListeners();
      if (identityKey(safeParse(event.oldValue)) !== identityKey(safeParse(event.newValue))) notifyAuthIdentityChange();
      scheduleAccessExpiry();
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    scheduleAccessExpiry();
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
