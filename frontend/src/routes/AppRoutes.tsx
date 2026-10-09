import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthJourneyShell } from "../components/auth/AuthJourneyShell";
import { EdgePulseLoader } from "../components/EdgePulseLoader";
import { DataTransferProvider } from "../components/settings/useDataTransfer";
import { AuthCallbackPage } from "../pages/AuthCallbackPage";
import { ApiError, getAuthSession, getUiRolloutConfig } from "../lib/api";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  hasWorkspaceAccess,
  setStoredAuthSession,
  subscribeAuthSession,
  toStoredAuthSession,
} from "../lib/authSession";
import {
  buildAuthSignInHref,
  buildPricingHref,
} from "../lib/authJourney";
import { loadAppStorageItem, saveAppStorageItem } from "../lib/serverStorage";
import {
  normalizeServerUiRollout,
  initialUiRolloutState,
  persistUiRolloutSnapshot,
  resolveServerUiRollout,
  resolveUiRollout,
  rolloutStorageKey,
  routeGroup,
  routeUsesModernUi,
} from "../lib/uiRollout";

const LandingPage = lazy(() =>
  import("../pages/LandingPage").then((module) => ({ default: module.LandingPage })),
);
const CompatibilityRouteRenderer = lazy(() =>
  import("../components/compatibility/CompatibilityRouteRenderer").then((module) => ({ default: module.CompatibilityRouteRenderer })),
);
const PricingPage = lazy(() =>
  import("../pages/PricingPage").then((module) => ({ default: module.PricingPage })),
);
const AccountPage = lazy(() => import("../pages/AccountPage").then((module) => ({ default: module.AccountPage })));
const PrivacyPage = lazy(() =>
  import("../pages/LegalPages").then((module) => ({ default: module.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("../pages/LegalPages").then((module) => ({ default: module.TermsPage })),
);
const AuthSignInRoute = lazy(() =>
  import("./AuthSignInRoute").then((module) => ({ default: module.AuthSignInRoute })),
);
const SharedWorkspacePage = lazy(() =>
  import("../pages/SharedWorkspacePage").then((module) => ({ default: module.SharedWorkspacePage })),
);
const loadWorkspaceModule = () => import("../App");
const WorkspaceApp = lazy(() =>
  loadWorkspaceModule().then((module) => ({ default: module.WorkspaceApp })),
);
const NotFoundPage = lazy(() =>
  import("../pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })),
);

function preloadWorkspaceSurface() {
  return Promise.all([
    loadWorkspaceModule(),
    import("../components/EdgeLabWorkspace"),
  ]).catch(() => undefined);
}

function AppRouteFallback() {
  const location = useLocation();
  const signingIn = location.pathname === "/auth/callback/google";
  const title = signingIn ? "Signing in" : "Opening EdgeLab";

  return (
    <AuthJourneyShell description="This usually takes a moment." statusLabel={signingIn ? "Secure sign-in" : "Loading"} title={title}>
      <EdgePulseLoader label={title} showLabel size="lg" />
    </AuthJourneyShell>
  );
}

function useAuthSession() {
  return useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, getStoredAuthSession);
}

function SessionRehydrator() {
  const session = useAuthSession();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!session?.token) {
      return;
    }

    let active = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      getAuthSession(session.token)
      .then((response) => {
        if (!active) {
          return;
        }
        const next = { ...toStoredAuthSession(response), token: session.token };
        const current = getStoredAuthSession();
        if (current?.token === session.token && JSON.stringify(current) !== JSON.stringify(next)) setStoredAuthSession(next);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        if (!(error instanceof ApiError) || error.status !== 401 || getStoredAuthSession()?.token !== session.token) return;
        clearStoredAuthSession();
        if (location.pathname.startsWith("/app")) {
          const fromPath = `${location.pathname}${location.search}${location.hash}`;
          navigate(buildAuthSignInHref({ fromPath, reason: "session-expired" }), {
            replace: true,
            state: { fromPath },
          });
        }
      })
      .finally(() => { pending = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    const handleVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [navigate, session?.token, location.pathname, location.search, location.hash]);

  return null;
}

const WORKSPACE_BETA_NOTICE_KEY = "workspace-beta-notice-dismissed.v1";

function WorkspaceBetaNotice() {
  const session = useAuthSession();
  const location = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!session?.user.isBetaUser) {
      setVisible(false);
      return;
    }

    let active = true;
    let timer: number | null = null;

    void loadAppStorageItem<unknown>(WORKSPACE_BETA_NOTICE_KEY, false).then((dismissed) => {
      if (!active) {
        return;
      }
      if (dismissed === true || dismissed === "1") {
        setVisible(false);
        return;
      }
      setVisible(true);
      timer = window.setTimeout(() => {
        void saveAppStorageItem(WORKSPACE_BETA_NOTICE_KEY, true);
        setVisible(false);
      }, 3400);
    });

    return () => {
      active = false;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [session?.user.isBetaUser]);

  if (!session?.user.isBetaUser || !visible || location.pathname === "/shared") {
    return null;
  }

  return (
    <div className="pointer-events-none relative z-[120] flex justify-center px-3 py-2 lg:fixed lg:inset-x-0 lg:top-4 lg:px-4 lg:py-0">
      <div
        aria-atomic="true"
        aria-live="polite"
        className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-full border border-amber-300/15 bg-[#091019f2] px-4 py-2.5 text-sm text-slate-200 shadow-[0_18px_46px_rgba(0,0,0,0.34)] backdrop-blur-xl transition duration-500"
        role="status"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_18px_rgba(252,211,77,0.45)] motion-safe:animate-pulse" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/75">
          Beta workspace
        </span>
        <span className="hidden text-slate-600 sm:inline">•</span>
        <span>Temporary beta data</span>
      </div>
    </div>
  );
}

function ProtectedWorkspace({ WorkspaceApp }: { WorkspaceApp: ComponentType }) {
  const session = useAuthSession();
  const location = useLocation();

  useEffect(() => {
    if (hasWorkspaceAccess(session) && location.pathname.startsWith("/app")) {
      void preloadWorkspaceSurface();
    }
  }, [location.pathname, session]);

  if (!session) {
    const fromPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        replace
        state={{ fromPath }}
        to={buildAuthSignInHref({ fromPath })}
      />
    );
  }

  if (!hasWorkspaceAccess(session)) {
    const fromPath = `${location.pathname}${location.search}${location.hash}`;
    if (session.user.deploymentMode !== "beta") {
      return <Navigate replace state={{ fromPath }} to={buildPricingHref(fromPath)} />;
    }
    return (
      <Navigate
        replace
        state={{ fromPath }}
        to={buildAuthSignInHref({ fromPath, waitlist: true })}
      />
    );
  }

  return (
    <>
      <WorkspaceBetaNotice />
      <WorkspaceApp />
    </>
  );
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <SessionRehydrator />
      <RouteTransitionBoundary>
        <Suspense fallback={<AppRouteFallback />}>
          <Routes>
          <Route element={<LandingPage />} path="/" />
          <Route element={<Navigate replace to="/" />} path="/index.html" />
          <Route element={<PricingPage />} path="/pricing" />
          <Route element={<AccountPage />} path="/account" />
          <Route element={<PrivacyPage />} path="/privacy" />
          <Route element={<TermsPage />} path="/terms" />
          <Route element={<AuthSignInRoute />} path="/auth/signin" />
          <Route element={<AuthCallbackPage />} path="/auth/callback/google" />
          <Route element={<ProtectedWorkspace WorkspaceApp={SharedWorkspacePage} />} path="/shared" />
          <Route element={<ProtectedWorkspace WorkspaceApp={WorkspaceApp} />} path="/app" />
          <Route element={<ProtectedWorkspace WorkspaceApp={WorkspaceApp} />} path="/app/*" />
          <Route element={<Navigate replace to="/app" />} path="/workspace" />
          <Route element={<NotFoundPage />} path="*" />
          </Routes>
        </Suspense>
      </RouteTransitionBoundary>
    </BrowserRouter>
  );
}

