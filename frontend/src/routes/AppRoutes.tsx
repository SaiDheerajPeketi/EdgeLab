import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthTransitionScreen } from "../components/auth/AuthTransitionScreen";
import { CompatibilityRouteRenderer } from "../components/compatibility/CompatibilityRouteRenderer";
import { AuthCallbackPage } from "../pages/AuthCallbackPage";
import { getAuthSession, getUiRolloutConfig } from "../lib/api";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
  subscribeAuthSession,
  toStoredAuthSession,
} from "../lib/authSession";
import {
  authDestinationFromLocation,
  buildAuthSignInHref,
} from "../lib/authJourney";
import { loadAppStorageItem, saveAppStorageItem } from "../lib/serverStorage";
import {
  normalizeServerUiRollout,
  parseUiRolloutSnapshot,
  persistUiRolloutSnapshot,
  resolveServerUiRollout,
  resolveUiRollout,
  rolloutStorageKey,
  routeGroup,
} from "../lib/uiRollout";

const LandingPage = lazy(() =>
  import("../pages/LandingPage").then((module) => ({ default: module.LandingPage })),
);
const PricingPage = lazy(() =>
  import("../pages/PricingPage").then((module) => ({ default: module.PricingPage })),
);
const PrivacyPage = lazy(() =>
  import("../pages/LegalPages").then((module) => ({ default: module.PrivacyPage })),
);
const TermsPage = lazy(() =>
  import("../pages/LegalPages").then((module) => ({ default: module.TermsPage })),
);
const AuthSignInPage = lazy(() =>
  import("../pages/AuthSignInPage").then((module) => ({ default: module.AuthSignInPage })),
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

  if (location.pathname === "/auth/callback/google") {
    return (
      <AuthTransitionScreen
        activeStep={0}
        description="This usually takes a moment."
        eyebrow="Secure callback"
        panelEyebrow="Auth path"
        panelTitle="Google return"
        statusLabel="Signing in"
        steps={[
          {
            detail: "Open callback route.",
            label: "Load callback",
          },
          {
            detail: "Exchange code.",
            label: "Restore session",
          },
          {
            detail: "Open workspace.",
            label: "Open workspace",
          },
        ]}
        title="Signing in"
      />
    );
  }

  return (
    <AuthTransitionScreen
      activeStep={1}
      description="This usually takes a moment."
      eyebrow="Routing"
      panelEyebrow="Route path"
      panelTitle="Surface transition"
      statusLabel="Opening EdgeLab"
      steps={[
        {
          detail: "Resolve destination.",
          label: "Match route",
        },
        {
          detail: "Load surface.",
          label: "Load surface",
        },
        {
          detail: "Restore state.",
          label: "Hand off state",
        },
      ]}
      title="Opening EdgeLab"
    />
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

    getAuthSession(session.token)
      .then((response) => {
        if (!active) {
          return;
        }
        setStoredAuthSession(toStoredAuthSession(response));
      })
      .catch(() => {
        if (!active) {
          return;
        }
        clearStoredAuthSession();
        if (location.pathname.startsWith("/app")) {
          const fromPath = `${location.pathname}${location.search}${location.hash}`;
          navigate(buildAuthSignInHref({ fromPath, reason: "session-expired" }), {
            replace: true,
            state: { fromPath },
          });
        }
      });

    return () => {
      active = false;
    };
  }, [navigate, session?.token]);

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
    if (session?.user.approved && location.pathname.startsWith("/app")) {
      void preloadWorkspaceSurface();
    }
  }, [location.pathname, session?.user.approved]);

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

  if (!session.user.approved) {
    const fromPath = `${location.pathname}${location.search}${location.hash}`;
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

function authRedirectTarget(location: { search: string; state: unknown }) {
  return authDestinationFromLocation(location);
}

function AuthSignInRoute() {
  const session = useAuthSession();
  const location = useLocation();

  if (session?.user.approved) {
    return <Navigate replace to={authRedirectTarget(location)} />;
  }

  return <AuthSignInPage />;
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

function initialUiRolloutState(): UiRolloutRuntimeState {
  const fallback: UiRolloutRuntimeState = {
    flags: resolveUiRollout({ killSwitch: true }),
    revision: "awaiting-server",
    source: "fallback",
  };
  if (typeof window === "undefined") return fallback;
  try {
    const cached = parseUiRolloutSnapshot(window.localStorage.getItem(UI_ROLLOUT_STORAGE_KEY));
    return rolloutRuntimeState(cached, "cache") ?? fallback;
  } catch {
    return fallback;
  }
}

export function RouteTransitionBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const session = useAuthSession();
  const boundaryRef = useRef<HTMLDivElement>(null);
  const [rollout, setRollout] = useState(initialUiRolloutState);
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
        // Keep the last valid response (or the fail-closed bootstrap state) so
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

  const modernUiEnabled = rollout.flags[group];

  return (
    <div
      key={session?.user.id ?? "anonymous"}
      className={`ui-route-transition ${modernUiEnabled ? "" : "ui-route-fallback"}`}
      data-route-group={group}
      data-ui-rollout-revision={rollout.revision}
      data-ui-rollout-source={rollout.source}
      data-ui-version={modernUiEnabled ? "v2" : "fallback"}
      ref={boundaryRef}
    >
      {modernUiEnabled ? children : <CompatibilityRouteRenderer group={group} revision={rollout.revision} />}
    </div>
  );
}
