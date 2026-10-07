import { Check, ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { authDestinationFromLocation, buildAuthSignInHref } from "../../lib/authJourney";
import { getAuthSession } from "../../lib/api";
import { getStoredAuthSession, hasWorkspaceAccess, setStoredAuthSession, subscribeAuthSession, toStoredAuthSession } from "../../lib/authSession";
import {
  clearBillingDestination, createBillingCheckout, getBillingCatalog, getBillingDestination, getBillingStatus, hasActiveSubscription, rememberBillingDestination,
  hasExistingBillingSubscription, type BillingCadence, type BillingCatalog, type BillingStatus,
} from "../../lib/billing";

const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-el-md border border-edgelab-border px-4 py-3 text-sm font-medium transition-colors hover:border-cyan-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 disabled:cursor-not-allowed disabled:opacity-50";
const features = [
  "Bar replay and simulated order management",
  "Charts, drawing tools, and technical indicators",
  "Journal, reports, and playbook review",
  "Backtest trade imports and strategy review",
  "Native Pine scripts, with experimental compatibility",
];
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);

export function ProPricing({ betaMode = false }: { betaMode?: boolean }) {
  const session = useSyncExternalStore(subscribeAuthSession, getStoredAuthSession, () => null);
  const ownerKey = session ? `${session.user.id}:${session.token}` : "";
  const location = useLocation();
  const [query, setQuery] = useSearchParams();
  const cadence: BillingCadence = query.get("cadence") === "annual" ? "annual" : "monthly";
  const billingReturn = query.get("billing");
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [billing, setBilling] = useState<{ ownerKey: string; status: BillingStatus } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [actionError, setActionError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const generation = useRef(0);
  const checkout = useRef<AbortController | null>(null);
  const frequencyId = useId();
  const googleIdentity = session?.user.provider === "google";

  useEffect(() => {
    const version = ++generation.current;
    const controller = new AbortController();
    setCatalogLoading(true); setCatalogError(""); setStatusError(""); setActionError(""); setBilling(null); setBusy(false);
    setStatusLoading(!!googleIdentity);
    const current = () => version === generation.current && !controller.signal.aborted;
    void getBillingCatalog(controller.signal).then(value => {
      if (current()) setCatalog(value);
    }).catch(error => {
      if (current()) { setCatalog(null); setCatalogError(error instanceof Error ? error.message : "Pricing could not be loaded. Try again."); }
    }).finally(() => { if (current()) setCatalogLoading(false); });
    if (googleIdentity && session) {
      void getBillingStatus(session, controller.signal).then(async status => {
        if (hasActiveSubscription(status) && !hasWorkspaceAccess(getStoredAuthSession())) {
          try {
            const response = await getAuthSession(session.token);
            const owner = getStoredAuthSession();
            if (current() && owner?.token === session.token && owner.user.id === session.user.id &&
                response.user.id === session.user.id && response.user.provider === "google") {
              // Keep the original owner token; this read may return a reissued JWT.
              setStoredAuthSession({ ...toStoredAuthSession(response), token: session.token });
            }
          } catch {
            if (current()) setStatusError("Your subscription is confirmed, but workspace access could not be refreshed. Refresh billing status or try again from Account.");
          }
        }
        if (current()) { setBilling({ ownerKey, status }); setNow(Date.now()); }
      }).catch(error => {
        if (current()) setStatusError(error instanceof Error ? error.message : "Billing could not be checked. Try again.");
      }).finally(() => { if (current()) setStatusLoading(false); });
    }
    return () => { ++generation.current; controller.abort(); checkout.current?.abort(); checkout.current = null; };
    // Only identity changes invalidate an account-bound request, not access-lease updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, googleIdentity, retry]);

  const status = billing?.ownerKey === ownerKey ? billing.status : null;
  useEffect(() => {
    if (!status) return;
    const expiry = Math.min(Date.parse(status.verified_at ?? "") + 300_000, Date.parse(status.current_period_end ?? ""));
    if (!Number.isFinite(expiry) || expiry <= Date.now()) { setNow(Date.now()); return; }
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, expiry - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [status]);
  const active = hasActiveSubscription(status, now);
  const betaWaiting = session?.user.deploymentMode === "beta" && !session.user.approved;
  const workspaceReady = hasWorkspaceAccess(session, now);
  const existing = hasExistingBillingSubscription(status);
  const awaiting = billingReturn === "success" && !active;
  const plan = catalog?.plans[0];
  const annualSaving = plan ? plan.monthly_amount * 12 - plan.annual_amount : 0;
  const destination = authDestinationFromLocation(location);
  const explicitFrom = (typeof location.state === "object" && location.state !== null && "fromPath" in location.state && typeof location.state.fromPath === "string") || query.has("from");
  const recoveredDestination = getBillingDestination(session);
  const chosenDestination = explicitFrom ? destination : recoveredDestination ?? destination;
  const workspaceDestination = chosenDestination === "/account" || chosenDestination.startsWith("/pricing") ? "/app" : chosenDestination;
  const signInHref = buildAuthSignInHref({ fromPath: `/pricing?cadence=${cadence}` });

  const startCheckout = async () => {
    if (!session || !googleIdentity || checkout.current || !catalog?.checkout_available || !status || existing || awaiting || betaWaiting) return;
    const owner = session;
    const version = generation.current;
    const controller = new AbortController();
    checkout.current = controller; setBusy(true); setActionError("");
    try {
      rememberBillingDestination(workspaceDestination, owner);
      const url = await createBillingCheckout(cadence, owner, controller.signal);
      const current = getStoredAuthSession();
      if (version === generation.current && !controller.signal.aborted && current?.token === owner.token && current.user.id === owner.user.id) {
        window.location.assign(url);
      }
    } catch (error) {
      if (version === generation.current && !controller.signal.aborted) { clearBillingDestination(owner); setActionError(error instanceof Error ? error.message : "Checkout could not be opened. Refresh your billing status before trying again."); }
    } finally {
      if (checkout.current === controller) checkout.current = null;
      if (version === generation.current) setBusy(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16" data-testid="pro-pricing">
      <div className="min-w-0">
        <h2 className="text-3xl font-semibold tracking-[-0.04em] text-edgelab-text-primary sm:text-4xl">{betaMode ? "Add paid exports to your review." : "One plan for your trading review."}</h2>
        <p className="mt-5 max-w-xl text-base leading-7 text-edgelab-text-secondary">Replay a session, review your decisions, and keep the evidence in one workspace.</p>
        <ul className="mt-8 space-y-4 text-sm leading-6 text-edgelab-text-primary">
          {features.map(feature => <li key={feature} className="flex items-start gap-3"><Check aria-hidden="true" size={18} className="mt-1 shrink-0 text-cyan-200" /><span>{feature}</span></li>)}
        </ul>
        <p className="mt-7 max-w-xl text-sm leading-6 text-edgelab-text-secondary">Bring your own market data. Live feeds, broker connections, AI providers, and order-flow data require separate credentials and permissions. Pine compatibility is experimental; supported outputs and limitations are shown in the editor.</p>
        <p className="mt-3 text-sm leading-6 text-edgelab-text-secondary">Data exports require an active paid subscription.</p>
        {betaMode && <p className="mt-3 text-sm leading-6 text-edgelab-text-secondary">Pro enables paid exports. Beta workspace access still requires approval; purchasing Pro does not reserve or unlock a beta seat.</p>}
      </div>
      <div className="min-w-0 border border-edgelab-border bg-edgelab-bg-secondary p-5 sm:p-8">
        <h3 className="text-xl font-semibold tracking-tight text-edgelab-text-primary">EdgeLab Pro</h3>
        <fieldset className="mt-6">
          <legend className="sr-only">Billing frequency</legend>
          <div className="grid grid-cols-2 gap-2">
            {([{ value: "monthly", label: "Monthly" }, { value: "annual", label: "Yearly" }] as const).map(option => (
              <label key={option.value} className="relative min-w-0 cursor-pointer">
                <input type="radio" name={frequencyId} value={option.value} checked={cadence === option.value} disabled={busy}
                  className="peer absolute inset-0 h-full min-h-11 w-full cursor-pointer opacity-0" onChange={() => setQuery(previous => { const next = new URLSearchParams(previous); next.set("cadence", option.value); return next; }, { replace: true, state: location.state })} />
                <span className={`flex min-h-11 items-center justify-center rounded-el-md border px-4 py-3 text-sm font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-200 peer-disabled:opacity-50 ${cadence === option.value ? "border-cyan-200/60 bg-cyan-200/10 text-cyan-100" : "border-edgelab-border text-edgelab-text-secondary hover:text-edgelab-text-primary"}`}>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-7 min-h-28" aria-live="polite">
          {catalogLoading ? <p role="status" className="text-sm text-edgelab-text-secondary">Loading published pricing…</p> : plan ? <>
            <p className="text-edgelab-text-primary"><span className="text-5xl font-semibold tracking-[-0.04em]">{money(cadence === "annual" ? plan.annual_amount / 12 : plan.monthly_amount)}</span><span className="ml-2 text-sm text-edgelab-text-secondary">USD / month</span></p>
            <p className="mt-3 text-sm leading-6 text-edgelab-text-secondary">{cadence === "annual" ? `${money(plan.annual_amount)} USD billed yearly. Save ${money(annualSaving)} per year (${Math.round(annualSaving / (plan.monthly_amount * 12) * 100)}%) compared with monthly billing.` : `${money(plan.monthly_amount)} USD billed monthly.`}</p>
          </> : <><p role="alert" className="text-sm leading-6 text-edgelab-text-secondary">{catalogError}</p><button type="button" className={`${actionClass} mt-3 text-edgelab-text-primary`} onClick={() => setRetry(value => value + 1)}>Retry pricing</button></>}
        </div>
        {catalog?.mode === "test" && catalog.checkout_available && !catalogLoading && <p className="mt-4 text-sm leading-6 text-amber-100">Test billing. Test subscriptions do not grant paid workspace access.</p>}
        {catalog && !catalogLoading && !catalog.checkout_available && <p className="mt-4 text-sm leading-6 text-edgelab-text-secondary">These are the announced plan prices. Paid checkout is not available yet; no subscription can be purchased here.</p>}
        {billingReturn === "success" && <p role="status" className="mt-4 text-sm leading-6 text-edgelab-text-secondary">{active ? "Your active paid subscription is confirmed." : "You returned from checkout. Payment and access still need confirmation from the billing server. Refresh your status or check Account."}</p>}
        {billingReturn === "cancel" && <p role="status" className="mt-4 text-sm leading-6 text-edgelab-text-secondary">Checkout was closed. Check your billing status before trying again; this return link does not confirm payment or cancellation.</p>}
        {betaWaiting && <p className="mt-4 text-sm leading-6 text-edgelab-text-secondary">Your beta access is awaiting approval. Check Account before purchasing Pro; payment does not grant a beta seat.</p>}
        {statusLoading && <p role="status" className="mt-4 text-sm text-edgelab-text-secondary">Checking your billing status…</p>}
        {statusError && <p role="alert" className="mt-4 text-sm leading-6 text-edgelab-text-secondary">{statusError}</p>}
        {actionError && <p role="alert" className="mt-4 text-sm leading-6 text-edgelab-text-secondary">{actionError}</p>}
        {active && !workspaceReady && !statusLoading && <p className="mt-4 text-sm leading-6 text-edgelab-text-secondary">{session?.user.deploymentMode === "beta" ? "Your paid subscription is confirmed. Beta workspace access still requires an approved seat; check Account for your access status." : "Your paid subscription is confirmed. Refresh billing status to update your workspace access."}</p>}
        {status && !active && existing && <p className="mt-4 text-sm leading-6 text-edgelab-text-secondary">{status.mode === "test" ? "A test subscription already exists. Manage it in Account; it does not unlock paid access." : "A subscription already exists. Check its payment or renewal status in Account before starting another purchase."}</p>}
        <div className="mt-6 flex flex-col gap-3">
          {active && workspaceReady ? <>
            <Link className={`${actionClass} border-cyan-200/60 bg-cyan-200 text-slate-950 hover:bg-cyan-100`} to={workspaceDestination} onClick={() => clearBillingDestination(session)}>Open workspace <ArrowRight aria-hidden="true" size={16} /></Link>
            <Link className={`${actionClass} text-edgelab-text-primary`} to="/account">Manage billing</Link>
          </> : !googleIdentity ? <Link className={`${actionClass} border-cyan-200/60 bg-cyan-200 text-slate-950 hover:bg-cyan-100`} to={signInHref} state={{ fromPath: `/pricing?cadence=${cadence}`, pricingDestination: workspaceDestination }}>Sign in with Google <ArrowRight aria-hidden="true" size={16} /></Link> : existing || awaiting || betaWaiting ? <Link className={`${actionClass} text-edgelab-text-primary`} to="/account">{betaWaiting ? "Check account access" : "Manage billing"}</Link> : <button type="button" className={`${actionClass} border-cyan-200/60 bg-cyan-200 text-slate-950 hover:bg-cyan-100`} onClick={() => void startCheckout()} disabled={busy || catalogLoading || statusLoading || !status || !catalog?.checkout_available}>{busy ? "Opening checkout…" : catalog && !catalog.checkout_available ? "Checkout unavailable" : catalog?.mode === "test" ? "Continue to test checkout" : "Continue to checkout"}<ArrowRight aria-hidden="true" size={16} /></button>}
          {googleIdentity && <button type="button" className={`${actionClass} text-edgelab-text-primary`} disabled={busy || statusLoading || catalogLoading} onClick={() => setRetry(value => value + 1)}>Refresh billing status</button>}
          {session && !active && !existing && !awaiting && !betaWaiting && <Link className={`${actionClass} text-edgelab-text-primary`} to="/account">View account</Link>}
        </div>
        <p className="mt-5 text-xs leading-5 text-edgelab-text-secondary">Checkout opens on Stripe. No free trial. Subscriptions renew at the displayed monthly or yearly price until canceled. Account provides subscription management and cancellation.</p>
      </div>
    </div>
  );
}

export default ProPricing;
