import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { deleteAuthSession, getAuthSession } from "../lib/api";
import {
  clearStoredAuthSession,
  getStoredAuthSession,
  initialsForName,
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
      <div className="w-full max-w-md rounded-[30px] border border-white/10 bg-white/[0.04] p-8 text-center shadow-card">
        <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-cyan-300/20 border-t-cyan-300" />
        <div className="mt-6 text-display text-3xl text-white">Loading route</div>
        <p className="mt-3 text-sm leading-7 text-slate-400">
          Pulling next EdgeLab surface into view.
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

function WorkspaceSessionChip() {
  const session = useAuthSession();

  if (!session) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[120] flex items-center gap-3">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-[#05070de6] px-3 py-2 text-slate-100 shadow-card backdrop-blur-xl">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-300 text-sm font-bold text-slate-950">
          {initialsForName(session.user.name)}
        </div>
        <div className="hidden sm:block">
          <div className="text-sm font-semibold">{session.user.name}</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
            {session.user.plan}
          </div>
        </div>
        <button
          className="rounded-full border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-300/30 hover:text-cyan-100"
          onClick={() => {
            const token = session.token;
            clearStoredAuthSession();
            void deleteAuthSession(token).catch(() => undefined);
          }}
          type="button"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function ProtectedWorkspace({ WorkspaceApp }: { WorkspaceApp: ComponentType }) {
  const session = useAuthSession();
  const location = useLocation();

  if (!session) {
    const fromPath = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate replace to={`/auth/signin?from=${encodeURIComponent(fromPath)}`} />;
  }

  if (!session.user.approved) {
    return (
      <Navigate
        replace
        to={`/auth/signin?from=${encodeURIComponent(location.pathname)}&waitlist=1`}
      />
    );
  }

  return (
    <>
      <WorkspaceSessionChip />
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
