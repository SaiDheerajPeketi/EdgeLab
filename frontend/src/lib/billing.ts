import { apiRequest, getAuthSession } from "./api";
import { isWorkspaceAuthDestination } from "./authJourney";
import { isPersonalMode } from "./deploymentMode";
import { getStoredAuthSession, isPersonalWorkspaceSession, setStoredAuthSession, toStoredAuthSession, type AuthSession } from "./authSession";

export type BillingStatus = {
  provider: "stripe";
  mode: "test" | "live";
  configured: boolean;
  workspace_access: boolean;
  subscription_access: boolean;
  plan: "pro" | null;
  status: string;
  cadence: "monthly" | "annual" | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  verified_at: string | null;
  refresh_required: boolean;
};

export type BillingCadence = "monthly" | "annual";
export type BillingCatalog = {
  provider: "stripe";
  enabled: boolean;
  mode: "test" | "live";
  checkout_available: boolean;
  reason: string | null;
  plans: [{ id: "pro"; name: "EdgeLab Pro"; currency: "usd"; monthly_amount: 2900; annual_amount: 29000 }];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Billing information could not be verified. Refresh and try again.");
  return value as Record<string, unknown>;
}

function nullableDate(value: unknown) {
  return value === null || (typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value)));
}

function assertOwner(owner: AuthSession | null): asserts owner is AuthSession {
  const current = getStoredAuthSession();
  if (!owner || !current || current.token !== owner.token || current.user.id !== owner.user.id) {
    throw new DOMException("The account changed before billing completed.", "AbortError");
  }
  if (owner.user.provider !== "google") throw new Error("Sign in with Google to manage your subscription.");
}

function assertNotCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Billing request canceled.", "AbortError");
}

export async function getBillingCatalog(signal?: AbortSignal): Promise<BillingCatalog> {
  const value = record(await apiRequest<unknown>("/billing/catalog", { signal, cache: "no-store" }));
  assertNotCanceled(signal);
  const plans = value.plans;
  if (value.provider !== "stripe" || (value.mode !== "test" && value.mode !== "live") ||
      typeof value.enabled !== "boolean" || typeof value.checkout_available !== "boolean" ||
      (value.checkout_available && !value.enabled) ||
      !(value.reason === null || (typeof value.reason === "string" && value.reason.length <= 1024)) ||
      !Array.isArray(plans) || plans.length !== 1) throw new Error("Published pricing could not be verified. Try again.");
  const plan = record(plans[0]);
  if (plan.id !== "pro" || plan.name !== "EdgeLab Pro" || plan.currency !== "usd" ||
      plan.monthly_amount !== 2900 || plan.annual_amount !== 29000) throw new Error("Published pricing could not be verified. Try again.");
  return { provider: "stripe", enabled: value.enabled, mode: value.mode as BillingCatalog["mode"],
    checkout_available: value.checkout_available, reason: value.reason as string | null,
    plans: [{ id: "pro", name: "EdgeLab Pro", currency: "usd", monthly_amount: 2900, annual_amount: 29000 }] };
}

