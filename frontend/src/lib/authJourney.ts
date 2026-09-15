export const DEFAULT_AUTH_DESTINATION = "/app";
const AUTH_DESTINATION_BASE = "https://edgelab.invalid";
const CONTROL_OR_BACKSLASH_PATTERN = /[\\\u0000-\u001f\u007f]/;
const ENCODED_SEPARATOR_OR_CONTROL_PATTERN = /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i;
const WORKSPACE_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,128}$/;

type AuthLocationLike = {
  search: string;
  state: unknown;
};

type SignInHrefOptions = {
  error?: string | null;
  fromPath?: string | null;
  reason?: string | null;
  waitlist?: boolean;
};

export type AuthJourneyIssue = {
  description: string;
  kind: "cancelled" | "denied" | "expired" | "retryable";
  title: string;
};

export function safeAuthDestination(value: string | null | undefined) {
  if (!value || CONTROL_OR_BACKSLASH_PATTERN.test(value) || !value.startsWith("/")) {
    return DEFAULT_AUTH_DESTINATION;
  }

  const rawPath = value.split(/[?#]/, 1)[0] ?? "";
  let decodedPath = rawPath;
  try {
    for (let depth = 0; depth < 3; depth += 1) {
      if (ENCODED_SEPARATOR_OR_CONTROL_PATTERN.test(decodedPath)) {
        return DEFAULT_AUTH_DESTINATION;
      }
      const nextPath = decodeURIComponent(decodedPath);
      if (nextPath === decodedPath) {
        break;
      }
      decodedPath = nextPath;
    }
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }

  if (
    CONTROL_OR_BACKSLASH_PATTERN.test(decodedPath) ||
    decodedPath.startsWith("//")
  ) {
    return DEFAULT_AUTH_DESTINATION;
  }

  try {
    const parsed = new URL(value, AUTH_DESTINATION_BASE);
    const isWorkspacePath =
      parsed.pathname === "/app" || parsed.pathname.startsWith("/app/");
    const shareToken = parsed.hash.slice(1);
    const isSharePath =
      parsed.pathname === "/shared" &&
      parsed.search === "" &&
      WORKSPACE_SHARE_TOKEN_PATTERN.test(shareToken);
    if (
      parsed.origin !== AUTH_DESTINATION_BASE ||
      (!isWorkspacePath && !isSharePath)
    ) {
      return DEFAULT_AUTH_DESTINATION;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }
}

export function authDestinationFromLocation(location: AuthLocationLike) {
  const state = location.state;
  const fromState =
    typeof state === "object" &&
    state &&
    "fromPath" in state &&
    typeof state.fromPath === "string"
      ? state.fromPath
      : null;
  const fromQuery = new URLSearchParams(location.search).get("from");
  return safeAuthDestination(fromState ?? fromQuery);
}

export function buildAuthSignInHref({
  error,
  fromPath,
  reason,
  waitlist = false,
}: SignInHrefOptions = {}) {
  const query = new URLSearchParams();
  const destination = safeAuthDestination(fromPath);
  // Share capabilities stay in navigation state. Putting the fragment-backed
  // token in this query would expose it to access logs and Referer headers.
  if (
    destination !== DEFAULT_AUTH_DESTINATION &&
    !destination.startsWith("/shared#")
  ) {
    query.set("from", destination);
  }
  if (waitlist) {
    query.set("waitlist", "1");
  }
  if (reason) {
    query.set("reason", reason);
  }
  if (error) {
    query.set("error", error);
  }
  const search = query.toString();
  return search ? `/auth/signin?${search}` : "/auth/signin";
}

export function authJourneyIssue(searchParams: URLSearchParams): AuthJourneyIssue | null {
  const reason = searchParams.get("reason")?.toLowerCase() ?? "";
  const error = searchParams.get("error")?.toLowerCase() ?? "";
  const combined = `${reason} ${error}`;

  if (combined.includes("expired") || combined.includes("state")) {
    return {
      description: "Your previous sign-in can no longer be used. Start again and EdgeLab will return you to the same destination.",
      kind: "expired",
      title: "Your sign-in expired.",
    };
  }
  if (combined.includes("access_denied") || combined.includes("cancel")) {
    return {
      description: "No account changes were made. Continue when you are ready, or return to the product page.",
      kind: "cancelled",
      title: "Sign-in was cancelled.",
    };
  }
  if (combined.includes("denied") || combined.includes("forbidden") || combined.includes("not approved")) {
    return {
      description: "This account is not approved for the current beta cohort. You can reserve a place on the waitlist instead.",
      kind: "denied",
      title: "Beta access is not available for this account.",
    };
  }
  if (error) {
    return {
      description: "EdgeLab could not complete the secure handoff. Your destination is preserved, so it is safe to try again.",
      kind: "retryable",
      title: "We could not finish signing in.",
    };
  }
  return null;
}
