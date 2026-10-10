import { ArrowRight, Download, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, Navigate } from "react-router-dom";
import { AuthJourneyShell } from "../components/auth/AuthJourneyShell";
import { deleteAuthSession, exportAppDataBundle, getAuthSession } from "../lib/api";
import { clearStoredAuthSession, getStoredAuthSession, hasWorkspaceAccess, isPersonalWorkspaceSession, setStoredAuthSession, subscribeAuthSession, toStoredAuthSession } from "../lib/authSession";
import { getBillingStatus, hasActiveSubscription, openBillingPortal, requireActiveExportSubscription, refreshPersonalWorkspaceSession, type BillingStatus } from "../lib/billing";
import { isPersonalMode } from "../lib/deploymentMode";

const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-el-md border border-edgelab-border px-4 py-3 text-sm font-medium text-edgelab-text-primary transition-colors hover:bg-edgelab-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-50";

export function AccountPage() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, getStoredAuthSession);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<"refresh" | "access" | "portal" | "export" | "signout" | null>("refresh");
  const [error, setError] = useState("");
  const [billingError, setBillingError] = useState("");
  const [accessError, setAccessError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now());
  const generation = useRef(0);
  const accessRequest = useRef<AbortController | null>(null);
  const personal = isPersonalMode();
  const ownerKey = session ? `${session.user.id}:${session.token}` : "";

  async function refresh() {
    const run = ++generation.current;
    setBusy("refresh"); setBilling(null); setBillingError(""); setAccessError(""); setError(""); setNotice("");
    try {
      if (personal) {
        await refreshPersonalWorkspaceSession(session);
        if (run === generation.current) setClock(Date.now());
      } else {
        const value = await getBillingStatus();
        if (run === generation.current) { setBilling(value); setClock(Date.now()); }
      }
    } catch (caught) {
      if (run === generation.current) {
        const message = caught instanceof Error ? caught.message : "Your access could not be checked. Try again.";
        if (personal) setAccessError(message); else setBillingError(message);
      }
    } finally { if (run === generation.current) setBusy(null); }
  }

  useEffect(() => {
    setBilling(null);
    setAccessError("");
    if (ownerKey) void refresh();
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    const retire = () => { generation.current += 1; accessRequest.current?.abort(); setBusy(null); setBilling(null); };
    window.addEventListener("edgelab:auth-session-change", retire);
    return () => { window.removeEventListener("edgelab:auth-session-change", retire); generation.current += 1; accessRequest.current?.abort(); window.clearInterval(timer); };
  }, [ownerKey]);

  if (!session) return <Navigate replace to="/auth/signin?from=%2Faccount" />;
  const subscribed = hasActiveSubscription(billing, clock);
  const workspace = hasWorkspaceAccess(session, clock);
  const canExport = personal ? isPersonalWorkspaceSession(session, clock) : subscribed;
  const beta = session.user.deploymentMode === "beta";
  const betaApprovalRequired = beta && !session.user.approved;
  const betaAccessUnavailable = beta && !workspace;
  const billingUnavailable = busy !== "refresh" && billing === null && Boolean(billingError);
  // A failed status reconciliation does not prevent the server from opening an owned billing portal.
  const canManageBilling = !personal && session.user.provider === "google" && billing?.configured !== false;
  const subscriptionLabel = busy === "refresh" ? "Checking subscription" : billingUnavailable ? "Subscription status unavailable" : subscribed ? "Subscription active" : billing?.mode === "test" && billing.subscription_access ? "Test subscription" : "No active subscription";
  const workspaceLabel = personal ? workspace ? "Available" : "Local session unavailable" : workspace ? "Available" : betaApprovalRequired ? "Beta approval required" : beta ? "Beta access unavailable" : billingUnavailable ? "Access could not be checked" : "Subscription required";

  async function checkAccess() {
    if (busy || !session || !beta) return;
    const owner = session, run = ++generation.current;
    const controller = new AbortController();
    accessRequest.current = controller;
    const retire = () => controller.abort();
    window.addEventListener("edgelab:auth-session-change", retire, { once: true });
    setBusy("access"); setAccessError(""); setNotice("");
    try {
      const response = await getAuthSession(owner.token, controller.signal);
      const current = getStoredAuthSession();
      if (controller.signal.aborted || run !== generation.current || current?.token !== owner.token || current.user.id !== owner.user.id) return;
      if (response.user.id !== owner.user.id) throw new Error("Your account access could not be verified. Try signing in again.");
      setStoredAuthSession({ ...toStoredAuthSession(response), token: owner.token });
      setClock(Date.now());
    } catch (caught) {
      if (!controller.signal.aborted && run === generation.current) setAccessError(caught instanceof Error ? caught.message : "Your workspace access could not be checked. Try again.");
    } finally {
      window.removeEventListener("edgelab:auth-session-change", retire);
      if (accessRequest.current === controller) accessRequest.current = null;
      if (run === generation.current) setBusy(null);
    }
  }

  async function perform(action: "portal" | "export" | "signout") {
    if (busy || !session || (action === "portal" && !canManageBilling) || (action === "export" && !(personal ? isPersonalWorkspaceSession(session) : hasActiveSubscription(billing)))) return;
    const run = ++generation.current;
    setBusy(action); setError(""); setNotice("");
    try {
      if (action === "portal") await openBillingPortal(session);
      else if (action === "signout") {
        await deleteAuthSession(session.token);
        if (run === generation.current) clearStoredAuthSession();
      } else {
        if (personal) await requireActiveExportSubscription(session);
        if (run !== generation.current) return;
        const bundle = await exportAppDataBundle();
        if (run !== generation.current) return;
        if (personal ? !isPersonalWorkspaceSession(getStoredAuthSession()) : !hasActiveSubscription(billing)) throw new Error(personal ? "Open your local workspace session to export data." : "Your subscription needs to be checked again before exporting. Refresh your status and retry.");
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url; link.download = "edgelab-data.json"; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice("Your data export is ready.");
      }
    } catch (caught) {
      if (run === generation.current) setError(caught instanceof Error ? caught.message : "This action could not be completed. Try again.");
    } finally { if (run === generation.current) setBusy(null); }
  }

  return <AuthJourneyShell
    title="Your EdgeLab account."
    description={personal ? "Manage your local session and workspace data." : "Manage your subscription and data from one place."}
    statusLabel={personal ? busy === "refresh" ? "Checking local access" : workspace ? "Personal workspace" : workspaceLabel : betaAccessUnavailable ? workspaceLabel : subscriptionLabel}
    statusTone={personal ? workspace ? "accent" : "warning" : betaAccessUnavailable ? "warning" : subscribed ? "accent" : "neutral"}
    rail={<div>
      <h2 className="text-xl font-medium tracking-[-0.02em]">Account details</h2>
      <dl className="mt-5 divide-y divide-edgelab-border border-y border-edgelab-border text-sm">
        <div className="py-4"><dt className="text-edgelab-text-secondary">Name</dt><dd className="mt-1 break-words font-medium">{session.user.name}</dd></div>
        <div className="py-4"><dt className="text-edgelab-text-secondary">Email</dt><dd className="mt-1 break-all font-medium">{session.user.email}</dd></div>
        <div className="py-4"><dt className="text-edgelab-text-secondary">Workspace</dt><dd className="mt-1 font-medium">{workspaceLabel}</dd></div>
      </dl>
      <p className="mt-5 text-sm leading-6 text-edgelab-text-secondary">{personal ? "Signing out closes access to this local session. Open the workspace again to continue." : "Signing out leaves your subscription unchanged. Manage billing to change or cancel it."}</p>
      <button className={`${actionClass} mt-5 w-full`} disabled={busy !== null} onClick={() => void perform("signout")} type="button"><LogOut aria-hidden="true" size={16} />{busy === "signout" ? "Signing out…" : "Sign out"}</button>
    </div>}
  >
    {betaAccessUnavailable && <section aria-labelledby="account-access-title" className="mb-8 border-b border-edgelab-border pb-7">
      <h2 className="text-xl font-medium" id="account-access-title">{betaApprovalRequired ? "Beta approval required" : "Beta access unavailable"}</h2>
      <p className="mt-3 text-base leading-7 text-edgelab-text-secondary">{betaApprovalRequired ? "Your account needs approval to enter the beta workspace. A subscription does not grant beta approval." : "Your beta workspace access is currently unavailable. Check your access to get the latest account status."}</p>
      <button className={`${actionClass} mt-5`} disabled={busy !== null} onClick={() => void checkAccess()} type="button"><RefreshCw aria-hidden="true" size={16} />{busy === "access" ? "Checking access…" : "Check access"}</button>
      {accessError && <p className="mt-3 text-sm leading-6 text-amber-100" role="alert">{accessError}</p>}
    </section>}
    {personal ? <section aria-labelledby="account-local-title">
      <h2 className="text-xl font-medium" id="account-local-title">Local workspace</h2>
      <p className="mt-3 text-base leading-7 text-edgelab-text-secondary">Your workspace and exports use the session issued by your local server.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link className={actionClass} to={workspace ? "/app" : "/auth/signin"}>{workspace ? "Open workspace" : "Open local session"}<ArrowRight aria-hidden="true" size={16} /></Link>
        <button className={actionClass} disabled={busy !== null} onClick={() => void refresh()} type="button"><RefreshCw aria-hidden="true" size={16} />{busy === "refresh" ? "Checking…" : "Refresh access"}</button>
      </div>
      {accessError && <p className="mt-3 text-sm leading-6 text-amber-100" role="alert">{accessError}</p>}
    </section> : <section aria-labelledby="account-subscription-title">
      <h2 className="text-xl font-medium" id="account-subscription-title">Subscription</h2>
      <p className="mt-3 text-base leading-7 text-edgelab-text-secondary">
        {billingUnavailable ? "Your subscription could not be checked. Refresh your status to try again." : subscribed ? billing?.cancel_at_period_end ? "Your plan is active until the end of your current billing period." : "EdgeLab Pro is active. Manage your billing details or cancellation through Stripe." : billing?.mode === "test" && billing.subscription_access ? "This is a test subscription. An active paid subscription is required to export data." : workspace ? beta ? "Your beta workspace is available. Data exports require an active paid subscription." : "Your workspace is available. Data exports require an active paid subscription." : beta ? "You can manage an existing subscription here. Beta workspace access requires separate approval." : "Choose a plan to unlock your workspace and data exports."}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {(workspace || !beta) && <Link className={actionClass} to={workspace ? "/app" : "/pricing"}>{workspace ? "Open workspace" : "View plans"}<ArrowRight aria-hidden="true" size={16} /></Link>}
        <button className={actionClass} disabled={busy !== null || !canManageBilling} onClick={() => void perform("portal")} type="button">{busy === "portal" ? "Opening billing…" : "Manage billing"}<ExternalLink aria-hidden="true" size={16} /></button>
        <button className={actionClass} disabled={busy !== null} onClick={() => void refresh()} type="button"><RefreshCw aria-hidden="true" size={16} />{busy === "refresh" ? "Checking…" : "Refresh status"}</button>
      </div>
    </section>}
    <section aria-labelledby="account-export-title" className="mt-8 border-t border-edgelab-border pt-7">
      <h2 className="text-xl font-medium" id="account-export-title">Your data</h2>
      <p className="mt-3 text-base leading-7 text-edgelab-text-secondary">{personal ? "Download your workspace and journal data as a JSON file." : "Download your workspace and journal data as a JSON file. Data exports require an active paid subscription."}</p>
      <button aria-describedby="account-export-requirement" className={`${actionClass} mt-5`} disabled={busy !== null || !canExport} onClick={() => void perform("export")} type="button"><Download aria-hidden="true" size={16} />{busy === "export" ? "Preparing export…" : "Export data"}</button>
      <p className="mt-3 text-sm leading-6 text-edgelab-text-secondary" id="account-export-requirement">{personal ? canExport ? "Your local session is active. Exports are available." : "Open your local workspace session to export data." : billingUnavailable ? "Exports are unavailable until your subscription status can be verified." : subscribed ? "Your subscription is active. Exports are available." : "Activate a subscription, then refresh your status to export."}</p>
    </section>
    {billingError && <p className="mt-5 text-sm leading-6 text-amber-100" role="alert">{billingError}</p>}
    {error ? <p className="mt-5 text-sm leading-6 text-amber-100" role="alert">{error}</p> : notice ? <p className="mt-5 text-sm leading-6 text-cyan-100" role="status">{notice}</p> : null}
  </AuthJourneyShell>;
}