export async function getBillingStatus(owner: AuthSession | null = getStoredAuthSession(), signal?: AbortSignal): Promise<BillingStatus> {
  assertOwner(owner);
  const value = record(await apiRequest<unknown>("/billing/status", {
    signal, cache: "no-store", headers: { Authorization: `Bearer ${owner.token}` },
  }));
  assertNotCanceled(signal);
  assertOwner(owner);
  const states = ["inactive", "active", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired", "canceled", "paused"];
  if (value.provider !== "stripe" || (value.mode !== "test" && value.mode !== "live") ||
      !["configured", "workspace_access", "subscription_access", "cancel_at_period_end", "refresh_required"].every(key => typeof value[key] === "boolean") ||
      (value.plan !== null && value.plan !== "pro") || (value.cadence !== null && value.cadence !== "monthly" && value.cadence !== "annual") ||
      typeof value.status !== "string" || !states.includes(value.status) ||
      !nullableDate(value.current_period_end) || !nullableDate(value.verified_at) ||
      (value.workspace_access && (value.mode !== "live" || !value.subscription_access || !value.configured)) ||
      (value.subscription_access && (!value.configured || value.plan !== "pro" || value.status !== "active"))) {
    throw new Error("Your billing status could not be verified. Refresh and try again.");
  }
  return value as BillingStatus;
}

export function hasExistingBillingSubscription(status: BillingStatus | null) {
  return !!status && !["inactive", "canceled", "incomplete_expired"].includes(status.status);
}

function hostedBillingUrl(value: unknown, host: "checkout.stripe.com" | "billing.stripe.com") {
  if (typeof value !== "string" || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value) || value.match(/^https:\/\/([^/?#]+)/)?.[1] !== host) throw new Error("The billing link could not be verified. Refresh your account and try again.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("The billing link could not be verified. Refresh your account and try again."); }
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || url.port) {
    throw new Error("The billing link could not be verified. Refresh your account and try again.");
  }
  return url.href;
}

export async function createBillingCheckout(cadence: BillingCadence, owner: AuthSession | null = getStoredAuthSession(), signal?: AbortSignal) {
  assertOwner(owner);
  if (owner.user.deploymentMode === "beta" && !owner.user.approved) throw new Error("Beta workspace approval is required before purchasing Pro. Check your access in Account.");
  if (cadence !== "monthly" && cadence !== "annual") throw new Error("Choose monthly or yearly billing.");
  assertNotCanceled(signal);
  const catalog = await getBillingCatalog(signal);
  assertOwner(owner);
  if (!catalog.checkout_available) throw new Error("Checkout is not available yet. Please try again later.");
  const status = await getBillingStatus(owner, signal);
  if (!status.configured || status.mode !== catalog.mode || status.refresh_required) throw new Error("Billing could not be confirmed. Refresh your status before checkout.");
  if (hasExistingBillingSubscription(status)) throw new Error("You already have a subscription to manage. Open Account instead of starting another checkout.");
  assertOwner(owner);
  assertNotCanceled(signal);
  const response = record(await apiRequest<unknown>("/billing/checkout", {
    method: "POST", signal, headers: { Authorization: `Bearer ${owner.token}` },
    body: JSON.stringify({ plan: "pro", cadence }),
  }));
  assertNotCanceled(signal);
  assertOwner(owner);
  return hostedBillingUrl(response.url, "checkout.stripe.com");
}

const BILLING_DESTINATION_KEY = "edgelab.billing.destination";

/** Share capabilities stay in session storage, never a checkout URL or local storage. */
export function rememberBillingDestination(destination: string, owner: AuthSession | null = getStoredAuthSession()) {
  assertOwner(owner);
  if (destination.length > 2048 || !isWorkspaceAuthDestination(destination)) return;
  try { window.sessionStorage.setItem(BILLING_DESTINATION_KEY, JSON.stringify({ userId: owner.user.id, token: owner.token, destination, savedAt: Date.now() })); }
  catch { /* Checkout remains usable; Account provides a workspace recovery path. */ }
}

export function getBillingDestination(owner: AuthSession | null = getStoredAuthSession()): string | null {
  const current = getStoredAuthSession();
  if (!owner || current?.token !== owner.token || current.user.id !== owner.user.id || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(BILLING_DESTINATION_KEY);
    if (!raw || raw.length > 8192) return null;
    const value = record(JSON.parse(raw));
    if (value.userId !== owner.user.id || value.token !== owner.token || typeof value.savedAt !== "number" ||
        !Number.isFinite(value.savedAt) || value.savedAt > Date.now() || value.savedAt <= Date.now() - 86_400_000 ||
        typeof value.destination !== "string" || value.destination.length > 2048) return null;
    return isWorkspaceAuthDestination(value.destination) ? value.destination : null;
  } catch { return null; }
}

export function clearBillingDestination(owner: AuthSession | null = getStoredAuthSession()) {
  if (!owner || typeof window === "undefined") return;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(BILLING_DESTINATION_KEY) ?? "null");
    if (value?.userId === owner.user.id && value?.token === owner.token) window.sessionStorage.removeItem(BILLING_DESTINATION_KEY);
  } catch { /* Invalid recovery data is never used. */ }
}

export async function openBillingPortal(owner: AuthSession | null = getStoredAuthSession(), signal?: AbortSignal) {
  assertOwner(owner);
  const response = record(await apiRequest<unknown>("/billing/portal", { method: "POST", body: "{}", signal,
    headers: { Authorization: `Bearer ${owner.token}` } }));
  assertNotCanceled(signal);
  assertOwner(owner);
  const url = hostedBillingUrl(response.url, "billing.stripe.com");
  window.location.assign(url);
}

export function hasActiveSubscription(status: BillingStatus | null, now = Date.now()) {
  if (!status || status.configured !== true || status.mode !== "live" || status.workspace_access !== true || status.subscription_access !== true ||
      status.status !== "active" || status.plan !== "pro") return false;
  const verified = Date.parse(status.verified_at ?? "");
  return verified <= now && verified > now - 300_000 && Date.parse(status.current_period_end ?? "") > now;
}

function storedIdentity(raw: string | null) {
  try { const session = JSON.parse(raw ?? "null"); return session ? `${session.user?.id}:${session.token}` : ""; }
  catch { return "invalid"; }
}

/** Personal export access is reconciled with the server under the original identity. */
export async function refreshPersonalWorkspaceSession(owner: AuthSession | null = getStoredAuthSession()) {
  if (!isPersonalMode() || !owner || owner.user.deploymentMode !== "personal") throw new Error("Open your local workspace before exporting data.");
  const controller = new AbortController();
  const retire = () => controller.abort();
  const storage = (event: StorageEvent) => {
    if (event.key === null || (event.key === "edgelab.auth.session.v1" && storedIdentity(event.oldValue) !== storedIdentity(event.newValue))) retire();
  };
  window.addEventListener("edgelab:auth-session-change", retire);
  window.addEventListener("storage", storage);
  const assertOwner = () => {
    const current = getStoredAuthSession();
    if (controller.signal.aborted || current?.token !== owner.token || current.user.id !== owner.user.id) {
      throw new DOMException("The account changed before local access could be checked.", "AbortError");
    }
  };
  try {
    assertOwner();
    const response = await getAuthSession(owner.token, controller.signal);
    assertOwner();
    if (response.user.id !== owner.user.id || response.token !== owner.token) throw new Error("Your local workspace access could not be verified. Open the workspace again.");
    const next = toStoredAuthSession(response);
    setStoredAuthSession(next);
    if (!isPersonalWorkspaceSession(next)) throw new Error("Your local workspace session expired or access is unavailable. Open the workspace again.");
    return next;
  } finally {
    window.removeEventListener("edgelab:auth-session-change", retire);
    window.removeEventListener("storage", storage);
  }
}

export async function requireActiveExportSubscription(owner: AuthSession | null = getStoredAuthSession()) {
  if (!owner) throw new Error(isPersonalMode() ? "Open your local workspace session to export data." : "Sign in with an active paid subscription to export your data.");
  if (isPersonalMode()) return refreshPersonalWorkspaceSession(owner);
  const status = await getBillingStatus(owner);
  const current = getStoredAuthSession();
  if (current?.token !== owner.token || current.user.id !== owner.user.id) throw new DOMException("The account changed before export.", "AbortError");
  if (!hasActiveSubscription(status)) throw new Error("Data exports require an active paid subscription. Manage your subscription in Account.");
  return owner;
}

export async function downloadSubscribedTextFile(filename: string, contents: string, type: string) {
  if (typeof document === "undefined") return;
  const owner = getStoredAuthSession();
  try {
    await requireActiveExportSubscription(owner);
    const current = getStoredAuthSession();
    if (current?.token !== owner?.token || current?.user.id !== owner?.user.id) return;
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    if (getStoredAuthSession()?.token !== owner?.token) return;
    window.dispatchEvent(new CustomEvent("edgelab:export-error", { detail: error instanceof Error ? error.message : "Your subscription could not be checked. Try again from Account." }));
  }
}
