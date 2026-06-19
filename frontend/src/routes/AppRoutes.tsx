import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getAuthSession } from "../lib/api";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  setStoredAuthSession,
  subscribeAuthSession,
  toStoredAuthSession,
} from "../lib/authSession";

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
const AuthCallbackPage = lazy(() =>
  import("../pages/AuthCallbackPage").then((module) => ({ default: module.AuthCallbackPage })),
);

type AppRoutesProps = {
  NotFoundPage: ComponentType;
  WorkspaceApp: ComponentType;
};

function AppRouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-edgelab-base px-4 text-edgelab-text-primary">
      <div className="w-full max-w-md rounded-[30px] border border-cyan-300/15 bg-white/[0.04] p-8 text-center shadow-card backdrop-blur-xl">
        <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
        <div className="mt-6 text-display text-3xl text-white">Opening EdgeLab</div>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Pulling next trading surface into view.
        </p>
      </div>
    </div>
  );
}

function useAuthSession() {
  return useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, getStoredAuthSession);
}

function SessionRehydrator() {
  const session = useAuthSession();

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
      });

    return () => {
      active = false;
    };
  }, [session?.token]);

  return null;
}

const WORKSPACE_BETA_NOTICE_KEY = "edgelab.workspace.beta-notice.dismissed.v1";

function WorkspaceBetaNotice() {
  const session = useAuthSession();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!session?.user.isBetaUser || typeof window === "undefined") {
      setVisible(false);
      return;
    }

    if (window.sessionStorage.getItem(WORKSPACE_BETA_NOTICE_KEY) === "1") {
      setVisible(false);
      return;
    }

    setVisible(true);

    const timer = window.setTimeout(() => {
      window.sessionStorage.setItem(WORKSPACE_BETA_NOTICE_KEY, "1");
      setVisible(false);
    }, 3400);

    return () => window.clearTimeout(timer);
  }, [session?.user.isBetaUser]);

  if (!session?.user.isBetaUser || !visible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[120] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-full border border-amber-300/15 bg-[#091019f2] px-4 py-2.5 text-sm text-slate-200 shadow-[0_18px_46px_rgba(0,0,0,0.34)] backdrop-blur-xl transition duration-500">
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

  if (!session) {
    const fromPath = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate replace state={{ fromPath }} to="/auth/signin" />;
  }

  if (!session.user.approved) {
    const fromPath = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        replace
        state={{ fromPath }}
        to="/auth/signin?waitlist=1"
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

export function AppRoutes({ WorkspaceApp, NotFoundPage }: AppRoutesProps) {
  return (
    <BrowserRouter>
      <SessionRehydrator />
      <Suspense fallback={<AppRouteFallback />}>
        <Routes>
          <Route element={<LandingPage />} path="/" />
          <Route element={<Navigate replace to="/" />} path="/index.html" />
          <Route element={<PricingPage />} path="/pricing" />
          <Route element={<PrivacyPage />} path="/privacy" />
          <Route element={<TermsPage />} path="/terms" />
          <Route element={<AuthSignInPage />} path="/auth/signin" />
          <Route element={<AuthCallbackPage />} path="/auth/callback/google" />
          <Route element={<ProtectedWorkspace WorkspaceApp={WorkspaceApp} />} path="/app" />
          <Route element={<ProtectedWorkspace WorkspaceApp={WorkspaceApp} />} path="/app/*" />
          <Route element={<Navigate replace to="/app" />} path="/workspace" />
          <Route element={<NotFoundPage />} path="*" />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
