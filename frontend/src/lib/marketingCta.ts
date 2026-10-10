import { buildAuthSignInHref } from "./authJourney";
import { deploymentMode, type DeploymentMode } from "./deploymentMode";

const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
] as const;
const INVALID_ATTRIBUTION_VALUE = /[\u0000-\u001f\u007f]/;
const MAX_ATTRIBUTION_VALUE_LENGTH = 160;

// A marketing preview never changes authentication or paid-access deployment mode.
export function marketingPresentationFromSearch(search: string): "beta" | "production" {
  return new URLSearchParams(search).get("variant") === "beta" ? "beta" : "production";
}

/** Keep the preview variant only on public destinations, never on private routes. */
export function marketingPresentationHref(href: string, mode: DeploymentMode): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "https://edgelab.invalid");
  if (url.pathname !== "/" && url.pathname !== "/pricing") return href;
  if (mode === "beta") url.searchParams.set("variant", "beta");
  else url.searchParams.delete("variant");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildMarketingPricingHref(search: string, cadence: "monthly" | "annual") {
  const query = marketingAttributionFromSearch(search);
  query.set("cadence", cadence);
  return marketingPresentationHref(`/pricing?${query.toString()}`, marketingPresentationFromSearch(search));
}

type MarketingCtaOptions = {
  mode?: DeploymentMode;
  forceWaitlist?: boolean;
  search: string;
  seatsRemaining: number | null | undefined;
};

export function buildMarketingCta({
  mode = deploymentMode,
  forceWaitlist = false,
  search,
  seatsRemaining,
}: MarketingCtaOptions) {
  const waitlist = forceWaitlist || (seatsRemaining != null && seatsRemaining <= 0);
  const attribution = marketingAttributionFromSearch(search);
  const destination = attribution.size > 0 ? `/app?${attribution.toString()}` : "/app";

  if (mode === "personal") return { href: destination, label: "Open workspace", waitlist: false } as const;

  if (mode === "production") {
    return { href: attribution.size > 0 ? `/pricing?${attribution.toString()}` : "/pricing", label: "View plans", waitlist: false } as const;
  }

  return {
    href: buildAuthSignInHref({ fromPath: destination, waitlist }),
    label: waitlist ? "Join waitlist" : "Join beta",
    waitlist,
  } as const;
}

export function marketingAttributionFromSearch(search: string) {
  const source = new URLSearchParams(search);
  const attribution = new URLSearchParams();

  ATTRIBUTION_KEYS.forEach((key) => {
    const value = source.get(key)?.trim();
    if (
      !value ||
      value.length > MAX_ATTRIBUTION_VALUE_LENGTH ||
      INVALID_ATTRIBUTION_VALUE.test(value)
    ) {
      return;
    }
    attribution.set(key, value);
  });

  return attribution;
}
