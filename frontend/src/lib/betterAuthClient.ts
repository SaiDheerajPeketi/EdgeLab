import { createAuthClient } from "better-auth/client";
import { storeGoogleAuthAttempt, ownsGoogleAuthAttempt } from "./googleAuth";
import { getStoredAuthSession } from "./authSession";

function ownerIdentity() {
  const session = getStoredAuthSession();
  return session ? JSON.stringify([session.user.id, session.token]) : "";
}

export async function beginBetterAuthSignIn(fromPath: string, pricingDestination?: string, owns = () => true) {
  const client = createAuthClient({ baseURL: window.location.origin, basePath: "/api/better-auth" });
  const redirectUri = `${window.location.origin}/auth/callback/google`;
  const state = storeGoogleAuthAttempt(fromPath, redirectUri, pricingDestination, ownerIdentity());
  const callback = new URL(redirectUri);
  callback.searchParams.set("better_auth", "1");
  callback.searchParams.set("state", state);
  const response = await client.signIn.social({ provider: "google", callbackURL: callback.href, errorCallbackURL: callback.href, disableRedirect: true });
  if (!owns() || !ownsGoogleAuthAttempt(state, ownerIdentity())) return;
  if (response.error) throw new Error("Google sign-in is unavailable right now. Try again shortly.");
  const target = new URL(response.data?.url ?? "");
  if (target.protocol !== "https:" || target.hostname !== "accounts.google.com" || target.username || target.password) throw new Error("Invalid Google sign-in destination");
  window.location.replace(target.href);
}
