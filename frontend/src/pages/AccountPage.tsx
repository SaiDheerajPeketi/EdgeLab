import { ArrowRight, Download, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, Navigate } from "react-router-dom";
import { AuthJourneyShell } from "../components/auth/AuthJourneyShell";
import { deleteAuthSession, exportAppDataBundle } from "../lib/api";
import { clearStoredAuthSession, getStoredAuthSession, hasWorkspaceAccess, subscribeAuthSession } from "../lib/authSession";
import { getBillingStatus, hasActiveSubscription, openBillingPortal, type BillingStatus } from "../lib/billing";

const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-el-md border border-edgelab-border px-4 py-3 text-sm font-medium text-edgelab-text-primary transition-colors hover:bg-edgelab-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-50";

export function AccountPage() {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, getStoredAuthSession);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<"refresh" | "portal" | "export" | "signout" | null>("refresh");
  const [error, setError] = useState("");
  const [billingError, setBillingError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now());
  const generation = useRef(0);
  const ownerKey = session ? `${session.user.id}:${session.token}` : "";

  async function refresh() {
    const run = ++generation.current;
    setBusy("refresh"); setBilling(null); setBillingError(""); setError(""); setNotice("");
    try {
      const value = await getBillingStatus();
      if (run === generation.current) { setBilling(value); setClock(Date.now()); }
    } catch (caught) {
      if (run === generation.current) setBillingError(caught instanceof Error ? caught.message : "Your subscription could not be checked. Try again.");
    } finally { if (run === generation.current) setBusy(null); }
  }

  useEffect(() => {
    setBilling(null);
    if (ownerKey) void refresh();
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { generation.current += 1; window.clearInterval(timer); };
  }, [ownerKey]);

  if (!session) return <Navigate replace to="/auth/signin?from=%2Faccount" />;
  const subscribed = hasActiveSubscription(billing, clock);
  const workspace = hasWorkspaceAccess(session, clock);
  const billingUnavailable = busy !== "refresh" && billing === null && Boolean(billingError);
  // A failed status reconciliation does not prevent the server from opening an owned billing portal.
  const canManageBilling = session.user.provider === "google" && billing?.configured !== false;
  const subscriptionLabel = busy === "refresh" ? "Checking subscription" : billingUnavailable ? "Subscription status unavailable" : subscribed ? "Subscription active" : billing?.mode === "test" && billing.subscription_access ? "Test subscription" : "No active subscription";

  async function perform(action: "portal" | "export" | "signout") {
    if (busy || !session || (action === "portal" && !canManageBilling) || (action === "export" && !hasActiveSubscription(billing))) return;
    const run = ++generation.current;
    setBusy(action); setError(""); setNotice("");
    try {
      if (action === "portal") await openBillingPortal(session);
      else if (action === "signout") {
        await deleteAuthSession(session.token);
        if (run === generation.current) clearStoredAuthSession();
      } else {
        const bundle = await exportAppDataBundle();
        if (run !== generation.current) return;
        if (!hasActiveSubscription(billing)) throw new Error("Your subscription needs to be checked again before exporting. Refresh your status and retry.");
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
    description="Manage your subscription and data from one place."
    statusLabel={subscriptionLabel}
    statusTone={subscribed ? "accent" : "neutral"}
    rail={<div>
      <h2 className="text-xl font-medium tracking-[-0.02em]">Account details</h2>
      <dl className="mt-5 divide-y divide-edgelab-border border-y border-edgelab-border text-sm">
        <div className="py-4"><dt className="text-edgelab-text-secondary">Name</dt><dd className="mt-1 break-words font-medium">{session.user.name}</dd></div>
        <div className="py-4"><dt className="text-edgelab-text-secondary">Email</dt><dd className="mt-1 break-all font-medium">{session.user.email}</dd></div>
        <div className="py-4"><dt className="text-edgelab-text-secondary">Workspace</dt><dd className="mt-1 font-medium">{workspace ? "Available" : "Subscription required"}</dd></div>
      </dl>
      <p className="mt-5 text-sm leading-6 text-edgelab-text-secondary">Signing out leaves your subscription unchanged. Manage billing to change or cancel it.</p>
      <button className={`${actionClass} mt-5 w-full`} disabled={busy !== null} onClick={() => void perform("signout")} type="button"><LogOut aria-hidden="true" size={16} />{busy === "signout" ? "Signing out…" : "Sign out"}</button>
    </div>}
  >
    <section aria-labelledby="account-subscription-title">
      <h2 className="text-xl font-medium" id="account-subscription-title">Subscription</h2>
      <p className="mt-3 text-base leading-7 text-edgelab-text-secondary">
        {billingUnavailable ? "Your subscription could not be checked. Refresh your status to try again." : subscribed ? billing?.cancel_at_period_end ? "Your plan is active until the end of your current billing period." : "EdgeLab Pro is active. Manage your billing details or cancellation through Stripe." : billing?.mode === "test" && billing.subscription_access ? "This is a test subscription. An active paid subscription is required to export data." : workspace ? "Your beta workspace is available. Data exports require an active paid subscription." : "Choose a plan to unlock your workspace and data exports."}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link className={actionClass} to={workspace ? "/app" : "/pricing"}>{workspace ? "Open workspace" : "View plans"}<ArrowRight aria-hidden="true" size={16} /></Link>
        <button className={actionClass} disabled={busy !== null || !canManageBilling} onClick={() => void perform("portal")} type="button">{busy === "portal" ? "Opening billing…" : "Manage billing"}<ExternalLink aria-hidden="true" size={16} /></button>
        <button className={actionClass} disabled={busy !== null} onClick={() => void refresh()} type="button"><RefreshCw aria-hidden="true" size={16} />{busy === "refresh" ? "Checking…" : "Refresh status"}</button>
      </div>
    </section>
    <section aria-labelledby="account-export-title" className="mt-8 border-t border-edgelab-border pt-7">
      <h2 className="text-xl font-medium" id="account-export-title">Your data</h2>
      <p className="mt-3 text-base leading-7 text-edgelab-text-secondary">Download your workspace and journal data as a JSON file. Data exports require an active paid subscription.</p>
      <button aria-describedby="account-export-requirement" className={`${actionClass} mt-5`} disabled={busy !== null || !subscribed} onClick={() => void perform("export")} type="button"><Download aria-hidden="true" size={16} />{busy === "export" ? "Preparing export…" : "Export data"}</button>
      <p className="mt-3 text-sm leading-6 text-edgelab-text-secondary" id="account-export-requirement">{billingUnavailable ? "Exports are unavailable until your subscription status can be verified." : subscribed ? "Your subscription is active. Exports are available." : "Activate a subscription, then refresh your status to export."}</p>
    </section>
    {billingError && <p className="mt-5 text-sm leading-6 text-amber-100" role="alert">{billingError}</p>}
    {error ? <p className="mt-5 text-sm leading-6 text-amber-100" role="alert">{error}</p> : notice ? <p className="mt-5 text-sm leading-6 text-cyan-100" role="status">{notice}</p> : null}
  </AuthJourneyShell>;
}
