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
export function marketingPresentationFromSearch(search: string): DeploymentMode {
  return new URLSearchParams(search).get("variant") === "beta" ? "beta" : "production";
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
