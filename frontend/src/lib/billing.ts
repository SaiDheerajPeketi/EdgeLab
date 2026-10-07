import { apiRequest } from "./api";
import { getStoredAuthSession, type AuthSession } from "./authSession";

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

export function getBillingStatus() {
  return apiRequest<BillingStatus>("/billing/status");
}

export async function openBillingPortal() {
  const response = await apiRequest<{ url: string }>("/billing/portal", { method: "POST", body: "{}" });
  const url = new URL(response.url);
  if (url.protocol !== "https:" || url.hostname !== "billing.stripe.com" || url.username || url.password || url.port) {
    throw new Error("The billing link could not be verified. Refresh your account and try again.");
  }
  window.location.assign(url.href);
}

export function hasActiveSubscription(status: BillingStatus | null, now = Date.now()) {
  if (!status || status.configured !== true || status.mode !== "live" || status.workspace_access !== true || status.subscription_access !== true ||
      status.status !== "active" || status.plan !== "pro") return false;
  const verified = Date.parse(status.verified_at ?? "");
  return verified <= now && verified > now - 300_000 && Date.parse(status.current_period_end ?? "") > now;
}

export async function requireActiveExportSubscription(owner: AuthSession | null = getStoredAuthSession()) {
  if (!owner) throw new Error("Sign in with an active paid subscription to export your data.");
  const status = await getBillingStatus();
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