type UiRolloutRuntimeState = {
  flags: ReturnType<typeof resolveUiRollout>;
  revision: string;
  source: "cache" | "fallback" | "server";
};

const UI_ROLLOUT_REFRESH_MS = 60_000;
const UI_ROLLOUT_STORAGE_KEY = rolloutStorageKey();

function rolloutRuntimeState(
  response: unknown,
  source: UiRolloutRuntimeState["source"],
): UiRolloutRuntimeState | null {
  const normalized = normalizeServerUiRollout(response);
  return normalized ? {
    flags: resolveServerUiRollout(normalized),
    revision: normalized.revision,
    source,
  } : null;
}

function readInitialUiRolloutState(): UiRolloutRuntimeState {
  if (typeof window === "undefined") return initialUiRolloutState(null);
  try {
    return initialUiRolloutState(window.localStorage.getItem(UI_ROLLOUT_STORAGE_KEY), import.meta.env.DEV, window.location.hostname);
  } catch {
    return initialUiRolloutState(null);
  }
}

export function RouteTransitionBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useAuthSession();
  const boundaryRef = useRef<HTMLDivElement>(null);
  const [rollout, setRollout] = useState(readInitialUiRolloutState);
  const group = routeGroup(location.pathname);

  useEffect(() => {
    let active = true;
    let requestInFlight = false;

    const refresh = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const response = await getUiRolloutConfig();
        if (!active) return;
        const next = rolloutRuntimeState(response, "server");
        try { persistUiRolloutSnapshot(window.localStorage, response); } catch {
          // The runtime policy still applies when browser storage is disabled.
        }
        if (!next) {
          setRollout({
            flags: resolveUiRollout({ killSwitch: true }),
            revision: "invalid-server-config",
            source: "fallback",
          });
          return;
        }
        setRollout(next);
      } catch {
        // Keep the last valid response (or the initial presentation state) so
        // a transient outage cannot undo an operator fallback.
      } finally {
        requestInFlight = false;
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, UI_ROLLOUT_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary) return;
    boundary.dataset.transitioning = "true";
    const timer = window.setTimeout(() => delete boundary.dataset.transitioning, 120);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  const modernUiEnabled = routeUsesModernUi(location.pathname, rollout.flags);
  // Session writes and presentation refreshes must not remount a pending handoff.
  const googleCallback = location.pathname === "/auth/callback/google";

  return (
    <DataTransferProvider><div
      key={googleCallback ? "google-callback" : session?.user.id ?? "anonymous"}
      className={`ui-route-transition ${modernUiEnabled ? "" : "ui-route-fallback"}`}
      data-route-group={group}
      data-ui-rollout-revision={rollout.revision}
      data-ui-rollout-source={rollout.source}
      data-ui-version={modernUiEnabled ? "v2" : "fallback"}
      ref={boundaryRef}
    >
      {googleCallback || modernUiEnabled ? children : <Suspense fallback={<AppRouteFallback />}><CompatibilityRouteRenderer group={group} /></Suspense>}
    </div></DataTransferProvider>
  );
}
